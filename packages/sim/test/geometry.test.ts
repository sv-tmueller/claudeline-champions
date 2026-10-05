import { describe, expect, it } from 'vitest';
import type { RectObstacle } from '../src/arena';
import { direction, length, sweepCircle, sweepRect } from '../src/geometry';
import type { Point } from '../src/geometry';

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

// Verbatim copies of the sweep as it was before it stopped allocating. The exports must agree
// with them bit for bit: the replay fixtures pin the flight of every projectile.
function oracleSweepCircle(
  p0: Point,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const fx = p0.x - cx;
  const fy = p0.y - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return Infinity;
  const b = 2 * (fx * dx + fy * dy);
  if (b >= 0) return Infinity;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t <= 1 ? t : Infinity;
}

function oracleSweepBox(
  p0: Point,
  dx: number,
  dy: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): number {
  let tMin = 0;
  let tMax = 1;
  const axes: [number, number, number, number][] = [
    [p0.x, dx, minX, maxX],
    [p0.y, dy, minY, maxY],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (d === 0) {
      if (p < lo || p > hi) return Infinity;
      continue;
    }
    let t1 = (lo - p) / d;
    let t2 = (hi - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}

function oracleSweepRect(
  p0: Point,
  dx: number,
  dy: number,
  rect: RectObstacle,
  r: number,
): number {
  const minX = rect.x - rect.w / 2;
  const maxX = rect.x + rect.w / 2;
  const minY = rect.y - rect.h / 2;
  const maxY = rect.y + rect.h / 2;
  let best = oracleSweepBox(p0, dx, dy, minX - r, maxX + r, minY, maxY);
  if (r === 0) return best;
  best = Math.min(best, oracleSweepBox(p0, dx, dy, minX, maxX, minY - r, maxY + r));
  for (const cx of [minX, maxX]) {
    for (const cy of [minY, maxY]) {
      best = Math.min(best, oracleSweepCircle(p0, dx, dy, cx, cy, r));
    }
  }
  return best;
}

describe('the sweeps against the allocating originals', () => {
  // Multiples of 1/64 keep every input exact, so only the operations can differ.
  const starts: number[] = [];
  for (let i = -16; i <= 16; i++) starts.push(i / 4);
  const steps = [-6, -2.25, -0.75, -1 / 64, 0, 1 / 64, 0.75, 2.25, 6];
  const radii = [0, 1 / 64, 0.25, 0.5, 1.5];

  function same(actual: number, expected: number, what: string): void {
    if (!Object.is(actual, expected)) {
      throw new Error(`${what}: got ${actual}, the original gives ${expected}`);
    }
  }

  it('gives the same circle sweep for every start, step, centre and radius', () => {
    const centres: [number, number][] = [
      [0, 0],
      [1, 1],
      [-0.5, 0.25],
    ];
    let hits = 0;
    let misses = 0;
    let insides = 0;
    for (const x of starts) {
      for (const y of starts) {
        for (const dx of steps) {
          for (const dy of steps) {
            for (const [cx, cy] of centres) {
              for (const r of radii) {
                const expected = oracleSweepCircle({ x, y }, dx, dy, cx, cy, r);
                const what = `circle (${x}, ${y}) + (${dx}, ${dy}) at (${cx}, ${cy}) r ${r}`;
                same(sweepCircle({ x, y }, dx, dy, cx, cy, r), expected, what);
                if (expected === Infinity) misses++;
                else if (expected === 0) insides++;
                else hits++;
              }
            }
          }
        }
      }
    }
    // The grid reaches every branch: starts inside, misses and contacts mid-segment.
    expect(hits).toBeGreaterThan(1000);
    expect(misses).toBeGreaterThan(1000);
    expect(insides).toBeGreaterThan(1000);
  });

  it('gives the same rect sweep for every start, step, rect and radius', () => {
    const rects = [rect(2, 2), rect(3, 1, 0.5, -0.25), rect(1.5, 2.5, 0.25, 0.125)];
    let hits = 0;
    let misses = 0;
    let insides = 0;
    for (const o of rects) {
      for (const x of starts) {
        for (const y of starts) {
          for (const dx of steps) {
            for (const dy of steps) {
              for (const r of radii) {
                const expected = oracleSweepRect({ x, y }, dx, dy, o, r);
                const what = `rect ${o.w}x${o.h} (${x}, ${y}) + (${dx}, ${dy}) r ${r}`;
                same(sweepRect({ x, y }, dx, dy, o, r), expected, what);
                if (expected === Infinity) misses++;
                else if (expected === 0) insides++;
                else hits++;
              }
            }
          }
        }
      }
    }
    expect(hits).toBeGreaterThan(1000);
    expect(misses).toBeGreaterThan(1000);
    expect(insides).toBeGreaterThan(1000);
  });

  it('reaches each of the four corner circles first when a diagonal pass meets one', () => {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const p0 = { x: 2 * sx, y: 2 * sy };
        const expected = oracleSweepCircle(p0, -sx, -sy, sx, sy, 0.5);
        expect(expected).toBeGreaterThan(0);
        expect(expected).toBeLessThan(1);
        expect(oracleSweepBox(p0, -sx, -sy, -1.5, 1.5, -1, 1)).toBeGreaterThan(expected);
        expect(oracleSweepBox(p0, -sx, -sy, -1, 1, -1.5, 1.5)).toBeGreaterThan(expected);
        same(sweepRect(p0, -sx, -sy, rect(2, 2), 0.5), expected, `corner ${sx}, ${sy}`);
      }
    }
  });

  it('is not disturbed by a sweep in between: the exports hold no state', () => {
    const a = sweepRect({ x: -3, y: 1.3 }, 6, 0, rect(2, 2), 0.5);
    sweepCircle({ x: 9, y: 9 }, -1, -1, 0, 0, 3);
    sweepRect({ x: 0, y: 5 }, 0, -9, rect(4, 1, 1, 1), 2);
    expect(sweepRect({ x: -3, y: 1.3 }, 6, 0, rect(2, 2), 0.5)).toBe(a);
  });
});
