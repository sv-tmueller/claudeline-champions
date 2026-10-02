import { describe, expect, it } from 'vitest';
import { createMatch, hasLineOfSight, step } from '@claudeline/sim';
import type { ArenaDef, ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import { createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import type { Difficulty } from '../src/difficulty';
import { profileFor } from '../src/profile';
import { arena01, config2v2 } from './helpers';

const open: ArenaDef = { ...arena01, id: 'open', obstacles: [] };
const STEP = 5.5 / 60;

function setup(arena: ArenaDef = open): GameState {
  return createMatch(config2v2(), arena, 1);
}

function ch(state: GameState, id: number): ChampionState {
  const c = state.champions[id];
  if (!c) throw new Error(`no champion ${id}`);
  return c;
}

function put(state: GameState, id: number, x: number, y: number): ChampionState {
  const c = ch(state, id);
  c.x = x;
  c.y = y;
  return c;
}

function kill(state: GameState, ...ids: number[]): void {
  for (const id of ids) ch(state, id).alive = false;
}

/** Think without stepping: the state stays put, so only the bot's own memory moves. */
function thinkTimes(bot: Bot, state: GameState, n: number): PlayerInput {
  let last = bot.think(state);
  for (let i = 1; i < n; i++) last = bot.think(state);
  return last;
}

/** One tick: every bot thinks on the same state, then the sim steps once. */
function tick(
  state: GameState,
  bots: Map<number, Bot>,
  scripted: Map<number, PlayerInput> = new Map(),
): void {
  const inputs: (PlayerInput | undefined)[] = [];
  for (const [id, bot] of bots) inputs[id] = bot.think(state);
  for (const [id, input] of scripted) inputs[id] = input;
  step(state, inputs);
}

function dist(a: ChampionState, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('createBot validation', () => {
  it('throws an Invalid bot error for a bad player id', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createBot(bad, 'easy', 1), String(bad)).toThrow(/^Invalid bot: /);
    }
  });

  it('throws for a difficulty that is not a tier, including prototype names', () => {
    for (const bad of ['extreme', 'constructor', '__proto__', 'toString', '', 3, null, undefined]) {
      expect(() => createBot(0, bad as unknown as Difficulty, 1), String(bad)).toThrow(
        /^Invalid bot: /,
      );
    }
  });

  it('throws for a seed that is not an integer', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, '3' as unknown as number]) {
      expect(() => createBot(0, 'easy', bad), String(bad)).toThrow(/^Invalid bot: /);
    }
  });

  it('accepts every tier and negative or large integer seeds', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      expect(() => createBot(0, tier, -5)).not.toThrow();
    }
    expect(() => createBot(3, 'hard', 2 ** 40)).not.toThrow();
  });

  it('throws on think when the state has no such champion', () => {
    expect(() => createBot(9, 'easy', 1).think(setup())).toThrow(/^Invalid bot: /);
  });
});

describe('think output', () => {
  it('returns a neutral input with the stored aim for a dead champion', () => {
    const state = setup();
    const me = ch(state, 0);
    me.aimX = 123;
    me.aimY = -456;
    me.alive = false;
    const bot = createBot(0, 'hard', 1);
    expect(bot.think(state)).toEqual({ moveX: 0, moveY: 0, aimX: 123, aimY: -456, buttons: 0 });
    expect(bot.inspect()).toEqual({ intent: 'idle', targetId: -1 });
  });

  it('returns a fresh valid input every tick', () => {
    const state = setup();
    kill(state, 1, 3);
    const bots = new Map([[0, createBot(0, 'hard', 3)]]);
    const bot = bots.get(0);
    if (!bot) throw new Error('no bot');
    const seen = new Set<PlayerInput>();
    for (let i = 0; i < 300; i++) {
      const input = bot.think(state);
      expect(seen.has(input)).toBe(false);
      seen.add(input);
      expect(Object.is(input.moveX, 0) || input.moveX === 1 || input.moveX === -1).toBe(true);
      expect(Object.is(input.moveY, 0) || input.moveY === 1 || input.moveY === -1).toBe(true);
      expect(Object.is(input.moveX, -0)).toBe(false);
      expect(Object.is(input.moveY, -0)).toBe(false);
      expect(Number.isInteger(input.aimX)).toBe(true);
      expect(Number.isInteger(input.aimY)).toBe(true);
      expect(Object.is(input.aimX, -0)).toBe(false);
      expect(Object.is(input.aimY, -0)).toBe(false);
      expect(input.buttons).toBe(0);
      step(state, [input]);
    }
  });

  it('never changes the state it reads', () => {
    const state = setup(arena01);
    const bot = createBot(0, 'normal', 8);
    for (let i = 0; i < 120; i++) {
      const before = JSON.stringify(state);
      const input = bot.think(state);
      expect(JSON.stringify(state)).toBe(before);
      step(state, [input]);
    }
  });

  it('inspect returns a fresh copy', () => {
    const state = setup();
    const bot = createBot(0, 'hard', 1);
    thinkTimes(bot, state, 10);
    const a = bot.inspect();
    expect(a).toEqual({ intent: 'engage', targetId: 2 });
    a.intent = 'retreat';
    a.targetId = 99;
    expect(bot.inspect()).toEqual({ intent: 'engage', targetId: 2 });
    expect(bot.inspect()).not.toBe(bot.inspect());
  });
});

describe('target choice', () => {
  function targetOf(state: GameState, tier: Difficulty = 'hard'): number {
    const bot = createBot(0, tier, 1);
    thinkTimes(bot, state, TIERS[tier].delay + 1);
    return bot.inspect().targetId;
  }

  it('picks the lower id on equal distance', () => {
    const state = setup();
    put(state, 0, -5, 0);
    put(state, 2, 5, 3);
    put(state, 3, 5, -3);
    expect(targetOf(state)).toBe(2);
  });

  it('keeps its target until another enemy is more than 1 m nearer', () => {
    const state = setup();
    put(state, 0, -5, 0);
    put(state, 2, 5, 0);
    put(state, 3, 5.5, 0);
    const bot = createBot(0, 'hard', 1);
    thinkTimes(bot, state, 10);
    expect(bot.inspect().targetId).toBe(2);
    // Enemy 2 is 10 m away. Enemy 3 at 9.2 m is 0.8 m nearer: still enemy 2.
    put(state, 3, 4.2, 0);
    thinkTimes(bot, state, 10);
    expect(bot.inspect().targetId).toBe(2);
    // At 8.9 m it is 1.1 m nearer: switch.
    put(state, 3, 3.9, 0);
    thinkTimes(bot, state, 10);
    expect(bot.inspect().targetId).toBe(3);
  });

  it('skips a dead enemy', () => {
    const state = setup();
    put(state, 0, -5, 0);
    put(state, 2, -3, 0);
    put(state, 3, 6, 0);
    kill(state, 2);
    expect(targetOf(state)).toBe(3);
  });

  it('idles with the aim unchanged when no enemy is alive', () => {
    const state = setup();
    kill(state, 2, 3);
    const me = ch(state, 0);
    const bot = createBot(0, 'easy', 1);
    for (let i = 0; i < 80; i++) {
      const input = bot.think(state);
      expect(input).toEqual({ moveX: 0, moveY: 0, aimX: me.aimX, aimY: me.aimY, buttons: 0 });
    }
    expect(bot.inspect()).toEqual({ intent: 'idle', targetId: -1 });
  });

  it('starts again from engage when an enemy returns', () => {
    const state = setup();
    put(state, 0, -5, 0);
    put(state, 2, 5, 0);
    kill(state, 3);
    const bot = createBot(0, 'hard', 1);
    thinkTimes(bot, state, 10);
    expect(bot.inspect().intent).toBe('engage');
    ch(state, 2).alive = false;
    thinkTimes(bot, state, 10);
    expect(bot.inspect()).toEqual({ intent: 'idle', targetId: -1 });
    ch(state, 2).alive = true;
    thinkTimes(bot, state, 10);
    expect(bot.inspect()).toEqual({ intent: 'engage', targetId: 2 });
  });
});

describe('engage', () => {
  for (const [name, id, tier] of [
    ['hargrim', 0, 'hard'],
    ['quillon', 1, 'hard'],
  ] as const) {
    it(`${name} stops at its maximum range in the clear lane and stays still`, () => {
      const state = setup(arena01);
      kill(state, id === 0 ? 1 : 0, 3);
      const me = put(state, id, -12, 3);
      const target = put(state, 2, 4, 3);
      const rangeMax = profileFor(me.championId).rangeMax;
      const bots = new Map([[id, createBot(id, tier, 5)]]);
      let still = 0;
      for (let i = 0; i < 700; i++) {
        tick(state, bots);
        still = me.vx === 0 && me.vy === 0 ? still + 1 : 0;
      }
      expect(dist(me, target)).toBeGreaterThan(rangeMax - 0.2);
      expect(dist(me, target)).toBeLessThanOrEqual(rangeMax);
      expect(still).toBeGreaterThanOrEqual(60);
    });
  }

  it('keeps moving around a wall until it has line of sight', () => {
    // A tall wall instead of the pillar: a ranged bot that detoured around the pillar would
    // pass inside its kite range and stop there (see the notes in the pull request).
    const wall: ArenaDef = {
      ...open,
      obstacles: [{ type: 'rect', x: 0, y: 0, w: 0.5, h: 10, height: 1.5, blocksProjectiles: true }],
    };
    const state = setup(wall);
    kill(state, 0, 3);
    const me = put(state, 1, -4, 0);
    const target = put(state, 2, 4, 0);
    expect(hasLineOfSight(state, me, target)).toBe(false);
    expect(dist(me, target)).toBeLessThanOrEqual(profileFor('quillon').rangeMax);
    const bots = new Map([[1, createBot(1, 'hard', 5)]]);
    let moving = 0;
    let ticks = 0;
    while (!hasLineOfSight(state, me, target) && ticks < 900) {
      tick(state, bots);
      ticks++;
      if (me.vx !== 0 || me.vy !== 0) moving++;
    }
    expect(hasLineOfSight(state, me, target)).toBe(true);
    // After the reaction delay of idling it walks every tick until it sees the target.
    expect(moving).toBeGreaterThanOrEqual(ticks - TIERS.hard.delay - 1);
    for (let i = 0; i < 30; i++) tick(state, bots);
    expect(me.vx === 0 && me.vy === 0).toBe(true);
    expect(hasLineOfSight(state, me, target)).toBe(true);
  });

  it('walks around the pillar to a melee target', () => {
    const state = setup(arena01);
    kill(state, 1, 3);
    const me = put(state, 0, -4, 0);
    const target = put(state, 2, 4, 0);
    const bots = new Map([[0, createBot(0, 'hard', 5)]]);
    for (let i = 0; i < 600; i++) tick(state, bots);
    expect(dist(me, target)).toBeLessThanOrEqual(profileFor('hargrim').rangeMax);
    expect(hasLineOfSight(state, me, target)).toBe(true);
  });
});

describe('kite', () => {
  it('backs away from a target that walks at it and keeps its distance', () => {
    const state = setup(arena01);
    kill(state, 0, 3);
    const me = put(state, 1, 4, 3);
    const target = put(state, 2, -4, 3);
    const bot = createBot(1, 'hard', 9);
    const bots = new Map([[1, bot]]);
    const east: PlayerInput = { moveX: 1, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };
    const floor = 6 - TIERS.hard.delay * STEP - 0.2;
    let minDistance = Infinity;
    let sawKite = false;
    let ticks = 0;
    while (me.x <= 12 && ticks < 600) {
      const before = me.x;
      tick(state, bots, new Map([[2, east]]));
      ticks++;
      minDistance = Math.min(minDistance, dist(me, target));
      if (bot.inspect().intent === 'kite') {
        sawKite = true;
        expect(me.x).toBeGreaterThanOrEqual(before);
      }
    }
    expect(sawKite).toBe(true);
    expect(me.x).toBeGreaterThan(12);
    expect(minDistance).toBeGreaterThanOrEqual(floor);
  });
});

describe('retreat', () => {
  it('walks to its own spawn away from the target and stops there', () => {
    const state = setup(arena01);
    kill(state, 1, 3);
    const me = put(state, 0, -6, 3);
    const target = put(state, 2, 0, 3);
    me.health = 0.2 * me.maxHealth;
    const spawn = { x: arena01.spawns.teamA[0]?.[0] ?? NaN, y: arena01.spawns.teamA[0]?.[1] ?? NaN };
    const bot = createBot(0, 'hard', 2);
    const bots = new Map([[0, bot]]);
    const startToSpawn = dist(me, spawn);
    const startToTarget = dist(me, target);
    for (let i = 0; i < 100; i++) tick(state, bots);
    expect(bot.inspect().intent).toBe('retreat');
    expect(dist(me, spawn)).toBeLessThan(startToSpawn);
    expect(dist(me, target)).toBeGreaterThan(startToTarget);
    for (let i = 0; i < 300; i++) tick(state, bots);
    expect(dist(me, spawn)).toBeLessThanOrEqual(0.5);
    expect(me.vx === 0 && me.vy === 0).toBe(true);
  });

  it('uses the spawn slot of its own team position', () => {
    const state = setup(arena01);
    kill(state, 0, 3);
    const me = put(state, 1, -6, -3);
    put(state, 2, 0, -3);
    me.health = 0.1 * me.maxHealth;
    const bots = new Map([[1, createBot(1, 'hard', 2)]]);
    for (let i = 0; i < 500; i++) tick(state, bots);
    // Champion 1 is the second player of team A, so its spawn is (-12, -2).
    expect(dist(me, { x: -12, y: -2 })).toBeLessThanOrEqual(0.5);
  });
});

describe('reaction delay', () => {
  for (const tier of ['easy', 'normal', 'hard'] as const) {
    it(`${tier} acts on a change exactly ${TIERS[tier].delay} thinks later`, () => {
      const state = setup();
      put(state, 0, -5, 0);
      put(state, 2, 3, 0);
      kill(state, 1, 3);
      const me = ch(state, 0);
      const bot = createBot(0, tier, 4);
      const n = 100;
      for (let i = 0; i < n; i++) bot.think(state);
      expect(bot.inspect().intent).toBe('engage');
      me.health = 0.2 * me.maxHealth;
      let first = -1;
      for (let i = n; i < n + 100; i++) {
        bot.think(state);
        if (first < 0 && bot.inspect().intent === 'retreat') first = i;
      }
      expect(first).toBe(n + TIERS[tier].delay);
    });
  }
});

describe('aim error', () => {
  /** Angles in degrees between the bot's aim and the exact lead at a stationary target. */
  function errors(tier: Difficulty, thinks: number): number[] {
    const state = setup();
    kill(state, 0, 3);
    const me = put(state, 1, -5, 0);
    const target = put(state, 2, 5, 0);
    const bot = createBot(1, tier, 77);
    const out: number[] = [];
    for (let i = 0; i < thinks; i++) {
      const input = bot.think(state);
      if (i < TIERS[tier].delay) continue;
      const aim = Math.atan2(input.aimY / 100 - me.y, input.aimX / 100 - me.x);
      const lead = Math.atan2(target.y - me.y, target.x - me.x);
      out.push(((aim - lead) * 180) / Math.PI);
    }
    return out;
  }

  const mean = (xs: number[]) => xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length;

  it('never exceeds the tier maximum plus rounding slack over 600 thinks', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const e = errors(tier, 600);
      expect(Math.max(...e.map(Math.abs))).toBeLessThanOrEqual(TIERS[tier].errorDegrees + 0.05);
    }
  });

  it('is ordered easy above normal above hard', () => {
    const easy = mean(errors('easy', 600));
    const normal = mean(errors('normal', 600));
    const hard = mean(errors('hard', 600));
    expect(easy).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(hard);
  });

  it('holds each error for 15 thinks', () => {
    const e = errors('normal', 300);
    for (let block = 0; block + 15 <= e.length; block += 15) {
      for (let i = 1; i < 15; i++) expect(e[block + i]).toBe(e[block]);
      if (block + 15 < e.length) expect(e[block + 15]).not.toBe(e[block]);
    }
  });

  it('keeps the stored aim while idle', () => {
    const state = setup();
    kill(state, 2, 3);
    const me = ch(state, 0);
    me.aimX = 777;
    me.aimY = -333;
    const bot = createBot(0, 'normal', 1);
    for (let i = 0; i < 40; i++) {
      const input = bot.think(state);
      expect([input.aimX, input.aimY]).toEqual([777, -333]);
    }
  });
});
