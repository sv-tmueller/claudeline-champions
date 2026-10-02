import type { Obstacle } from './arena';
import { isPositiveInteger } from './area';
import { CHAMPION_RADIUS, DT } from './constants';
import { clamp, sweepCircle, sweepRect } from './geometry';
import type { Point } from './geometry';
import { applyEffects, copyEffects } from './health';
import { nextId } from './state';
import type { Effect, GameState, ProjectileEndReason, ProjectileState } from './state';

export interface ProjectileSpec {
  ownerId: number;
  x: number;
  y: number;
  /** Direction of flight; it is normalized here and must not be zero. */
  dirX: number;
  dirY: number;
  /** Meters per second. */
  speed: number;
  radius: number;
  lifetimeTicks: number;
  pierce: boolean;
  effects: readonly Effect[];
}

function fail(problem: string): never {
  throw new Error(`Invalid projectile: ${problem}`);
}

/**
 * Spawns a projectile owned by champion `spec.ownerId` and returns its id. It acts from the
 * next `step` on. A dead owner may still spawn one.
 */
export function spawnProjectile(state: GameState, spec: ProjectileSpec): number {
  const owner = state.champions[spec.ownerId];
  if (!owner) return fail(`unknown owner ${spec.ownerId}`);
  for (const key of ['x', 'y', 'dirX', 'dirY', 'speed', 'radius'] as const) {
    if (!Number.isFinite(spec[key])) return fail(`${key} is not a finite number`);
  }
  const length = Math.hypot(spec.dirX, spec.dirY);
  if (length === 0) return fail('direction is zero');
  if (spec.speed <= 0) return fail('speed must be above 0');
  if (spec.radius <= 0) return fail('radius must be above 0');
  if (!isPositiveInteger(spec.lifetimeTicks)) {
    return fail('lifetimeTicks must be a positive integer');
  }
  if (typeof spec.pierce !== 'boolean') return fail('pierce must be a boolean');
  const effects = copyEffects(spec.effects, fail);

  const projectile: ProjectileState = {
    id: nextId(state),
    ownerId: spec.ownerId,
    team: owner.team,
    x: spec.x + 0,
    y: spec.y + 0,
    vx: (spec.dirX / length) * spec.speed + 0,
    vy: (spec.dirY / length) * spec.speed + 0,
    radius: spec.radius,
    remainingTicks: spec.lifetimeTicks,
    pierce: spec.pierce,
    hitIds: [],
    effects,
  };
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

/**
 * A contact at t = 0 only blocks a projectile that moves into the obstacle, so a champion
 * pressed against a wall can still fire away from it. The grown shape is convex, so a
 * projectile that starts inside and moves away never touches it again.
 */
function isApproaching(o: Obstacle, p0: Point, dx: number, dy: number): boolean {
  if (o.type === 'circle') return (p0.x - o.x) * dx + (p0.y - o.y) * dy < 0;
  const minX = o.x - o.w / 2;
  const maxX = o.x + o.w / 2;
  const minY = o.y - o.h / 2;
  const maxY = o.y + o.h / 2;
  const qx = clamp(p0.x, minX, maxX);
  const qy = clamp(p0.y, minY, maxY);
  if (qx === p0.x && qy === p0.y) return true;
  return (p0.x - qx) * dx + (p0.y - qy) * dy < 0;
}

interface Blocker {
  t: number;
  reason: ProjectileEndReason;
}

/** First obstacle or boundary reached within this tick's sweep; ties go to the first found. */
function findBlocker(
  state: GameState,
  p: ProjectileState,
  p0: Point,
  dx: number,
  dy: number,
): Blocker {
  let best: Blocker = { t: Infinity, reason: 'obstacle' };
  for (const o of state.arena.obstacles) {
    if (!o.blocksProjectiles) continue;
    const t =
      o.type === 'circle'
        ? sweepCircle(p0, dx, dy, o.x, o.y, o.r + p.radius)
        : sweepRect(p0, dx, dy, o, p.radius);
    if (t === Infinity || (t === 0 && !isApproaching(o, p0, dx, dy))) continue;
    if (t < best.t) best = { t, reason: 'obstacle' };
  }
  const limitX = state.arena.size.width / 2 - p.radius;
  const limitY = state.arena.size.height / 2 - p.radius;
  const outward = (pos: number, d: number, limit: number): number => {
    if (d > 0) return Math.max(0, (limit - pos) / d);
    if (d < 0) return Math.max(0, (-limit - pos) / d);
    return Infinity;
  };
  const boundary = Math.min(outward(p0.x, dx, limitX), outward(p0.y, dy, limitY));
  if (boundary <= 1 && boundary < best.t) best = { t: boundary, reason: 'boundary' };
  return best;
}

/** Returns true when the projectile is gone after this tick's sweep. */
function sweep(state: GameState, p: ProjectileState): boolean {
  const p0 = { x: p.x, y: p.y };
  const dx = p.vx * DT;
  const dy = p.vy * DT;
  const blocker = findBlocker(state, p, p0, dx, dy);

  const reach = CHAMPION_RADIUS + p.radius;
  const contacts: { t: number; id: number }[] = [];
  for (const c of state.champions) {
    if (!c.alive || c.team === p.team || p.hitIds.includes(c.id)) continue;
    const t = sweepCircle(p0, dx, dy, c.x, c.y, reach);
    if (t <= 1 && t <= blocker.t) contacts.push({ t, id: c.id });
  }
  contacts.sort((a, b) => a.t - b.t || a.id - b.id);

  const at = (t: number) => ({ x: p0.x + t * dx + 0, y: p0.y + t * dy + 0 });
  const hit = (contact: { t: number; id: number }) => {
    const pos = at(contact.t);
    state.events.push({
      type: 'projectileHit',
      projectileId: p.id,
      ownerId: p.ownerId,
      targetId: contact.id,
      x: pos.x,
      y: pos.y,
    });
    applyEffects(state, p.ownerId, contact.id, p.effects);
  };
  const expire = (reason: ProjectileEndReason, t: number) => {
    const pos = at(t);
    state.events.push({
      type: 'projectileExpired',
      projectileId: p.id,
      reason,
      x: pos.x,
      y: pos.y,
    });
  };

  if (!p.pierce) {
    const first = contacts[0];
    if (first) {
      hit(first);
      expire('hit', first.t);
      return true;
    }
  } else {
    for (const contact of contacts) {
      hit(contact);
      p.hitIds.push(contact.id);
    }
  }
  if (blocker.t <= 1) {
    expire(blocker.reason, blocker.t);
    return true;
  }
  p.x += dx;
  p.y += dy;
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
