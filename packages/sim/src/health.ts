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
 * Removes up to `amount` health and returns what was removed. Not a kit primitive: it is the
 * building block projectiles, areas and later melee arcs and the ring call.
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
  const removed = Math.min(champion.health, amount);
  champion.health = champion.health - removed;
  const { health } = champion;
  state.events.push({ type: 'damage', targetId, sourceId, amount: removed, health });
  if (champion.health === 0) {
    champion.alive = false;
    champion.vx = 0;
    champion.vy = 0;
    state.events.push({ type: 'death', targetId, sourceId });
  }
  return removed;
}

/** Restores up to `amount` health and returns what was restored. A dead champion stays dead. */
export function applyHeal(
  state: GameState,
  targetId: number,
  amount: number,
  sourceId: number,
): number {
  const champion = target(state, 'heal', targetId);
  checkAmount('heal', amount);
  if (!champion.alive) return 0;
  const restored = Math.min(champion.maxHealth - champion.health, amount);
  if (restored <= 0) return 0;
  champion.health = champion.health + restored;
  const { health } = champion;
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
    else applyHeal(state, targetId, effect.amount, sourceId);
  }
}
