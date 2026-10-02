import {
  HASTE_CAP_PERCENT,
  KNOCKBACK_CAP_METERS,
  SLOW_CAP_PERCENT,
  STATUS_PULSE_TICKS,
  STUN_CAP_TICKS,
} from './constants';
import { direction } from './geometry';
import { SLOTS } from './input';
import { endDash } from './state';
import type {
  ChampionState,
  GameState,
  StatusEndReason,
  StatusInstance,
  StatusSource,
  StatusSpec,
  StatusType,
} from './state';

function fail(problem: string): never {
  throw new Error(`Invalid status: ${problem}`);
}

function isTicks(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function checkTarget(state: GameState, targetId: number): ChampionState {
  const champion = state.champions[targetId];
  if (!champion) return fail(`unknown target ${targetId}`);
  return champion;
}

export function checkSource(state: GameState, source: StatusSource): StatusSource {
  if (typeof source !== 'object' || source === null) return fail('source must be an object');
  if (!state.champions[source.sourceId]) return fail(`unknown source ${source.sourceId}`);
  if (source.slot !== null && !SLOTS.includes(source.slot)) {
    return fail(`unknown slot ${String(source.slot)}`);
  }
  return { sourceId: source.sourceId, slot: source.slot };
}

function checkSpec(spec: StatusSpec): StatusSpec {
  if (typeof spec !== 'object' || spec === null) return fail('spec must be an object');
  const type: unknown = spec.type;
  if (!isTicks(spec.ticks)) return fail(`ticks ${String(spec.ticks)} is not a positive integer`);
  const { ticks } = spec;
  switch (type) {
    case 'stun':
    case 'root':
    case 'silence':
    case 'invulnerable':
      return { type, ticks };
    case 'slow':
    case 'haste': {
      const { percent } = spec as { percent: unknown };
      if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 1 || percent > 100) {
        return fail(`percent ${String(percent)} is not an integer from 1 to 100`);
      }
      return { type, percent, ticks };
    }
    case 'dot':
    case 'hot': {
      const { perPulse } = spec as { perPulse: unknown };
      if (!isAmount(perPulse)) return fail(`perPulse ${String(perPulse)} is not a number above 0`);
      return { type, perPulse, ticks };
    }
    default:
      return fail(`unknown status type ${String(type)}`);
  }
}

export function hasStatus(champion: ChampionState, type: StatusType): boolean {
  return champion.statuses.some((s) => s.type === type);
}

function sameSource(a: StatusInstance, b: StatusSource): boolean {
  return a.sourceId === b.sourceId && a.slot === b.slot;
}

function sumPercent(champion: ChampionState, type: 'slow' | 'haste', cap: number): number {
  let total = 0;
  for (const s of champion.statuses) if (s.type === type) total += s.percent;
  return Math.min(cap, total);
}

/** Walk speed multiplier from slow and haste; exactly 1 without either. */
export function speedFactor(champion: ChampionState): number {
  const haste = sumPercent(champion, 'haste', HASTE_CAP_PERCENT);
  const slow = sumPercent(champion, 'slow', SLOW_CAP_PERCENT);
  return 1 + (haste - slow) / 100;
}

/** Removes one status and says why. A no-op when the instance is not on the champion. */
export function endStatus(
  state: GameState,
  champion: ChampionState,
  instance: StatusInstance,
  reason: StatusEndReason,
): void {
  const index = champion.statuses.indexOf(instance);
  if (index < 0) return;
  champion.statuses.splice(index, 1);
  state.events.push({
    type: 'statusExpired',
    targetId: champion.id,
    sourceId: instance.sourceId,
    slot: instance.slot,
    status: instance.type,
    reason,
  });
}

/** Ends every status in application order, as a dying champion loses them. */
export function clearStatuses(
  state: GameState,
  champion: ChampionState,
  reason: StatusEndReason,
): void {
  for (const instance of [...champion.statuses]) endStatus(state, champion, instance, reason);
}

export function addStatus(
  state: GameState,
  champion: ChampionState,
  instance: StatusInstance,
): void {
  champion.statuses.push(instance);
  state.events.push({
    type: 'statusApplied',
    targetId: champion.id,
    sourceId: instance.sourceId,
    slot: instance.slot,
    status: instance.type,
    remainingTicks: instance.remainingTicks,
  });
}

/** Invulnerable blocks these when they are applied; running ones are left alone. */
export function isBlockedByInvulnerable(type: StatusType): boolean {
  return (
    type === 'stun' ||
    type === 'root' ||
    type === 'silence' ||
    type === 'slow' ||
    type === 'dot' ||
    type === 'knockback'
  );
}

/**
 * Applies a status to a champion and returns whether anything changed. Rules per type are in
 * the Statuses section of simulation.md. Returns false, with no event, for a dead target, for
 * a hostile status on an invulnerable one and for a stun, root, silence or invulnerable that
 * does not outlast the one already running. Throws `Invalid status: ...` for an unknown target
 * or source or a bad spec, even when the target is dead.
 */
export function applyStatus(
  state: GameState,
  targetId: number,
  spec: StatusSpec,
  source: StatusSource,
): boolean {
  const target = checkTarget(state, targetId);
  const from = checkSource(state, source);
  const checked = checkSpec(spec);
  if (!target.alive) return false;
  if (isBlockedByInvulnerable(checked.type) && hasStatus(target, 'invulnerable')) return false;
  const base = { ...from, remainingTicks: checked.ticks };

  switch (checked.type) {
    case 'stun':
    case 'root':
    case 'silence':
    case 'invulnerable': {
      const type = checked.type;
      const remainingTicks = type === 'stun' ? Math.min(checked.ticks, STUN_CAP_TICKS) : checked.ticks;
      const old = target.statuses.find((s) => s.type === type);
      if (old) {
        if (remainingTicks <= old.remainingTicks) return false;
        endStatus(state, target, old, 'replaced');
      }
      addStatus(state, target, { ...base, type, remainingTicks });
      if (type === 'stun') endDash(state, target, 'stunned');
      return true;
    }
    case 'slow':
    case 'haste': {
      const type = checked.type;
      const old = target.statuses.find((s) => s.type === type && sameSource(s, from));
      if (old) endStatus(state, target, old, 'replaced');
      addStatus(state, target, { ...base, type, percent: checked.percent });
      return true;
    }
    case 'dot':
    case 'hot': {
      const type = checked.type;
      const old = target.statuses.find((s) => s.type === type && sameSource(s, from));
      // A refresh keeps the pulse timer, so refreshing never delays or hastens the next pulse.
      const ticksToNextPulse =
        old && (old.type === 'dot' || old.type === 'hot') ? old.ticksToNextPulse : STATUS_PULSE_TICKS;
      if (old) endStatus(state, target, old, 'replaced');
      addStatus(state, target, { ...base, type, perPulse: checked.perPulse, ticksToNextPulse });
      return true;
    }
  }
}

/** Adds a shield of `absorb` health points lasting `ticks`; one shield per source. */
export function applyShield(
  state: GameState,
  targetId: number,
  spec: { absorb: number; ticks: number },
  source: StatusSource,
): boolean {
  const target = checkTarget(state, targetId);
  const from = checkSource(state, source);
  if (typeof spec !== 'object' || spec === null) return fail('spec must be an object');
  if (!isAmount(spec.absorb)) return fail(`absorb ${String(spec.absorb)} is not a number above 0`);
  if (!isTicks(spec.ticks)) return fail(`ticks ${String(spec.ticks)} is not a positive integer`);
  if (!target.alive) return false;
  const old = target.statuses.find((s) => s.type === 'shield' && sameSource(s, from));
  if (old) endStatus(state, target, old, 'replaced');
  addStatus(state, target, {
    ...from,
    type: 'shield',
    remainingTicks: spec.ticks,
    absorb: spec.absorb,
  });
  return true;
}

type Knockback = Extract<StatusInstance, { type: 'knockback' }>;

/** Meters of push an instance still has to deliver: D n (n + 1) / (N (N + 1)). */
export function remainingPush(k: Knockback): number {
  const n = k.remainingTicks;
  const total = k.totalTicks;
  return (k.distance * n * (n + 1)) / (total * (total + 1));
}

/**
 * Adds a push of `distance` meters spread over `ticks`, one instance per source. The push still
 * to come over all instances stays within 6 m: a new push is trimmed to the room left by the
 * other sources and dropped, with no event and nothing changed, when no room is left. Direction
 * is normalized here. Returns whether a push was added.
 */
export function applyKnockback(
  state: GameState,
  targetId: number,
  spec: { dirX: number; dirY: number; distance: number; ticks: number },
  source: StatusSource,
): boolean {
  const target = checkTarget(state, targetId);
  const from = checkSource(state, source);
  if (typeof spec !== 'object' || spec === null) return fail('spec must be an object');
  if (!Number.isFinite(spec.dirX) || !Number.isFinite(spec.dirY)) {
    return fail('direction is not a finite vector');
  }
  const dir = direction(spec.dirX, spec.dirY);
  if (!dir) return fail('direction is zero');
  if (!isAmount(spec.distance)) return fail(`distance ${String(spec.distance)} is not a number above 0`);
  if (!isTicks(spec.ticks)) return fail(`ticks ${String(spec.ticks)} is not a positive integer`);
  if (!target.alive || hasStatus(target, 'invulnerable')) return false;

  const old = target.statuses.find((s) => s.type === 'knockback' && sameSource(s, from));
  let others = 0;
  for (const s of target.statuses) if (s.type === 'knockback' && s !== old) others += remainingPush(s);
  const distance = Math.min(spec.distance, KNOCKBACK_CAP_METERS - others);
  if (distance <= 0) return false;

  if (old) endStatus(state, target, old, 'replaced');
  addStatus(state, target, {
    ...from,
    type: 'knockback',
    remainingTicks: spec.ticks,
    dirX: dir.x,
    dirY: dir.y,
    distance,
    totalTicks: spec.ticks,
  });
  return true;
}
