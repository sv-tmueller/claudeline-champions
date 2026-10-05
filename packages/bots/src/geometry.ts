import { CHAMPION_RADIUS } from '@claudeline/sim';
import type { Obstacle } from '@claudeline/sim';
import type { NavGrid, Vec2 } from './grid';
import { hypot2 } from './hypot';

// The shapes a champion centre may not enter are the obstacles inflated by the champion
// radius and the boundary shrunk by it, the same rules as the sim's collision pass. The
// checks are strict, so touching counts as free.

function assertNever(value: never): never {
  throw new Error(`unexpected obstacle ${JSON.stringify(value)}`);
}

function insideShrunkBoundary(grid: NavGrid, p: Vec2): boolean {
  const limitX = grid.width / 2 - CHAMPION_RADIUS;
  const limitY = grid.height / 2 - CHAMPION_RADIUS;
  return p.x >= -limitX && p.x <= limitX && p.y >= -limitY && p.y <= limitY;
}

function overlapsObstacle(o: Obstacle, p: Vec2): boolean {
  switch (o.type) {
    case 'circle':
      return hypot2(p.x - o.x, p.y - o.y) < o.r + CHAMPION_RADIUS;
    case 'rect': {
      const gapX = Math.max(Math.abs(p.x - o.x) - o.w / 2, 0);
      const gapY = Math.max(Math.abs(p.y - o.y) - o.h / 2, 0);
      return hypot2(gapX, gapY) < CHAMPION_RADIUS;
    }
    default:
      return assertNever(o);
  }
}

/** True when a champion centred at p would leave the boundary or overlap an obstacle. */
export function pointBlocked(grid: NavGrid, p: Vec2): boolean {
  if (!insideShrunkBoundary(grid, p)) return true;
  for (const o of grid.obstacles) {
    if (overlapsObstacle(o, p)) return true;
  }
  return false;
}

/** Numbers per obstacle in `NavGrid.shapes`: kind, x, y, r or w, h, limit. */
const SHAPE_STRIDE = 6;
/** The kind of a circle in `NavGrid.shapes`; a rectangle is `SHAPE_RECT`. */
const SHAPE_CIRCLE = 0;
const SHAPE_RECT = 1;

/**
 * The obstacles of an arena as numbers for `segmentClear`: per obstacle its kind, x, y, r (a
 * circle) or w and h (a rectangle), and the distance the segment must keep from it, r plus the
 * champion radius for a circle and the champion radius for a rectangle. Why a flat array of
 * numbers and not the obstacle objects: V8 boxes (16 B, measured) a non-integer double it loads
 * from a field of these objects on some reads, and `segmentClear` runs on every think; a read
 * from an array of doubles does not.
 */
export function obstacleShapes(obstacles: readonly Obstacle[]): number[] {
  const shapes: number[] = [];
  for (const o of obstacles) {
    if (o.type === 'circle') {
      shapes.push(SHAPE_CIRCLE, o.x, o.y, o.r, 0.5, o.r + CHAMPION_RADIUS);
    } else {
      shapes.push(SHAPE_RECT, o.x, o.y, o.w, o.h, CHAMPION_RADIUS);
    }
  }
  return shapes;
}

/**
 * Slab clip of the segment a-b against the box of the rectangle at `at` in `shapes`, one axis at
 * a time, written out for the two axes so no tuple or loop array is allocated: this runs on the
 * think path.
 */
function segmentHitsBox(a: Vec2, b: Vec2, shapes: readonly number[], at: number): boolean {
  const x = shapes[at + 1] as number;
  const y = shapes[at + 2] as number;
  const w = shapes[at + 3] as number;
  const h = shapes[at + 4] as number;
  let t0 = 0;
  let t1 = 1;
  const deltaX = b.x - a.x;
  const minX = x - w / 2;
  const maxX = x + w / 2;
  if (deltaX === 0) {
    if (a.x < minX || a.x > maxX) return false;
  } else {
    const ta = (minX - a.x) / deltaX;
    const tb = (maxX - a.x) / deltaX;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return false;
  }
  const deltaY = b.y - a.y;
  const minY = y - h / 2;
  const maxY = y + h / 2;
  if (deltaY === 0) {
    if (a.y < minY || a.y > maxY) return false;
  } else {
    const ta = (minY - a.y) / deltaY;
    const tb = (maxY - a.y) / deltaY;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * True when a champion centre can walk the straight segment p-q without touching an
 * inflated obstacle or leaving the boundary. A free cell can still lie partly inside an
 * inflated obstacle, so the grid alone is not enough for chords between cell centres.
 *
 * This runs on the think path and allocates nothing: every distance is a local, no helper takes
 * or returns a double (V8 boxes those at a call it does not inline), every number comes from
 * `grid.shapes`, and every distance comes from one `hypot2` call site. An obstacle is blocked
 * when the segment is within its limit of some probe point: a circle has one, its centre; a
 * rectangle has six, the two ends of the segment (their distance to the box) and its four
 * corners (their distance to the segment), unless the segment goes through the box, which is
 * distance 0.
 */
export function segmentClear(grid: NavGrid, p: Vec2, q: Vec2): boolean {
  if (!insideShrunkBoundary(grid, p)) return false;
  if (!insideShrunkBoundary(grid, q)) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const lengthSquared = dx * dx + dy * dy;
  const shapes = grid.shapes;
  for (let at = 0; at < shapes.length; at += SHAPE_STRIDE) {
    const isRect = shapes[at] === SHAPE_RECT;
    const x = shapes[at + 1] as number;
    const y = shapes[at + 2] as number;
    const limit = shapes[at + 5] as number;
    let first = 6;
    let last = 7;
    if (isRect) {
      if (segmentHitsBox(p, q, shapes, at)) return false;
      first = 0;
      last = 6;
    }
    for (let k = first; k < last; k++) {
      let ex: number;
      let ey: number;
      if (k < 2) {
        // The distance from an end of the segment to the box.
        const endX = k === 0 ? p.x : q.x;
        const endY = k === 0 ? p.y : q.y;
        ex = Math.max(Math.abs(endX - x) - (shapes[at + 3] as number) / 2, 0);
        ey = Math.max(Math.abs(endY - y) - (shapes[at + 4] as number) / 2, 0);
      } else {
        // The distance from a point (the circle centre, or a corner) to the segment.
        let px = x;
        let py = y;
        if (isRect) {
          px = x + ((k < 4 ? -1 : 1) * (shapes[at + 3] as number)) / 2;
          py = y + ((k % 2 === 0 ? -1 : 1) * (shapes[at + 4] as number)) / 2;
        }
        if (lengthSquared === 0) {
          ex = px - p.x;
          ey = py - p.y;
        } else {
          const t = Math.min(1, Math.max(0, ((px - p.x) * dx + (py - p.y) * dy) / lengthSquared));
          ex = px - (p.x + t * dx);
          ey = py - (p.y + t * dy);
        }
      }
      if (hypot2(ex, ey) < limit) return false;
    }
  }
  return true;
}
