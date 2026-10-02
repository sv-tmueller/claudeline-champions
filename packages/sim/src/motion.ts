import { resolveChampion } from './collision';
import { MOTION_SUBSTEP_METERS } from './constants';
import { direction } from './geometry';
import { hasLineOfSight } from './sight';
import { endDash } from './state';
import type { ChampionState, GameState } from './state';
import { endStatus, hasStatus, isTicks } from './status';

export interface DashSpec {
  /** Direction of the dash; it is normalized here, so it must not be zero. */
  dirX: number;
  dirY: number;
  /** Total meters over `ticks`, at most `MAX_DASH_DISTANCE`. */
  distance: number;
  ticks: number;
}

/** No dash is longer than this; it keeps the substep loop short for any input. */
export const MAX_DASH_DISTANCE = 1000;

function fail(what: 'dash' | 'teleport', problem: string): never {
  throw new Error(`Invalid ${what}: ${problem}`);
}

function champion(state: GameState, what: 'dash' | 'teleport', id: number): ChampionState {
  const found = state.champions[id];
  if (!found) return fail(what, `unknown champion ${id}`);
  return found;
}

/**
 * Starts a dash for a champion: `distance` meters in even steps over `ticks` ticks, moving from the
 * next `step` on. A running dash ends as `replaced`. Stun and root do not stop it from starting:
 * stun cancels a dash when it lands, and root ends it in the next step. Returns false, with no
 * event, for a dead champion.
 */
export function startDash(state: GameState, championId: number, spec: DashSpec): boolean {
  const target = champion(state, 'dash', championId);
  if (typeof spec !== 'object' || spec === null) return fail('dash', 'spec must be an object');
  if (!Number.isFinite(spec.dirX) || !Number.isFinite(spec.dirY)) {
    return fail('dash', 'direction is not a finite vector');
  }
  const dir = direction(spec.dirX, spec.dirY);
  if (!dir) return fail('dash', 'direction is zero');
  if (!Number.isFinite(spec.distance) || spec.distance <= 0 || spec.distance > MAX_DASH_DISTANCE) {
    return fail('dash', `distance ${String(spec.distance)} is not a number from 0 to ${MAX_DASH_DISTANCE}`);
  }
  if (!isTicks(spec.ticks)) return fail('dash', `ticks ${String(spec.ticks)} is not a positive integer`);
  if (!target.alive) return false;

  endDash(state, target, 'replaced');
  target.dash = {
    dirX: dir.x,
    dirY: dir.y,
    stepLength: spec.distance / spec.ticks,
    ticksLeft: spec.ticks,
  };
  state.events.push({
    type: 'dashStarted',
    championId,
    x: target.x,
    y: target.y,
    dirX: dir.x,
    dirY: dir.y,
    distance: spec.distance,
    ticks: spec.ticks,
  });
  return true;
}

/**
 * Moves a champion to (toX, toY) at once if the straight line there clears every obstacle that
 * blocks projectiles; low walls do not block. Collision is then resolved at the destination with
 * the start as the previous position, so the champion is pushed out of bodies and obstacles,
 * clamped inside the boundary, or left at the start when it cannot be cleared. The event carries
 * the position the champion ends at, which is the start for a blocked teleport. Returns false
 * when blocked, and for a dead champion, which also emits nothing.
 */
export function teleport(state: GameState, championId: number, toX: number, toY: number): boolean {
  const target = champion(state, 'teleport', championId);
  if (!Number.isFinite(toX) || !Number.isFinite(toY)) return fail('teleport', 'point is not finite');
  if (!target.alive) return false;
  const fromX = target.x;
  const fromY = target.y;
  const clear = hasLineOfSight(state, { x: fromX, y: fromY }, { x: toX, y: toY });
  if (clear) {
    target.x = toX + 0;
    target.y = toY + 0;
    resolveChampion(state, target, fromX, fromY);
  }
  state.events.push({
    type: 'teleport',
    championId,
    fromX,
    fromY,
    toX: target.x,
    toY: target.y,
    blocked: !clear,
  });
  return clear;
}

/**
 * Step 3f of the tick: the dash step and every knockback impulse, ignoring stun, root and a locked
 * windup. Root ends a running dash first. The summed displacement is cut into substeps of at most
 * `MOTION_SUBSTEP_METERS`, with collision resolved after each; the first push ends the dash as
 * `blocked` and every knockback as `stopped`, and nothing moves on, so forced motion does not
 * slide. A dash whose ticks run out ends as `complete`.
 */
export function stepForcedMotion(state: GameState, champion: ChampionState): void {
  if (champion.dash && hasStatus(champion, 'root')) endDash(state, champion, 'rooted');
  const { dash } = champion;
  const knockbacks = champion.statuses.filter((s) => s.type === 'knockback');
  if (!dash && knockbacks.length === 0) return;

  let dx = 0;
  let dy = 0;
  if (dash) {
    dx += dash.dirX * dash.stepLength;
    dy += dash.dirY * dash.stepLength;
  }
  for (const k of knockbacks) {
    if (k.type !== 'knockback') continue;
    // The push of the tick with n ticks left: D n (n + 1) / (N (N + 1)) minus the same for n - 1.
    const push = (k.distance * 2 * k.remainingTicks) / (k.totalTicks * (k.totalTicks + 1));
    dx += k.dirX * push;
    dy += k.dirY * push;
  }

  let pushed = false;
  const total = direction(dx, dy)?.length ?? 0;
  if (total > 0) {
    let count = Math.max(1, Math.round(total / MOTION_SUBSTEP_METERS));
    if (total / count > MOTION_SUBSTEP_METERS) count += 1;
    const startX = champion.x;
    const startY = champion.y;
    for (let i = 1; i <= count && !pushed; i++) {
      const prevX = champion.x;
      const prevY = champion.y;
      champion.x = startX + dx * (i / count) + 0;
      champion.y = startY + dy * (i / count) + 0;
      pushed = resolveChampion(state, champion, prevX, prevY);
    }
  }

  if (pushed) {
    endDash(state, champion, 'blocked');
    for (const k of knockbacks) endStatus(state, champion, k, 'stopped');
  } else if (dash) {
    dash.ticksLeft -= 1;
    if (dash.ticksLeft === 0) endDash(state, champion, 'complete');
  }
}
