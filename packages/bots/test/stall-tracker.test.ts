import { describe, expect, it } from 'vitest';
import { createMatch } from '@claudeline/sim';
import type { ArenaDef, ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import type { Bot } from '../src/bot';
import type { Intent } from '../src/intent';
import { arena01, config2v2, createStallTracker, ownSpawnOf, stallMessage } from './helpers';
import { sceneOf } from './scenes';

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
    expect(tracker.worst()).toEqual({
      id: 0,
      from: 0,
      length: 3,
      intent: 'engage',
      intents: { engage: 3, kite: 0, retreat: 0, idle: 0 },
    });
  });

  // The filed stall of #129 read "in idle" for a run of 691 ticks of engage and 15 of idle once the
  // target died: the intent of the last tick names the run, so the counts say what it was made of.
  it('reports the intents over the run: engage, then idle, gives both counts', () => {
    const state = duel(0);
    place(state, 0, -12, 0);
    place(state, 2, 12, 0);
    let intent: Intent = 'engage';
    const bots: Bot[] = [{ think: () => ZERO, inspect: () => ({ intent, targetId: 2 }) }];
    const tracker = createStallTracker(state, bots);
    for (let i = 0; i < 4; i++) tracker.observe(zeros());
    intent = 'idle';
    for (let i = 0; i < 2; i++) tracker.observe(zeros());
    const worst = tracker.worst();
    expect(worst.intent).toBe('idle');
    expect(worst.length).toBe(6);
    expect(worst.intents).toEqual({ engage: 4, kite: 0, retreat: 0, idle: 2 });
    expect(stallMessage(worst)).toBe('champion 0 stalled from tick 0 for 6 ticks in idle (engage 4, idle 2)');
  });

  it('counts the intents of the worst run only: a run that ended does not carry over', () => {
    const state = duel(0);
    place(state, 0, -12, 0);
    place(state, 2, 12, 0);
    let intent: Intent = 'kite';
    const bots: Bot[] = [{ think: () => ZERO, inspect: () => ({ intent, targetId: 2 }) }];
    const tracker = createStallTracker(state, bots);
    for (let i = 0; i < 2; i++) tracker.observe(zeros());
    tracker.observe([WALK, ZERO]);
    intent = 'engage';
    for (let i = 0; i < 3; i++) tracker.observe(zeros());
    expect(tracker.worst().intents).toEqual({ engage: 3, kite: 0, retreat: 0, idle: 0 });
  });

  it('prints a run of one intent with that one count', () => {
    const none = { id: 3, from: 9, length: 7, intent: 'kite' as const };
    expect(stallMessage({ ...none, intents: { engage: 0, kite: 7, retreat: 0, idle: 0 } })).toBe(
      'champion 3 stalled from tick 9 for 7 ticks in kite (kite 7)',
    );
  });
});

// The tracker's own oracle (`holding` in helpers.ts) knows the wait of Skerrow for Lunge, written
// from bots.md and not from the rule of src: a stand from 6 to 8 m with a clear shot while her SPACE
// has 2 to 90 ticks left.
describe('createStallTracker and the wait of Skerrow', () => {
  const waiting = (distance: number, cooldown: number, options: Parameters<typeof sceneOf>[2] = {}) =>
    sceneOf('skerrow', distance, { ready: [], cooldown: { SPACE: cooldown }, ...options });
  const stalls = (state: GameState): number => worstAfter(state, [stub('engage', 2)], [ZERO]);

  it('does not count the stand from 6 to 8 m at a SPACE cooldown of 2 to 90', () => {
    for (const d of [6, 7, 8]) expect(stalls(waiting(d, 50)), `at ${d} m`).toBe(0);
    for (const cooldown of [2, 90]) expect(stalls(waiting(7, cooldown)), `cooldown ${cooldown}`).toBe(0);
  });

  it('counts the same stand just outside the band or the cooldown: 10 of 10', () => {
    for (const d of [5.95, 8.05]) expect(stalls(waiting(d, 50)), `at ${d} m`).toBe(10);
    for (const cooldown of [0, 1, 91]) expect(stalls(waiting(7, cooldown)), `cooldown ${cooldown}`).toBe(10);
  });

  it('counts the stand with no clear shot: 10 of 10', () => {
    const behind = waiting(7, 50, { arena: arena01, me: [-3.5, 0], enemy: [3.5, 0] });
    expect(stalls(behind)).toBe(10);
  });

  it('counts the stand of a Skerrow that has no kit, and of a champion that is not Skerrow', () => {
    expect(stalls(waiting(7, 50, { kits: [] }))).toBe(10);
    expect(stalls(sceneOf('hargrim', 7, { ready: [], cooldown: { SPACE: 50 } }))).toBe(10);
  });
});

// The recorded stand of #123, seed 6: two Hargrims 2.139 m apart, A one ulp inside the inflated
// circle of arena01's centre pillar, B in the open. The kit's rangeMax is 2 (the band top of 3 m
// less the margin of 1), so neither holds, and the pillar is between them, so neither has a clear
// shot. The tracker's reachability uses the bots' own `nearestFreeCell`: with the tolerance of
// `geometry.ts` it finds a free cell next to A and the enemy reachable, so the tracker counts the
// stand; without it the search returns no cell, the enemy reads unreachable and the tracker reads
// 0. That is why the tracker could not see the stand on the bots that stalled for thousands of
// ticks, and why this row is red without the tolerance.
describe('createStallTracker and the end-ring stand of #123', () => {
  it('counts the two Hargrims that stand one ulp inside the centre pillar: 10 of 10', () => {
    const state = sceneOf('hargrim', 0, {
      arena: arena01,
      me: [0.0855392913577604, -1.9981699201104024],
      enemy: [2.0015268855029604, -1.0463832708773901],
      enemyId: 'hargrim',
    });
    const bots = [stub('engage', 2), stub('idle', -1), stub('engage', 0)];
    expect(worstAfter(state, bots, [ZERO, ZERO, ZERO])).toBe(10);
  });
});
