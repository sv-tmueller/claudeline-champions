import { describe, expect, it } from 'vitest';
import type { ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import { createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import { arena01, clearShotOracle, jsonKits, profileOf } from './helpers';
import { sceneOf } from './scenes';
import type { Options } from './scenes';

// The engage stand of a champion with rangeMin 0 (#213, bots.md, Testing): it walks in until its
// target is within `standReach`, a fraction of rangeMax (STAND_FRACTION, 0.8 here as a literal in
// helpers.ts), and no longer stands on the edge of rangeMax. The frozen states are on arena01 with
// the shipped kits: champion 0 at (-6, 3), a dummy enemy (champion 2) east of it, nothing between
// them. The finisher, the deadlock rule and the sight logic of a retreating bot keep rangeMax.

const HARGRIM_STAND = profileOf(0, 2).standReach; // the shipped Hargrim: rangeMax 2, stands at 1.6
const SKERROW_STAND = profileOf(0, 1.5).standReach; // the shipped Skerrow: rangeMax 1.5, stands at 1.2
const SETTLE = TIERS.hard.delay + 10;

function me(state: GameState): ChampionState {
  return state.champions[0] as ChampionState;
}

function enemy(state: GameState): ChampionState {
  return state.champions[2] as ChampionState;
}

/**
 * A frozen duel on arena01: champion 0 at (-6, 3) and the enemy `distance` metres east of it, on
 * the lane between the pillar and the low wall, so the way to the spawn (-12, 2) is open.
 */
function duel(championId: string, distance: number, options: Options = {}): GameState {
  return sceneOf(championId, distance, { arena: arena01, me: [-6, 3], ...options });
}

/** Thinks `n` times on the frozen state and returns what the last think returned, copied. */
function think(bot: Bot, state: GameState, n = SETTLE): PlayerInput {
  let last = bot.think(state);
  for (let i = 1; i < n; i++) last = bot.think(state);
  return { ...last };
}

function stands(input: PlayerInput): boolean {
  return input.moveX === 0 && input.moveY === 0;
}

describe('the frozen duels have a clear shot at every distance of the rows', () => {
  it.each([1.1, 1.3, 1.5, 1.7, 2.3, 2.5, 12.5])('at %s m', (distance) => {
    const state = duel('hargrim', distance, { me: distance > 3 ? [-12, 3] : [-6, 3] });
    expect(clearShotOracle(state, me(state), enemy(state), 0.5)).toBe(true);
  });
});

describe('Hargrim (kit: rangeMax 2, stands within 1.6 m)', () => {
  it('walks toward a target between the stand reach and rangeMax', () => {
    for (const distance of [HARGRIM_STAND + 0.05, 1.9]) {
      const state = duel('hargrim', distance);
      const bot = createBot(0, 'hard', 1);
      const input = think(bot, state);
      expect(bot.inspect(), `${distance} m`).toEqual({ intent: 'engage', targetId: 2 });
      expect(input.moveX, `${distance} m`).toBeGreaterThan(0);
    }
  });

  it('stands with a target inside the stand reach', () => {
    for (const distance of [HARGRIM_STAND - 0.05, 1.2]) {
      const state = duel('hargrim', distance);
      const bot = createBot(0, 'hard', 1);
      const input = think(bot, state);
      expect(bot.inspect(), `${distance} m`).toEqual({ intent: 'engage', targetId: 2 });
      expect(stands(input), `${distance} m`).toBe(true);
    }
  });

  it('keeps no memory of the stand: a target that steps from inside the stand reach to just past it is followed at once', () => {
    const state = duel('hargrim', HARGRIM_STAND - 0.05);
    const bot = createBot(0, 'hard', 1);
    expect(stands(think(bot, state))).toBe(true);
    enemy(state).x = me(state).x + HARGRIM_STAND + 0.05;
    expect(think(bot, state, 3).moveX).toBeGreaterThan(0);
    // And stands again once it is back inside.
    enemy(state).x = me(state).x + HARGRIM_STAND - 0.05;
    expect(stands(think(bot, state, 3))).toBe(true);
  });
});

describe('Skerrow (kit: rangeMax 1.5, stands within 1.2 m)', () => {
  it('walks toward a target between the stand reach and rangeMax', () => {
    for (const distance of [SKERROW_STAND + 0.05, 1.45]) {
      const state = duel('skerrow', distance);
      const bot = createBot(0, 'hard', 1);
      const input = think(bot, state);
      expect(bot.inspect(), `${distance} m`).toEqual({ intent: 'engage', targetId: 2 });
      expect(input.moveX, `${distance} m`).toBeGreaterThan(0);
    }
  });

  it('stands with a target inside the stand reach, which is still outside the touching distance of 1 m', () => {
    expect(SKERROW_STAND).toBeGreaterThan(1.1);
    for (const distance of [SKERROW_STAND - 0.05, 1.1]) {
      const state = duel('skerrow', distance);
      const bot = createBot(0, 'hard', 1);
      const input = think(bot, state);
      expect(stands(input), `${distance} m`).toBe(true);
    }
  });
});

describe('a Hargrim with no kit (the table: rangeMax 3, stands within 2.4 m)', () => {
  const TABLE_STAND = profileOf(0, 3).standReach;

  it('walks in from beyond the stand reach and stands inside it', () => {
    const outside = duel('hargrim', TABLE_STAND + 0.1, { kits: [] });
    const botOutside = createBot(0, 'hard', 1);
    expect(think(botOutside, outside).moveX).toBeGreaterThan(0);
    const inside = duel('hargrim', TABLE_STAND - 0.1, { kits: [] });
    expect(stands(think(createBot(0, 'hard', 1), inside))).toBe(true);
  });
});

describe('a champion that keeps its range is not changed (control)', () => {
  it('Quillon stands at 12.5 m, between 10.4 m (0.8 of rangeMax) and her rangeMax of 13', () => {
    const state = duel('quillon', 12.5, { kits: jsonKits(), me: [-12, 3] });
    const bot = createBot(0, 'hard', 1);
    const input = think(bot, state);
    expect(bot.inspect()).toEqual({ intent: 'engage', targetId: 2 });
    expect(stands(input)).toBe(true);
  });
});

describe('the finisher, the deadlock rule and the sight logic keep rangeMax', () => {
  it('the finisher: a Hargrim at 20 percent health engages a weaker enemy 1.8 m away, past its stand reach', () => {
    const state = duel('hargrim', 1.8, { health: 0.2, enemyHealth: 0.1 });
    const bot = createBot(0, 'hard', 1);
    const input = think(bot, state);
    expect(bot.inspect()).toEqual({ intent: 'engage', targetId: 2 });
    // The finisher engages, and the engage walks in to the stand reach.
    expect(input.moveX).toBeGreaterThan(0);
  });

  it('the deadlock check: a retreating Hargrim with a healthier enemy 1.8 m away is in reach and walks to its spawn', () => {
    const state = duel('hargrim', 1.8, { health: 0.2 });
    const bot = createBot(0, 'hard', 1);
    const input = think(bot, state);
    expect(bot.inspect()).toEqual({ intent: 'retreat', targetId: 2 });
    // Its spawn is west of (-6, 0); an advance would walk east.
    expect(input.moveX).toBeLessThan(0);
  });

  it('the sight logic: an advancing Hargrim stands in rangeMax with a clear shot, 1.8 m from its target', () => {
    const state = duel('hargrim', 3.5, { health: 0.2 });
    const bot = createBot(0, 'hard', 1);
    expect(think(bot, state).moveX).toBeGreaterThan(0); // no enemy in reach, behind: advancing
    enemy(state).x = me(state).x + 1.8;
    expect(stands(think(bot, state, 5))).toBe(true); // the advance is latched and stands in rangeMax
  });
});
