import type { Obstacle } from './arena';
import { isPositiveInteger } from './area';
import { CHAMPION_RADIUS, DT } from './constants';
import { clamp, length, sweepCircleAt, sweepRectAt } from './geometry';
import type { Circle, Segment } from './geometry';
import { landHit } from './energy';
import { copyEffects } from './health';
import { nextId } from './state';
import type {
  CastRecord,
  ChampionState,
  Effect,
  GameState,
  ProjectileEndReason,
  ProjectileState,
} from './state';

export interface ProjectileSpec {
  ownerId: number;
  x: number;
  y: number;
  /** Direction of flight; it is normalized here, so it must not be zero or beyond about 1e154. */
  dirX: number;
  dirY: number;
  /** Meters per second. */
  speed: number;
  radius: number;
  lifetimeTicks: number;
  pierce: boolean;
  effects: readonly Effect[];
  /** Lands on the owner's team instead of `effects`; when given, `effects` may be empty. */
  readonly allyEffects?: readonly Effect[];
}

/** Smallest direction component, in magnitude, that `length` measures without underflow. */
const MIN_DIRECTION = 1e-150;

function fail(problem: string): never {
  throw new Error(`Invalid projectile: ${problem}`);
}

function failAlly(problem: string): never {
  return fail(`allyEffects: ${problem}`);
}

/**
 * Spawns a projectile owned by champion `spec.ownerId` and returns its id. It acts from the
 * next `step` on. A dead owner may still spawn one. `castId` is the cast that fired it, whose
 * hits earn energy; it must be in `state.casts`. Dev tools spawn with null through `debug`.
 */
export function spawnProjectile(
  state: GameState,
  spec: ProjectileSpec,
  castId: number | null = null,
): number {
  const owner = state.champions[spec.ownerId];
  if (!owner) return fail(`unknown owner ${spec.ownerId}`);
  for (const key of ['x', 'y', 'dirX', 'dirY', 'speed', 'radius'] as const) {
    if (!Number.isFinite(spec[key])) return fail(`${key} is not a finite number`);
  }
  if (spec.dirX === 0 && spec.dirY === 0) return fail('direction is zero');
  // `length` squares its arguments, so a direction is only measurable while the squares are
  // normal doubles. The upper bound is `sqrt(MAX_VALUE)` (1.34e154) on an axis. The lower
  // bound is the square root of the smallest normal double (1.49e-154), below which the
  // squares are subnormal and the length is wrong; 1e-150 is a round number safely above it.
  const dirLength = length(spec.dirX, spec.dirY);
  if (!Number.isFinite(dirLength)) return fail('direction is too large to measure');
  if (Math.abs(spec.dirX) < MIN_DIRECTION && Math.abs(spec.dirY) < MIN_DIRECTION) {
    return fail('direction is too small to measure');
  }
  if (spec.speed <= 0) return fail('speed must be above 0');
  if (spec.radius <= 0) return fail('radius must be above 0');
  if (!isPositiveInteger(spec.lifetimeTicks)) {
    return fail('lifetimeTicks must be a positive integer');
  }
  if (typeof spec.pierce !== 'boolean') return fail('pierce must be a boolean');
  const effects = copyEffects(spec.effects, fail);
  let allyEffects: Effect[] | undefined;
  if (spec.allyEffects !== undefined) {
    if (!Array.isArray(spec.allyEffects) || spec.allyEffects.length === 0) {
      return fail('allyEffects must be a non-empty array');
    }
    allyEffects = copyEffects(spec.allyEffects, failAlly);
  }
  if (castId !== null) {
    // A plain loop: a closure over `castId` here would allocate on every spawn.
    const { casts } = state;
    let known = false;
    for (let i = 0; i < casts.length; i++) {
      if ((casts[i] as CastRecord).id !== castId) continue;
      known = true;
      break;
    }
    if (!known) return fail(`unknown cast ${castId}`);
  }

  const projectile: ProjectileState = {
    id: nextId(state),
    ownerId: spec.ownerId,
    team: owner.team,
    x: spec.x + 0,
    y: spec.y + 0,
    vx: (spec.dirX / dirLength) * spec.speed + 0,
    vy: (spec.dirY / dirLength) * spec.speed + 0,
    radius: spec.radius,
    remainingTicks: spec.lifetimeTicks,
    pierce: spec.pierce,
    hitIds: [],
    effects,
    castId,
  };
  // The key is left out when absent: `checksum` throws on undefined and `cloneState` drops it.
  if (allyEffects !== undefined) projectile.allyEffects = allyEffects;
  state.projectiles.push(projectile);
  state.events.push({
    type: 'projectileSpawned',
    projectileId: projectile.id,
    ownerId: projectile.ownerId,
    x: projectile.x,
    y: projectile.y,
    vx: projectile.vx,
    vy: projectile.vy,
    radius: projectile.radius,
  });
  return projectile.id;
}

/** The moving circle of the sweep in progress. `sweep` owns it and fills every field. */
const seg: Segment = { x: 0.5, y: 0.5, dx: 0.5, dy: 0.5, r: 0.5 };
/** The circle `sweep` tests the segment against, and the only writer of it. */
const target: Circle = { cx: 0.5, cy: 0.5, cr: 0.5 };
/**
 * The champions one sweep touches, in ascending (t, id) order, written in place: the first
 * `contactCount` entries are live. `sweep` fills them before the first hit and reads them in
 * the hit pass, and nothing a hit calls sweeps. `contactT` holds doubles and `contactId` holds
 * small integers, so each array keeps its element kind from the start.
 */
const contactT: number[] = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
const contactId: number[] = [0, 0, 0, 0, 0, 0];
let contactCount = 0;

/**
 * A contact at t = 0 only blocks a projectile that moves into the obstacle, so a champion
 * pressed against a wall can still fire away from it. The grown shape is convex, so a
 * projectile that starts inside and moves away never touches it again. It reads `seg`.
 */
function isApproaching(o: Obstacle): boolean {
  if (o.type === 'circle') return (seg.x - o.x) * seg.dx + (seg.y - o.y) * seg.dy < 0;
  const minX = o.x - o.w / 2;
  const maxX = o.x + o.w / 2;
  const minY = o.y - o.h / 2;
  const maxY = o.y + o.h / 2;
  const qx = clamp(seg.x, minX, maxX);
  const qy = clamp(seg.y, minY, maxY);
  if (qx === seg.x && qy === seg.y) return true;
  return (seg.x - qx) * seg.dx + (seg.y - qy) * seg.dy < 0;
}

/** Lands one hit at time t along `seg`: the event, then the effects. */
function hitAt(state: GameState, p: ProjectileState, t: number, targetId: number): void {
  const pos = { x: seg.x + t * seg.dx + 0, y: seg.y + t * seg.dy + 0 };
  state.events.push({
    type: 'projectileHit',
    projectileId: p.id,
    ownerId: p.ownerId,
    targetId,
    x: pos.x,
    y: pos.y,
  });
  // `allyEffects` is only read for a champion of the owner's team, which only an ally-effect
  // projectile touches (see `sweep`).
  const ally = state.champions[targetId]?.team === p.team;
  landHit(state, p, targetId, ally ? (p.allyEffects as Effect[]) : p.effects, pos);
}

/** Ends the projectile at time t along `seg`. */
function expireAt(
  state: GameState,
  p: ProjectileState,
  reason: ProjectileEndReason,
  t: number,
): void {
  state.events.push({
    type: 'projectileExpired',
    projectileId: p.id,
    reason,
    x: seg.x + t * seg.dx + 0,
    y: seg.y + t * seg.dy + 0,
  });
}

/**
 * Returns true when the projectile is gone after this tick's sweep. A tick that hits and ends
 * nothing allocates nothing in the code: no object, array or closure, and no double passed or
 * returned through a call V8 may not inline (see `Segment`; a miss returns the literal
 * `Infinity`). The allocation test still reads about 430 B per step for eight projectiles
 * before V8's final compiler tier.
 */
function sweep(state: GameState, p: ProjectileState): boolean {
  seg.x = p.x;
  seg.y = p.y;
  seg.dx = p.vx * DT;
  seg.dy = p.vy * DT;
  seg.r = p.radius;

  // The first obstacle reached, or Infinity; ties go to the first found.
  let obstacleT = Infinity;
  const obstacles = state.arena.obstacles;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i] as Obstacle;
    if (!o.blocksProjectiles) continue;
    let t: number;
    if (o.type === 'circle') {
      target.cx = o.x;
      target.cy = o.y;
      target.cr = o.r + p.radius;
      t = sweepCircleAt(seg, target);
    } else {
      t = sweepRectAt(seg, o);
    }
    if (t === Infinity || (t === 0 && !isApproaching(o))) continue;
    if (t < obstacleT) obstacleT = t;
  }

  // The arena boundary, where the centre reaches the walls shrunk by the radius.
  const limitX = state.arena.size.width / 2 - p.radius;
  const limitY = state.arena.size.height / 2 - p.radius;
  let boundaryX = Infinity;
  if (seg.dx > 0) boundaryX = Math.max(0, (limitX - seg.x) / seg.dx);
  else if (seg.dx < 0) boundaryX = Math.max(0, (-limitX - seg.x) / seg.dx);
  let boundaryY = Infinity;
  if (seg.dy > 0) boundaryY = Math.max(0, (limitY - seg.y) / seg.dy);
  else if (seg.dy < 0) boundaryY = Math.max(0, (-limitY - seg.y) / seg.dy);
  const boundary = Math.min(boundaryX, boundaryY);
  const boundaryFirst = boundary <= 1 && boundary < obstacleT;
  const blockerT = boundaryFirst ? boundary : obstacleT;

  contactCount = 0;
  const reach = CHAMPION_RADIUS + p.radius;
  const champions = state.champions;
  // An ally-effect projectile touches the owner's team (never the owner); an empty `effects`
  // beside `allyEffects` makes it pass the other team. Without `allyEffects` it is as ever.
  const allies = p.allyEffects !== undefined;
  const enemies = !allies || p.effects.length > 0;
  for (let i = 0; i < champions.length; i++) {
    const c = champions[i] as ChampionState;
    if (!c.alive || p.hitIds.includes(c.id)) continue;
    if (c.team === p.team) {
      if (!allies || c.id === p.ownerId) continue;
    } else if (!enemies) continue;
    target.cx = c.x;
    target.cy = c.y;
    target.cr = reach;
    const t = sweepCircleAt(seg, target);
    if (!(t <= 1 && t <= blockerT)) continue;
    // Insert after every contact that is earlier, or equal in t with a lower id.
    let k = contactCount;
    while (k > 0) {
      const before = contactT[k - 1] as number;
      if (before < t || (before === t && (contactId[k - 1] as number) < c.id)) break;
      contactT[k] = before;
      contactId[k] = contactId[k - 1] as number;
      k--;
    }
    contactT[k] = t;
    contactId[k] = c.id;
    contactCount++;
  }

  const n = contactCount;
  if (!p.pierce) {
    if (n > 0) {
      const t = contactT[0] as number;
      hitAt(state, p, t, contactId[0] as number);
      expireAt(state, p, 'hit', t);
      return true;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const id = contactId[i] as number;
      hitAt(state, p, contactT[i] as number, id);
      p.hitIds.push(id);
    }
  }
  if (blockerT <= 1) {
    expireAt(state, p, boundaryFirst ? 'boundary' : 'obstacle', blockerT);
    return true;
  }
  p.x += seg.dx;
  p.y += seg.dy;
  return false;
}

/** Phase 4: projectiles in id order sweep from their position to the next one. */
export function stepProjectiles(state: GameState): void {
  state.projectiles = state.projectiles.filter((p) => !sweep(state, p));
}

/** Phase 6: a projectile that has made all its sweeps ends. */
export function expireProjectiles(state: GameState): void {
  state.projectiles = state.projectiles.filter((p) => {
    p.remainingTicks -= 1;
    if (p.remainingTicks > 0) return true;
    state.events.push({
      type: 'projectileExpired',
      projectileId: p.id,
      reason: 'lifetime',
      x: p.x,
      y: p.y,
    });
    return false;
  });
}
