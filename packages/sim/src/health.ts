import type { ChampionState, Effect, GameState } from './state';

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
 * Removes up to `amount` health and returns what was removed. An amount too small to change
 * the health emits nothing. Not a kit primitive: it is the building block projectiles, areas
 * and later melee arcs and the ring call.
 */
export function applyDamage(
  state: GameState,
  targetId: number,
  amount: number,
  sourceId: number,
): number {
  const champion = target(state, 'damage', targetId);
  checkAmount('damage', amount);
  if (!champion.alive || amount === 0) return 0;
  const before = champion.health;
  champion.health = before - Math.min(before, amount);
  const { health } = champion;
  const removed = before - health;
  if (removed === 0) return 0;
  state.events.push({ type: 'damage', targetId, sourceId, amount: removed, health });
  if (champion.health === 0) {
    champion.alive = false;
    champion.vx = 0;
    champion.vy = 0;
    state.events.push({ type: 'death', targetId, sourceId });
  }
  return removed;
}

/**
 * Restores up to `amount` health and returns what was restored. A dead champion stays dead, and
 * an amount too small to change the health emits nothing.
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
  const before = champion.health;
  champion.health = before + Math.min(champion.maxHealth - before, amount);
  const { health } = champion;
  const restored = health - before;
  if (restored === 0) return 0;
  state.events.push({ type: 'heal', targetId, sourceId, amount: restored, health });
  return restored;
}

export function applyEffects(
  state: GameState,
  sourceId: number,
  targetId: number,
  effects: readonly Effect[],
): void {
  for (const effect of effects) {
    if (effect.type === 'damage') applyDamage(state, targetId, effect.amount, sourceId);
    else if (effect.type === 'heal') applyHeal(state, targetId, effect.amount, sourceId);
  }
}

/** Shared by the projectile and area spawns. */
export function copyEffects(
  effects: readonly Effect[],
  reject: (problem: string) => never,
): Effect[] {
  if (!Array.isArray(effects)) return reject('effects must be an array');
  return effects.map((effect) => {
    const type: unknown = effect.type;
    if (type !== 'damage' && type !== 'heal') return reject(`unknown effect type ${String(type)}`);
    if (!('amount' in effect) || !Number.isFinite(effect.amount) || effect.amount <= 0) {
      return reject(`effect amount ${effect.amount} is not a number above 0`);
    }
    return { type, amount: effect.amount };
  });
}
