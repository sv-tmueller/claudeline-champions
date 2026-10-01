import { describe, expect, it } from 'vitest';
import { createMatch, hasLineOfSight } from '../src/index';
import { arena01, config2v2 } from './helpers';

const state = createMatch(config2v2(), arena01, 1);

function sees(ax: number, ay: number, bx: number, by: number): boolean {
  return hasLineOfSight(state, { x: ax, y: ay }, { x: bx, y: by });
}

describe('hasLineOfSight', () => {
  it('is blocked by the central pillar', () => {
    expect(sees(-5, 0, 5, 0)).toBe(false);
  });

  it('is blocked by a blocking rect', () => {
    expect(sees(-10, 0, -6, 0)).toBe(false);
  });

  it('ignores a low wall that does not block projectiles', () => {
    expect(sees(-9, 5, -3, 5)).toBe(true);
  });

  it('is clear over open ground', () => {
    expect(sees(-10, -8, 10, -8)).toBe(true);
  });

  it('counts a tangent as blocked and a miss by 1e-9 as clear', () => {
    expect(sees(-5, 1.5, 5, 1.5)).toBe(false);
    expect(sees(-5, 1.5 + 1e-9, 5, 1.5 + 1e-9)).toBe(true);
  });

  it('gives the same answer with the arguments swapped', () => {
    const pairs: [number, number, number, number][] = [
      [-5, 0, 5, 0],
      [-10, 0, -6, 0],
      [-9, 5, -3, 5],
      [-5, 1.5, 5, 1.5],
      [-5, 1.5 + 1e-9, 5, 1.5 + 1e-9],
      [-10, -8, 10, -8],
    ];
    for (const [ax, ay, bx, by] of pairs) expect(sees(bx, by, ax, ay)).toBe(sees(ax, ay, bx, by));
  });
});
