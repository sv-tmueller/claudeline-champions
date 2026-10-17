import { describe, expect, it } from 'vitest';
import { step } from '@claudeline/sim';
import type {
  ArenaDef,
  ChampionState,
  GameState,
  Obstacle,
  PlayerInput,
  ProjectileState,
} from '@claudeline/sim';
import { roundAim, rotateByHalfTangent } from '../src/aim';
import { createBot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import type { Difficulty } from '../src/difficulty';
import { segmentClear } from '../src/geometry';
import { buildNavGrid } from '../src/grid';
import { cellFree } from '../src/kite';
import { createRng } from '../src/rng';
import { arena01, copyInput } from './helpers';
import { OPEN, moveTrace, sceneOf, spawnBolt, sweepOfHit } from './scenes';
import type { BoltOptions, Options } from './scenes';

// The dodge is a movement override of the acted intent (spec section 6, amended on the decision of
// batch #134): on a think that acts on a target, after the aim, the bot looks for a projectile
// that its own centre line predicts a hit from, and once it has seen that threat for `castDelay`
// thinks it draws one coin for the projectile (a yes under the tier's `dodgeChance`) and steps
// sideways while the hit is still predicted. The pins below run on frozen states of a champion
// with no kit (`dummy`, rangeMin 4, rangeMax 8) that stands at 6 m from its enemy, so every move
// is a dodge; the sim is the oracle of every reach, hit sweep and miss.

const YES = { easy: 626, normal: 699, hard: 3718 } as const;
const NO = { easy: 4176, normal: 234, hard: 39 } as const;

// Per tier: the reaction delay, the cast delay (the reaction of the dodge), the chance, and where
// the coin sits in the bot's stream of draws. The aim draws come first in a think: the easy bot's
// coin falls on the think of its second aim draw (acting think 15), so it is the third value; the
// normal and hard coins fall before the second aim draw, so they are the second. The seeds are
// chosen so the coin is within 0.02 of the chance, and the values next to it fall on the other
// side by at least 0.05: a coin drawn one place early or late, or a chance moved by 0.05, flips it.
const TABLE = [
  { tier: 'easy', delay: 30, castDelay: 15, chance: 0.25, coin: 3 },
  { tier: 'normal', delay: 15, castDelay: 8, chance: 0.5, coin: 2 },
  { tier: 'hard', delay: 6, castDelay: 3, chance: 0.75, coin: 2 },
] as const;

/** A hard bot whose first and second coins are both a yes, for the scenes with two bolts. */
const HARD_BOTH = 1;
/** Hard seeds whose first coin is a no and second a yes, and the other way round. */
const HARD_NO_YES = 9;
const HARD_YES_NO = 7;

function arenaWith(...obstacles: Obstacle[]): ArenaDef {
  return { ...arena01, id: 'custom', obstacles };
}

/** The first `n` values of the bot's own generator for a seed, from the reference `createRng`. */
function values(seed: number, n: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
}

/** The standard lane: the dummy at (-6, 0), its enemy at (0, 0), a bolt flying west at it. */
function lane(
  bolts: readonly BoltOptions[] = [{ from: [-0.5, 0], dir: [-1, 0] }],
  options: Options = {},
): GameState {
  const state = sceneOf('dummy', 6, options);
  for (const bolt of bolts) spawnBolt(state, bolt);
  return state;
}

/** The sweep in which the sim hits a standing champion 0 with projectile `index` of the scene. */
function hitSweep(state: GameState, index = 0): number | null {
  return sweepOfHit(state, (state.projectiles[index] as ProjectileState).id);
}

/** Whether a hard bot with a yes coin steps aside within its reaction and a few thinks. */
function dodges(state: GameState): boolean {
  return moveTrace(state, 'hard', YES.hard, 20).some(Boolean);
}

/** The move of the think with this index. */
function moveAt(
  state: GameState,
  tier: Difficulty,
  seed: number,
  index: number,
): readonly [number, number] {
  const bot = createBot(0, tier, seed);
  let move: readonly [number, number] = [0, 0];
  for (let i = 0; i <= index; i++) {
    const input = bot.think(state);
    move = [input.moveX, input.moveY];
  }
  return move;
}

const HARD = TABLE[2];
/** The think of a hard bot's first dodge. */
const HARD_REACTION = HARD.delay + HARD.castDelay;

/** The move a hard bot with a yes coin makes at the first think of its dodge, or [0, 0]. */
function hardMove(state: GameState, seed: number = YES.hard): readonly [number, number] {
  return moveAt(state, 'hard', seed, HARD_REACTION);
}

describe('the tiers', () => {
  it('carry the dodge chance, a double in every tier object', () => {
    expect(TIERS.easy).toMatchObject({ dodgeChance: 0.25 });
    expect(TIERS.normal).toMatchObject({ dodgeChance: 0.5 });
    expect(TIERS.hard).toMatchObject({ dodgeChance: 0.75 });
  });
});

describe('the dodge of each tier', () => {
  for (const row of TABLE) {
    const { tier, delay, castDelay, chance, coin } = row;
    const reaction = delay + castDelay;

    it(`${tier}: the seeds' coins sit within 0.02 of ${chance}, one under and one over`, () => {
      const yes = values(YES[tier], 6)[coin - 1] as number;
      const no = values(NO[tier], 6)[coin - 1] as number;
      expect(yes).toBeLessThan(chance);
      expect(yes).toBeGreaterThanOrEqual(chance - 0.02);
      expect(no).toBeGreaterThanOrEqual(chance);
      expect(no).toBeLessThan(chance + 0.02);
    });

    it(`${tier}: steps aside from think ${reaction}, castDelay thinks after it first predicts the hit, and not before`, () => {
      const trace = moveTrace(lane(), tier, YES[tier], reaction + 40);
      expect(trace.indexOf(true)).toBe(reaction);
      expect(trace.slice(reaction).every(Boolean)).toBe(true);
    });

    it(`${tier}: a coin over the chance never steps aside`, () => {
      expect(moveTrace(lane(), tier, NO[tier], reaction + 60).some(Boolean)).toBe(false);
    });

    it(`${tier}: draws the coin after the aim draw and once per projectile, so the aim stream goes on`, () => {
      // The aim of block m (15 thinks from the first acting think) uses the m-th aim draw. The
      // coin is one draw, taken after the aim draw of its think and before the next block's.
      for (const seed of [YES[tier], NO[tier]]) {
        const state = lane();
        const v = values(seed, 8);
        const order = tier === 'easy' ? [0, 1, 3, 4] : [0, 2, 3, 4];
        const bot = createBot(0, tier, seed);
        const me = state.champions[0] as ChampionState;
        for (let i = 0; i < delay + 60; i++) {
          const input = bot.think(state);
          if (i < delay) continue;
          const block = Math.floor((i - delay) / 15);
          const u = (2 * (v[order[block] as number] as number) - 1) * TIERS[tier].maxU;
          const turned = rotateByHalfTangent(0 - me.x, 0 - me.y, u);
          expect([input.aimX, input.aimY], `seed ${seed}, think ${i}`).toEqual([
            roundAim(me.x + turned.x),
            roundAim(me.y + turned.y),
          ]);
        }
      }
    });
  }
});

describe('the dodge, edges of the prediction', () => {
  it('sees the lane: the sim hits a standing champion in sweep 15, and the bot steps aside', () => {
    const state = lane();
    expect(hitSweep(state)).toBe(15);
    expect(dodges(state)).toBe(true);
  });

  it('counts the champion radius and the bolt radius: 0.79 m off the line dodges, 0.81 m does not', () => {
    for (const [offset, hit] of [
      [0.79, true],
      [-0.79, true],
      [0.81, false],
      [-0.81, false],
    ] as const) {
      const state = lane([{ from: [-0.5, offset], dir: [-1, 0] }]);
      expect(hitSweep(state) !== null, `the sim at ${offset} m`).toBe(hit);
      expect(dodges(state), `${offset} m off the line`).toBe(hit);
    }
  });

  it('uses the radius of the bolt it sees: 1.09 m dodges a 0.6 m bolt and 1.11 m does not', () => {
    for (const [offset, hit] of [
      [1.09, true],
      [1.11, false],
    ] as const) {
      const state = lane([{ from: [-0.5, offset], dir: [-1, 0], radius: 0.6 }]);
      expect(hitSweep(state) !== null, `the sim at ${offset} m`).toBe(hit);
      expect(dodges(state), `${offset} m off the line`).toBe(hit);
    }
  });

  it('dodges a bolt with exactly its hit sweep left and not one with a sweep less', () => {
    const at = (remaining: number) => lane([{ from: [-0.5, 0], dir: [-1, 0], remaining }]);
    const exact = at(15);
    const short = at(14);
    expect(hitSweep(exact)).toBe(15);
    expect(hitSweep(short)).toBeNull();
    expect(dodges(exact)).toBe(true);
    expect(dodges(short)).toBe(false);
    expect(dodges(at(40))).toBe(true);
  });

  it('does not dodge a bolt that already overlaps it, or one that touches it', () => {
    // 0.7 m off: inside the 0.8 m of the two radii; the sim hits it in sweep 1 whatever the bot does.
    const inside = lane([{ from: [-5.3, 0], dir: [-1, 0] }]);
    expect(hitSweep(inside)).toBe(1);
    expect(dodges(inside)).toBe(false);
    // 0.75 m off with a 0.25 m bolt: the circles touch (every number here is exact).
    const touching = lane([{ from: [-5.25, 0], dir: [-1, 0], radius: 0.25 }]);
    expect(dodges(touching)).toBe(false);
    // 0.9 m off: the hit is predicted a sweep away, and the bot still steps.
    const near = lane([{ from: [-5.1, 0], dir: [-1, 0] }]);
    expect(hitSweep(near)).toBe(1);
    expect(dodges(near)).toBe(true);
  });

  it('does not dodge a bolt that moves away or across', () => {
    const away = lane([{ from: [-5, 0], dir: [1, 0] }]);
    expect(hitSweep(away)).toBeNull();
    expect(dodges(away)).toBe(false);
    const across = lane([{ from: [-6, 2], dir: [1, 0] }]);
    expect(hitSweep(across)).toBeNull();
    expect(dodges(across)).toBe(false);
  });

  it('dodges a diagonal bolt as it does an axis-aligned one', () => {
    const state = lane([{ from: [-9, -3], dir: [1, 1] }]);
    expect(hitSweep(state)).not.toBeNull();
    expect(dodges(state)).toBe(true);
  });

  it('ignores a bolt of its own team, even one that would heal it', () => {
    const owned = lane([{ from: [-0.5, 0], dir: [-1, 0], owner: 1 }]);
    expect(hitSweep(owned)).toBeNull();
    expect(dodges(owned)).toBe(false);
    const heal = lane([
      {
        from: [-0.5, 0],
        dir: [-1, 0],
        owner: 1,
        effects: [],
        allyEffects: [{ type: 'heal', amount: 10 }],
      },
    ]);
    expect(hitSweep(heal)).not.toBeNull();
    expect(dodges(heal)).toBe(false);
  });

  it('ignores an enemy ally bolt with no effects on enemies, and dodges one that has them', () => {
    const passes = lane([
      { from: [-0.5, 0], dir: [-1, 0], effects: [], allyEffects: [{ type: 'heal', amount: 10 }] },
    ]);
    expect(hitSweep(passes)).toBeNull();
    expect(dodges(passes)).toBe(false);
    const both = lane([
      {
        from: [-0.5, 0],
        dir: [-1, 0],
        effects: [{ type: 'damage', amount: 10 }],
        allyEffects: [{ type: 'heal', amount: 10 }],
      },
    ]);
    expect(hitSweep(both)).not.toBeNull();
    expect(dodges(both)).toBe(true);
  });

  it('ignores a piercing bolt that has hit it already', () => {
    const spent = lane([{ from: [-0.5, 0], dir: [-1, 0], pierce: true, hitIds: [0] }]);
    expect(hitSweep(spent)).toBeNull();
    expect(dodges(spent)).toBe(false);
    const other = lane([{ from: [-0.5, 0], dir: [-1, 0], pierce: true, hitIds: [3] }]);
    expect(hitSweep(other)).not.toBeNull();
    expect(dodges(other)).toBe(true);
  });

  it('ignores a bolt that a wall stops before it reaches it, and not one a wall stops after', () => {
    // The enemy stands off the lane so the dummy has its clear shot; the wall is 0.5 m thick.
    const wall: Obstacle = { type: 'rect', x: -3, y: 0, w: 0.5, h: 2, height: 1.5, blocksProjectiles: true };
    const enemy = { enemy: [-2, 3.5] as const };
    const blocked = lane(undefined, { ...enemy, arena: arenaWith(wall) });
    expect(hitSweep(blocked)).toBeNull();
    expect(dodges(blocked)).toBe(false);
    // A wall behind the champion stops the bolt after the hit, which is no reason to stay.
    const after = lane(undefined, { ...enemy, arena: arenaWith({ ...wall, x: -8 }) });
    expect(hitSweep(after)).not.toBeNull();
    expect(dodges(after)).toBe(true);
    // A low wall does not block a bolt.
    const through = lane(undefined, { ...enemy, arena: arenaWith({ ...wall, blocksProjectiles: false }) });
    expect(hitSweep(through)).not.toBeNull();
    expect(dodges(through)).toBe(true);
  });
});

describe('the dodge, direction', () => {
  it('steps away from the line it is on: north of the lane steps north, south of it south', () => {
    const north = lane(undefined, { me: [-6, 0.3], enemy: [0, 0.3] });
    expect(hardMove(north)).toEqual([0, 1]);
    const south = lane(undefined, { me: [-6, -0.3], enemy: [0, -0.3] });
    expect(hardMove(south)).toEqual([0, -1]);
  });

  it('takes the side of (-vy, vx) on the centre line, the tie', () => {
    // A bolt flying west: (-vy, vx) points south.
    expect(hardMove(lane())).toEqual([0, -1]);
    // A bolt flying east at it from the west: (-vy, vx) points north.
    expect(hardMove(lane([{ from: [-9, 0], dir: [1, 0] }]))).toEqual([0, 1]);
  });

  it('steps across a diagonal bolt, in the 45 degree sectors of the steering', () => {
    // A bolt flying north-east along y = x + 6 hits (-6, 0); (-vy, vx) points north-west.
    const bolt: BoltOptions = { from: [-9, -3], dir: [1, 1] };
    expect(hardMove(lane([bolt]))).toEqual([-1, 1]);
    // 0.28 m south-east of the line the bot steps further south-east.
    expect(hardMove(lane([bolt], { me: [-5.8, -0.2], enemy: [0.2, -0.2] }))).toEqual([1, -1]);
  });

  it('takes the other side when the first lands in a wall, and none when both do', () => {
    const wallAt = (y: number): Obstacle => ({
      type: 'rect',
      x: -6,
      y,
      w: 4,
      h: 0.5,
      height: 1.5,
      blocksProjectiles: false,
    });
    const at = (...walls: Obstacle[]): GameState =>
      lane(undefined, { me: [-6, 0.3], enemy: [0, 0.3], arena: arenaWith(...walls) });
    // North is the first side; a wall north of the bot blocks the step to y = 1.3.
    expect(hardMove(at())).toEqual([0, 1]);
    expect(hardMove(at(wallAt(1.5)))).toEqual([0, -1]);
    // Walls on both sides: the bot stands.
    expect(moveTrace(at(wallAt(1.5), wallAt(-1.2)), 'hard', YES.hard, 30).some(Boolean)).toBe(false);
  });

  it('takes the other side when a post grazes the straight step but the cell it ends in is free', () => {
    const post: Obstacle = { type: 'circle', x: -6.55, y: 0.8, r: 0.1, height: 1.5, blocksProjectiles: false };
    const arena = arenaWith(post);
    const grid = buildNavGrid(arena);
    // The precondition: the north step ends in a free cell, and only the segment is blocked.
    expect(cellFree(grid, { x: -6, y: 1.3 })).toBe(true);
    expect(segmentClear(grid, { x: -6, y: 0.3 }, { x: -6, y: 1.3 })).toBe(false);
    expect(hardMove(lane(undefined, { me: [-6, 0.3], enemy: [0, 0.3], arena }))).toEqual([0, -1]);
  });
});

describe('the dodge, two threats', () => {
  // A comes from the east along y = 0 and hits in sweep 15, its step is south (0, -1); B comes
  // from the north along x = -6 and its step is east (1, 0).
  const east: BoltOptions = { from: [-0.5, 0], dir: [-1, 0] };
  const north = (y: number): BoltOptions => ({ from: [-6, y], dir: [0, -1] });

  it('steps from the one that hits first, whatever its index', () => {
    expect(hitSweep(lane([east, north(3.5)]), 0)).toBe(15);
    expect(hitSweep(lane([east, north(3.5)]), 1)).toBe(9);
    expect(hardMove(lane([east, north(3.5)]), HARD_BOTH)).toEqual([1, 0]);
    expect(hardMove(lane([north(3.5), east]), HARD_BOTH)).toEqual([1, 0]);
    expect(hitSweep(lane([east, north(8)]), 1)).toBe(22);
    expect(hardMove(lane([east, north(8)]), HARD_BOTH)).toEqual([0, -1]);
    expect(hardMove(lane([north(8), east]), HARD_BOTH)).toEqual([0, -1]);
  });

  it('breaks a tie in the hit sweep for the lower index', () => {
    const state = lane([east, north(5.5)]);
    expect(hitSweep(state, 0)).toBe(15);
    expect(hitSweep(state, 1)).toBe(15);
    expect(hardMove(state, HARD_BOTH)).toEqual([0, -1]);
    expect(hardMove(lane([north(5.5), east]), HARD_BOTH)).toEqual([1, 0]);
  });

  it('draws a coin for each projectile in index order and steps from the earliest with a yes', () => {
    // The coins of the first and second bolt are the second and third value of the stream.
    const coins = (seed: number) => values(seed, 3).slice(1).map((v) => v < 0.75);
    expect(coins(HARD_BOTH)).toEqual([true, true]);
    expect(coins(HARD_NO_YES)).toEqual([false, true]);
    expect(coins(HARD_YES_NO)).toEqual([true, false]);
    // B hits first: with the coins (no, yes) the bot steps from B, with (yes, no) from A.
    expect(hardMove(lane([east, north(3.5)]), HARD_NO_YES)).toEqual([1, 0]);
    expect(hardMove(lane([east, north(3.5)]), HARD_YES_NO)).toEqual([0, -1]);
    // A hits first: with (no, yes) the earlier one is skipped and the bot steps from B.
    expect(hardMove(lane([east, north(8)]), HARD_NO_YES)).toEqual([1, 0]);
    expect(hardMove(lane([east, north(8)]), HARD_YES_NO)).toEqual([0, -1]);
  });
});

describe('the dodge, reaction and memory', () => {
  it('counts the reaction from the first think it predicts the hit, for a bolt that comes later', () => {
    // A normal bot (reaction delay 15, cast delay 8) acts from think 15; the bolt appears at its
    // acting think 10. Its coin is drawn at acting think 18, after the aim draw at acting think 15
    // (the second value): the third value, a yes for seed 5, where the second is a no.
    const v = values(5, 4);
    expect(v[1] as number).toBeGreaterThanOrEqual(0.5);
    expect(v[2] as number).toBeLessThan(0.5);
    const state = lane([]);
    const bot = createBot(0, 'normal', 5);
    const trace: boolean[] = [];
    for (let i = 0; i < 15 + 10 + 20; i++) {
      if (i === 15 + 10) spawnBolt(state, { from: [-0.5, 0], dir: [-1, 0] });
      const input = bot.think(state);
      trace.push(input.moveX !== 0 || input.moveY !== 0);
    }
    expect(trace.indexOf(true)).toBe(15 + 10 + 8);
  });

  it('keeps its coin: a no stays a no through every later think', () => {
    expect(moveTrace(lane(), 'hard', NO.hard, 400).some(Boolean)).toBe(false);
  });

  it('forgets its coins when the kit cache is rebuilt', () => {
    // A Quillon at 8 m stands. Hard seed 9: the first coin is a no, the second a yes. The kit
    // object changes at think 12, the cache rebuilds, the bolt is new to the bot again, and it
    // steps aside castDelay thinks later, on the second coin.
    expect(values(HARD_NO_YES, 3).slice(1).map((v) => v < 0.75)).toEqual([false, true]);
    const state = sceneOf('quillon', 8);
    spawnBolt(state, { from: [-2.5, 0], dir: [-1, 0] });
    const bot = createBot(0, 'hard', HARD_NO_YES);
    const trace: boolean[] = [];
    for (let i = 0; i < 40; i++) {
      if (i === 12) state.kits = state.kits.map((kit) => structuredClone(kit));
      const input = bot.think(state);
      trace.push(input.moveX !== 0 || input.moveY !== 0);
    }
    expect(trace.indexOf(true)).toBe(12 + 3);
    expect(trace.slice(12 + 3).every(Boolean)).toBe(true);
  });

  it('does nothing on an idle think or a dead one', () => {
    const idle = lane();
    (idle.champions[2] as ChampionState).alive = false;
    expect(moveTrace(idle, 'hard', YES.hard, 40).some(Boolean)).toBe(false);
    const dead = lane();
    (dead.champions[0] as ChampionState).alive = false;
    const bot = createBot(0, 'hard', YES.hard);
    for (let i = 0; i < 40; i++) {
      const input = bot.think(dead);
      expect([input.moveX, input.moveY]).toEqual([0, 0]);
    }
  });

  it('rewrites the move and nothing else: intent, aim and buttons are those of a think with no bolt', () => {
    // A Quillon at 8 m presses on her engage stand; the bolt only moves her. Compared up to the
    // next aim block, where the coin's draw has moved the stream.
    const thinks = 15 + 15;
    const run = (withBolt: boolean) => {
      const state = sceneOf('quillon', 8);
      if (withBolt) spawnBolt(state, { from: [-2.5, 0], dir: [-1, 0] });
      const bot = createBot(0, 'normal', YES.normal);
      const rows: string[] = [];
      const moves: boolean[] = [];
      for (let i = 0; i < thinks; i++) {
        const input = bot.think(state);
        rows.push(`${input.aimX} ${input.aimY} ${input.buttons} ${bot.inspect().intent}`);
        moves.push(input.moveX !== 0 || input.moveY !== 0);
      }
      return { rows, moves };
    };
    const without = run(false);
    const dodging = run(true);
    expect(dodging.rows).toEqual(without.rows);
    expect(without.rows.some((row) => / [1-9]\d* engage$/.test(row))).toBe(true);
    expect(without.moves.some(Boolean)).toBe(false);
    expect(dodging.moves.indexOf(true)).toBe(15 + 8);
  });
});

describe('the dodge, stepped with the sim as the oracle', () => {
  // A slow bolt (5 m/s) 7.5 m from a dummy that stands 8 m from its enemy: 81 sweeps to the hit,
  // longer than the 45 thinks of the easiest tier's reaction plus the step out of the lane.
  for (const row of TABLE) {
    const { tier } = row;
    const play = (seed: number) => {
      const state = sceneOf('dummy', 8, { arena: OPEN, me: [-10, 0], enemy: [-2, 0] });
      spawnBolt(state, { from: [-2.5, 0], dir: [-1, 0], speed: 5, lifetime: 200 });
      const bot = createBot(0, tier, seed);
      const me = state.champions[0] as ChampionState;
      let hits = 0;
      let moved = 0;
      for (let t = 0; t < 140; t++) {
        const inputs: (PlayerInput | undefined)[] = [];
        inputs[0] = copyInput(bot.think(state));
        step(state, inputs);
        hits += state.events.filter((e) => e.type === 'projectileHit' && e.targetId === 0).length;
        moved = Math.max(moved, Math.abs(me.y));
      }
      return { hits, moved, health: me.health, maxHealth: me.maxHealth };
    };

    it(`${tier}: the bolt misses a bot with a yes coin and hits one with a no coin`, () => {
      const yes = play(YES[tier]);
      expect(yes.hits).toBe(0);
      expect(yes.health).toBe(yes.maxHealth);
      expect(yes.moved).toBeGreaterThan(0.8);
      const no = play(NO[tier]);
      expect(no.hits).toBe(1);
      expect(no.health).toBeLessThan(no.maxHealth);
      expect(no.moved).toBe(0);
    });
  }
});
