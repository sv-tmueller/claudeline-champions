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
import { arena01, clearShotOracle, config2v2, configMirror, configSix, jsonKits, sixKits } from './helpers';
import { hargrimKit, quillonFastExKit } from './kits';

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

  it('keeps the stored aim when the aim overflows to infinity, not only when it is not a number', () => {
    const state = setup();
    kill(state, 1, 3);
    const me = ch(state, 0);
    me.aimX = 321;
    me.aimY = -654;
    // 1e308 m is a finite distance, and its aim in centimetres overflows.
    put(state, 2, 1e308, 3);
    const bot = createBot(0, 'hard', 1);
    const input = thinkTimes(bot, state, TIERS.hard.delay + 5);
    expect(bot.inspect().targetId).toBe(2);
    expect({ aimX: input.aimX, aimY: input.aimY }).toEqual({ aimX: 321, aimY: -654 });
  });

  it('aims at a target 1e200 m away although the time to meet it is infinite', () => {
    const state = setup();
    kill(state, 1, 3);
    const me = ch(state, 0);
    me.aimX = 321;
    me.aimY = -654;
    // The squared distance overflows, so the time to meet a target standing still is +Infinity:
    // the lead is not used, and the aim is the target's own position, which is still finite.
    put(state, 2, 1e200, 3);
    const bot = createBot(0, 'hard', 1);
    const input = thinkTimes(bot, state, TIERS.hard.delay + 5);
    expect(bot.inspect().targetId).toBe(2);
    expect(Number.isFinite(input.aimX), `aimX ${input.aimX}`).toBe(true);
    expect(Number.isFinite(input.aimY), `aimY ${input.aimY}`).toBe(true);
    expect(input.aimX).toBeGreaterThan(1e201);
  });

  it("returns a valid input every tick, always the bot's own record", () => {
    const state = setup();
    kill(state, 1, 3);
    const bots = new Map([[0, createBot(0, 'hard', 3)]]);
    const bot = bots.get(0);
    if (!bot) throw new Error('no bot');
    let own: PlayerInput | undefined;
    for (let i = 0; i < 300; i++) {
      const input = bot.think(state);
      own ??= input;
      expect(input).toBe(own);
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
    // A stand needs a clear shot of a champion's width, so the walk ends at a cell that has one:
    // a bare line of sight can still be the edge of the pillar's shadow.
    const seen = () =>
      clearShotOracle(state, me, target, 0.5) &&
      dist(me, target) >= rangeMin &&
      dist(me, target) <= rangeMax;
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
      // A stand: no walking at all, not a step that happens to keep line of sight.
      expect({ moveX: input.moveX, moveY: input.moveY }, `hold ${i}`).toEqual({ moveX: 0, moveY: 0 });
      stepOne(state, 1, input);
      expect(hasLineOfSight(state, me, target), `hold ${i}`).toBe(true);
    }
    expect(me.vx === 0 && me.vy === 0).toBe(true);
  });

  it('walks on in the engage band without a clear shot, and stands with one', () => {
    // Lumeth (id 2) engages at 8 m: inside its band [6, 10], and the pillar of arena01 has a
    // radius of 1.5, so a level line at height h has a line of sight above 1.5 and a clear shot
    // of 0.5 m above 2.
    const { rangeMax } = profileFor('lumeth');
    const engage = (h: number) => {
      const state = setup(arena01);
      kill(state, 1, 3);
      const me = put(state, 2, -4, h);
      const target = put(state, 0, 4, h);
      expect(dist(me, target)).toBeLessThanOrEqual(rangeMax);
      const bot = createBot(2, 'hard', 1);
      const input = thinkTimes(bot, state, TIERS.hard.delay + 1);
      expect(bot.inspect()).toEqual({ intent: 'engage', targetId: 0 });
      return { state, me, target, input };
    };

    const edge = engage(1.6);
    expect(hasLineOfSight(edge.state, edge.me, edge.target)).toBe(true);
    expect(clearShotOracle(edge.state, edge.me, edge.target, 0.5)).toBe(false);
    expect(edge.input.moveX !== 0 || edge.input.moveY !== 0).toBe(true);

    const clear = engage(2.1);
    expect(clearShotOracle(clear.state, clear.me, clear.target, 0.5)).toBe(true);
    expect({ moveX: clear.input.moveX, moveY: clear.input.moveY }).toEqual({ moveX: 0, moveY: 0 });
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

  it('starts a fresh plan when it is cornered again after a stand in the band', () => {
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
    // A teammate at full health keeps the team ahead (1.2 against 1), so the bot retreats. Alone, at
    // 0.2 against 1 and out of reach, it would advance: that is the deadlock rule, deadlock.test.ts.
    kill(state, 3);
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

  // `think` writes the lead and the error turn out over locals (an allocation-free form). This
  // replays the aim of a few thousand frozen states, drawn from a seed, with the chain of aim.ts
  // that the form replaced: the bot's first aim draw replayed from its seed, then `leadPoint`,
  // `rotateByHalfTangent` and `roundAim`. The states cover a target walking at the shooter and
  // away from it, one at least as fast as the projectile, a zero offset, and the projectile
  // speeds of the shipped kits through a cast in its windup (the speed of the winding-up ability
  // is the one the aim leads with), and no cast (the nominal speed).
  // Runner (ubuntu-latest, Node 22): 1.4 and 1.7 s green, 2.7, 2.6 and 3.0 s red on 5820f16
  // (runs 39001711657, 39008413462, 39009180211 x3); 1.0 s locally (Apple M5 Pro, Node 22.23.2,
  // full npm run test). Timeout: the smallest of 10, 15 and 20 s at least twice the slowest
  // runner time (testing.md, Check suite).
  it('matches the reference chain on random frozen states, to the centimetre', { timeout: 10_000 }, () => {
    const rng = createRng(20241005);
    // A third of the states use the shipped Hargrim and Quillon, a third a fixture whose M2 EX bolt
    // (18 m/s) is faster than its base bolt (15 m/s): the shipped kits give both the same speed on
    // every slot. The last third is Ondrel and Brimwick, whose areas (the Mire, Drowned Ground and
    // Firecracker) have no projectile and so lead at the nominal speed, and whose bolts fly at 16
    // and 24 m/s; they swap places every other round of blocks, so each is the bot of a cast.
    const kitSets = [
      { kits: jsonKits, config: () => configMirror() },
      { kits: () => [hargrimKit(), quillonFastExKit()], config: () => configMirror() },
      { kits: sixKits, config: (i: number) => configSix(Math.floor(i / 12) % 2 === 1) },
    ];
    const slots = ['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'] as const;
    const seen = { approach: 0, retreat: 0, fast: 0, zero: 0, speeds: new Set<number>() };
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const set = kitSets[Math.floor(i / 4) % kitSets.length] as (typeof kitSets)[number];
      const kits = set.kits();
      const state = createMatch(set.config(i), open, 1, kits);
      const botId = i % 2;
      const enemyId = 2 + (Math.floor(i / 2) % 2);
      for (const id of [0, 1, 2, 3]) if (id !== botId && id !== enemyId) kill(state, id);
      const me = put(state, botId, (rng.next() - 0.5) * 20, (rng.next() - 0.5) * 12);
      const target = ch(state, enemyId);
      const zero = i % 17 === 0;
      target.x = zero ? me.x : me.x + (rng.next() - 0.5) * 24;
      target.y = zero ? me.y : me.y + (rng.next() - 0.5) * 16;
      const speedOfTarget = rng.next() * 30;
      const heading = rng.next() * 2 * Math.PI;
      target.vx = Math.cos(heading) * speedOfTarget;
      target.vy = Math.sin(heading) * speedOfTarget;

      // Half the states have a cast winding up, which sets the speed the aim leads with.
      let speed = NOMINAL_PROJECTILE_SPEED;
      if (i % 2 === 1) {
        const slot = slots[Math.floor(rng.next() * slots.length)] as (typeof slots)[number];
        const kit = kits.find((k) => k.id === me.championId);
        const base = kit?.slots[slot];
        const variant = base?.ex !== undefined && rng.next() < 0.5;
        const spec = variant ? base?.ex : base;
        const first = spec?.effects[0];
        if (first !== undefined && first.type === 'projectile') speed = first.speed;
        me.cast = { castId: 1, slot, ex: variant, windupTicks: 30, windupLeft: 10 };
      }

      // The edges of the lead, on a line with the shooter, in three variants: a target that stands
      // still (b is 0), one closing at exactly the speed of the projectile (a is 0), and one
      // receding along the line at the speed of the projectile less a billionth (a is about -1e-6
      // and b is positive, where the two forms of the root differ by ten metres of aim).
      if (i % 13 === 0 && !zero) {
        const variant = Math.floor(i / 13) % 3;
        const away = target.x > me.x ? 1 : -1;
        target.y = me.y;
        target.vy = 0;
        target.vx = variant === 0 ? 0 : variant === 1 ? -away * speed : away * speed * (1 - 1e-9);
      }

      const seed = 1 + Math.floor(rng.next() * 1e6);
      const bot = createBot(botId, 'hard', seed);
      const input = thinkTimes(bot, state, TIERS.hard.delay + 1);
      expect(bot.inspect().targetId, `state ${i}`).toBe(enemyId);

      const u = (2 * createRng(seed).next() - 1) * TIERS.hard.maxU;
      const lead = leadPoint(me, target, { x: target.vx, y: target.vy }, speed);
      const turned = rotateByHalfTangent(lead.x - me.x, lead.y - me.y, u);
      const expected = [roundAim(me.x + turned.x), roundAim(me.y + turned.y)];
      expect([input.aimX, input.aimY], `state ${i}, speed ${speed}, seed ${seed}`).toEqual(expected);
      checked++;

      const dx = target.x - me.x;
      const dy = target.y - me.y;
      const b = 2 * (dx * target.vx + dy * target.vy);
      if (dx === 0 && dy === 0) seen.zero++;
      else if (target.vx * target.vx + target.vy * target.vy >= speed * speed) seen.fast++;
      else if (b < 0) seen.approach++;
      else seen.retreat++;
      seen.speeds.add(speed);
    }
    expect(checked).toBe(4000);
    // Every branch of the lead is reached, many times.
    expect(seen.approach).toBeGreaterThan(300);
    expect(seen.retreat).toBeGreaterThan(300);
    expect(seen.fast).toBeGreaterThan(300);
    expect(seen.zero).toBeGreaterThan(100);
    // Nominal 20 and the Quillon and Hargrim projectile speeds of the shipped kits: 22, 14, 12, 25,
    // the fixture's: 15 for its base M2 and 18 for its EX, and the 16 of Undertow and the 24 of
    // Flash Powder.
    for (const speed of [12, 14, 15, 16, 18, 20, 22, 24, 25]) {
      expect([...seen.speeds], `speed ${speed}`).toContain(speed);
    }
  });

  // The rounding of the inline form turns -0 into 0 without an integer test: `Math.round` of a
  // value in [-0.5, 0) cm is -0, and the sim and the reference (`roundAim`) both read it as 0. An
  // aim point 0.03 cm west of the origin (on the y axis, 7 m north) rounds to -0 on x and, mirrored,
  // on y, so both axes are covered. The state is built so the error turn lands the aim there: the
  // target is the aim point turned back by the same error.
  it('rounds an aim point within half a centimetre below zero to 0, on both axes', () => {
    const seed = 3;
    const u = (2 * createRng(seed).next() - 1) * TIERS.hard.maxU;
    for (const [aimX, aimY] of [
      [-0.0003, 7],
      [7, -0.0003],
    ] as const) {
      const state = setup();
      kill(state, 0, 3);
      const me = put(state, 1, 0, 0);
      // The target stands still, so the lead is the target and the aim is its turn by 2 atan(u).
      const back = rotateByHalfTangent(aimX, aimY, -u);
      const target = put(state, 2, back.x, back.y);
      target.vx = 0;
      target.vy = 0;
      const bot = createBot(1, 'hard', seed);
      const input = thinkTimes(bot, state, TIERS.hard.delay + 1);
      const turned = rotateByHalfTangent(target.x - me.x, target.y - me.y, u);
      // On the axis that is the zero, `Math.round` gives -0.
      const rounded = [Math.round((me.x + turned.x) * 100), Math.round((me.y + turned.y) * 100)];
      expect(rounded.some((r) => Object.is(r, -0)), `rounded ${rounded}`).toBe(true);
      expect(Object.is(input.aimX, -0), `aimX ${input.aimX}`).toBe(false);
      expect(Object.is(input.aimY, -0), `aimY ${input.aimY}`).toBe(false);
      expect([input.aimX, input.aimY]).toEqual([roundAim(me.x + turned.x), roundAim(me.y + turned.y)]);
    }
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

  // The aim error of a think is a draw of the bot's own generator, mulberry32 of the seed, one per
  // 15 acting thinks. `think` writes the draw out inside `aim` (over a typed state, so a draw
  // allocates nothing: see allocation.test.ts), and `rng.ts` stays as its reference. This replays
  // the stream of several seeds (the same state for -1 and 2^32 - 1, and for 0 and 2^32) over
  // thousands of thinks at a target that stands still, with the chain of aim.ts, and compares every
  // aim to the centimetre. A changed constant, shift or the order of an operation moves the stream
  // within a few draws.
  it('draws the error of each 15 thinks from the seeded stream of rng.ts, over thousands of thinks', () => {
    const seeds = [-1, 0, 1, 2, 5, 77, 123456789, 2 ** 31, -(2 ** 31), 2 ** 32 - 1, 2 ** 32, 2 ** 40 + 3];
    const THINKS_PER_SEED = 2400;
    let compared = 0;
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (const seed of seeds) {
        const state = setup();
        kill(state, 0, 3);
        const me = put(state, 1, -5, 0);
        const target = put(state, 2, 5, 0);
        const bot = createBot(1, tier, seed);
        const rng = createRng(seed);
        const { delay, maxU } = TIERS[tier];
        let u = 0;
        for (let i = 0; i < THINKS_PER_SEED; i++) {
          const input = bot.think(state);
          // The bot idles on the aim until its first acted think, then draws on every 15th.
          if (i < delay) continue;
          if ((i - delay) % 15 === 0) u = (2 * rng.next() - 1) * maxU;
          const turned = rotateByHalfTangent(target.x - me.x, target.y - me.y, u);
          const expected = [roundAim(me.x + turned.x), roundAim(me.y + turned.y)];
          expect([input.aimX, input.aimY], `${tier} seed ${seed} think ${i}`).toEqual(expected);
          compared++;
        }
      }
    }
    // The easy, normal and hard bots idle (and aim nowhere new) for 30, 15 and 6 thinks.
    expect(compared).toBe(seeds.length * (3 * THINKS_PER_SEED - (30 + 15 + 6)));
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

describe('finisher', () => {
  // Quillon (id 1, band [6, 13]) at 20 percent health, 8 m from Lumeth (id 2) on open ground.
  function duelAt(enemyHealth: number, distance = 8, arena: ArenaDef = open, h = 0) {
    const state = setup(arena);
    kill(state, 0, 3);
    const me = put(state, 1, -4, h);
    const enemy = put(state, 2, -4 + distance, h);
    me.health = 0.2 * me.maxHealth;
    enemy.health = enemyHealth * enemy.maxHealth;
    return { state, me, enemy };
  }
  const intentAfterDelay = (state: GameState) => {
    const bot = createBot(1, 'hard', 1);
    thinkTimes(bot, state, TIERS.hard.delay + 1);
    return bot.inspect();
  };

  it('engages an enemy in reach at 15 percent instead of retreating at 20 percent', () => {
    expect(intentAfterDelay(duelAt(0.15).state)).toEqual({ intent: 'engage', targetId: 2 });
  });

  it('retreats from an enemy at 25 percent', () => {
    expect(intentAfterDelay(duelAt(0.25).state)).toEqual({ intent: 'retreat', targetId: 2 });
  });

  it('engages an enemy at exactly the bot health fraction', () => {
    expect(intentAfterDelay(duelAt(0.2).state).intent).toBe('engage');
  });

  it('retreats when the weak enemy is beyond rangeMax', () => {
    const { rangeMax } = profileFor('quillon');
    expect(rangeMax).toBe(13);
    expect(intentAfterDelay(duelAt(0.15, 13.5).state).intent).toBe('retreat');
    expect(intentAfterDelay(duelAt(0.15, 13).state).intent).toBe('engage');
  });

  it('retreats when the weak enemy has no clear shot, on the edge of the pillar shadow', () => {
    const edge = duelAt(0.15, 8, arena01, 1.6);
    expect(hasLineOfSight(edge.state, edge.me, edge.enemy)).toBe(true);
    expect(clearShotOracle(edge.state, edge.me, edge.enemy, 0.5)).toBe(false);
    expect(intentAfterDelay(edge.state).intent).toBe('retreat');
    const clear = duelAt(0.15, 8, arena01, 2.1);
    expect(clearShotOracle(clear.state, clear.me, clear.enemy, 0.5)).toBe(true);
    expect(intentAfterDelay(clear.state).intent).toBe('engage');
  });

  it('targets the finisher, not the nearer enemy that is healthy', () => {
    const { state } = duelAt(0.1, 10);
    ch(state, 3).alive = true;
    put(state, 3, 2, 0);
    expect(intentAfterDelay(state)).toEqual({ intent: 'engage', targetId: 2 });
    // Without the finisher the nearer enemy is the target, and the bot retreats.
    ch(state, 2).health = ch(state, 2).maxHealth;
    expect(intentAfterDelay(state)).toEqual({ intent: 'retreat', targetId: 3 });
  });

  it('targets the nearer of two qualifying enemies, in both id orders', () => {
    // Nearer than 4 m the kite score tops the retreat score at 20 percent, and the finisher is never reached.
    const near = 5;
    const far = 10;
    for (const [nearId, farId] of [
      [2, 3],
      [3, 2],
    ] as const) {
      const { state, me } = duelAt(0.15);
      ch(state, 3).alive = true;
      ch(state, 3).health = 0.1 * ch(state, 3).maxHealth;
      put(state, nearId, me.x + near, 0);
      put(state, farId, me.x + far, 0);
      expect(intentAfterDelay(state)).toEqual({ intent: 'kite', targetId: nearId });
    }
  });

  it('takes the lower id when two qualifying enemies are at the same distance', () => {
    const { state, me } = duelAt(0.15);
    ch(state, 3).alive = true;
    ch(state, 3).health = 0.15 * ch(state, 3).maxHealth;
    put(state, 2, me.x, 5);
    put(state, 3, me.x, -5);
    expect(intentAfterDelay(state)).toEqual({ intent: 'kite', targetId: 2 });
    put(state, 2, me.x, -5);
    put(state, 3, me.x, 5);
    expect(intentAfterDelay(state)).toEqual({ intent: 'kite', targetId: 2 });
  });

  it('does not take a dead enemy as the finisher, and retreats from the live one', () => {
    const { state } = duelAt(0.1, 6);
    ch(state, 2).alive = false;
    ch(state, 3).alive = true;
    ch(state, 3).health = 0.5 * ch(state, 3).maxHealth;
    put(state, 3, 4, 0);
    expect(intentAfterDelay(state)).toEqual({ intent: 'retreat', targetId: 3 });
  });

  it('kites a finisher that is closer than rangeMin', () => {
    expect(intentAfterDelay(duelAt(0.15, 2).state)).toEqual({ intent: 'kite', targetId: 2 });
  });

  /**
   * The bot retreats at 20 percent, takes the finisher at `distance`, then regains health to
   * `health` while the enemy leaves reach (and is healthy, so no finisher qualifies). Returns the
   * intents acted on after the finisher think and after the enemy has left.
   */
  function afterFinisherLeaves(distance: number, health: number) {
    const { state, me, enemy } = duelAt(0.1, distance);
    const bot = createBot(1, 'hard', 1);
    thinkTimes(bot, state, TIERS.hard.delay + 1);
    const during = bot.inspect();
    me.health = health * me.maxHealth;
    enemy.x = me.x + 20;
    enemy.health = enemy.maxHealth;
    thinkTimes(bot, state, TIERS.hard.delay + 1);
    return { during, after: bot.inspect() };
  }

  it('does not resume the retreat in the band after an engage finisher', () => {
    expect(afterFinisherLeaves(8, 0.32)).toEqual({
      during: { intent: 'engage', targetId: 2 },
      after: { intent: 'engage', targetId: 2 },
    });
  });

  it('resumes the retreat in the band after a kite finisher', () => {
    // At 5 m the retreat score tops the kite score at 20 percent, so the finisher is reached.
    expect(afterFinisherLeaves(5, 0.32)).toEqual({
      during: { intent: 'kite', targetId: 2 },
      after: { intent: 'retreat', targetId: 2 },
    });
  });
});

describe('the returned input', () => {
  /** Champion 0 of the 2v2 against champion 2, 6 m east on open ground. */
  function duel(): GameState {
    const state = setup();
    kill(state, 1, 3);
    put(state, 0, -3, 0);
    put(state, 2, 3, 0);
    return state;
  }

  it("is the bot's own record: the next think overwrites it, whatever the path", () => {
    const state = duel();
    const bot = createBot(0, 'hard', 1);
    expect(bot.think(state)).toBe(bot.think(state));
    // The dead path.
    ch(state, 0).alive = false;
    expect(bot.think(state)).toBe(bot.think(state));
    ch(state, 0).alive = true;
    // The idle path: no enemy is alive.
    kill(state, 2);
    expect(bot.think(state)).toBe(bot.think(state));
  });

  it('is a record per bot', () => {
    const state = setup();
    expect(createBot(0, 'hard', 1).think(state)).not.toBe(createBot(0, 'hard', 1).think(state));
  });

  it('is written in every field again on each think, on the acting path and on the dead path', () => {
    const state = duel();
    const bot = createBot(0, 'hard', 1);
    // Past the reaction delay the bot acts: it engages and walks toward its target 6 m away.
    thinkTimes(bot, state, TIERS.hard.delay + 1);
    expect(bot.inspect()).toEqual({ intent: 'engage', targetId: 2 });
    const input = bot.think(state);
    const expected = { ...input };
    expect(input.moveX, 'it walks east').toBe(1);
    // A caller that writes garbage into the record does not corrupt the next think.
    (input as { moveX: number }).moveX = -1;
    (input as { moveY: number }).moveY = 1;
    input.aimX = 123456;
    input.aimY = -98765;
    input.buttons = 77;
    expect(bot.think(state)).toEqual(expected);
    ch(state, 0).alive = false;
    ch(state, 0).aimX = 321;
    ch(state, 0).aimY = -654;
    input.aimX = 5;
    input.buttons = 9;
    expect(bot.think(state)).toEqual({ moveX: 0, moveY: 0, aimX: 321, aimY: -654, buttons: 0 });
  });

  it('is not what inspect returns: inspect is a fresh copy every time', () => {
    const state = duel();
    const bot = createBot(0, 'hard', 1);
    thinkTimes(bot, state, TIERS.hard.delay + 1);
    const a = bot.inspect();
    expect(bot.inspect()).not.toBe(a);
    expect(bot.inspect()).toEqual(a);
    (a as { intent: string }).intent = 'idle';
    expect(bot.inspect().intent).toBe('engage');
  });
});
