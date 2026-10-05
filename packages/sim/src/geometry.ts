import type { RectObstacle } from './arena';

export interface Point {
  x: number;
  y: number;
}

/**
 * Euclidean length from `+ - *` and `Math.sqrt`, which round correctly on every platform.
 *
 * It is only accurate while the squares stay normal doubles. Above `sqrt(MAX_VALUE)`, about
 * 1.34e154 on one axis, a square overflows to Infinity. Below the square root of the smallest
 * normal double, about 1.49e-154, a square turns subnormal and loses precision, then flushes
 * to 0 (so `length(1e-170, 0)` is 0). Callers that take outside vectors reject both ends,
 * see `spawnProjectile`.
 */
export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * The unit vector of (dx, dy) and its length, or null for a zero vector. Both axes are first
 * divided by the larger one, so unlike `length` it needs no bound on the input: the squares
 * are at most 2 and the result is exact to a few ulps from 5e-324 up to the largest doubles.
 * Callers pass finite numbers. A zero component is stored as +0.
 */
export function direction(
  dx: number,
  dy: number,
): { x: number; y: number; length: number } | null {
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  if (m === 0) return null;
  const ux = dx / m;
  const uy = dy / m;
  const l = Math.sqrt(ux * ux + uy * uy);
  return { x: ux / l + 0, y: uy / l + 0, length: m * l };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * The moving circle of a sweep: it starts at (x, y), moves by (dx, dy) and has radius r. The
 * sweeps below read it and never write it.
 *
 * Sweeps take their inputs in these objects, not as arguments, and return a plain number.
 * V8 boxes a double it passes to or gets back from a call it does not inline, which cost
 * about 27 KB per step with eight projectiles in flight. A double stored in a double field
 * of an object that already exists is written in place and costs nothing. Make one with
 * double values (0.5, not 0) so its fields are double fields from the start.
 *
 * Each scratch object has one owner, which writes every field a call reads before the call.
 * A callee never writes an object it is given, so a nested call cannot clobber its caller's
 * inputs, and nothing carries over from one call to the next.
 */
export interface Segment {
  x: number;
  y: number;
  dx: number;
  dy: number;
  r: number;
}

/** A circle for `sweepCircleAt`: the centre (cx, cy) and the combined radius cr. */
export interface Circle {
  cx: number;
  cy: number;
  cr: number;
}

/**
 * Earliest t in [0, 1] at which the point (s.x, s.y) + t * (s.dx, s.dy) is within c.cr of the
 * centre (c.cx, c.cy), or Infinity. Contact is inclusive, so a tangent counts, and a start
 * inside gives 0. It does not read s.r.
 */
export function sweepCircleAt(s: Segment, c: Circle): number {
  const fx = s.x - c.cx;
  const fy = s.y - c.cy;
  const r = c.cr;
  const dx = s.dx;
  const dy = s.dy;
  const q = fx * fx + fy * fy - r * r;
  if (q <= 0) return 0;
  const a = dx * dx + dy * dy;
  // A zero-length segment never leaves its start, which is outside.
  if (a === 0) return Infinity;
  const b = 2 * (fx * dx + fy * dy);
  // Outside and moving away (or sideways): no root at t >= 0.
  if (b >= 0) return Infinity;
  const disc = b * b - 4 * a * q;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t <= 1 ? t : Infinity;
}

/**
 * Slab test against the rect grown by s.r on x (growX) or on y: earliest t in [0, 1],
 * inclusive, or Infinity. The x axis goes first.
 */
function sweepSlab(s: Segment, rect: RectObstacle, growX: boolean): number {
  const r = s.r;
  const minX = growX ? rect.x - rect.w / 2 - r : rect.x - rect.w / 2;
  const maxX = growX ? rect.x + rect.w / 2 + r : rect.x + rect.w / 2;
  const minY = growX ? rect.y - rect.h / 2 : rect.y - rect.h / 2 - r;
  const maxY = growX ? rect.y + rect.h / 2 : rect.y + rect.h / 2 + r;
  let tMin = 0;
  let tMax = 1;
  const dx = s.dx;
  if (dx === 0) {
    if (s.x < minX || s.x > maxX) return Infinity;
  } else {
    let t1 = (minX - s.x) / dx;
    let t2 = (maxX - s.x) / dx;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  const dy = s.dy;
  if (dy === 0) {
    if (s.y < minY || s.y > maxY) return Infinity;
  } else {
    let t1 = (minY - s.y) / dy;
    let t2 = (maxY - s.y) / dy;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}

/** The corner circle of `sweepRectAt`, which only it writes. */
const corner: Circle = { cx: 0.5, cy: 0.5, cr: 0.5 };

/**
 * Earliest t in [0, 1] at which the circle of radius s.r moving along s touches the rect, or
 * Infinity. The rect grown by r is a rounded rectangle: two slab tests, one grown in x only
 * and one in y only, plus the four corner circles. With r = 0 it is the plain slab test.
 */
export function sweepRectAt(s: Segment, rect: RectObstacle): number {
  let best = sweepSlab(s, rect, true);
  if (s.r === 0) return best;
  best = Math.min(best, sweepSlab(s, rect, false));
  const minX = rect.x - rect.w / 2;
  const maxX = rect.x + rect.w / 2;
  const minY = rect.y - rect.h / 2;
  const maxY = rect.y + rect.h / 2;
  corner.cr = s.r;
  corner.cx = minX;
  corner.cy = minY;
  best = Math.min(best, sweepCircleAt(s, corner));
  corner.cy = maxY;
  best = Math.min(best, sweepCircleAt(s, corner));
  corner.cx = maxX;
  corner.cy = minY;
  best = Math.min(best, sweepCircleAt(s, corner));
  corner.cy = maxY;
  best = Math.min(best, sweepCircleAt(s, corner));
  // A miss returns the literal, not the Math.min result, so no computed double crosses this call.
  if (best === Infinity) return Infinity;
  return best;
}

/** The scratch of the two argument-style sweeps below, so they hold no state between calls. */
const wrapSegment: Segment = { x: 0.5, y: 0.5, dx: 0.5, dy: 0.5, r: 0.5 };
const wrapCircle: Circle = { cx: 0.5, cy: 0.5, cr: 0.5 };

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
  wrapSegment.x = p0.x;
  wrapSegment.y = p0.y;
  wrapSegment.dx = dx;
  wrapSegment.dy = dy;
  wrapCircle.cx = cx;
  wrapCircle.cy = cy;
  wrapCircle.cr = r;
  return sweepCircleAt(wrapSegment, wrapCircle);
}

/**
 * Earliest t in [0, 1] at which a circle of radius r moving from p0 touches the rect, or
 * Infinity; see `sweepRectAt`.
 */
export function sweepRect(
  p0: Point,
  dx: number,
  dy: number,
  rect: RectObstacle,
  r: number,
): number {
  wrapSegment.x = p0.x;
  wrapSegment.y = p0.y;
  wrapSegment.dx = dx;
  wrapSegment.dy = dy;
  wrapSegment.r = r;
  return sweepRectAt(wrapSegment, rect);
}
