import arena01Json from '../../../data/arenas/arena01.json';
import {
  Button,
  CHAMPION_RADIUS,
  SLOTS,
  createMatch,
  hasLineOfSight,
  parseArenaDef,
  step,
} from '@claudeline/sim';
import type {
  ArenaDef,
  ChampionState,
  GameState,
  KitDef,
  MatchConfig,
  PlayerInput,
} from '@claudeline/sim';
import { createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import type { Difficulty } from '../src/difficulty';
import { nearestFreeCell } from '../src/follow';
import { buildNavGrid, cellCenter, cellIndexAt } from '../src/grid';
import type { NavGrid } from '../src/grid';
import type { Intent } from '../src/intent';
import { findPath } from '../src/path';
import { profileFor } from '../src/profile';

export const arena01: ArenaDef = parseArenaDef(arena01Json);

function validAxis(v: number): boolean {
  return (v === 1 || v === -1 || v === 0) && !Object.is(v, -0);
}

const SLOT_BITS: readonly number[] = SLOTS.map((slot) => Button[slot]);

/**
 * The input rules every bot input must meet: eight-direction axes, whole-centimetre aim, and
 * buttons. Without a kit the buttons are 0. With the champion's kit they are 0 or exactly one slot
 * bit, with SHIFT only together with a slot of `kit.ex` that has an EX variant, never with F.
 */
export function validInput(input: PlayerInput, kit?: KitDef): boolean {
  return (
    validAxis(input.moveX) &&
    validAxis(input.moveY) &&
    Number.isInteger(input.aimX) &&
    Number.isInteger(input.aimY) &&
    !Object.is(input.aimX, -0) &&
    !Object.is(input.aimY, -0) &&
    validButtons(input.buttons, kit)
  );
}

function validButtons(buttons: number, kit: KitDef | undefined): boolean {
  if (kit === undefined) return buttons === 0;
  if (buttons === 0) return true;
  const shift = (buttons & Button.SHIFT) !== 0;
  const pressed = SLOTS.filter((slot) => (buttons & Button[slot]) !== 0);
  const known = SLOT_BITS.reduce((mask, bit) => mask | bit, Button.SHIFT);
  if ((buttons & ~known) !== 0 || pressed.length !== 1) return false;
  const slot = pressed[0];
  if (slot === undefined) return false;
  if (!shift) return true;
  return slot !== 'F' && kit.ex.includes(slot) && kit.slots[slot].ex !== undefined;
}

/** The kit of a champion, found by championId as the sim does; undefined for a champion without one. */
export function kitOf(state: GameState, c: ChampionState): KitDef | undefined {
  return state.kits.find((kit) => kit.id === c.championId);
}

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

/** Hargrim A, Quillon A, Hargrim B, Quillon B: both kits on both teams. */
export function configMirror(): MatchConfig {
  return {
    teamSize: 2,
    players: [
      { championId: 'hargrim', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'hargrim', team: 'B' },
      { championId: 'quillon', team: 'B' },
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

export interface RunOptions {
  config?: MatchConfig;
  kits?: readonly KitDef[];
}

export function createRun(
  botSeeds: readonly number[],
  tiers: readonly Difficulty[],
  matchSeed = 7,
  options: RunOptions = {},
): MatchRun {
  const state = createMatch(options.config ?? config2v2(), arena01, matchSeed, options.kits ?? []);
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
  options: RunOptions = {},
): MatchRun {
  const run = createRun(botSeeds, tiers, matchSeed, options);
  for (let tick = 0; tick < ticks; tick++) {
    before?.(run, tick);
    const tickInputs = run.advance();
    onTick?.(run, tick, tickInputs);
  }
  return run;
}

/**
 * An independent oracle for the spawn point of a champion: its slot is the number of
 * teammates with a lower id. It deliberately does not import the one in src/bot.
 */
export function ownSpawnOf(state: GameState, c: ChampionState): Point | undefined {
  const slot = state.champions.filter((o) => o.team === c.team && o.id < c.id).length;
  const spawn = (c.team === 'A' ? state.arena.spawns.teamA : state.arena.spawns.teamB)[slot];
  return spawn === undefined ? undefined : { x: spawn[0], y: spawn[1] };
}

/** True when the intent in `acted` is a stand that bots.md documents. */
export function holding(
  state: GameState,
  c: ChampionState,
  acted: { intent: Intent; targetId: number },
): boolean {
  if (acted.intent === 'retreat') {
    const spawn = ownSpawnOf(state, c);
    return spawn !== undefined && Math.hypot(c.x - spawn.x, c.y - spawn.y) <= 0.5;
  }
  const target = state.champions[acted.targetId];
  if (target === undefined || !target.alive || target.team === c.team) return false;
  const d = Math.hypot(c.x - target.x, c.y - target.y);
  const { rangeMin, rangeMax } = profileFor(c.championId);
  if (acted.intent === 'engage') return d <= rangeMax && hasLineOfSight(state, c, target);
  if (acted.intent === 'kite') {
    return d >= rangeMin && d <= rangeMax && hasLineOfSight(state, c, target);
  }
  return false;
}

/** A champion's own cell when free, else its nearest free cell, as a point; null when none. */
function walkableCellOf(grid: NavGrid, p: Point): Point | null {
  const own = cellIndexAt(grid, p);
  if (own >= 0 && grid.blocked[own] === false) return cellCenter(grid, own);
  const near = nearestFreeCell(grid, p);
  return near < 0 ? null : cellCenter(grid, near);
}

/** True when some alive enemy of c is reachable on the grid from c. */
export function enemyReachable(grid: NavGrid, state: GameState, c: ChampionState): boolean {
  const from = walkableCellOf(grid, c);
  if (from === null) return false;
  for (const enemy of state.champions) {
    if (!enemy.alive || enemy.team === c.team) continue;
    const to = walkableCellOf(grid, enemy);
    if (to !== null && findPath(grid, from, to).length > 0) return true;
  }
  return false;
}

export interface WorstStall {
  id: number;
  /** The tick the run started on. */
  from: number;
  length: number;
  intent: Intent;
}

export interface StallTracker {
  /** Call after every bot thought and before `step`: it reads the state the bots thought on. */
  observe(inputs: readonly PlayerInput[]): void;
  worst(): WorstStall;
}

/**
 * Counts, per bot, consecutive stall ticks: a zero-move input, not in a documented stand,
 * while some alive enemy is reachable on the grid. Any other tick resets the run.
 */
export function createStallTracker(state: GameState, bots: readonly Bot[]): StallTracker {
  const grid = buildNavGrid(state.arena);
  const runs = bots.map(() => ({ from: 0, length: 0 }));
  let worst: WorstStall = { id: -1, from: 0, length: 0, intent: 'idle' };
  return {
    observe(inputs: readonly PlayerInput[]): void {
      bots.forEach((bot, id) => {
        const c = state.champions[id];
        const input = inputs[id];
        const run = runs[id];
        if (c === undefined || input === undefined || run === undefined) return;
        const acted = bot.inspect();
        const stalled =
          c.alive &&
          input.moveX === 0 &&
          input.moveY === 0 &&
          !holding(state, c, acted) &&
          // Last, so the reachability search runs only on candidate stall ticks.
          enemyReachable(grid, state, c);
        if (!stalled) {
          run.length = 0;
          return;
        }
        if (run.length === 0) run.from = state.tick;
        run.length++;
        if (run.length > worst.length) {
          worst = { id, from: run.from, length: run.length, intent: acted.intent };
        }
      });
    },
    worst(): WorstStall {
      return { ...worst };
    },
  };
}
