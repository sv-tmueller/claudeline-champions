import { describe, expect, it } from 'vitest';
import type { RectObstacle } from '../src/arena';
import { direction, length, sweepCircle, sweepRect } from '../src/geometry';

function rect(w: number, h: number, x = 0, y = 0): RectObstacle {
  return { type: 'rect', x, y, w, h, height: 1, blocksProjectiles: true };
}

describe('length', () => {
  it('measures a vector with only correctly rounded operations', () => {
    expect(length(3, 4)).toBe(5);
    expect(length(-3, 4)).toBe(5);
    expect(length(0, 0)).toBe(0);
    expect(length(1, 1)).toBe(Math.sqrt(2));
  });
});

describe('sweepCircle', () => {
  it('returns the time of first contact head on', () => {
    expect(sweepCircle({ x: -5, y: 0 }, 10, 0, 0, 0, 1.5)).toBeCloseTo(0.35, 12);
  });

  it('counts a tangent as contact', () => {
    // f = (-5, 1.5), d = (10, 0): the discriminant is exactly 0 in floats.
    expect(sweepCircle({ x: -5, y: 1.5 }, 10, 0, 0, 0, 1.5)).toBe(0.5);
  });

  it('misses just past the tangent', () => {
    expect(sweepCircle({ x: -5, y: 1.5 + 1e-9 }, 10, 0, 0, 0, 1.5)).toBe(Infinity);
  });

  it('returns 0 when the segment starts inside', () => {
    expect(sweepCircle({ x: 0.5, y: 0 }, 10, 0, 0, 0, 1)).toBe(0);
  });

  it('misses when the contact is past the end of the segment', () => {
    expect(sweepCircle({ x: -5, y: 0 }, 2, 0, 0, 0, 1.5)).toBe(Infinity);
  });

  it('misses a circle behind a segment that moves away', () => {
    expect(sweepCircle({ x: 2, y: 0 }, 10, 0, 0, 0, 1)).toBe(Infinity);
  });

  it('handles a zero-length segment as a point test', () => {
    expect(sweepCircle({ x: 0.5, y: 0 }, 0, 0, 0, 0, 1)).toBe(0);
    expect(sweepCircle({ x: 1, y: 0 }, 0, 0, 0, 0, 1)).toBe(0);
    expect(sweepCircle({ x: 1.0001, y: 0 }, 0, 0, 0, 0, 1)).toBe(Infinity);
  });
});

describe('sweepRect', () => {
  it('with radius 0 is the plain slab test', () => {
    expect(sweepRect({ x: -3, y: 0.5 }, 6, 0, rect(2, 2), 0)).toBeCloseTo(1 / 3, 12);
  });

  it('handles a segment parallel to an axis', () => {
    expect(sweepRect({ x: -3, y: 1.5 }, 6, 0, rect(2, 2), 0)).toBe(Infinity);
    expect(sweepRect({ x: -3, y: 1 }, 6, 0, rect(2, 2), 0)).toBeCloseTo(1 / 3, 12);
    expect(sweepRect({ x: 0, y: 3 }, 0, -6, rect(2, 2), 0)).toBeCloseTo(1 / 3, 12);
  });

  it('returns 0 when the segment starts inside', () => {
    expect(sweepRect({ x: 0.2, y: 0.2 }, 5, 5, rect(2, 2), 0)).toBe(0);
    expect(sweepRect({ x: 0.2, y: 0.2 }, 0, 0, rect(2, 2), 0.1)).toBe(0);
  });

  it('grows the faces by the radius', () => {
    expect(sweepRect({ x: -3, y: 0 }, 6, 0, rect(2, 2), 0.5)).toBeCloseTo((3 - 1.5) / 6, 12);
  });

  it('rounds the corners: a pass inside the square corner of the grown rect misses', () => {
    // (1.45, 1.45) is inside the square (1.5, 1.5) corner but 0.636 from the real corner.
    expect(sweepRect({ x: 1.45, y: 2 }, 0, -0.55, rect(2, 2), 0.5)).toBe(Infinity);
  });

  it('hits the rounded corner at the circle contact time', () => {
    // Offset 0.3 from the corner (1, 1): contact at y = 1 + sqrt(0.5^2 - 0.3^2) = 1.4.
    expect(sweepRect({ x: 1.3, y: 2 }, 0, -2, rect(2, 2), 0.5)).toBeCloseTo(0.3, 12);
  });

  it('prefers the corner circle over the face slab when it is hit first', () => {
    // Along y = 1.3 the corner circle at (-1, 1) is entered at x = -1.4.
    expect(sweepRect({ x: -3, y: 1.3 }, 6, 0, rect(2, 2), 0.5)).toBeCloseTo((3 - 1.4) / 6, 12);
  });

  it('misses a segment that stops short', () => {
    expect(sweepRect({ x: -5, y: 0 }, 2, 0, rect(2, 2), 0.5)).toBe(Infinity);
  });
});

describe('direction', () => {
  it('returns the unit vector and the length', () => {
    const d = direction(3, 4);
    expect(d?.x).toBeCloseTo(0.6, 15);
    expect(d?.y).toBeCloseTo(0.8, 15);
    expect(d?.length).toBeCloseTo(5, 12);
  });

  it('has no direction for a zero vector', () => {
    expect(direction(0, 0)).toBeNull();
    expect(direction(-0, 0)).toBeNull();
  });

  it('measures vectors beyond the range of length', () => {
    const big = direction(1e200, -1e200);
    expect(big?.x).toBeCloseTo(Math.SQRT1_2, 15);
    expect(big?.y).toBeCloseTo(-Math.SQRT1_2, 15);
    expect((big?.length ?? 0) / 1e200).toBeCloseTo(Math.SQRT2, 14);
    const tiny = direction(0, 1e-200);
    expect(tiny).toEqual({ x: 0, y: 1, length: 1e-200 });
    const subnormal = direction(5e-324, 0);
    expect(subnormal).toEqual({ x: 1, y: 0, length: 5e-324 });
  });

  it('stores +0 for a zero component', () => {
    const d = direction(-5, -0);
    expect(Object.is(d?.y, 0)).toBe(true);
    expect(d?.x).toBe(-1);
  });
});
