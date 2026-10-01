import { CHAMPION_RADIUS } from '@claudeline/sim';
import type { Obstacle, RectObstacle } from '@claudeline/sim';
import type { NavGrid, Vec2 } from './grid';

// The shapes a champion centre may not enter are the obstacles inflated by the champion
// radius and the boundary shrunk by it, the same rules as the sim's collision pass. The
// checks are strict, so touching counts as free.

function assertNever(value: never): never {
  throw new Error(`unexpected obstacle ${JSON.stringify(value)}`);
}

function insideShrunkBoundary(width: number, height: number, p: Vec2): boolean {
  const limitX = width / 2 - CHAMPION_RADIUS;
  const limitY = height / 2 - CHAMPION_RADIUS;
  return p.x >= -limitX && p.x <= limitX && p.y >= -limitY && p.y <= limitY;
}

function overlapsObstacle(o: Obstacle, p: Vec2): boolean {
  switch (o.type) {
    case 'circle':
      return Math.hypot(p.x - o.x, p.y - o.y) < o.r + CHAMPION_RADIUS;
    case 'rect': {
      const gapX = Math.max(Math.abs(p.x - o.x) - o.w / 2, 0);
      const gapY = Math.max(Math.abs(p.y - o.y) - o.h / 2, 0);
      return Math.hypot(gapX, gapY) < CHAMPION_RADIUS;
    }
    default:
      return assertNever(o);
  }
}

/** True when a champion centred at p would leave the boundary or overlap an obstacle. */
export function pointBlocked(grid: NavGrid, p: Vec2): boolean {
  if (!insideShrunkBoundary(grid.width, grid.height, p)) return true;
  for (const o of grid.obstacles) {
    if (overlapsObstacle(o, p)) return true;
  }
  return false;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToBox(p: Vec2, o: RectObstacle): number {
  const gapX = Math.max(Math.abs(p.x - o.x) - o.w / 2, 0);
  const gapY = Math.max(Math.abs(p.y - o.y) - o.h / 2, 0);
  return Math.hypot(gapX, gapY);
}

/** Slab clip of the segment a-b against the box, one axis at a time. */
function segmentHitsBox(a: Vec2, b: Vec2, o: RectObstacle): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, o.x - o.w / 2, o.x + o.w / 2],
    [a.y, b.y - a.y, o.y - o.h / 2, o.y + o.h / 2],
  ];
  for (const [start, delta, min, max] of axes) {
    if (delta === 0) {
      if (start < min || start > max) return false;
      continue;
    }
    const ta = (min - start) / delta;
    const tb = (max - start) / delta;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return false;
  }
  return true;
}

function distanceSegmentToBox(a: Vec2, b: Vec2, o: RectObstacle): number {
  if (segmentHitsBox(a, b, o)) return 0;
  let best = Math.min(distanceToBox(a, o), distanceToBox(b, o));
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const corner = { x: o.x + (sx * o.w) / 2, y: o.y + (sy * o.h) / 2 };
      best = Math.min(best, distanceToSegment(corner, a, b));
    }
  }
  return best;
}

/**
 * True when a champion centre can walk the straight segment p-q without touching an
 * inflated obstacle or leaving the boundary. A free cell can still lie partly inside an
 * inflated obstacle, so the grid alone is not enough for chords between cell centres.
 */
export function segmentClear(grid: NavGrid, p: Vec2, q: Vec2): boolean {
  if (!insideShrunkBoundary(grid.width, grid.height, p)) return false;
  if (!insideShrunkBoundary(grid.width, grid.height, q)) return false;
  for (const o of grid.obstacles) {
    switch (o.type) {
      case 'circle':
        if (distanceToSegment(o, p, q) < o.r + CHAMPION_RADIUS) return false;
        break;
      case 'rect':
        if (distanceSegmentToBox(p, q, o) < CHAMPION_RADIUS) return false;
        break;
      default:
        return assertNever(o);
    }
  }
  return true;
}
