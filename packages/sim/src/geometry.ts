import type { RectObstacle } from './arena';

export interface Point {
  x: number;
  y: number;
}

/**
 * Earliest t in [0, 1] at which the point p0 + t * (dx, dy) is within r of the centre
 * (cx, cy), or Infinity. Contact is inclusive, so a tangent counts, and a start inside
 * gives 0.
 */
export function sweepCircle(
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
  // A zero-length segment never leaves its start, which is outside.
  if (a === 0) return Infinity;
  const b = 2 * (fx * dx + fy * dy);
  // Outside and moving away (or sideways): no root at t >= 0.
  if (b >= 0) return Infinity;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t <= 1 ? t : Infinity;
}

/** Slab test against [minX, maxX] x [minY, maxY]: earliest t in [0, 1], inclusive, or Infinity. */
function sweepBox(
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

/**
 * Earliest t in [0, 1] at which a circle of radius r moving from p0 touches the rect, or
 * Infinity. The rect grown by r is a rounded rectangle: two slab tests, one grown in x
 * only and one in y only, plus the four corner circles. With r = 0 it is the plain slab test.
 */
export function sweepRect(
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
  let best = sweepBox(p0, dx, dy, minX - r, maxX + r, minY, maxY);
  if (r === 0) return best;
  best = Math.min(best, sweepBox(p0, dx, dy, minX, maxX, minY - r, maxY + r));
  for (const cx of [minX, maxX]) {
    for (const cy of [minY, maxY]) {
      best = Math.min(best, sweepCircle(p0, dx, dy, cx, cy, r));
    }
  }
  return best;
}
