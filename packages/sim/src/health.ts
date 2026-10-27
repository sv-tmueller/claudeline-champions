import { MAX_ENERGY, STATUS_PULSE_TICKS, WOUND_PERCENT_PER_STACK } from './constants';
import { direction } from './geometry';
import type { Point } from './geometry';
import type { Slot } from './input';
import { endDash, interruptCast } from './state';
import type { ChampionState, Effect, GameState, StatusInstance } from './state';
import {
  applyKnockback,
  applyShield,
  applyStatus,
  clearStatuses,
  copyStatusSpec,
  endStatus,
  hasStatus,
  isMagnitude,
  isStatusTicks,
  MAGNITUDE_PROBLEM,
  TICKS_PROBLEM,
} from './status';

function fail(what: 'damage' | 'heal', problem: string): never {
  throw new Error(`Invalid ${what}: ${problem}`);
}

function target(state: GameState, what: 'damage' | 'heal', targetId: number): ChampionState {
  const champion = state.champions[targetId];
  if (!champion) return fail(what, `unknown target ${targetId}`);
  return champion;
}

function checkAmount(what: 'damage' | 'heal', amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    fail(what, `amount ${amount} is not a non-negative number`);
  }
}

/**
 * Takes up to `amount` from the target and returns the health removed. Shields absorb first, in
 * array order, with one `shieldAbsorbed` event for the whole hit; a used-up shield ends as
 * `depleted`. `ignoreShields` skips them all, for the ring (rules.md 1.1). An invulnerable target
 * takes nothing either way. An amount too small to change the health emits no damage event. Not a
 * kit primitive: it is the building block projectiles, areas, melee arcs, damage over time and the
 * ring use.
 */
export function applyDamage(
  state: GameState,
  targetId: number,
  amount: number,
  sourceId: number,
  ignoreShields = false,
): number {
  const champion = target(state, 'damage', targetId);
  checkAmount('damage', amount);
  if (!champion.alive || amount === 0) return 0;
  if (hasStatus(champion, 'invulnerable')) return 0;

  let rest = amount;
  if (!ignoreShields) {
    let absorbed = 0;
    let absorbLeft = 0;
    const depleted: ChampionState['statuses'] = [];
    for (const status of champion.statuses) {
      if (status.type !== 'shield') continue;
      const take = Math.min(status.absorb, rest);
      status.absorb -= take;
      rest -= take;
      absorbed += take;
      absorbLeft += status.absorb;
      if (status.absorb === 0) depleted.push(status);
    }
    if (absorbed > 0) {
      state.events.push({
        type: 'shieldAbsorbed',
        targetId,
        sourceId,
        amount: absorbed,
        absorbLeft,
      });
      for (const shield of depleted) endStatus(state, champion, shield, 'depleted');
    }
  }

  const before = champion.health;
  champion.health = before - Math.min(before, rest);
  const { health } = champion;
  const removed = before - health;
  if (removed === 0) return 0;
  state.events.push({ type: 'damage', targetId, sourceId, amount: removed, health });
  if (champion.health === 0) {
    champion.alive = false;
    champion.vx = 0;
    champion.vy = 0;
    state.events.push({ type: 'death', targetId, sourceId });
    clearStatuses(state, champion, 'death');
    endDash(state, champion, 'death');
    interruptCast(state, champion, 'death');
  }
  return removed;
}

/** The wound stacks the champion holds, 0 without a wound. A plain loop: heals run in live matches. */
function woundStacks(champion: ChampionState): number {
  const { statuses } = champion;
  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i] as StatusInstance;
    if (status.type === 'wound') return status.stacks;
  }
  return 0;
}

/**
 * Restores up to `amount` health and returns what was restored. A wound on the target cuts the
 * amount first, by 10 percent per stack as `amount * (100 - 10 * stacks) / 100`, and the
 * max-health clamp comes after; the event and the return value carry the cut amount. A dead
 * champion stays dead, and an amount too small to change the health emits nothing. Invulnerable
 * does not stop it.
 */
export function applyHeal(
  state: GameState,
  targetId: number,
  amount: number,
  sourceId: number,
): number {
  const champion = target(state, 'heal', targetId);
  checkAmount('heal', amount);
  if (!champion.alive) return 0;
  const stacks = woundStacks(champion);
  // No wound: the amount stays as it is, as `amount * 100 / 100` is not always `amount`, 0.007 for one.
  const cut = stacks === 0 ? amount : (amount * (100 - WOUND_PERCENT_PER_STACK * stacks)) / 100;
  const before = champion.health;
  champion.health = before + Math.min(champion.maxHealth - before, cut);
  const { health } = champion;
  const restored = health - before;
  if (restored === 0) return 0;
  state.events.push({ type: 'heal', targetId, sourceId, amount: restored, health });
  return restored;
}

/**
 * Status upkeep for one champion, once per tick after it moved. First every due pulse of damage
 * over time and heal over time runs, then every status loses a tick and ends at 0, so a status
 * lasting D ticks affects exactly D of the holder's turns and a pulse due on the last tick still
 * lands. Works on a snapshot because a pulse can kill the champion, which clears the list.
 */
export function upkeepStatuses(state: GameState, champion: ChampionState): void {
  const snapshot = [...champion.statuses];
  for (const status of snapshot) {
    if (status.type !== 'dot' && status.type !== 'hot') continue;
    status.ticksToNextPulse -= 1;
    if (status.ticksToNextPulse > 0) continue;
    status.ticksToNextPulse = STATUS_PULSE_TICKS;
    if (status.type === 'dot') applyDamage(state, champion.id, status.perPulse, status.sourceId);
    else applyHeal(state, champion.id, status.perPulse, status.sourceId);
    if (!champion.alive) return;
  }
  for (const status of snapshot) {
    // A shield used up by a pulse is already gone.
    if (!champion.statuses.includes(status)) continue;
    status.remainingTicks -= 1;
    if (status.remainingTicks === 0) endStatus(state, champion, status, 'expired');
  }
}

/**
 * Applies the effects in order to one champion hit by `sourceId` and returns the health its
 * `heal` effects restored. `origin` is where the hit came from (projectile contact point, area
 * centre, arc origin), which `away` knockback points away from. The statuses it applies carry
 * `slot`, the slot of the cast that landed the hit, or none. `energyGain` is skipped: `landHit`
 * reads it.
 */
export function applyEffects(
  state: GameState,
  sourceId: number,
  targetId: number,
  effects: readonly Effect[],
  origin: Point,
  slot: Slot | null = null,
): number {
  const source = { sourceId, slot };
  let restored = 0;
  for (const effect of effects) {
    switch (effect.type) {
      case 'damage':
        applyDamage(state, targetId, effect.amount, sourceId);
        break;
      case 'heal':
        restored += applyHeal(state, targetId, effect.amount, sourceId);
        break;
      case 'applyStatus':
        applyStatus(state, targetId, effect.status, source);
        break;
      case 'shield':
        applyShield(state, targetId, effect, source);
        break;
      case 'knockback': {
        const victim = state.champions[targetId];
        const owner = state.champions[sourceId];
        if (!victim || !owner) break;
        const dir =
          effect.direction === 'away'
            ? direction(victim.x - origin.x, victim.y - origin.y)
            : direction(owner.x - victim.x, owner.y - victim.y);
        // A zero vector has no direction, so there is no push.
        if (dir) {
          applyKnockback(
            state,
            targetId,
            { dirX: dir.x, dirY: dir.y, distance: effect.distance, ticks: effect.ticks },
            source,
          );
        }
        break;
      }
      case 'energyGain':
        break;
    }
  }
  return restored;
}

/** Shared by the projectile, area and melee arc specs. */
export function copyEffects(
  effects: readonly Effect[],
  reject: (problem: string) => never,
): Effect[] {
  if (!Array.isArray(effects)) return reject('effects must be an array');
  return effects.map((effect) => {
    if (typeof effect !== 'object' || effect === null) return reject('effect must be an object');
    const type: unknown = effect.type;
    switch (type) {
      case 'damage':
      case 'heal': {
        const { amount } = effect as { amount: number };
        if (!Number.isFinite(amount) || amount <= 0) {
          return reject(`effect amount ${amount} is not a number above 0`);
        }
        return { type, amount };
      }
      case 'applyStatus':
        return {
          type,
          status: copyStatusSpec((effect as { status: never }).status, reject),
        };
      case 'shield': {
        const { absorb, ticks } = effect as { absorb: number; ticks: number };
        if (!isMagnitude(absorb)) return reject(`shield absorb ${absorb} ${MAGNITUDE_PROBLEM}`);
        if (!isStatusTicks(ticks)) return reject(`shield ticks ${ticks} ${TICKS_PROBLEM}`);
        return { type, absorb, ticks };
      }
      case 'knockback': {
        const {
          distance,
          ticks,
          direction: way,
        } = effect as { distance: number; ticks: number; direction: unknown };
        if (!isMagnitude(distance)) {
          return reject(`knockback distance ${distance} ${MAGNITUDE_PROBLEM}`);
        }
        if (!isStatusTicks(ticks)) return reject(`knockback ticks ${ticks} ${TICKS_PROBLEM}`);
        if (way !== 'away' && way !== 'toward') {
          return reject(`knockback direction ${String(way)} is not away or toward`);
        }
        return { type, distance, ticks, direction: way };
      }
      case 'energyGain': {
        const { amount } = effect as { amount: number };
        if (!Number.isInteger(amount) || amount < 1 || amount > MAX_ENERGY) {
          return reject(`effect energyGain amount ${amount} is not an integer from 1 to ${MAX_ENERGY}`);
        }
        return { type, amount };
      }
      default:
        return reject(`unknown effect type ${String(type)}`);
    }
  });
}
