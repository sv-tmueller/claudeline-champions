import { describe, expect, it } from 'vitest';
import { nextRandom } from '../src/rng';

function draw(seed: number, count: number): number[] {
  const holder = { rng: seed >>> 0 };
  return Array.from({ length: count }, () => nextRandom(holder));
}

describe('nextRandom (mulberry32)', () => {
  it('matches the pinned values for seed 1', () => {
    expect(draw(1, 3)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it('matches the pinned values for seed 1337', () => {
    expect(draw(1337, 3)).toEqual([0.1844118325971067, 0.18998925131745636, 0.8104719922412187]);
  });

  it('is deterministic for a given seed', () => {
    expect(draw(42, 100)).toEqual(draw(42, 100));
  });

  it('stores the advanced state as a uint32', () => {
    const holder = { rng: 1 };
    nextRandom(holder);
    expect(holder.rng).toBe((1 + 0x6d2b79f5) >>> 0);
    expect(Number.isInteger(holder.rng)).toBe(true);
  });

  it('returns values in [0, 1)', () => {
    for (const v of draw(7, 5000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
