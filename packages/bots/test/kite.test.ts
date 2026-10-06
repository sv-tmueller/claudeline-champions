import { describe, expect, it } from 'vitest';
import { buildNavGrid } from '../src/grid';
import { createMeasure } from '../src/hypot';
import {
  KITE_STEP,
  awayFromInto,
  createKiteScratch,
  kiteDirectionInto,
  kiteStepInto,
} from '../src/kite';
import type { MoveCommand } from '../src/steer';
import { arena01 } from './helpers';

const C = Math.SQRT1_2;

describe('the five kite directions', () => {
  it('are straight away, then +45, -45, +90 and -90 degrees, in that order', () => {
    const away = { x: 1, y: 0 };
    const dir = { x: 0.5, y: 0.5 };
    const seen: number[][] = [];
    for (let k = 0; k < 5; k++) {
      kiteDirectionInto(dir, away, k);
      // `+ 0` turns a -0 into 0 for the comparison.
      seen.push([dir.x + 0, dir.y + 0]);
    }
    expect(seen).toEqual([
      [1, 0],
      [C, C],
      [C, -C],
      [0, 1],
      [0, -1],
    ]);
  });

  it('turn a vector that does not lie on an axis by the same angles', () => {
    const away = { x: 0, y: -1 };
    const dir = { x: 0.5, y: 0.5 };
    kiteDirectionInto(dir, away, 1);
    expect([dir.x, dir.y]).toEqual([away.x * C - away.y * C, away.x * C + away.y * C]);
    kiteDirectionInto(dir, away, 3);
    expect([dir.x + 0, dir.y + 0]).toEqual([1, 0]);
  });

  it('start at (1, 0) when the two champions stand on one point', () => {
    const away = { x: 0.5, y: 0.5 };
    awayFromInto(away, { x: 2, y: 3 }, { x: 2, y: 3 }, createMeasure());
    expect(away).toEqual({ x: 1, y: 0 });
  });
});

describe('kiteStepInto', () => {
  const grid = buildNavGrid(arena01);

  it('steps straight away from the other champion on open ground', () => {
    const out: MoveCommand = { moveX: 0, moveY: 0 };
    const me = { x: -6, y: -2 };
    expect(kiteStepInto(out, createKiteScratch(), grid, me, { x: -8, y: -2 }, createMeasure())).toBe(true);
    expect(out).toEqual({ moveX: 1, moveY: 0 });
    expect(KITE_STEP).toBe(1);
  });

  it('writes the first free point of the five into the scratch point, and none when cornered', () => {
    const out: MoveCommand = { moveX: 0, moveY: 0 };
    const scratch = createKiteScratch();
    const corner = { x: 14.4, y: 9.4 };
    // From the north-east corner with the other champion to the south-west, all five 1 m points
    // lie outside the boundary shrunk by the champion radius, or in a blocked cell.
    const cornered = kiteStepInto(out, scratch, grid, corner, { x: 12.4, y: 7.4 }, createMeasure());
    expect(cornered).toBe(false);
    // The scratch point holds the last point tried: -90 degrees from away.
    const last = { x: corner.x + scratch.dir.x * KITE_STEP, y: corner.y + scratch.dir.y * KITE_STEP };
    expect([scratch.point.x, scratch.point.y]).toEqual([last.x, last.y]);
  });
});
