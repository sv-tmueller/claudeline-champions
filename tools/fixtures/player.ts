import { step } from '@claudeline/sim';
import type { ChampionState, GameState, KitDef } from '@claudeline/sim';
import { EXPECTED, RosterCoverage, SEEDS, mirrorMatch, toInput } from '../../packages/sim/test/roster-fixture.ts';
import type { Action, Entry, Segment } from '../../packages/sim/test/roster-fixture.ts';

// The seeded random player of the scripted roster fixtures, as the header of
// packages/sim/test/roster-fixtures.test.ts records it: the draws of one window, in order, with its
// three open details fixed as the header fixes them. It plays one attempt live on arena01 in the
// 2v2 mirror of the kit for TICKS ticks and returns the script it produced, as segments and
// actions, and what the coverage of the roster fixture test still misses.
//
// The script is data that a replay must reproduce on every platform, so this file uses exact
// operations only: + - * /, Math.sqrt, Math.round, Math.floor and comparisons. Never Math.hypot or
// a transcendental function (V8's differ in the last bit between CPUs). The tools lint does not
// ban them, so review enforces it.

export const TICKS = 2400;

/** mulberry32, in the exact form of packages/sim/src/rng.ts, which the sim does not export. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    const a = (state + 0x6d2b79f5) >>> 0;
    state = a;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The probability of each button, in the bit order M1, M2, SPACE, Q, E, R, F; SHIFT follows. */
const BUTTON_ODDS = [0.5, 0.3, 0.2, 0.3, 0.3, 0.15, 0.3];
const SHIFT_ODDS = 0.3;
const SHIFT_BIT = 128;
/** The energies a `setEnergy` action sets, picked by one draw. */
const ENERGIES = [0, 24, 25, 98, 99, 100, 60];

interface Point {
  x: number;
  y: number;
}

/** The champion of `list` nearest to `from`, the lower id on a tie (the list is in id order). */
function nearest(list: ChampionState[], from: Point): ChampionState | undefined {
  let best: ChampionState | undefined;
  let bestSquared = Infinity;
  for (const other of list) {
    const dx = other.x - from.x;
    const dy = other.y - from.y;
    const squared = dx * dx + dy * dy;
    if (squared < bestSquared) {
      best = other;
      bestSquared = squared;
    }
  }
  return best;
}

/** The sign of `delta` when it is more than half a meter, else 0. */
function axis(delta: number, away: boolean): number {
  if (Math.abs(delta) <= 0.5) return 0;
  const toward = delta > 0 ? 1 : -1;
  return away ? -toward : toward;
}

/**
 * One window of one champion, from the state before the tick's step: the draws in the order of the
 * header, (1) the length to (8) the energy action. Returns the entry and the length, and pushes
 * the action it drew, if any, to `actions`.
 */
function drawWindow(
  rnd: () => number,
  state: GameState,
  c: ChampionState,
  tick: number,
  actions: Action[],
): { entry: Entry; length: number } {
  const length = 5 + Math.floor(rnd() * 14);
  const flag = rnd();
  // Living champions in id order: a dead champion is neither an enemy nor an ally.
  const enemies = state.champions.filter((o) => o.alive && o.team !== c.team);
  const allies = state.champions.filter((o) => o.alive && o.team === c.team && o.id !== c.id);
  const randomEnemy = enemies[Math.floor(rnd() * enemies.length)];
  const randomAlly = allies[Math.floor(rnd() * allies.length)];
  const target = flag < 0.3 ? randomEnemy : nearest(enemies, c);

  // The aim kind: 0 the target, 1 the ally, 2 a uniform point, 3 the champion itself. A kind with
  // nobody to aim at falls through to the next one that applies.
  const roll = rnd();
  let kind = roll < 0.6 ? 0 : roll < 0.8 ? 1 : roll < 0.92 ? 2 : 3;
  if (kind === 0 && target === undefined) kind = 1;
  if (kind === 1 && randomAlly === undefined) kind = 2;
  let aim: Point;
  if (kind === 0 && target !== undefined) aim = target;
  else if (kind === 1 && randomAlly !== undefined) aim = randomAlly;
  else if (kind === 2) {
    const x = -14 + 28 * rnd();
    const y = -9 + 18 * rnd();
    aim = { x, y };
  } else aim = c;
  // Whole centimeters; `+ 0` turns a -0 into 0.
  const aimX = Math.round(aim.x * 100) + 0;
  const aimY = Math.round(aim.y * 100) + 0;

  // The walk. Within 3.5 m of the rounded aim point (strictly) it walks away from it.
  let moveX = 0;
  let moveY = 0;
  const walk = rnd();
  if (walk < 0.45) {
    const dx = aimX / 100 - c.x;
    const dy = aimY / 100 - c.y;
    const away = Math.sqrt(dx * dx + dy * dy) < 3.5;
    moveX = axis(dx, away);
    moveY = axis(dy, away);
  } else if (walk < 0.7) {
    moveX = Math.floor(rnd() * 3) - 1;
    moveY = Math.floor(rnd() * 3) - 1;
  }

  let buttons = 0;
  BUTTON_ODDS.forEach((odds, bit) => {
    if (rnd() < odds) buttons |= 1 << bit;
  });
  if (rnd() < SHIFT_ODDS) buttons |= SHIFT_BIT;

  if (rnd() < 0.2) {
    const championId = Math.floor(rnd() * 4);
    const energy = ENERGIES[Math.floor(rnd() * ENERGIES.length)] as number;
    actions.push({ tick, type: 'setEnergy', spec: { championId, energy } });
  }
  return { entry: [moveX + 0, moveY + 0, aimX, aimY, buttons], length };
}

export interface Attempt {
  segments: Segment[];
  actions: Action[];
  /** What the coverage of the roster fixture test still misses after the run; empty when it covers. */
  missing: string[];
}

/** Plays attempt number `attempt` (1, 2, 3 and so on) of the kit, the player seeded with that number. */
export function playAttempt(kit: KitDef, attempt: number): Attempt {
  const expected = EXPECTED[kit.id];
  const seed = SEEDS[kit.id];
  if (expected === undefined || seed === undefined) throw new Error(`no EXPECTED or SEEDS entry for ${kit.id}`);
  const rnd = mulberry32(attempt);
  const state = mirrorMatch(kit, seed);
  const coverage = new RosterCoverage();
  const windowEnd: number[] = state.champions.map(() => 0);
  const entries: Entry[] = state.champions.map(() => null);
  const segments: Segment[] = [];
  const actions: Action[] = [];
  let previous = '';
  for (let tick = 0; tick < TICKS; tick++) {
    for (const c of state.champions) {
      if (tick < (windowEnd[c.id] as number)) continue;
      const { entry, length } = drawWindow(rnd, state, c, tick, actions);
      entries[c.id] = entry;
      windowEnd[c.id] = tick + length;
    }
    const key = JSON.stringify(entries);
    const last = segments[segments.length - 1];
    if (last !== undefined && key === previous) last.ticks++;
    else segments.push({ ticks: 1, inputs: entries.map((e) => (e === null ? null : [...e] as Entry)) });
    previous = key;
    for (const action of actions) {
      if (action.tick !== tick) continue;
      const c = state.champions[action.spec.championId] as ChampionState;
      c.energy = action.spec.energy;
    }
    coverage.before(state);
    step(state, entries.map(toInput));
    coverage.after(state);
  }
  return { segments, actions, missing: coverage.missing(expected) };
}
