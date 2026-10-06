import { segmentClear } from './geometry';
import { cellIndexAt } from './grid';
import type { NavGrid, Vec2 } from './grid';
import { distanceInto } from './hypot';
import type { Measure } from './hypot';
import { steerTowardInto } from './steer';
import type { MoveCommand } from './steer';

/** How far a kiting bot looks for a free step, in metres. */
export const KITE_STEP = 1;

/**
 * The points a kite step uses instead of allocating: the candidate point, the unit vector away
 * from the other champion, and the candidate direction. Points that start as doubles, so no
 * field changes representation. A bot owns one; the escape and the cornered test of the
 * ultimate's hold share it, one at a time.
 */
export interface KiteScratch {
  point: Vec2;
  away: Vec2;
  dir: Vec2;
}

export function createKiteScratch(): KiteScratch {
  return { point: { x: 0.5, y: 0.5 }, away: { x: 0.5, y: 0.5 }, dir: { x: 0.5, y: 0.5 } };
}

/**
 * The unit vector from `from` to `me`, written into `away`; (1, 0) when they stand on the same
 * point. Reads the distance with `distanceInto`, so it is the one `kiteStepInto` always used.
 */
export function awayFromInto(away: Vec2, me: Vec2, from: Vec2, dist: Measure): void {
  distanceInto(dist, me, from);
  const d = dist.metres;
  away.x = d === 0 ? 1 : (me.x - from.x) / d;
  away.y = d === 0 ? 0 : (me.y - from.y) / d;
}

/**
 * The k-th of the five directions a kite tries, in order: straight away, then 45, -45, 90 and -90
 * degrees from `away`; written into `dir`. The 45 degree turns use exact constants, no
 * trigonometry. `k` is 0 to 4.
 */
export function kiteDirectionInto(dir: Vec2, away: Vec2, k: number): void {
  const c = Math.SQRT1_2;
  if (k === 0) {
    dir.x = away.x;
    dir.y = away.y;
  } else if (k === 1) {
    dir.x = away.x * c - away.y * c;
    dir.y = away.x * c + away.y * c;
  } else if (k === 2) {
    const s = -Math.SQRT1_2;
    dir.x = away.x * c - away.y * s;
    dir.y = away.x * s + away.y * c;
  } else if (k === 3) {
    dir.x = -away.y;
    dir.y = away.x;
  } else {
    dir.x = away.y;
    dir.y = -away.x;
  }
}

/** True when the grid cell holding p is free, the cell the path follower would plan to. */
export function cellFree(grid: NavGrid, p: Vec2): boolean {
  const cell = cellIndexAt(grid, p);
  return cell >= 0 && grid.blocked[cell] === false;
}

/**
 * The first of straight away, +45, -45, +90, -90 degrees from `from` whose point 1 m off `me`
 * lies in a free grid cell and is reached by a clear straight segment: the move toward it is
 * written into `out` and the result is true. False when all five fail: `me` is cornered.
 */
export function kiteStepInto(
  out: MoveCommand,
  scratch: KiteScratch,
  grid: NavGrid,
  me: Vec2,
  from: Vec2,
  dist: Measure,
): boolean {
  const { point, away, dir } = scratch;
  awayFromInto(away, me, from, dist);
  for (let k = 0; k < 5; k++) {
    kiteDirectionInto(dir, away, k);
    point.x = me.x + dir.x * KITE_STEP;
    point.y = me.y + dir.y * KITE_STEP;
    if (cellFree(grid, point) && segmentClear(grid, me, point)) {
      steerTowardInto(out, me, point);
      return true;
    }
  }
  return false;
}
