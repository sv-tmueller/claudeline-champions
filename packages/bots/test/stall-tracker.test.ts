import { describe, expect, it } from 'vitest';
import { createMatch } from '@claudeline/sim';
import type { ArenaDef, ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import type { Bot } from '../src/bot';
import type { Intent } from '../src/intent';
import { arena01, config2v2, createStallTracker, ownSpawnOf } from './helpers';

function setHealth(state: GameState, id: number, fraction: number): void {
  const c = ch(state, id);
  c.health = fraction * c.maxHealth;
}

const open: ArenaDef = { ...arena01, id: 'open', obstacles: [] };
const OBSERVES = 10;
const ZERO: PlayerInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };
const WALK: PlayerInput = { moveX: 1, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };

function stub(intent: Intent, targetId: number): Bot {
  return { think: () => ZERO, inspect: () => ({ intent, targetId }) };
}

function ch(state: GameState, id: number): ChampionState {
  const c = state.champions[id];
  if (!c) throw new Error(`no champion ${id}`);
  return c;
}

/**
 * A duel on open ground between champion `id` (kitless, so the table profile applies: hargrim
 * 0 to 3, quillon 6 to 13) and champion 2, lumeth. The other two champions are dead. Each test
 * tracks only the bots of champions 0 and 1, so the enemy is never counted.
 */
function duel(id: 0 | 1): GameState {
  const state = createMatch(config2v2(), open, 1);
  for (const dead of id === 0 ? [1, 3] : [0, 3]) ch(state, dead).alive = false;
  return state;
}

function place(state: GameState, id: number, x: number, y: number): void {
  const c = ch(state, id);
  c.x = x;
  c.y = y;
}

/** The longest run the tracker reports after `inputs` per observe, for `n` observes. */
function worstAfter(state: GameState, bots: Bot[], inputs: PlayerInput[], n = OBSERVES): number {
  const tracker = createStallTracker(state, bots);
  for (let i = 0; i < n; i++) tracker.observe(inputs);
  return tracker.worst().length;
}

function zeros(): PlayerInput[] {
  return [ZERO, ZERO];
}

describe('createStallTracker', () => {
  it('counts a bot that engages from far away with no movement: 10 of 10', () => {
    const state = duel(0);
    place(state, 0, -12, 0);
    place(state, 2, 12, 0);
    const bots = [stub('engage', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(10);
  });

  // A retreating bot that stands at its own spawn is holding only when the rule of the bot says so:
  // its team is ahead, or an enemy is in its reach (within rangeMax with a clear shot of 0.5 m).
  // Otherwise the bot should be advancing, and the stand is a stall.
  it('does not count a retreating bot that stands at its own spawn while its team is ahead', () => {
    const state = duel(0);
    const spawn = ownSpawnOf(state, ch(state, 0));
    if (spawn === undefined) throw new Error('no spawn');
    place(state, 0, spawn.x, spawn.y);
    place(state, 2, 0, 0);
    // 1 against 0.5: ahead.
    setHealth(state, 2, 0.5);
    const bots = [stub('retreat', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(0);
  });

  it('counts a retreating bot that stands at its own spawn while its team is not ahead and nothing is in reach: 10 of 10', () => {
    const state = duel(0);
    const spawn = ownSpawnOf(state, ch(state, 0));
    if (spawn === undefined) throw new Error('no spawn');
    place(state, 0, spawn.x, spawn.y);
    place(state, 2, 0, 0);
    // 1 against 1 is a tie, which is not ahead; the enemy is 12 m away and the bot reaches 3 m.
    const bots = [stub('retreat', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(10);
  });

  it('does not count a retreating bot at its spawn while an enemy is in its reach with a clear shot', () => {
    const state = duel(0);
    const spawn = ownSpawnOf(state, ch(state, 0));
    if (spawn === undefined) throw new Error('no spawn');
    place(state, 0, spawn.x, spawn.y);
    place(state, 2, spawn.x + 2.5, spawn.y);
    const bots = [stub('retreat', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(0);
  });

  it('does not count a retreating bot at its spawn while an enemy other than its target is in reach', () => {
    const state = duel(0);
    ch(state, 3).alive = true;
    const spawn = ownSpawnOf(state, ch(state, 0));
    if (spawn === undefined) throw new Error('no spawn');
    place(state, 0, spawn.x, spawn.y);
    place(state, 2, 0, 0);
    place(state, 3, spawn.x + 2.5, spawn.y);
    const bots = [stub('retreat', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(0);
  });

  it('counts a retreating bot at its spawn when the enemy in range has no clear shot: 10 of 10', () => {
    // arena01: Quillon (id 1, reaches 13 m) at its spawn (-12, -2) and Lumeth at (-4, 2), 8.9 m away
    // with the box at (-8, 0) in the way.
    const state = createMatch(config2v2(), arena01, 1);
    for (const dead of [0, 3]) ch(state, dead).alive = false;
    const spawn = ownSpawnOf(state, ch(state, 1));
    if (spawn === undefined) throw new Error('no spawn');
    place(state, 1, spawn.x, spawn.y);
    place(state, 2, -4, 2);
    const bots = [stub('idle', -1), stub('retreat', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(10);
  });

  it('does not count a retreating bot that stands in reach of its target with a clear shot, away from its spawn', () => {
    // The latched stand: it advanced, it is in reach, and it casts. Quillon 8 m from Lumeth.
    const state = duel(1);
    place(state, 1, -4, 0);
    place(state, 2, 4, 0);
    const bots = [stub('idle', -1), stub('retreat', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(0);
  });

  it('counts a retreating bot that stands 1 m off its spawn: 10 of 10', () => {
    const state = duel(0);
    const spawn = ownSpawnOf(state, ch(state, 0));
    if (spawn === undefined) throw new Error('no spawn');
    place(state, 0, spawn.x + 1, spawn.y);
    place(state, 2, 0, 0);
    const bots = [stub('retreat', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(10);
  });

  it('counts a kiter closer than rangeMin even with line of sight: 10 of 10', () => {
    const state = duel(1);
    place(state, 1, 0, 0);
    place(state, 2, 3, 0);
    const bots = [stub('idle', -1), stub('kite', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(10);
  });

  it('does not count an engaging bot in range with line of sight', () => {
    const state = duel(0);
    place(state, 0, 0, 0);
    place(state, 2, 2, 0);
    const bots = [stub('engage', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(0);
  });

  it('does not count a bot when no enemy is alive', () => {
    const state = duel(0);
    ch(state, 2).alive = false;
    place(state, 0, -12, 0);
    const bots = [stub('engage', 2)];
    expect(worstAfter(state, bots, zeros())).toBe(0);
  });

  it('resets the run on a non-zero input', () => {
    const state = duel(0);
    place(state, 0, -12, 0);
    place(state, 2, 12, 0);
    const bots = [stub('engage', 2)];
    const tracker = createStallTracker(state, bots);
    for (let i = 0; i < 5; i++) tracker.observe(zeros());
    expect(tracker.worst().length).toBe(5);
    tracker.observe([WALK, ZERO]);
    for (let i = 0; i < 4; i++) tracker.observe(zeros());
    // Four more stalled observes after the reset do not pass the earlier run of 5.
    expect(tracker.worst().length).toBe(5);
    for (let i = 0; i < 2; i++) tracker.observe(zeros());
    expect(tracker.worst().length).toBe(6);
  });

  it('reports the run start, the champion and its intent', () => {
    const state = duel(0);
    place(state, 0, -12, 0);
    place(state, 2, 12, 0);
    const bots = [stub('engage', 2)];
    const tracker = createStallTracker(state, bots);
    for (let i = 0; i < 3; i++) tracker.observe(zeros());
    expect(tracker.worst()).toEqual({ id: 0, from: 0, length: 3, intent: 'engage' });
  });
});
