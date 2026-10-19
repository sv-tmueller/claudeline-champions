import { CHAMPION_RADIUS, TICK_RATE } from '@claudeline/sim';
import type { ChampionState, GameState, ProjectileState } from '@claudeline/sim';
import { segmentClear } from './geometry';
import type { NavGrid, Vec2 } from './grid';
import { KITE_STEP, cellFree } from './kite';
import { lineOfSight } from './sight';
import type { SightScratch } from './sight';
import { steerTowardInto } from './steer';
import type { MoveCommand } from './steer';

/** Projectiles whose coin the bot remembers; the oldest entry is replaced when all are taken. */
export const DODGE_MEMO_SIZE = 8;

/**
 * What a dodge keeps and what it works in, made once per bot (see Allocation in bots.md). The
 * memo is three typed arrays: the id of a projectile the bot predicted a hit from (-1 when the
 * entry is empty), the think count at which it first did, and the coin (-1 not drawn yet, 0 no, 1
 * yes). `thinks` counts the thinks that reached the dodge, so a reaction counts acting thinks.
 * `chance` is the tier's `dodgeChance`, a double in a field; `reaction` the tier's `castDelay`.
 * The points start as doubles, as the other scratch records do, so no field changes
 * representation and boxes.
 */
export interface DodgeScratch {
  /** The sweep contact point of the threat under test, then the point of a sidestep. */
  to: Vec2;
  /** The projectile's own position, copied so no call reads a field of a projectile. */
  from: Vec2;
  chance: number;
  reaction: number;
  thinks: number;
  /** Where the next new projectile is written in the memo. */
  next: number;
  ids: Int32Array;
  seen: Int32Array;
  coins: Int8Array;
}

export function createDodgeScratch(chance: number, reaction: number): DodgeScratch {
  const scratch: DodgeScratch = {
    to: { x: 0.5, y: 0.5 },
    from: { x: 0.5, y: 0.5 },
    chance,
    reaction,
    thinks: 0,
    next: 0,
    ids: new Int32Array(DODGE_MEMO_SIZE),
    seen: new Int32Array(DODGE_MEMO_SIZE),
    coins: new Int8Array(DODGE_MEMO_SIZE),
  };
  clearDodgeMemo(scratch);
  return scratch;
}

/** Forgets every projectile: the next think that predicts a hit from one starts its reaction over. */
export function clearDodgeMemo(scratch: DodgeScratch): void {
  scratch.ids.fill(-1);
  scratch.seen.fill(0);
  scratch.coins.fill(-1);
  scratch.next = 0;
}

/**
 * The dodge of spec section 6, a movement override of the acted intent. Every projectile of
 * another team that can hit the bot is a threat when, with the bot standing where it is, the
 * centre line of the projectile reaches the bot's reach (the two radii) within the sweeps the
 * projectile has left and nothing that blocks projectiles lies on the way. The first think a
 * projectile is a threat is written to the memo; `reaction` thinks later, while it still is, one
 * coin is drawn for it, a yes when it is under the chance. Among the threats with a yes coin the
 * one that hits first, the lower index on a tie, is dodged: the bot steps one metre sideways
 * (the perpendicular (-vy, vx) of its velocity), to the side it is already on, or to the other
 * when the first lands in a blocked cell or has no clear segment. The step is written into `out`
 * and the result is true; false leaves `out` untouched.
 *
 * It runs on the think path and allocates nothing. The coin is mulberry32 of rng.ts written out
 * over the bot's own state word, the same operations in the same order as the draw in `aim`
 * (a call of `rng.next` runs in the interpreter and boxes its result), and the doubles stay in
 * locals: no call takes or returns one. Only `+ - * /`, `sqrt` and `ceil` are used.
 */
export function dodgeInto(
  out: MoveCommand,
  scratch: DodgeScratch,
  rngState: Uint32Array,
  state: GameState,
  me: ChampionState,
  grid: NavGrid,
  sight: SightScratch,
): boolean {
  const { ids, seen, coins, from, to } = scratch;
  const thinks = scratch.thinks;
  scratch.thinks = thinks + 1;
  const projectiles = state.projectiles;
  let best = -1;
  let bestSweep = 0;
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i] as ProjectileState;
    if (p.team === me.team) continue;
    // An ally bolt with no effect on enemies passes the other team.
    if (p.allyEffects !== undefined && p.effects.length === 0) continue;
    let hitBefore = false;
    for (let k = 0; k < p.hitIds.length; k++) {
      if (p.hitIds[k] === me.id) hitBefore = true;
    }
    if (hitBefore) continue;

    // The contact time of the projectile's centre line with the reach circle around the bot, the
    // stable root 2c / (-b + sqrt(disc)) of a t^2 + b t + c = 0, as the aim's lead computes it.
    const dx = p.x - me.x;
    const dy = p.y - me.y;
    const vx = p.vx;
    const vy = p.vy;
    const reach = CHAMPION_RADIUS + p.radius;
    const a = vx * vx + vy * vy;
    const b = 2 * (dx * vx + dy * vy);
    const c = dx * dx + dy * dy - reach * reach;
    // Already overlapping (it hits on the next sweep whatever the bot does), or not closing in.
    if (!(c > 0) || !(b < 0) || !(a > 0)) continue;
    const disc = b * b - 4 * a * c;
    if (!(disc >= 0)) continue;
    const t = (2 * c) / (-b + Math.sqrt(disc));
    // Champions move before the projectiles sweep, and `remainingTicks` counts the next sweep.
    const sweep = Math.ceil(t * TICK_RATE);
    if (!(sweep <= p.remainingTicks)) continue;
    from.x = p.x;
    from.y = p.y;
    to.x = p.x + vx * t;
    to.y = p.y + vy * t;
    if (!lineOfSight(state, from, to, sight)) continue;

    // The memo entry of this projectile, made on the first think that predicts the hit.
    let slot = -1;
    for (let k = 0; k < DODGE_MEMO_SIZE; k++) {
      if (ids[k] === p.id) slot = k;
    }
    if (slot < 0) {
      slot = scratch.next;
      scratch.next = (slot + 1) % DODGE_MEMO_SIZE;
      ids[slot] = p.id;
      seen[slot] = thinks;
      coins[slot] = -1;
    }
    if (thinks - (seen[slot] as number) < scratch.reaction) continue;
    if ((coins[slot] as number) < 0) {
      // The draw of createRng(seed).next() of rng.ts, operation for operation (see `aim` in bot.ts).
      const word = ((rngState[0] as number) + 0x6d2b79f5) >>> 0;
      rngState[0] = word;
      let r = word;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      coins[slot] = ((r ^ (r >>> 14)) >>> 0) / 4294967296 < scratch.chance ? 1 : 0;
    }
    if (coins[slot] === 1 && (best < 0 || sweep < bestSweep)) {
      best = i;
      bestSweep = sweep;
    }
  }
  if (best < 0) return false;

  // The sidestep: along the perpendicular (-vy, vx) of the chosen projectile's velocity, on the
  // side the bot already stands on (the tie, on the line itself, takes +), else on the other.
  const p = projectiles[best] as ProjectileState;
  const length = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  const nx = -p.vy / length;
  const ny = p.vx / length;
  const side = (me.x - p.x) * nx + (me.y - p.y) * ny >= 0 ? 1 : -1;
  for (let k = 0; k < 2; k++) {
    const sign = k === 0 ? side : -side;
    to.x = me.x + sign * nx * KITE_STEP;
    to.y = me.y + sign * ny * KITE_STEP;
    if (cellFree(grid, to) && segmentClear(grid, me, to)) {
      steerTowardInto(out, me, to);
      return true;
    }
  }
  return false;
}
