import { describe, expect, it } from 'vitest';
import { createMatch, hasLineOfSight, step } from '@claudeline/sim';
import type { ArenaDef, ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import { KITE_STEP, TARGET_SWITCH_MARGIN, createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import type { Difficulty } from '../src/difficulty';
import { createFollower, followPath } from '../src/follow';
import { pointBlocked } from '../src/geometry';
import { buildNavGrid, cellIndexAt } from '../src/grid';
import type { Vec2 } from '../src/grid';
import { profileFor } from '../src/profile';
import { nearestSightCell } from '../src/sight';
import { NOMINAL_PROJECTILE_SPEED, leadPoint, rotateByHalfTangent, roundAim } from '../src/aim';
import { createRng } from '../src/rng';
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

  it('pins the switch margin at 1 m: exactly 1 m nearer stays, 1.01 m switches, 0.99 m stays', () => {
    expect(TARGET_SWITCH_MARGIN).toBe(1);
    // Enemy 2 is 10 m from the bot. Enemy 3 starts further away, then moves to the given distance.
    const cases: [number, number][] = [
      [9, 2], // exactly 1 m nearer: strict greater-than keeps the target
      [8.99, 3], // 1.01 m nearer
      [9.01, 2], // 0.99 m nearer
    ];
    for (const [d3, expected] of cases) {
      const state = setup();
      put(state, 0, -5, 0);
      put(state, 2, 5, 0);
      put(state, 3, 5.5, 0);
      const bot = createBot(0, 'hard', 1);
      thinkTimes(bot, state, 10);
      expect(bot.inspect().targetId, `start ${d3}`).toBe(2);
      put(state, 3, -5 + d3, 0);
      thinkTimes(bot, state, 10);
      expect(bot.inspect().targetId, `enemy 3 at ${d3} m`).toBe(expected);
    }
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
    // A tall wall instead of the pillar: the detour around the pillar passes through the kite
    // band, where the bot regains line of sight by the kite rules (see the kite tests). The
    // wall pins the engage rule on its own: the bot stays in engage until it sees the target.
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

describe('kite step', () => {
  /** A wall with its west face `face` metres east of the bot at the origin, target 3 m west. */
  function wallArena(face: number): ArenaDef {
    return {
      ...open,
      id: 'wall',
      obstacles: [
        { type: 'rect', x: face + 1, y: 0, w: 2, h: 16, height: 1.5, blocksProjectiles: true },
      ],
    };
  }

  function kiteMoveBesideWall(face: number) {
    const state = setup(wallArena(face));
    kill(state, 0, 3);
    put(state, 1, 0, 0);
    put(state, 2, -3, 0);
    const bot = createBot(1, 'hard', 1);
    const input = thinkTimes(bot, state, TIERS.hard.delay + 1);
    expect(bot.inspect().intent).toBe('kite');
    return { moveX: input.moveX, moveY: input.moveY };
  }

  it('pins the kite step at 1 m', () => {
    expect(KITE_STEP).toBe(1);
    // The champion radius is 0.5 and the grid cells are 0.5 m with the bot at a cell corner,
    // so the cell holding the point 1 m east has its centre at (1.25, 0.25) and is free only
    // with the wall face at 1.75 m or more. A face at 1.8 m leaves the straight step free: the
    // bot steps east. A step of 1.5 m would reach the cell centred at x 1.75, blocked at 1.8.
    expect(kiteMoveBesideWall(1.8)).toEqual({ moveX: 1, moveY: 0 });
    // At 1.5 m the straight cell is blocked, so the bot takes the +45 degree point. A step of
    // 0.8 m would stay in a free cell and go straight; one of 1.5 m would turn north.
    expect(kiteMoveBesideWall(1.5)).toEqual({ moveX: 1, moveY: 1 });
  });

  it('skips a point that is free when its grid cell is blocked', () => {
    // With the face at 1.6 m the point (1, 0) is free, since 1 + 0.5 < 1.6, but its cell is
    // blocked, because the cell centre (1.25, 0.25) has 1.25 + 0.5 > 1.6. The path follower
    // cannot plan to a blocked cell, so the bot takes the next candidate and moves (1, 1).
    const grid = buildNavGrid(wallArena(1.6));
    const point = { x: KITE_STEP, y: 0 };
    expect(pointBlocked(grid, point)).toBe(false);
    expect(grid.blocked[cellIndexAt(grid, point)]).toBe(true);
    expect(kiteMoveBesideWall(1.6)).toEqual({ moveX: 1, moveY: 1 });
    // A face at 1.48 m blocks the point itself, and the bot also moves (1, 1).
    expect(kiteMoveBesideWall(1.48)).toEqual({ moveX: 1, moveY: 1 });
  });
});

describe('kite corner and line of sight', () => {
  // Quillon (id 1, team A slot 1) spawns at (-12, -2).
  const SPAWN: Vec2 = { x: -12, y: -2 };
  const NOT_MOVING = { moveX: 0, moveY: 0 };

  /** The five points bot.ts tries, written out again: away, +45, -45, +90 and -90 degrees. */
  function kiteCandidates(me: Vec2, target: Vec2): Vec2[] {
    const d = Math.hypot(me.x - target.x, me.y - target.y);
    const ax = (me.x - target.x) / d;
    const ay = (me.y - target.y) / d;
    const r = Math.SQRT1_2;
    return [
      { x: ax, y: ay },
      { x: ax * r - ay * r, y: ax * r + ay * r },
      { x: ax * r + ay * r, y: -ax * r + ay * r },
      { x: -ay, y: ax },
      { x: ay, y: -ax },
    ].map((v) => ({ x: me.x + v.x * KITE_STEP, y: me.y + v.y * KITE_STEP }));
  }

  function expectCornered(me: Vec2, target: Vec2): void {
    const grid = buildNavGrid(arena01);
    for (const p of kiteCandidates(me, target)) {
      const cell = cellIndexAt(grid, p);
      expect(cell < 0 || grid.blocked[cell] === true, `${p.x}, ${p.y}`).toBe(true);
    }
  }

  function stepOne(state: GameState, id: number, input: PlayerInput): void {
    const inputs: (PlayerInput | undefined)[] = [];
    inputs[id] = input;
    step(state, inputs);
  }

  it('leaves a corner where all five kite steps are blocked', () => {
    const state = setup(arena01);
    kill(state, 0, 3);
    const me = put(state, 1, 14.4, 9.4);
    const target = put(state, 2, 12.4, 7.4);
    expectCornered(me, target);

    const bot = createBot(1, 'hard', 1);
    const first = thinkTimes(bot, state, TIERS.hard.delay + 1);
    expect(bot.inspect()).toEqual({ intent: 'kite', targetId: 2 });
    const grid = buildNavGrid(arena01);
    const expected = followPath(grid, createFollower(), me, SPAWN);
    expect(expected).not.toEqual(NOT_MOVING);
    expect({ moveX: first.moveX, moveY: first.moveY }).toEqual(expected);

    // The target stands still. Every input moves until the bot is 6 m from it.
    let ticks = 0;
    while (dist(me, target) < 6 && ticks < 300) {
      const input = bot.think(state);
      expect(input.moveX !== 0 || input.moveY !== 0, `tick ${ticks}`).toBe(true);
      for (const v of [input.moveX, input.moveY, input.aimX, input.aimY, me.x, me.y]) {
        expect(Number.isNaN(v)).toBe(false);
      }
      stepOne(state, 1, input);
      ticks++;
    }
    expect(dist(me, target)).toBeGreaterThanOrEqual(6);
    expect(dist(me, { x: 14.4, y: 9.4 })).toBeGreaterThan(1);
  });

  it('regains line of sight in the kite band', () => {
    const state = setup(arena01);
    kill(state, 0, 3);
    const me = put(state, 1, -3, 0);
    const target = put(state, 2, -3, 4);
    expect(hasLineOfSight(state, me, target)).toBe(true);
    const bot = createBot(1, 'hard', 1);
    thinkTimes(bot, state, TIERS.hard.delay + 1);
    expect(bot.inspect().intent).toBe('kite');

    // The target steps behind the pillar: 7 m away, inside the kite band, and out of sight.
    put(state, 2, 4, 0);
    expect(hasLineOfSight(state, me, target)).toBe(false);
    expect(dist(me, target)).toBe(7);
    const { rangeMin, rangeMax } = profileFor('quillon');
    const seen = () =>
      hasLineOfSight(state, me, target) && dist(me, target) >= rangeMin && dist(me, target) <= rangeMax;
    let ticks = 0;
    while (!seen() && ticks < 240) {
      const input = bot.think(state);
      expect(input.buttons, `tick ${ticks}`).toBe(0);
      stepOne(state, 1, input);
      ticks++;
    }
    expect(seen()).toBe(true);
    for (let i = 0; i < 30; i++) {
      const input = bot.think(state);
      expect(input.buttons).toBe(0);
      stepOne(state, 1, input);
      expect(hasLineOfSight(state, me, target), `hold ${i}`).toBe(true);
    }
    expect(me.vx === 0 && me.vy === 0).toBe(true);
  });

  it('follows the path to the target when no cell within 8 has line of sight', () => {
    const walled: ArenaDef = {
      ...open,
      id: 'walled',
      obstacles: [{ type: 'rect', x: 0, y: 0, w: 0.5, h: 16, height: 1.5, blocksProjectiles: true }],
    };
    const state = setup(walled);
    kill(state, 0, 3);
    const me = put(state, 1, -3.25, 0.25);
    const target = put(state, 2, -3.25, 4.25);
    const bot = createBot(1, 'hard', 1);
    thinkTimes(bot, state, TIERS.hard.delay + 1);
    expect(bot.inspect().intent).toBe('kite');

    // Across the wall and 6.5 m away: the cells that see it are 2.5 m from it, below the band.
    put(state, 2, 3.25, 0.25);
    expect(hasLineOfSight(state, me, target)).toBe(false);
    const grid = buildNavGrid(walled);
    const { rangeMin, rangeMax } = profileFor('quillon');
    expect(nearestSightCell(grid, state, me, target, rangeMin, rangeMax)).toBe(-1);

    const input = bot.think(state);
    expect(bot.inspect().intent).toBe('kite');
    const expected = followPath(grid, createFollower(), me, target);
    expect(expected).not.toEqual(NOT_MOVING);
    expect({ moveX: input.moveX, moveY: input.moveY }).toEqual(expected);
    expect(input.buttons).toBe(0);
  });

  it('starts a fresh plan when it is cornered again after kite steps', () => {
    const state = setup(arena01);
    kill(state, 0, 3);
    const me = put(state, 1, 14.4, 9.4);
    const target = put(state, 2, 12.4, 7.4);
    const bot = createBot(1, 'hard', 1);
    thinkTimes(bot, state, TIERS.hard.delay + 1);
    expect(bot.inspect().intent).toBe('kite');

    // Open ground, 7 m from the target and in sight: the bot stands, so it never calls the path
    // follower and the escape is over.
    put(state, 1, 2, 3);
    put(state, 2, 9, 3);
    for (let i = 0; i < 5; i++) {
      const input = bot.think(state);
      expect(input).toMatchObject({ moveX: 0, moveY: 0 });
    }

    // Cornered again, in the other corner. The escape plan from the first corner is stale.
    put(state, 1, 14.4, -9.4);
    put(state, 2, 12.4, -7.4);
    expectCornered(me, target);
    const input = bot.think(state);
    const expected = followPath(buildNavGrid(arena01), createFollower(), me, SPAWN);
    expect(expected).not.toEqual(NOT_MOVING);
    expect({ moveX: input.moveX, moveY: input.moveY }).toEqual(expected);
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

describe('aim lead', () => {
  it('leads a target walking across the line of fire, to the centimetre', () => {
    const tier = TIERS.hard;
    const state = setup();
    kill(state, 0, 3);
    const me = put(state, 1, -5, 0);
    const target = put(state, 2, 5, 0);
    target.vx = 0;
    target.vy = 5.5;
    const seed = 3;
    const bot = createBot(1, 'hard', seed);
    const input = thinkTimes(bot, state, tier.delay + 1);
    expect(bot.inspect()).toEqual({ intent: 'engage', targetId: 2 });

    // The bot's first aim draw, replayed from the same seed, is the one error in force.
    const u = (2 * createRng(seed).next() - 1) * tier.maxU;
    const lead = leadPoint(me, target, { x: target.vx, y: target.vy }, NOMINAL_PROJECTILE_SPEED);
    const turned = rotateByHalfTangent(lead.x - me.x, lead.y - me.y, u);
    expect(input.aimX).toBe(roundAim(me.x + turned.x));
    expect(input.aimY).toBe(roundAim(me.y + turned.y));
    // The lead is well ahead of the target, not at its current position.
    expect(Math.hypot(input.aimX / 100 - target.x, input.aimY / 100 - target.y)).toBeGreaterThan(1);
    expect(input.aimY).toBeGreaterThan(100);
  });
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
