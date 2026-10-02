import arena01Json from '../../../data/arenas/arena01.json';
import { CHAMPION_RADIUS, createMatch, parseArenaDef, step } from '@claudeline/sim';
import type { ArenaDef, ChampionState, GameState, MatchConfig, PlayerInput } from '@claudeline/sim';
import { createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import type { Difficulty } from '../src/difficulty';

export const arena01: ArenaDef = parseArenaDef(arena01Json);

// A copy of the sim's test helper: bots tests must not reach into sim tests.
export function config2v2(): MatchConfig {
  return {
    teamSize: 2,
    players: [
      { championId: 'hargrim', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'lumeth', team: 'B' },
      { championId: 'skerrow', team: 'B' },
    ],
  };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * An independent oracle for the grid and path rules. It deliberately does not import
 * src/geometry. Returns how far the circle of a champion centred at (x, y) is from touching
 * the nearest obstacle or boundary: negative means penetrating, zero means touching.
 */
export function clearanceAt(arena: ArenaDef, x: number, y: number): number {
  const r = CHAMPION_RADIUS;
  const { width, height } = arena.size;
  let best = Math.min(
    x + width / 2 - r,
    width / 2 - r - x,
    y + height / 2 - r,
    height / 2 - r - y,
  );
  for (const o of arena.obstacles) {
    if (o.type === 'circle') {
      best = Math.min(best, Math.hypot(x - o.x, y - o.y) - (o.r + r));
    } else {
      const nearestX = Math.min(Math.max(x, o.x - o.w / 2), o.x + o.w / 2);
      const nearestY = Math.min(Math.max(y, o.y - o.h / 2), o.y + o.h / 2);
      best = Math.min(best, Math.hypot(x - nearestX, y - nearestY) - r);
    }
  }
  return best;
}

export function oracleBlocked(arena: ArenaDef, x: number, y: number): boolean {
  return clearanceAt(arena, x, y) < 0;
}

/** True when a champion walking a to b penetrates anything, sampled every 0.01 m. */
export function oracleSegmentViolates(arena: ArenaDef, a: Point, b: Point): boolean {
  const tolerance = 1e-9;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = Math.max(1, Math.ceil(length / 0.01));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (clearanceAt(arena, x, y) < -tolerance) return true;
  }
  return false;
}

const INVARIANT_TOLERANCE = 1e-9;

/**
 * A copy of the sim's `checkInvariants` (bots tests must not import sim tests). Returns one
 * message per violation: non-finite values, boundary, obstacle and champion overlap.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const { width, height } = state.arena.size;
  const r = CHAMPION_RADIUS;
  const tag = (c: ChampionState, what: string) => `tick ${state.tick} champion ${c.id}: ${what}`;

  for (const c of state.champions) {
    for (const key of ['x', 'y', 'vx', 'vy', 'facing', 'health'] as const) {
      if (!Number.isFinite(c[key])) problems.push(tag(c, `${key} is ${c[key]}`));
    }
    if (c.x < -width / 2 + r - INVARIANT_TOLERANCE || c.x > width / 2 - r + INVARIANT_TOLERANCE) {
      problems.push(tag(c, `x ${c.x} outside the boundary`));
    }
    if (c.y < -height / 2 + r - INVARIANT_TOLERANCE || c.y > height / 2 - r + INVARIANT_TOLERANCE) {
      problems.push(tag(c, `y ${c.y} outside the boundary`));
    }
    state.arena.obstacles.forEach((o, i) => {
      if (o.type === 'circle') {
        const dist = Math.hypot(c.x - o.x, c.y - o.y);
        if (dist < o.r + r - INVARIANT_TOLERANCE) {
          problems.push(tag(c, `overlaps circle ${i} (${dist})`));
        }
      } else {
        const gapX = Math.max(Math.abs(c.x - o.x) - o.w / 2, 0);
        const gapY = Math.max(Math.abs(c.y - o.y) - o.h / 2, 0);
        const dist = Math.hypot(gapX, gapY);
        if (dist < r - INVARIANT_TOLERANCE) problems.push(tag(c, `overlaps rect ${i} (${dist})`));
      }
    });
  }
  for (const a of state.champions) {
    for (const b of state.champions) {
      if (b.id <= a.id || !a.alive || !b.alive) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 2 * r - INVARIANT_TOLERANCE) {
        problems.push(`tick ${state.tick}: champions ${a.id} and ${b.id} overlap (${dist})`);
      }
    }
  }
  return problems;
}

/** A 2v2 arena01 match with one bot per champion. `advance` runs one tick. */
export interface MatchRun {
  state: GameState;
  bots: Bot[];
  /** inputs[t][i] is what bot i returned on tick t. */
  inputs: PlayerInput[][];
  advance(): PlayerInput[];
}

export function createRun(
  botSeeds: readonly number[],
  tiers: readonly Difficulty[],
  matchSeed = 7,
): MatchRun {
  const state = createMatch(config2v2(), arena01, matchSeed);
  const bots = state.champions.map((c) => {
    const seed = botSeeds[c.id];
    const tier = tiers[c.id];
    if (seed === undefined || tier === undefined) throw new Error(`no seed or tier for ${c.id}`);
    return createBot(c.id, tier, seed);
  });
  const inputs: PlayerInput[][] = [];
  return {
    state,
    bots,
    inputs,
    advance(): PlayerInput[] {
      const tickInputs = bots.map((bot) => bot.think(state));
      step(state, tickInputs);
      inputs.push(tickInputs);
      return tickInputs;
    },
  };
}

/** Runs a match for `ticks` ticks; `before` runs ahead of each tick's thinks. */
export function runMatch(
  botSeeds: readonly number[],
  tiers: readonly Difficulty[],
  ticks: number,
  onTick?: (run: MatchRun, tick: number, tickInputs: PlayerInput[]) => void,
  before?: (run: MatchRun, tick: number) => void,
  matchSeed = 7,
): MatchRun {
  const run = createRun(botSeeds, tiers, matchSeed);
  for (let tick = 0; tick < ticks; tick++) {
    before?.(run, tick);
    const tickInputs = run.advance();
    onTick?.(run, tick, tickInputs);
  }
  return run;
}
