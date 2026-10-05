import { describe, expect, it } from 'vitest';
import { createMatch } from '@claudeline/sim';
import type { ArenaDef, ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import type { Bot } from '../src/bot';
import type { Intent } from '../src/intent';
import { arena01, config2v2, createStallTracker, ownSpawnOf } from './helpers';

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

  it('does not count a retreating bot that stands at its own spawn', () => {
    const state = duel(0);
    const spawn = ownSpawnOf(state, ch(state, 0));
    if (spawn === undefined) throw new Error('no spawn');
    place(state, 0, spawn.x, spawn.y);
    place(state, 2, 0, 0);
    const bots = [stub('retreat', 2)];
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
