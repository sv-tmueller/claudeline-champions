import { describe, expect, it } from 'vitest';
import { ORB_COLLECTIBLE_TICKS, cloneState, step } from '@claudeline/sim';
import type { ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import { createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import type { Difficulty } from '../src/difficulty';
import { profileFor } from '../src/profile';
import { arena01, jsonKits } from './helpers';
import { OPEN, sceneOf } from './scenes';

// The orb rule of spec section 6 and bots.md (The energy orb), on frozen scenes with the orb on. A
// bot contests the orb when it is up (collectible: round phase, not taken, phaseTicks at least
// 1200), no enemy is within the bot's own reach (alive, within rangeMax inclusive, clear shot of
// 0.5 m: `enemyInReach`), and it is strictly nearer the orb than every alive enemy. The contest is
// observed with a twin: the same state but for `orb.taken = true`, thought on by a bot of the same
// seed. The contest is the first think on which the two streams differ; the rule changes the move
// only, so the aim and the buttons never differ.

const FIELDS = ['moveX', 'moveY', 'aimX', 'aimY', 'buttons'] as const;
type Row = readonly [number, number, number, number, number];

function rowOf(input: PlayerInput): Row {
  return [input.moveX, input.moveY, input.aimX, input.aimY, input.buttons];
}

function twinOf(state: GameState): GameState {
  const twin = cloneState(state);
  if (twin.match?.orb !== undefined) twin.match.orb.taken = true;
  return twin;
}

function thinkRows(bot: Bot, state: GameState, thinks: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < thinks; i++) rows.push(rowOf(bot.think(state)));
  return rows;
}

interface Diff {
  /** The first think on which the two streams differ, or -1. */
  first: number;
  /** The fields that differ over the whole window. */
  fields: Set<string>;
}

function diffOf(a: readonly Row[], b: readonly Row[]): Diff {
  let first = -1;
  const fields = new Set<string>();
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Row;
    const y = b[i] as Row;
    for (let f = 0; f < FIELDS.length; f++) {
      if (x[f] !== y[f]) {
        fields.add(FIELDS[f] as string);
        if (first < 0) first = i;
      }
    }
  }
  return { first, fields };
}

/** Thinks past the delay on which a contest has shown. */
const WINDOW = 25;

/** A fresh bot of champion 0 on the state against its twin, over the delay of the tier and a window. */
function contest(state: GameState, tier: Difficulty = 'hard', seed = 1): Diff {
  const thinks = TIERS[tier].delay + WINDOW;
  const a = thinkRows(createBot(0, tier, seed), state, thinks);
  const b = thinkRows(createBot(0, tier, seed), twinOf(state), thinks);
  return diffOf(a, b);
}

const hargrim = (options: Parameters<typeof sceneOf>[2]) => sceneOf('hargrim', 4, options);

/**
 * The base contest: Hargrim 3 m west of the orb at (0, 2.5), its enemy 8 m south of it and 8.5 m
 * from the orb. 8 m is past every opener band of Hargrim, so the bot presses nothing and walks.
 */
const ME: readonly [number, number] = [-3, 2.5];
const FAR_ENEMY: readonly [number, number] = [-3, -5.5];

describe('a bot contests the energy orb when it is up, nothing is in reach and it is nearer', () => {
  it.each(['easy', 'normal', 'hard'] as const)(
    'walks to the orb exactly `delay` thinks after it becomes collectible (%s)',
    (tier) => {
      const delay = TIERS[tier].delay;
      const a = hargrim({ me: ME, enemy: FAR_ENEMY, orb: { phaseTicks: ORB_COLLECTIBLE_TICKS - 1 } });
      const b = twinOf(a);
      const botA = createBot(0, tier, 1);
      const botB = createBot(0, tier, 1);
      // Settled with the orb not yet collectible: the streams are the same.
      expect(diffOf(thinkRows(botA, a, 60), thinkRows(botB, b, 60)).first).toBe(-1);
      (a.match as NonNullable<GameState['match']>).phaseTicks = ORB_COLLECTIBLE_TICKS;
      (b.match as NonNullable<GameState['match']>).phaseTicks = ORB_COLLECTIBLE_TICKS;
      const diff = diffOf(thinkRows(botA, a, delay + WINDOW), thinkRows(botB, b, delay + WINDOW));
      // The decision of the first think reaches the legs `delay` thinks later, and only the move.
      expect(diff.first).toBe(delay);
      expect([...diff.fields].every((f) => f === 'moveX' || f === 'moveY')).toBe(true);
    },
  );

  it('takes the orb: the stepped match emits orbTaken for the bot, the enemy idle', () => {
    const state = hargrim({ me: ME, enemy: FAR_ENEMY, orb: {} });
    const bot = createBot(0, 'normal', 1);
    const idle: PlayerInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };
    let taker = -1;
    for (let t = 0; t < 300 && taker < 0; t++) {
      const input = bot.think(state);
      step(state, [{ ...input }, idle, idle, idle]);
      const event = state.events.find((e) => e.type === 'orbTaken');
      if (event?.type === 'orbTaken') taker = event.championId;
    }
    expect(taker).toBe(0);
  });

  it('contests as a bot with no kit and no profile entry', () => {
    // The default profile reaches 8 m: the enemy is 9 m away.
    const state = sceneOf('dummy', 4, { me: ME, enemy: [ME[0], ME[1] - 9], orb: {} });
    expect(contest(state).first).toBe(TIERS.hard.delay);
  });
});

describe('the threat: an enemy within the bot own reach, inclusive, with a clear shot', () => {
  // The reach of the bot is the profile of the shipped kit, not the table entry.
  const reach = profileFor('hargrim', jsonKits().find((k) => k.id === 'hargrim')).rangeMax;
  const at = (distance: number) =>
    hargrim({ me: ME, enemy: [ME[0], ME[1] - distance], orb: {} });

  it('has a reach that leaves room for the scenes below', () => {
    expect(reach).toBeGreaterThan(1);
    expect(reach).toBeLessThan(3.5);
  });

  it('does not contest with an enemy at exactly rangeMax', () => {
    expect(contest(at(reach)).first).toBe(-1);
  });

  it('contests with the enemy 0.05 m beyond rangeMax', () => {
    expect(contest(at(reach + 0.05)).first).toBe(TIERS.hard.delay);
  });

  it('contests with an enemy within rangeMax but behind a wall: no clear shot', () => {
    // Arena 01's rect at (-8, 0), 1 m by 3 m, blocks projectiles: Hargrim touches it on the east, the
    // enemy on the west, 2 m from Hargrim (within the reach of the shipped kit, inclusive), and
    // farther from the orb.
    const state = hargrim({ arena: arena01, me: [-7, 0], enemy: [-9, 0], orb: {} });
    expect(contest(state).first).toBe(TIERS.hard.delay);
  });

  it('does not contest with the same enemy in the open', () => {
    const state = hargrim({ arena: OPEN, me: [-7, 0], enemy: [-9, 0], orb: {} });
    expect(contest(state).first).toBe(-1);
  });
});

describe('the bot must be strictly nearer the orb than every alive enemy', () => {
  // The bot is 3 m from the orb; the enemy stands `r` m north of it, 4.2 m or more from the bot and
  // in a direction from the bot that is not the direction of the orb.
  const state = (r: number) => hargrim({ me: ME, enemy: [0, 2.5 + r], orb: {} });
  it('does not contest with an enemy 0.05 m nearer', () => {
    expect(contest(state(2.95)).first).toBe(-1);
  });

  it('does not contest on a mirror tie', () => {
    expect(contest(state(3)).first).toBe(-1);
  });

  it('contests with an enemy 0.05 m farther', () => {
    expect(contest(state(3.05)).first).toBe(TIERS.hard.delay);
  });

  it('does not contest when a second enemy, not the target, is nearer', () => {
    const s = state(3.05);
    const second = s.champions[3] as ChampionState;
    second.alive = true;
    second.x = 2;
    second.y = 2.5;
    expect(contest(s).first).toBe(-1);
  });

  it('contests when the nearer enemy is dead', () => {
    const s = state(3.05);
    const dead = s.champions[3] as ChampionState;
    dead.alive = false;
    dead.x = 2;
    dead.y = 2.5;
    expect(contest(s).first).toBe(TIERS.hard.delay);
  });

  it('contests when an ally is nearer', () => {
    const s = hargrim({ me: ME, enemy: FAR_ENEMY, ally: [-1, 2.5], orb: {} });
    expect(contest(s).first).toBe(TIERS.hard.delay);
  });
});

describe('the orb is up only when it is collectible', () => {
  const at = (orb: NonNullable<Parameters<typeof sceneOf>[2]>['orb']) =>
    hargrim({ me: ME, enemy: FAR_ENEMY, orb });

  it('does not contest at tick 1199 and contests at tick 1200', () => {
    expect(contest(at({ phaseTicks: 1199 })).first).toBe(-1);
    expect(contest(at({ phaseTicks: 1200 })).first).toBe(TIERS.hard.delay);
  });

  it('does not pre-position at the warning (tick 1020) and contests at 1201 and later', () => {
    expect(contest(at({ phaseTicks: 1020 })).first).toBe(-1);
    expect(contest(at({ phaseTicks: 1201 })).first).toBe(TIERS.hard.delay);
    expect(contest(at({ phaseTicks: 4000 })).first).toBe(TIERS.hard.delay);
  });

  it('does not contest an orb that is taken', () => {
    const s = at({ taken: true });
    expect(diffOf(thinkRows(createBot(0, 'hard', 1), s, 30), thinkRows(createBot(0, 'hard', 1), twinOf(s), 30)).first).toBe(-1);
    // Taken is also what the twin is: the bot's stream with it taken must not walk to (0, 2.5).
    const walkers = thinkRows(createBot(0, 'hard', 1), s, 40).filter((r) => r[0] > 0 && r[1] === 0);
    expect(walkers).toEqual([]);
  });

  it('does not contest in any phase but the round', () => {
    for (const phase of ['warmup', 'roundEnd', 'matchEnd'] as const) {
      expect(contest(at({ phase, phaseTicks: 5000 })).first, phase).toBe(-1);
    }
  });

  it('plays free play, with no match flow, as it does with the orb off', () => {
    const free = hargrim({ me: ME, enemy: FAR_ENEMY });
    expect(free.match).toBeUndefined();
    const taken = at({ taken: true });
    const a = thinkRows(createBot(0, 'hard', 1), free, 40);
    const b = thinkRows(createBot(0, 'hard', 1), taken, 40);
    expect(diffOf(a, b).first).toBe(-1);
  });

  it('plays a match flow with no orb as it does with the orb off', () => {
    const noOrb = at({});
    delete (noOrb.match as NonNullable<GameState['match']>).orb;
    const a = thinkRows(createBot(0, 'hard', 1), noOrb, 40);
    const b = thinkRows(createBot(0, 'hard', 1), twinOf(at({})), 40);
    expect(diffOf(a, b).first).toBe(-1);
  });
});

describe('the reaction delay carries the contest, and the act time checks it again', () => {
  it('never walks to an orb taken inside the delay', () => {
    const tier = 'hard';
    const a = hargrim({ me: ME, enemy: FAR_ENEMY, orb: { phaseTicks: ORB_COLLECTIBLE_TICKS - 1 } });
    const b = twinOf(a);
    const botA = createBot(0, tier, 1);
    const botB = createBot(0, tier, 1);
    expect(diffOf(thinkRows(botA, a, 60), thinkRows(botB, b, 60)).first).toBe(-1);
    // The orb is up for one think, then gone: the decision to contest is in the ring, and the
    // bot must not act on it.
    (a.match as NonNullable<GameState['match']>).phaseTicks = ORB_COLLECTIBLE_TICKS;
    (b.match as NonNullable<GameState['match']>).phaseTicks = ORB_COLLECTIBLE_TICKS;
    (b.match as NonNullable<GameState['match']>).orb!.taken = true;
    const rowsA = thinkRows(botA, a, 1);
    (a.match as NonNullable<GameState['match']>).orb!.taken = true;
    rowsA.push(...thinkRows(botA, a, TIERS[tier].delay + WINDOW - 1));
    const rowsB = thinkRows(botB, b, TIERS[tier].delay + WINDOW);
    expect(diffOf(rowsA, rowsB).first).toBe(-1);
  });
});

describe('only the move is replaced', () => {
  it('a retreating Hargrim nearer the orb walks to it and still presses Iron Hide as its twin does', () => {
    const state = sceneOf('hargrim', 4, {
      me: [-3, 2.5],
      enemy: [-3, -2.5],
      ready: ['R'],
      health: 0.2,
      orb: {},
    });
    const a = thinkRows(createBot(0, 'hard', 1), state, TIERS.hard.delay + THINKS_PAST);
    const b = thinkRows(createBot(0, 'hard', 1), twinOf(state), TIERS.hard.delay + THINKS_PAST);
    const diff = diffOf(a, b);
    expect(diff.first).toBe(TIERS.hard.delay);
    expect([...diff.fields].every((f) => f === 'moveX' || f === 'moveY')).toBe(true);
    // Iron Hide is pressed (R is the button of the row) by both, on the same thinks.
    expect(a.filter((r) => r[4] !== 0).length).toBeGreaterThan(0);
    expect(a.map((r) => r[4])).toEqual(b.map((r) => r[4]));
  });
});

const THINKS_PAST = 30;
