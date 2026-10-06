import { describe, expect, it } from 'vitest';
import { createMatch, step } from '../src/index';
import type { GameState } from '../src/index';
import { spawnProjectile } from '../src/projectile';
import { arena01, config2v2 } from './helpers';

/*
 * Platform gate: this test gates on the native runner (a GitHub-hosted x86 job or an Apple
 * silicon host). The Linux container the lead runs for the fixtures does not gate it: under
 * emulation V8 does not optimise the step code within the measured window, so the baseline
 * match alone reads about 19.7 KB per step there and this test is expected to fail. Only the
 * fixture tests (dmath, scripted, abilities, roster, rounds, replay) gate in the container.
 * See batch #53 decision 12.
 */

/**
 * The most heap one step may allocate for eight projectiles that sweep every obstacle and
 * champion and hit nothing. The sweep used to build arrays and tuples per obstacle and read
 * about 27 KB per step on this scene; it now reads about 0.4 KB, before V8's last compiler
 * tier has settled. The limit sits between the two. It cannot catch one small object per sweep
 * (about 1.4 KB per step, under the limit), so only review guards that.
 */
const SWEEP_ALLOCATION_LIMIT_BYTES_PER_STEP = 4096;

/**
 * The least the baseline match (no projectiles) must read per step. `process.memoryUsage()`
 * allocates by itself, so a step that does nothing still reads 160 to 256 B; a real baseline
 * match reads 2,272 to 4,048 B. The floor sits between the two, so a no-op step fails it.
 */
const BASELINE_FLOOR_BYTES_PER_STEP = 1000;

const WINDOW = 600;
const WARM_UP = 300;
const ROUNDS = 3;
/** Lanes through arena01 that touch no obstacle and no champion at the spawn positions. */
const SPAWN_X = -10;
const LANES = [9, 8, 4, 3, -2.5, -3, -8, -9];

const deltas = new Float64Array(WINDOW);
const sorted = new Float64Array(WINDOW);

interface Figure {
  median: number;
  sum: number;
}

/** Steps `n` times; the figure is the median heapUsed delta per step and the growth sum. */
function window(state: GameState, n: number): Figure {
  for (let i = 0; i < n; i++) {
    const before = process.memoryUsage().heapUsed;
    step(state, []);
    deltas[i] = process.memoryUsage().heapUsed - before;
  }
  const part = deltas.subarray(0, n);
  const ordered = sorted.subarray(0, n);
  ordered.set(part);
  ordered.sort();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = part[i] ?? 0;
    if (d > 0) sum += d;
  }
  const lo = ordered[Math.floor((n - 1) / 2)] ?? 0;
  const hi = ordered[Math.floor(n / 2)] ?? 0;
  return { median: (lo + hi) / 2, sum };
}

function scene(shots: boolean): GameState {
  const state = createMatch(config2v2(), arena01, 1);
  if (shots) {
    LANES.forEach((y, lane) => {
      spawnProjectile(state, {
        ownerId: 0,
        x: SPAWN_X,
        y,
        dirX: 1,
        dirY: 0,
        speed: 0.5,
        radius: 0.25,
        lifetimeTicks: 100000,
        pierce: false,
        // Lane 0 carries both lists and lane 1 only an ally list (an empty `effects`), so the
        // ally branch and the second projectile shape are in the measured sweep.
        effects: lane === 1 ? [] : [{ type: 'damage', amount: 30 }],
        ...(lane < 2 ? { allyEffects: [{ type: 'heal' as const, amount: 10 }] } : {}),
      });
    });
  }
  return state;
}

function show(f: Figure): string {
  return `${Math.round(f.median)} B median, ${Math.round(f.sum)} B growth`;
}

describe('the projectile sweep', () => {
  it('allocates under the limit per step while eight projectiles hit nothing, two of them with allyEffects', () => {
    const shots = scene(true);
    const base = scene(false);
    // Warm up through the same window code, so each scene is compiled before it is measured.
    window(shots, WARM_UP);
    window(base, WARM_UP);

    const diffs: number[] = [];
    const lines: string[] = [];
    let baseline = Infinity;
    for (let round = 0; round < ROUNDS; round++) {
      const withShots = window(shots, WINDOW);
      const without = window(base, WINDOW);
      baseline = Math.min(baseline, without.median);
      diffs.push(withShots.median - without.median);
      lines.push(`round ${round + 1}: shots ${show(withShots)}, baseline ${show(without)}`);
    }

    const best = Math.min(...diffs);
    expect(
      best,
      `bytes per step above the baseline, minimum of ${ROUNDS} rounds (limit ` +
        `${SWEEP_ALLOCATION_LIMIT_BYTES_PER_STEP}); ${lines.join('; ')}`,
    ).toBeLessThan(SWEEP_ALLOCATION_LIMIT_BYTES_PER_STEP);
    // The counter moves: the baseline match allocates well above what the measuring call does
    // alone, in every round, so a step that did nothing would fail here.
    expect(
      baseline,
      `lowest baseline median over ${ROUNDS} rounds, floor ${BASELINE_FLOOR_BYTES_PER_STEP}; ` +
        lines.join('; '),
    ).toBeGreaterThan(BASELINE_FLOOR_BYTES_PER_STEP);

    // The sim stepped: both scenes ran every warm-up and measured step, and the shots flew.
    const steps = WARM_UP + ROUNDS * WINDOW;
    expect(shots.tick).toBe(steps);
    expect(base.tick).toBe(steps);
    expect(shots.projectiles).toHaveLength(LANES.length);
    for (const p of shots.projectiles) expect(p.x).toBeGreaterThan(SPAWN_X);
    for (const c of shots.champions) expect(c.health).toBe(c.maxHealth);
  });
});
