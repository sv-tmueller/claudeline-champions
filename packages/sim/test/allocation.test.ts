import { describe, expect, it } from 'vitest';
import { createMatch, step } from '../src/index';
import type { GameState } from '../src/index';
import { spawnProjectile } from '../src/projectile';
import { arena01, config2v2 } from './helpers';

/**
 * The most heap one step may allocate for eight projectiles that sweep every obstacle and
 * champion and hit nothing. The sweep used to build arrays and tuples per obstacle and read
 * about 27 KB per step on this scene; it now reads about 1 KB, and 0 once V8's last compiler
 * tier has settled. The limit sits between the two.
 */
const SWEEP_ALLOCATION_LIMIT_BYTES_PER_STEP = 4096;

const WINDOW = 600;
const WARM_UP = 300;
const ROUNDS = 3;
/** Lanes through arena01 that touch no obstacle and no champion at the spawn positions. */
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
    for (const y of LANES) {
      spawnProjectile(state, {
        ownerId: 0,
        x: -10,
        y,
        dirX: 1,
        dirY: 0,
        speed: 0.5,
        radius: 0.25,
        lifetimeTicks: 100000,
        pierce: false,
        effects: [{ type: 'damage', amount: 30 }],
      });
    }
  }
  return state;
}

function show(f: Figure): string {
  return `${Math.round(f.median)} B median, ${Math.round(f.sum)} B growth`;
}

describe('the projectile sweep', () => {
  it('allocates under the limit per step while eight projectiles hit nothing', () => {
    const shots = scene(true);
    const base = scene(false);
    // Warm up through the same window code, so each scene is compiled before it is measured.
    window(shots, WARM_UP);
    window(base, WARM_UP);

    const diffs: number[] = [];
    const lines: string[] = [];
    let baseline = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const withShots = window(shots, WINDOW);
      const without = window(base, WINDOW);
      baseline = Math.max(baseline, without.median);
      diffs.push(withShots.median - without.median);
      lines.push(`round ${round + 1}: shots ${show(withShots)}, baseline ${show(without)}`);
    }

    const best = Math.min(...diffs);
    expect(
      best,
      `bytes per step above the baseline, minimum of ${ROUNDS} rounds (limit ` +
        `${SWEEP_ALLOCATION_LIMIT_BYTES_PER_STEP}); ${lines.join('; ')}`,
    ).toBeLessThan(SWEEP_ALLOCATION_LIMIT_BYTES_PER_STEP);
    // The counter moves: the baseline match allocates something every step.
    expect(baseline).toBeGreaterThan(0);

    expect(shots.projectiles).toHaveLength(LANES.length);
    for (const c of shots.champions) expect(c.health).toBe(c.maxHealth);
  });
});
