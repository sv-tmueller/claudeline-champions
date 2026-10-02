import { describe, expect, it } from 'vitest';
import { BASE_MOVE_SPEED, DT } from '@claudeline/sim';
import { ARRIVAL_RADIUS, steerToward } from '../src/steer';

const origin = { x: 0, y: 0 };

describe('steerToward', () => {
  it('quantizes the eight unit directions at 10 m', () => {
    const d = 10 / Math.SQRT2;
    const cases: [number, number, number, number][] = [
      [10, 0, 1, 0],
      [d, d, 1, 1],
      [0, 10, 0, 1],
      [-d, d, -1, 1],
      [-10, 0, -1, 0],
      [-d, -d, -1, -1],
      [0, -10, 0, -1],
      [d, -d, 1, -1],
    ];
    for (const [x, y, moveX, moveY] of cases) {
      expect(steerToward(origin, { x, y }), `${x},${y}`).toEqual({ moveX, moveY });
    }
  });

  it('switches from a straight move to a diagonal at 22.5 degrees', () => {
    // tan(22.5 degrees) = SQRT2 - 1 = 0.4142, so 4.0 per 10 is straight and 4.3 per 10 is diagonal.
    expect(steerToward(origin, { x: 10, y: 4.0 })).toEqual({ moveX: 1, moveY: 0 });
    expect(steerToward(origin, { x: 10, y: 4.3 })).toEqual({ moveX: 1, moveY: 1 });
    expect(steerToward(origin, { x: -10, y: 4.0 })).toEqual({ moveX: -1, moveY: 0 });
    expect(steerToward(origin, { x: -10, y: -4.3 })).toEqual({ moveX: -1, moveY: -1 });
    expect(steerToward(origin, { x: 4.0, y: -10 })).toEqual({ moveX: 0, moveY: -1 });
    expect(steerToward(origin, { x: -4.3, y: 10 })).toEqual({ moveX: -1, moveY: 1 });
  });

  it('measures the direction from the position, not the origin', () => {
    expect(steerToward({ x: 3, y: -2 }, { x: 3, y: 8 })).toEqual({ moveX: 0, moveY: 1 });
    expect(steerToward({ x: 3, y: -2 }, { x: -7, y: -2 })).toEqual({ moveX: -1, moveY: 0 });
  });

  it('stops inside the arrival radius and exactly at it', () => {
    expect(steerToward(origin, { x: 0.05, y: 0.05 })).toEqual({ moveX: 0, moveY: 0 });
    expect(steerToward(origin, { x: ARRIVAL_RADIUS, y: 0 })).toEqual({ moveX: 0, moveY: 0 });
    expect(steerToward(origin, { x: ARRIVAL_RADIUS + 0.01, y: 0 })).toEqual({
      moveX: 1,
      moveY: 0,
    });
    expect(steerToward(origin, origin)).toEqual({ moveX: 0, moveY: 0 });
  });

  it('takes the arrival radius as an argument', () => {
    expect(steerToward(origin, { x: 0.4, y: 0 }, 0.5)).toEqual({ moveX: 0, moveY: 0 });
    expect(steerToward(origin, { x: 0.6, y: 0 }, 0.5)).toEqual({ moveX: 1, moveY: 0 });
  });

  it('returns positive zero on a zero axis', () => {
    const north = steerToward(origin, { x: 0, y: 10 });
    expect(Object.is(north.moveX, 0)).toBe(true);
    const south = steerToward(origin, { x: 0, y: -10 });
    expect(Object.is(south.moveX, 0)).toBe(true);
    const west = steerToward(origin, { x: -10, y: 0 });
    expect(Object.is(west.moveY, 0)).toBe(true);
  });

  it('returns positive zero on an axis that quantizes to zero from a negative offset', () => {
    // 4.0 per 10 is below tan(22.5 degrees), so that axis is off although its offset is negative.
    const cases: [number, number, number, number][] = [
      [-4.0, 10, 0, 1],
      [10, -4.0, 1, 0],
      [4.0, -10, 0, -1],
      [-10, 4.0, -1, 0],
      [-4.0, -10, 0, -1],
      [-10, -4.0, -1, 0],
    ];
    for (const [x, y, moveX, moveY] of cases) {
      const move = steerToward(origin, { x, y });
      expect(Object.is(move.moveX, moveX), `${x},${y} moveX ${move.moveX}`).toBe(true);
      expect(Object.is(move.moveY, moveY), `${x},${y} moveY ${move.moveY}`).toBe(true);
    }
  });

  it('stops for a non-finite target or position', () => {
    expect(steerToward(origin, { x: Number.NaN, y: 5 })).toEqual({ moveX: 0, moveY: 0 });
    expect(steerToward(origin, { x: 5, y: Number.POSITIVE_INFINITY })).toEqual({
      moveX: 0,
      moveY: 0,
    });
    expect(steerToward({ x: Number.NaN, y: 0 }, { x: 5, y: 5 })).toEqual({ moveX: 0, moveY: 0 });
  });

  it('keeps the arrival radius above one tick of walking so a bot cannot overshoot forever', () => {
    expect(ARRIVAL_RADIUS).toBeGreaterThanOrEqual(BASE_MOVE_SPEED * DT);
  });
});
