import { describe, expect, it } from 'vitest';
import { SLOTS, checksum, createMatch, step } from '@claudeline/sim';
import type { ChampionState, GameState, MatchConfig } from '@claudeline/sim';
import { AIM_ERROR_HOLD, createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import { createFollower, followPathInto } from '../src/follow';
import type { PathFollower } from '../src/follow';
import { pointBlocked } from '../src/geometry';
import { buildNavGrid, cellCenter, cellIndexAt } from '../src/grid';
import type { NavGrid, Vec2 } from '../src/grid';
import { hypot2 } from '../src/hypot';
import type { Intent } from '../src/intent';
import type { MoveCommand } from '../src/steer';
import { arena01, config2v2, configLumeth, configMirror, configSkerrow, rosterKits } from './helpers';
import { spawnBolt } from './scenes';

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
 * Per-think figures in bytes, the lowest round of each scene. Main is this test run against
 * `packages/bots/src` at b09b437 (the three deadlock scenes read what main does there: a retreat
 * or a stand, since main has no rule); macOS is an Apple silicon host on Node 22.23, two to four
 * runs; the runner is the unit job of a draft pull request, ubuntu-latest on Node 22, two runs.
 * The sizes of the allocations are alike on both platforms; a figure moves by up to 100 B from
 * one run to the next, and the three deadlock scenes differ by about 900 B between the platforms.
 *
 *   scene                main, macOS     main, runner    branch, macOS  branch, runner
 *   press                4784 to 5936    5936 to 5984    0              0
 *   engage stand         4168 to 5416    5368 to 5416    0              0
 *   path follow          5568 to 5712    5616 to 5664    0              0
 *   kite, no clear shot  52904 to 56056  56024 to 56056  0              0
 *   kite step            8648 to 9704    9656 to 9704    0              0
 *   retreat              5856 to 5984    5984            0              0
 *   deadlock advance     5776            5760            0              0
 *   deadlock flee        8656            9584            0              0
 *   deadlock stand       8512            9472            0              0
 *   opener press         (new scene)     (new scene)     0              0
 *   escape press         (new scene)     (new scene)     0              0
 *   skerrow engage       (new scene)     (new scene)     0              0
 *   skerrow wait         (new scene)     (new scene)     0              (not run)
 *   lumeth escape        (new scene)     (new scene)     0              (not run)
 *   lumeth heal          (new scene)     (new scene)     0              (not run)
 *   lumeth windup        (new scene)     (new scene)     0              (not run)
 *   dodge                (new scene)     (new scene)     0              (not run)
 *
 * The last eight scenes have no main figure: they test paths main does not have. The unit job of
 * the draft pull request (#86) read 0 for each of the first three in both of its runs; the
 * skerrow wait scene (#98) reads 0 on macOS on Node 22 and Node 26, and its runner figure is the
 * unit job of that pull request. The lumeth escape scene (#106) reads 0 in every round on macOS on
 * Node 22 and Node 26.
 *
 * The branch reads 0 in the lowest round of every scene, and 256 in one round of the press scene
 * while V8 tiers up (the other two read 0). The mutations that put a cost back each go over the
 * bound alone: a `{ slot, ex }` object per slot reads 280 in every scene, the kit derived again on
 * every think 480 to 632, the two shifted points of a clear shot made fresh 720 to 2880 in the
 * scenes that test a shot, a cell centre object in the sight scan 10296. It cannot see one small
 * object per think: a fresh returned input reads 96, and the decision record is smaller still.
 * A fresh object kept reachable in a module variable on each of the three new paths reads 336
 * (six doubles, in the opener band test: the three Hargrim scenes that reach it), 200 (a fresh
 * `Landing`, in the escape landing search) and 168 (six doubles, in the held ultimate's cornered
 * test); a two-double point reads 72 and stays under the bound, like the returned input. The
 * same object (six doubles) kept on each of the three paths of #98 reads 168 in the skerrow wait
 * scene: in the wait test (`waitsFor`, also 168 in the opener press and skerrow engage scenes), in
 * the target's escape test (`targetEscapeReady`, skerrow engage and wait) and in the Quiet Dart
 * condition of `updateRuns` (168 in each of the scenes read). `waitsFor` takes the distance as a
 * measure and not as a number: on Node 26 a double argument to it read 16 B a think in the opener
 * press scene.
 * The same object (six doubles) kept in a module variable on the two new paths of #106 reads 168 in
 * the lumeth escape scene on Node 22 and Node 26, in every round: in the dash landing search
 * (`findLanding` of a dash escape) and in the near-ally scan (`nearAllyOf`, run on every think of a
 * champion with Binding Sigil).
 * The same object (six doubles) kept in a module variable on the paths of #112 reads 672 in the
 * lumeth escape, heal and windup scenes in the ally scan (`allyForSlot`, 168 for each of her four
 * ally slots a think), 168 in the lumeth heal scene in the aim at an ally that is pressed and 168 in
 * the lumeth windup scene in the ally held through the windup (both in `think`), in every round on
 * Node 22, Node 26 and Node 26 with Maglev alone, where the three scenes read 0 clean.
 * The same object (six doubles) kept in a module variable on the two paths of #137 reads 304 in the
 * dodge scene in the threat scan of `dodgeInto` (per projectile: two bolts in the scene) on Node 22
 * and Node 26, and 120 in the sidestep (per think), which is under the bound in the default tiers
 * and over the Maglev one. A double argument to `dodgeInto` reads 16.
 * The unit tests pin the returned input as the bot's own record, and review covers the decision
 * record.
 *
 * A plan, a fresh follower after a goal or intent change, and `inspect()` allocate by design and
 * are outside the steady state: the scenes never plan inside the measured median (a plan runs
 * every 30th think at most). The plan search allocates only the path it returns, which the plan
 * check below bounds.
 *
 * In the default tiers this check sees only the optimizing tier a long warm-up reaches
 * (Turbofan). A browser match runs the bots in V8's middle tier, Maglev, for thousands of ticks,
 * and in the engines measured (the Chromium of Playwright 1.63, and V8 14.6 on Node 26 with
 * --no-turbofan) a call with a double argument or result, Number.isFinite included, and a number
 * written to a closure variable each box there (16 B): the live scene read 1.2 KB a window in
 * bot.ts:aim from one such call. The same scenes therefore run in Maglev alone, in the
 * `bots-heap-maglev` project of vitest.heap.config.ts on Node 26.7 (V8 14.6), against
 * THINK_MAGLEV_LIMIT_BYTES; Node 22's V8 12.4 does not reproduce the figures even with
 * --maglev --no-turbofan (tens of KB a think, before and after alike), so the project needs
 * Node 26 and says so when it does not have it. The CI runs this file in the unit job on Node 22
 * and in its own job on Node 26 (both projects) and on Node 24 (the default tier). See bots.md,
 * Allocation.
 */
const THINK_ALLOCATION_LIMIT_BYTES = 128;

/**
 * The tier the run is in: vitest.heap.config.ts sets `BOTS_HEAP_TIER=maglev` for its
 * `bots-heap-maglev` project, which runs this file in the middle tier alone, as a browser match runs
 * the bots, with the four flags of that config (`--maglev --no-turbofan`, and the two that switch off
 * background compilation and OSR, which the browser keeps on: the check measures what Maglev's code
 * boxes, not how the browser tiers the bots up). Every other run, `npm run test` included, is the
 * default tier. The Maglev project needs Node 26: on Node 22 the whole config is red by design (the
 * guard and the Maglev checks fail on V8 12.4), and the Node 22 command is `--project bots-heap`.
 */
const MAGLEV = process.env['BOTS_HEAP_TIER'] === 'maglev';

/**
 * The most heap one think may allocate in Maglev alone, in bytes. Maglev boxes every double that
 * crosses a call it does not inline, and every number written to a closure variable, 16 B each;
 * the scenes read 0 there, so the smallest mutation is one box per think, 16 B. The limit sits
 * between the two.
 *
 * Each fix of the Maglev boxing sites, reverted alone (a mutation), on Node 26.7 in Maglev alone,
 * red in 3 of 3 runs. The clean tree reads, in every run: 0 B a think in all 17 scenes, the plan
 * step 2784 B clear and 2400 to 2416 B fallback, the draw block and the dodge block 0 B, both -0
 * pins 0 B.
 *
 *   mutation                                       red in, and what it reads
 *   Number.isFinite for `t - t === 0` in aim       all 16 scenes 16 B; block 240 B; both pins 16 B
 *   aimU a closure variable of createBot           the draw block, 16 B
 *   steerTowardInto's distance through hypot2      8 scenes 80 to 160 B; plan 2944 B clear
 *   Number.isFinite in cellIndexAt                 3 scenes 16, 80 and 96 B; plan 2912 B; the
 *                                                  landing pin 32 B
 *   clearShotWith's length through hypot2          6 scenes 16 to 1600 B
 *   segmentClear through hypot2                    11 scenes 2416 to 5984 B; plan 740 KB
 *   waitsFor with a double argument (#103)         the opener press scene, 16 B
 *   bestDistance of the sight scan a local         the kite, no clear shot scene, 16 B
 *   `+ 0` for `+ 0.5 - 0.5` in aim                 the aim pin, 768 B
 *   `+ 0` for `+ 0.5 - 0.5` in landingInto         the landing pin, 288 B
 *   a bare Math.round in landingInto               the landing pin (no aim of +0 is made)
 *   rng.ts:next for the draw in aim                the draw block, 24 to 32 B
 *   a six-double object per call of plan,          the plan step, 2952 B clear and 2576 B
 *     findPath or pullString                       fallback
 *   the same object per call of nearestFreeCell    the plan step, 2736 to 2752 B fallback
 *   a six-double object per projectile scanned     the dodge scene 304 B; the dodge block 2736 B
 *     in dodgeInto (#137)
 *   a six-double object per sidestep               the dodge scene 120 B; the dodge block 120 B
 *   rng.ts:next for the dodge coin                 the dodge block, 32 B
 *   a double argument to dodgeInto                 the dodge scene 16 B; the dodge block 144 B;
 *                                                  the draw block 240 B
 *
 * Two mutations stay under the limits and are not guarded: `Number.isFinite` for the final aim
 * test (`aimX - aimX === 0`) and `needsPlan`'s distance through hypot2. Both read 0 B, the clean
 * figure, in every scene, block and pin in 3 of 3 runs, so nothing in this file sees them.
 */
const THINK_MAGLEV_LIMIT_BYTES = 8;

/**
 * The least the baseline sim step must read, as in the sim's own allocation test: it proves the
 * counter moves. A measuring call alone reads 160 to 256 B, a real baseline step 2,272 to 4,048 B.
 */
const BASELINE_FLOOR_BYTES_PER_STEP = 1000;

/**
 * The most heap one plan step of the path follower may allocate, in bytes: the median over a
 * spread of start and goal pairs across arena01 of the `heapUsed` delta around one
 * `followPathInto` of a fresh follower (so a plan: `findPath`, the string pull, `splitPath`, the
 * follower's goal and, at an end in a blocked cell, `nearestFreeCell`), minus the median of the
 * same delta around nothing. Two spreads: clear (both ends in free cells) and fallback (both ends
 * at legal points inside blocked cells); all 600 pairs of each plan. A plan is outside the steady
 * state above (it runs every 30th think at most, and about every 6th while chasing a moving goal),
 * but in a live match it was the bulk of the bots' bytes: the search allocated its tables, an
 * object per open entry and two cell centres per edge test. The search now runs on scratch that
 * outlives the call, and what a plan allocates is its output: the waypoints and the points of the
 * split path, about 46 objects of 56 B for a path across the arena, in an array made at its final
 * length. The limits sit close to the clean figure because the output is most of what a plan
 * reads.
 *
 * Per plan, the three rounds as they read, macOS:
 *   before (bc1d6f1, Node 22.23): clear 55980 to 56436, fallback 39288 to 39796
 *   after, Node 22.23:            clear 2784 to 2800,   fallback 2072 to 2132
 *   after, Node 26.7:             clear 2784,           fallback 1920 to 2064
 * Before the split path was made at its final length the fallback spread read 2280 B on Node 22
 * but 2904 to 3176 B on Node 26 (V8 14.6 grows an array and copies a spread differently), above
 * what a per-segment mutation read on Node 22, so no one limit held on both.
 *
 * A fresh six-double object kept in a module variable, clear then fallback, lowest round (the
 * same on Node 22 and Node 26 within 100 B): per edge test 44260 and 22792 B, per open push 25716
 * and 14224, per point of `splitPath` 7320 and 4920, per segment of `splitPath` 3200 and 2400, per
 * cell of `nearestFreeCell` 19636 (fallback; the clear spread never calls it). These go red on both
 * majors. Two mutations are at the edge and not guarded. Per call of `plan`, `findPath` or
 * `pullString`: 2952 clear, 2 B over the limit on both majors (clean 2800 on Node 22, 2784 on
 * Node 26), 2232 fallback. Per call of `nearestFreeCell`: 336 B on a fallback plan (it is called at
 * both ends), red on Node 22 (2400 to 2408 B, clean 2072 to 2132) and at the limit on Node 26
 * (2400 B in one run, 2256 B in another, clean 1920 to 2064), invisible on clear. The fallback
 * limit stays 2300 B: 2200 B would leave Node 22's clean fallback a margin of 3 percent. A smaller
 * object per plan, or a typed array per search, is not measured here and is the limit of this
 * check, as a two-double point is for the think bound.
 */
const PLAN_ALLOCATION_LIMIT_BYTES = 2950;
const PLAN_FALLBACK_LIMIT_BYTES = 2300;
// Maglev alone (Node 26.7): the clear plan reads the same 2784 B, the fallback plan 2400 to 2416 B
// (the default tier 1920 to 2064 B: Maglev allocates a little more for a fallback plan, so the
// default tier's 2300 B would leave the clean figure no room). A fresh six-double object per call
// of `plan`, `findPath` or `pullString` reads 2952 clear and 2576 fallback, per call of
// `nearestFreeCell` 2736 to 2752 fallback (the table at THINK_MAGLEV_LIMIT_BYTES): all four go red
// against these limits, which sit 4 and 3.5 percent above the clean figures and 2 and 3 percent
// below the smallest mutant.
const PLAN_MAGLEV_LIMIT_BYTES = 2900;
const PLAN_MAGLEV_FALLBACK_LIMIT_BYTES = 2500;

/** Calls of `hypot2` in one control window, and the least per call the control must read. */
const CONTROL_CALLS = 20;
const CONTROL_FLOOR_BYTES_PER_CALL = 16;

/** The control loop: the result of every call is stored, so it must be a number. */
function hypotLoop(out: Float64Array, seed: number): void {
  for (let i = 0; i < CONTROL_CALLS; i++) out[i] = hypot2(seed + i * 0.25, 3 + i);
}

/**
 * The most heap a block of 15 thinks with one aim draw may allocate in Maglev alone, in bytes
 * (median over the blocks of a round, the lowest round, the empty pair taken off). Main's draw
 * (`rng.ts:next`) read 16 to 32 B there, the draw written out in `aim` reads 0.
 */
const DRAW_BLOCK_MAGLEV_LIMIT_BYTES = 8;

/**
 * The same for a block of castDelay + 1 thinks over bolts with new ids, which draws one dodge coin
 * for each of the two bolts of the dodge scene (see the test). The coin is mulberry32 written out
 * in `dodgeInto`; through `rng.ts:next` it boxes its result, as the aim draw did.
 */
const DODGE_BLOCK_MAGLEV_LIMIT_BYTES = 8;

const WARM_UP = 20000;
const WINDOW = 600;
const ROUNDS = 3;

const deltas = new Float64Array(WINDOW);
const sorted = new Float64Array(WINDOW);
const bases = new Float64Array(WINDOW);

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
 * a scene needs them; the bot is `id`, on a normal tier (reaction delay 15, cast delay 8) with
 * seed 5 unless the scene gives another.
 */
function scene(
  name: string,
  id: number,
  intent: Intent,
  presses: boolean,
  moves: boolean,
  arrange: (state: GameState, bot: Bot) => void,
  config: MatchConfig = configMirror(),
  seed = 5,
): Scene {
  const state = createMatch(config, arena01, 1, rosterKits());
  for (const dead of [0, 1, 2, 3]) if (dead !== id && dead !== 2) ch(state, dead).alive = false;
  const bot = createBot(id, 'normal', seed);
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
    // An opener press: Hargrim 4.5 m from a Hargrim walking away, energy 0. Chain Hook (E, 4 to 7 m
    // at a target walking away) is pressed, and Rush's band (SPACE, 4 to 5 m) is tested on the same
    // think: the motion cue, the opener bands and the run of every slot.
    scene('opener press', 0, 'engage', true, true, (state) => {
      put(state, 0, -4, -3);
      put(state, 2, 0.5, -3);
      ch(state, 2).vx = 5.5;
    }),
    // An escape press: Quillon 3 m from Hargrim, kiting, with Skip ready: the escape trigger, the
    // landing search over the kite directions with a line of sight each, and the aim override run
    // on every think. The other slots are ready too, and Skip is chosen first.
    scene('escape press', 1, 'kite', true, true, (state) => {
      put(state, 1, -4, -3);
      put(state, 2, -1, -3);
    }),
    // A Skerrow engage: Skerrow 7 m from a Hargrim that stands against the east wall, energy 100, F
    // ready but held (the target is healthy and has a way along the wall), every other slot on
    // cooldown: the cornered test of the held ultimate runs on every think and presses nothing.
    scene(
      'skerrow engage',
      0,
      'engage',
      false,
      true,
      (state) => {
        put(state, 0, 7.4, -3);
        put(state, 2, 14.4, -3);
        const me = ch(state, 0);
        me.energy = 100;
        me.cooldowns.fill(100);
        me.cooldowns[SLOTS.indexOf('F')] = 0;
      },
      configSkerrow(),
    ),
    // A Skerrow wait: Skerrow 7 m from a Hargrim on a clear lane, Lunge 50 ticks from ready, Quiet
    // Dart ready but held back (the Hargrim's Iron Hide is cooling down, so it has no escape ready)
    // and every other slot on cooldown: the wait stand with its clear shot and the Dart cue run on
    // every think, and nothing is pressed.
    scene(
      'skerrow wait',
      0,
      'engage',
      false,
      false,
      (state) => {
        put(state, 0, -3, 3);
        put(state, 2, 4, 3);
        const me = ch(state, 0);
        me.cooldowns.fill(100);
        me.cooldowns[SLOTS.indexOf('SPACE')] = 50;
        me.cooldowns[SLOTS.indexOf('Q')] = 0;
        ch(state, 2).cooldowns.fill(100);
      },
      configSkerrow(),
    ),
    // A Lumeth escape: Lumeth 2 m from a Hargrim, kiting, with Glide ready and Lantern Burst and
    // every other slot cooling down, and her Hargrim ally 3 m from the target: the trigger (3 m,
    // any intent), the near-ally scan that every think of hers runs, the dash landing search over
    // the kite directions with a clear path each, and the aim override run on every think.
    scene(
      'lumeth escape',
      1,
      'kite',
      true,
      true,
      (state) => {
        put(state, 1, -4, -3);
        put(state, 2, -2, -3);
        ch(state, 0).alive = true;
        put(state, 0, -2, 0);
        const me = ch(state, 1);
        me.cooldowns.fill(100);
        me.cooldowns[SLOTS.indexOf('SPACE')] = 0;
      },
      configLumeth(),
    ),
    // A Lumeth heal: Lumeth 7 m from her Hargrim ally, who is missing 60 health, the enemy Hargrim 8.5
    // m away on a clear lane, Soothing Surge ready and every other slot cooling down: the ally scan of
    // every ally slot (four a think, the bolts with a clear shot each), the ally id kept in the cues
    // and the aim at the ally with its lead are run on every think, and M2 is pressed on every one.
    scene(
      'lumeth heal',
      1,
      'engage',
      true,
      false,
      (state) => {
        arrangeHeal(state);
      },
      configLumeth(),
    ),
    // A Lumeth windup: the same, after the bot has pressed Soothing Surge, with its cast in progress
    // (10 ticks of its 18 left, frozen) and the cooldown running: no press, and the aim is the ally
    // held through the windup on every think.
    scene(
      'lumeth windup',
      1,
      'engage',
      false,
      false,
      (state, bot) => {
        arrangeHeal(state);
        // The normal tier presses on its 24th think (a delay of 15 and a run of 9): settle twice.
        settle(bot, state);
        settle(bot, state);
        const me = ch(state, 1);
        me.cast = { castId: 1, slot: 'M2', ex: false, windupTicks: 18, windupLeft: 10 };
        me.cooldowns[SLOTS.indexOf('M2')] = 100;
      },
      configLumeth(),
    ),
    // A dodge: Quillon 8 m from Hargrim on a clear lane, every slot on cooldown, so she stands and
    // presses nothing, and two bolts of the Hargrim's team aimed at her, one flying along an axis
    // (vy 0) and one on a diagonal: the threat scan of both on every think, their memo entries,
    // and the sidestep with its cell and segment tests, which moves her on every think. Seed 5:
    // the first coin is a no and the second a yes, so the second bolt is the one she steps from.
    scene(
      'dodge',
      1,
      'engage',
      false,
      true,
      (state) => {
        arrangeDodge(state);
      },
      configMirror(),
      5,
    ),
  ];
}

/**
 * The dodge scenes: Quillon at (-4, -3) standing 8 m from the enemy Hargrim at (4, -3), and two of
 * his bolts that hit her standing still: A along the lane from the east (velocity (-20, 0), hits in
 * sweep 19) and B on a diagonal from (-7, 0) (velocity (14.1, -14.1), hits in sweep 11).
 */
function arrangeDodge(state: GameState): void {
  put(state, 1, -4, -3);
  put(state, 2, 4, -3);
  ch(state, 1).cooldowns.fill(100);
  spawnBolt(state, { from: [3, -3], dir: [-1, 0] });
  spawnBolt(state, { from: [-7, 0], dir: [1, -1] });
}

/** The Lumeth heal scenes: Lumeth at (-8, -3), her ally Hargrim at (-1, -3) missing 60, M2 ready. */
function arrangeHeal(state: GameState): void {
  put(state, 1, -8, -3);
  put(state, 2, -2, 3);
  ch(state, 0).alive = true;
  put(state, 0, -1, -3);
  ch(state, 0).health = ch(state, 0).maxHealth - 60;
  const me = ch(state, 1);
  me.cooldowns.fill(100);
  me.cooldowns[SLOTS.indexOf('M2')] = 0;
}

describe('think allocation', () => {
  // The Maglev project is only worth its figures on the engine they were measured on and with the
  // flags applied: V8 12.4 (Node 22) does not reproduce them, a worker that lost its execArgv
  // runs the default tiers and reads 0 B everywhere, and one that compiles on a background thread
  // or replaces its loops on the stack (`--no-concurrent-recompilation` or `--no-use-osr` lost)
  // reads 480 B in a block or 32 B a think after the move to -0 in some runs (see
  // vitest.heap.config.ts). The control below proves the tier itself.
  it.runIf(MAGLEV)('runs on Node 26 (V8 14) with the Maglev-only flags of the config', () => {
    const v8Major = Number.parseInt(process.versions.v8.split('.')[0] ?? '0', 10);
    const wanted = ['--maglev', '--no-turbofan', '--no-concurrent-recompilation', '--no-use-osr'];
    const flags = wanted.filter((flag) => process.execArgv.includes(flag));
    const missing = wanted.filter((flag) => !flags.includes(flag));
    const problem = `the Maglev heap check needs Node 26 (V8 14.6) and ${wanted.join(' ')}: found V8 ${process.versions.v8}, missing ${missing.join(' ') || 'nothing'}`;
    expect(v8Major >= 14 && missing.length === 0, problem).toBe(true);
  });

  // The control: a call V8 does not inline boxes the double it returns, and Maglev does not inline
  // `hypot2` into this loop (Turbofan does, and reads about 0). So a Maglev run that reads 0 B in
  // the scenes below has not gone vacuous: it reads at least 16 B per call here.
  it.runIf(MAGLEV)('measures a Maglev that boxes: a loop of hypot2 calls reads at least 16 B a call', () => {
    const out = new Float64Array(CONTROL_CALLS);
    for (let i = 0; i < 2000; i++) hypotLoop(out, i);
    for (let i = 0; i < WINDOW; i++) {
      const before = heap();
      hypotLoop(out, i);
      deltas[i] = heap() - before;
    }
    const perCall = (median(deltas, WINDOW) - emptyPairMedian()) / CONTROL_CALLS;
    console.log(`maglev control, hypot2 into a Float64Array: ${perCall} B per call`);
    expect(perCall, 'median bytes per hypot2 call in the control loop, floor 16').toBeGreaterThanOrEqual(CONTROL_FLOOR_BYTES_PER_CALL);
  });

  // Runner (ubuntu-latest, Node 22): 2.9 and 3.9 s green, 5.9, 5.9 and 5.7 s red on 5820f16
  // (runs 39001711657, 39008413462, 39009180211 x3); 1.6 s locally (Apple M5 Pro, Node 22.23.2,
  // full npm run test). Timeout: the smallest of 10, 15 and 20 s at least twice the slowest
  // runner time (testing.md, Check suite). The heap jobs of #108 (Node 24 and 26, both tiers) read
  // 3.3 to 5.2 s.
  it('allocates under the limit per think in every scene', { timeout: 15_000 }, () => {
    const thinkLimit = MAGLEV ? THINK_MAGLEV_LIMIT_BYTES : THINK_ALLOCATION_LIMIT_BYTES;
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
          // The empty pair is read in this loop, just before the think's: a call of
          // `process.memoryUsage()` allocates its result object, 144 B in a tier that does not
          // optimise it away, and `emptyPairMedian` read at another time or in another function can
          // sit in another tier than this loop (on Node 24 one scene read +144 B in every round).
          const emptyBefore = heap();
          bases[i] = heap() - emptyBefore;
          const before = heap();
          const input = s.bot.think(s.state);
          const after = heap();
          deltas[i] = after - before;
          if (input.buttons !== 0) presses++;
          if (input.moveX !== 0 || input.moveY !== 0) moves++;
        }
        const figure = median(deltas, WINDOW) - median(bases, WINDOW);
        figures.push(figure);
        best = Math.min(best, figure);
        lines.push(`${s.name} round ${round + 1}: ${Math.round(figure)} B per think`);
      }
      console.log(`think allocation, ${s.name}: ${figures.map((f) => Math.round(f)).join(', ')} B per think`);
      if (!(best < thinkLimit)) {
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
      `scenes whose lowest round is at or over ${thinkLimit} B per think; ${lines.join('; ')}`,
    ).toEqual([]);
    // think never mutates the state.
    scenes.forEach((s, i) => expect(checksum(s.state), s.name).toBe(checksums[i]));
  });

  // Runner (ubuntu-latest, Node 22): 1.6 and 1.7 s green, 2.7, 2.6 and 2.3 s red on 5820f16
  // (runs 39001711657, 39008413462, 39009180211 x3); 0.75 s locally (Apple M5 Pro, Node 22.23.2,
  // full npm run test). Timeout: the smallest of 10, 15 and 20 s at least twice the slowest
  // runner time (testing.md, Check suite). The heap jobs of #108 read 1.7 to 3.2 s.
  it("allocates only the path it plans, across arena01: the follower's whole plan step", { timeout: 10_000 }, () => {
    const grid: NavGrid = buildNavGrid(arena01);
    const free: number[] = [];
    // Legal points inside blocked cells (the cell centre is blocked, the point is not): a bot can
    // stand there, and `nearestFreeCell` searches the cells around it.
    const inBlocked: Vec2[] = [];
    for (let i = 0; i < grid.blocked.length; i++) {
      if (grid.blocked[i] === false) {
        free.push(i);
        continue;
      }
      const c = cellCenter(grid, i);
      for (const [dx, dy] of [[0.2, 0.2], [-0.2, 0.2], [-0.2, -0.2], [0.2, -0.2]] as const) {
        const p = { x: c.x + dx, y: c.y + dy };
        if (cellIndexAt(grid, p) === i && !pointBlocked(grid, p)) {
          inBlocked.push(p);
          break;
        }
      }
    }
    // Two fixed spreads of pairs, made before the measured calls so the test allocates nothing in
    // them. Clear: both ends in free cells. Fallback: both ends in blocked cells, so the plan
    // searches for a free cell at each end.
    const spread = (cells: number[], a: number, b: number): Vec2[] => {
      const points: Vec2[] = [];
      for (let i = 0; i < WINDOW; i++) points.push(cellCenter(grid, cells[(i * a + b) % cells.length] as number));
      return points;
    };
    const spreadOf = (points: Vec2[], a: number, b: number): Vec2[] => {
      const out: Vec2[] = [];
      for (let i = 0; i < WINDOW; i++) out.push(points[(i * a + b) % points.length] as Vec2);
      return out;
    };
    const clear = { from: spread(free, 211, 7), to: spread(free, 389, 101), name: 'clear' };
    const fallback = { from: spreadOf(inBlocked, 31, 3), to: spreadOf(inBlocked, 53, 17), name: 'fallback' };
    const out: MoveCommand = { moveX: 0, moveY: 0 };
    const figures: Record<string, number[]> = {};
    for (const set of [clear, fallback]) {
      const followers: PathFollower[] = [];
      const plan = (i: number): void =>
        followPathInto(out, grid, followers[i] as PathFollower, set.from[i] as Vec2, set.to[i] as Vec2);
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < WINDOW; i++) followers[i] = createFollower();
        for (let i = 0; i < WINDOW; i++) plan(i);
      }
      const rounds: number[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        for (let i = 0; i < WINDOW; i++) followers[i] = createFollower();
        let planned = 0;
        for (let i = 0; i < WINDOW; i++) {
          const emptyBefore = heap();
          bases[i] = heap() - emptyBefore;
          const before = heap();
          plan(i);
          deltas[i] = heap() - before;
          if ((followers[i] as PathFollower).points.length > 0) planned++;
        }
        // A plan that found nothing would read low and prove nothing: every pair of both spreads
        // plans (the fallback ones through a free cell at each end), as 600 of 600 do.
        if (set === clear) expect(planned, 'clear pairs with no points').toBe(WINDOW);
        else expect(planned, 'fallback pairs with points').toBe(WINDOW);
        rounds.push(median(deltas, WINDOW) - median(bases, WINDOW));
      }
      figures[set.name] = rounds;
    }
    const lines = Object.entries(figures).map(([name, rounds]) => `${name} ${rounds.map((f) => Math.round(f)).join(', ')}`);
    console.log(`plan allocation, the follower's plan step over ${WINDOW} pairs: ${lines.join('; ')} B per plan`);
    for (const [name, rounds] of Object.entries(figures)) {
      const limit =
        name === 'clear'
          ? MAGLEV
            ? PLAN_MAGLEV_LIMIT_BYTES
            : PLAN_ALLOCATION_LIMIT_BYTES
          : MAGLEV
            ? PLAN_MAGLEV_FALLBACK_LIMIT_BYTES
            : PLAN_FALLBACK_LIMIT_BYTES;
      expect(
        Math.min(...rounds),
        `lowest round of the median bytes per ${name} plan: ${rounds.map(Math.round).join(', ')}`,
      ).toBeLessThan(limit);
    }
  });

  // The draw block: the per-think median hides the aim error draw, which runs once in 15 thinks
  // (AIM_ERROR_HOLD). A block of 15 thinks holds exactly one draw, wherever it starts, so the
  // median over blocks reads the draw in its first think. On main the draw was `rng.ts:next`, run
  // too rarely to be optimised before a long run: it read about 30 B a draw in the browser.
  // Run in Maglev alone: in the default tiers a block reads about -140 B whatever the draw (a
  // block of thinks reads less than the empty pair there, so the check has no power), and `next`
  // is optimised there.
  it.runIf(MAGLEV)('allocates nothing in a block of 15 thinks with one aim draw', () => {
    const s = scene('press', 1, 'engage', true, false, (state) => {
      put(state, 1, -4, -3);
      put(state, 2, 4, -3);
      ch(state, 1).energy = 60;
    });
    for (let i = 0; i < WARM_UP; i++) s.bot.think(s.state);
    const figures: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      for (let i = 0; i < WINDOW; i++) {
        const before = heap();
        for (let k = 0; k < AIM_ERROR_HOLD; k++) s.bot.think(s.state);
        deltas[i] = heap() - before;
      }
      figures.push(median(deltas, WINDOW) - emptyPairMedian());
    }
    console.log(`think allocation, a block of ${AIM_ERROR_HOLD} thinks with one draw: ${figures.map((f) => Math.round(f)).join(', ')} B per block`);
    expect(
      Math.min(...figures),
      `lowest round of the median bytes per block of ${AIM_ERROR_HOLD} thinks: ${figures.map(Math.round).join(', ')}`,
    ).toBeLessThan(DRAW_BLOCK_MAGLEV_LIMIT_BYTES);
  });

  // The dodge draw: a projectile's coin is drawn once, castDelay thinks after the bot first predicts
  // its hit, so the dodge scene (whose bolts stay the same) reads it in no measured think. A block of
  // castDelay + 1 thinks, with the two bolts renumbered at its start, holds exactly one coin for each
  // of them, wherever the block starts, so the median over blocks reads the draw. Run in Maglev alone
  // for the reason of the draw block above.
  it.runIf(MAGLEV)('allocates nothing in a block of thinks with a dodge coin for each of two bolts', () => {
    const s = scene(
      'dodge draw',
      1,
      'engage',
      false,
      true,
      (state) => {
        arrangeDodge(state);
      },
      configMirror(),
      5,
    );
    const length = TIERS.normal.castDelay + 1;
    let nextId = 1000;
    const renumber = (): void => {
      for (let k = 0; k < s.state.projectiles.length; k++) {
        (s.state.projectiles[k] as { id: number }).id = nextId++;
      }
    };
    for (let i = 0; i < WARM_UP / length; i++) {
      renumber();
      for (let k = 0; k < length; k++) s.bot.think(s.state);
    }
    const figures: number[] = [];
    let moves = 0;
    for (let round = 0; round < ROUNDS; round++) {
      for (let i = 0; i < WINDOW; i++) {
        renumber();
        const before = heap();
        for (let k = 0; k < length; k++) {
          const input = s.bot.think(s.state);
          if (input.moveX !== 0 || input.moveY !== 0) moves++;
        }
        deltas[i] = heap() - before;
      }
      figures.push(median(deltas, WINDOW) - emptyPairMedian());
    }
    console.log(`think allocation, a block of ${length} thinks with a dodge coin per bolt: ${figures.map((f) => Math.round(f)).join(', ')} B per block, ${moves} moving thinks`);
    // The scene reaches the step: the block's last think is a dodge when a coin was a yes.
    expect(moves, 'moving thinks').toBeGreaterThan(0);
    expect(
      Math.min(...figures),
      `lowest round of the median bytes per block of ${length} thinks: ${figures.map(Math.round).join(', ')}`,
    ).toBeLessThan(DODGE_BLOCK_MAGLEV_LIMIT_BYTES);
  });

  // The first aim of -0: after a warm-up on whole-centimetre aims, a point in [-0.5, 0) cm rounds
  // to -0, and `Math.round(..) + 0` then saw its first value that is not an int32: V8 deoptimised
  // the function, and in Maglev alone the bot ran about 1200 thinks in a lower tier at 290 to
  // 420 B a think (the browser read 65 KB a window in `aim`). `+ 0.5 - 0.5` has number feedback
  // from its first run. Each scene is warmed up where its aim is whole, then moved 1 to 3 m so
  // the aim lands in [-0.5, 0) cm, and the lower of the two windows after the move must read under
  // the limit (the first window alone reads 16 B in a run of this test by itself).
  // Red under `+ 0` in aim (768 B) and in landingInto (288 B), Node 26.7, Maglev alone.
  function expectNoDeoptAtMinusZero(s: Scene, move: (state: GameState) => void): void {
    for (let i = 0; i < WARM_UP; i++) s.bot.think(s.state);
    move(s.state);
    const figures: number[] = [];
    let zeros = 0;
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < WINDOW; i++) {
        const before = heap();
        const input = s.bot.think(s.state);
        deltas[i] = heap() - before;
        if (Object.is(input.aimX, 0) || Object.is(input.aimY, 0)) zeros++;
      }
      figures.push(median(deltas, WINDOW) - emptyPairMedian());
    }
    console.log(
      `think allocation after the move to -0, ${s.name}: ${figures.map((f) => Math.round(f)).join(', ')} B per think, ${zeros} aims of +0`,
    );
    // The scene reaches the case it is for: the aim is +0, a -0 turned, on some thinks.
    expect(zeros, `${s.name}: thinks with an aim of 0`).toBeGreaterThan(0);
    expect(
      Math.min(...figures),
      `${s.name}: lowest of the two windows after the move, median bytes per think: ${figures.map(Math.round).join(', ')}`,
    ).toBeLessThan(THINK_MAGLEV_LIMIT_BYTES);
  }

  // 8 m from the target, along x, with the error of a normal bot: aimX is
  // 100 * (x + 8 cos(2 atan u)) cm, between -4 and 0 for x = -8, and a part of the draws are -0.
  it.runIf(MAGLEV)('keeps the aim of a press optimised when it first rounds to -0', () => {
    const s = scene('press, aim at -0.3 cm', 1, 'engage', true, false, (state) => {
      put(state, 1, -5, -3);
      put(state, 2, 3, -3);
      ch(state, 1).energy = 60;
    });
    expectNoDeoptAtMinusZero(s, (state) => {
      put(state, 1, -8, -3);
      put(state, 2, 0, -3);
    });
  });

  // Skip lands 4 m away, straight from the target: from x = 3.997 the landing is at x = -0.003.
  it.runIf(MAGLEV)("keeps an escape press's landing optimised when it first rounds to -0", () => {
    const s = scene('escape press, landing at -0.3 cm', 1, 'kite', true, true, (state) => {
      put(state, 1, 2.997, -3);
      put(state, 2, 5.997, -3);
    });
    expectNoDeoptAtMinusZero(s, (state) => {
      put(state, 1, 3.997, -3);
      put(state, 2, 6.997, -3);
    });
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
