import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';

function draw(seed: number, count: number): number[] {
  const rng = createRng(seed);
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(rng.next());
  return values;
}

describe('createRng', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(42, 50)).toEqual(draw(42, 50));
  });

  it('stays in [0, 1)', () => {
    for (const v of draw(7, 5000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('diverges for different seeds', () => {
    expect(draw(1, 10)).not.toEqual(draw(2, 10));
  });

  it('keeps each generator private', () => {
    const a = createRng(5);
    const b = createRng(5);
    a.next();
    a.next();
    expect(b.next()).toBe(draw(5, 1)[0]);
  });

  it('treats the seed as a uint32', () => {
    expect(draw(-1, 5)).toEqual(draw(4294967295, 5));
  });
});
