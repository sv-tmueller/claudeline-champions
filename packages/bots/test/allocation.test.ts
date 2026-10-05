import { describe, expect, it } from 'vitest';
import { checksum, createMatch, step } from '@claudeline/sim';
import type { ChampionState, GameState } from '@claudeline/sim';
import { createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import type { Intent } from '../src/intent';
import { arena01, config2v2, configMirror, jsonKits } from './helpers';

/*
 * Platform gate: this test gates on the native runner (a GitHub-hosted x86 job or an Apple
 * silicon host), like the sim's allocation test. The Linux container the lead runs for the
 * fixtures does not gate it: under emulation V8 does not optimise the think code within the
 * measured window. See batch #53 decision 12.
 */

/**
 * The most heap one think of one bot may allocate in the steady state, in bytes. The figure of a
 * round is the median over its samples of the `heapUsed` delta around one `think`, minus the
 * median of the same delta around nothing (`process.memoryUsage()` allocates by itself); the
 * test takes the lowest round of each scene. The limit sits between main's lowest scene figure
 * and the branch's highest, on both platforms.
 *
 * Per-think figures in bytes, the lowest round of each scene (main is the test run against
 * `packages/bots/src` at b09b437; macOS is an Apple silicon host on Node 22.23, three runs; the
 * runner is the unit job of the draft pull request, ubuntu-latest, Node 22):
 *
 *   scene                  main, macOS      main, runner   branch, macOS   branch, runner
 *   press                  4784 to 5936     RUNNER_MAIN    0               RUNNER_BRANCH
 *   engage stand           4168 to 5368     RUNNER_MAIN    0               RUNNER_BRANCH
 *   path follow            5568 to 5664     RUNNER_MAIN    0               RUNNER_BRANCH
 *   kite, no clear shot    52904 to 56056   RUNNER_MAIN    0               RUNNER_BRANCH
 *   kite step              8648 to 9704     RUNNER_MAIN    0               RUNNER_BRANCH
 *   retreat                5856 to 5984     RUNNER_MAIN    0               RUNNER_BRANCH
 *
 * The branch reads 0 in the lowest round of every scene on macOS, and at most 288 in a round
 * that V8 spends tiering up. The mutations that put a cost back each go over the bound alone: a
 * `{ slot, ex }` object per slot reads 280, the kit derived again on every think 480, the two
 * shifted points of a clear shot made fresh 720 (2880 in the scan), a cell centre object in the
 * sight scan 10296. It cannot see one small object per think: a fresh returned input reads 96,
 * and the decision record is smaller still. The unit tests pin the returned input as the bot's
 * own record, and review covers the decision record.
 *
 * A plan (A star, the path split, the fallback search), a fresh follower after a goal or intent
 * change, and `inspect()` allocate by design and are outside the steady state: the scenes never
 * plan inside the measured median (a plan runs every 30th think at most).
 */
const THINK_ALLOCATION_LIMIT_BYTES = 128;

/**
 * The least the baseline sim step must read, as in the sim's own allocation test: it proves the
 * counter moves. A measuring call alone reads 160 to 256 B, a real baseline step 2,272 to 4,048 B.
 */
const BASELINE_FLOOR_BYTES_PER_STEP = 1000;

const WARM_UP = 20000;
const WINDOW = 600;
const ROUNDS = 3;

const deltas = new Float64Array(WINDOW);
const sorted = new Float64Array(WINDOW);

function heap(): number {
  return process.memoryUsage().heapUsed;
}

function median(values: Float64Array, n: number): number {
  const ordered = sorted.subarray(0, n);
  ordered.set(values.subarray(0, n));
  ordered.sort();
  const lo = ordered[Math.floor((n - 1) / 2)] ?? 0;
  const hi = ordered[Math.floor(n / 2)] ?? 0;
  return (lo + hi) / 2;
}

/** The median `heapUsed` delta of a pair of reads with nothing between them. */
function emptyPairMedian(): number {
  for (let i = 0; i < WINDOW; i++) {
    const before = heap();
    deltas[i] = heap() - before;
  }
  return median(deltas, WINDOW);
}

interface Scene {
  name: string;
  state: GameState;
  bot: Bot;
  /** The intent the bot acts on at the end. */
  intent: Intent;
  /** Whether the scene presses a button on every measured think. */
  presses: boolean;
  /** Whether the bot moves on every measured think (it stands still otherwise). */
  moves: boolean;
}

function ch(state: GameState, id: number): ChampionState {
  const c = state.champions[id];
  if (c === undefined) throw new Error(`no champion ${id}`);
  return c;
}

function put(state: GameState, id: number, x: number, y: number): void {
  const c = ch(state, id);
  c.x = x;
  c.y = y;
}

/**
 * A frozen mirror match on arena01 with the shipped kits: nothing steps inside a scene, and
 * `think` never mutates the state, so the same think repeats. Champions 0 and 3 are dead unless
 * a scene needs them; the bot is `id`, on a normal tier (reaction delay 15, cast delay 8).
 */
function scene(
  name: string,
  id: number,
  intent: Intent,
  presses: boolean,
  moves: boolean,
  arrange: (state: GameState, bot: Bot) => void,
): Scene {
  const state = createMatch(configMirror(), arena01, 1, jsonKits());
  for (const dead of [0, 1, 2, 3]) if (dead !== id && dead !== 2) ch(state, dead).alive = false;
  const bot = createBot(id, 'normal', 5);
  arrange(state, bot);
  return { name, state, bot, intent, presses, moves };
}

/** Thinks until the reaction delay has passed, so the bot acts on what it decided. */
function settle(bot: Bot, state: GameState): void {
  for (let i = 0; i < 20; i++) bot.think(state);
}

function buildScenes(): Scene[] {
  return [
    // A press: Quillon 8 m from Hargrim on a clear lane, run over the cast delay, cooldowns 0,
    // energy 60 (an EX press, no ultimate): chooseCast, the aim lead and the error rotation.
    scene('press', 1, 'engage', true, false, (state) => {
      put(state, 1, -4, -3);
      put(state, 2, 4, -3);
      ch(state, 1).energy = 60;
    }),
    // An engage stand: Hargrim 1.5 m from Hargrim, every slot on cooldown, so no press.
    scene('engage stand', 0, 'engage', false, false, (state) => {
      put(state, 0, -3, 3);
      put(state, 2, -1.5, 3);
      ch(state, 0).cooldowns.fill(100);
    }),
    // A path follow: Hargrim at its spawn walking 24 m to Hargrim across the arena. The state
    // is frozen, so the plan ages past the 6 thinks of the segment test and replans every 30th.
    scene('path follow', 0, 'engage', false, true, (state) => {
      put(state, 0, -12, 2);
      put(state, 2, 12, 2);
    }),
    // A kite without a clear shot: Quillon starts kiting 3 m from Hargrim, then stands 7 m away
    // with the pillar between them, so the bot scans for a sight cell and follows the path to it.
    scene('kite, no clear shot', 1, 'kite', false, true, (state, bot) => {
      put(state, 1, -3.5, -4);
      put(state, 2, -0.5, -4);
      settle(bot, state);
      put(state, 1, -3.5, 0);
      put(state, 2, 3.5, 0);
      settle(bot, state);
    }),
    // A kite step: Quillon 2 m from Hargrim steps away, the five-point test on every think, every
    // slot on cooldown, so no press.
    scene('kite step', 1, 'kite', false, true, (state) => {
      put(state, 1, -3.5, -4);
      put(state, 2, -1.5, -4);
      ch(state, 1).cooldowns.fill(100);
    }),
    // A retreat: Quillon at 20 percent health walks to its spawn, the enemy beyond rangeMax.
    scene('retreat', 1, 'retreat', false, true, (state) => {
      put(state, 1, -4, -3);
      put(state, 2, 12, 2);
      ch(state, 1).health = 0.2 * ch(state, 1).maxHealth;
    }),
    // The deadlock advance: Quillon at 20 percent health with its team behind (0.2 against 1) and
    // no enemy in reach, so the retreating bot walks the path to its target.
    scene('deadlock advance', 1, 'retreat', false, true, (state) => {
      put(state, 1, -10, -2);
      put(state, 2, 10, 2);
      ch(state, 1).health = 0.2 * ch(state, 1).maxHealth;
    }),
    // The deadlock flee: the same bot with an enemy in its reach (7 m away, a clear lane) and no
    // latch, so every think reads the team sums and scans the enemies before it walks to its spawn.
    scene('deadlock flee', 1, 'retreat', true, true, (state) => {
      put(state, 1, -6, -3);
      put(state, 2, 1, -3);
      ch(state, 1).health = 0.2 * ch(state, 1).maxHealth;
    }),
    // The deadlock stand: the same bot has begun to advance, the enemy steps into reach, and the
    // latched bot stands there with every slot on cooldown, so no press.
    scene('deadlock stand', 1, 'retreat', false, false, (state, bot) => {
      put(state, 1, -10, -2);
      put(state, 2, 10, 2);
      ch(state, 1).health = 0.2 * ch(state, 1).maxHealth;
      settle(bot, state);
      put(state, 2, -3, -3);
      ch(state, 1).cooldowns.fill(100);
    }),
  ];
}

describe('think allocation', () => {
  it('allocates under the limit per think in every scene', () => {
    const scenes = buildScenes();
    const lines: string[] = [];
    const checksums = scenes.map((s) => checksum(s.state));
    const failures: string[] = [];

    for (const s of scenes) {
      // Warm up through the same code the window runs, so each path is compiled before it is measured.
      for (let i = 0; i < WARM_UP; i++) s.bot.think(s.state);
      let best = Infinity;
      let presses = 0;
      let moves = 0;
      const figures: number[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        for (let i = 0; i < WINDOW; i++) {
          const before = heap();
          const input = s.bot.think(s.state);
          const after = heap();
          deltas[i] = after - before;
          if (input.buttons !== 0) presses++;
          if (input.moveX !== 0 || input.moveY !== 0) moves++;
        }
        const figure = median(deltas, WINDOW) - emptyPairMedian();
        figures.push(figure);
        best = Math.min(best, figure);
        lines.push(`${s.name} round ${round + 1}: ${Math.round(figure)} B per think`);
      }
      console.log(`think allocation, ${s.name}: ${figures.map((f) => Math.round(f)).join(', ')} B per think`);
      if (!(best < THINK_ALLOCATION_LIMIT_BYTES)) {
        failures.push(`${s.name}: lowest round ${Math.round(best)} B, ${figures.map(Math.round).join(', ')}`);
      }
      // The scene is live: the bot acts on the intent the scene is built for, and presses (or not).
      expect(s.bot.inspect().intent, s.name).toBe(s.intent);
      if (s.presses) expect(presses, `${s.name} presses`).toBe(ROUNDS * WINDOW);
      else expect(presses, `${s.name} presses`).toBe(0);
      if (s.moves) expect(moves, `${s.name} moves`).toBe(ROUNDS * WINDOW);
      else expect(moves, `${s.name} moves`).toBe(0);
    }

    expect(
      failures,
      `scenes whose lowest round is at or over ${THINK_ALLOCATION_LIMIT_BYTES} B per think; ${lines.join('; ')}`,
    ).toEqual([]);
    // think never mutates the state.
    scenes.forEach((s, i) => expect(checksum(s.state), s.name).toBe(checksums[i]));
  });

  it('measures a counter that moves: the baseline sim step reads above the floor', () => {
    const state = createMatch(config2v2(), arena01, 1);
    for (let i = 0; i < 300; i++) step(state, []);
    let lowest = Infinity;
    for (let round = 0; round < ROUNDS; round++) {
      for (let i = 0; i < WINDOW; i++) {
        const before = heap();
        step(state, []);
        deltas[i] = heap() - before;
      }
      lowest = Math.min(lowest, median(deltas, WINDOW));
    }
    expect(lowest, `lowest baseline step median over ${ROUNDS} rounds, floor ${BASELINE_FLOOR_BYTES_PER_STEP}`).toBeGreaterThan(
      BASELINE_FLOOR_BYTES_PER_STEP,
    );
  });
});
