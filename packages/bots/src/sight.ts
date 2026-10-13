import { CHAMPION_RADIUS } from '@claudeline/sim';
import type { GameState, Obstacle } from '@claudeline/sim';
import { createMeasure, distanceInto } from './hypot';
import type { Measure } from './hypot';
import { cellIndexAt } from './grid';
import type { NavGrid, Vec2 } from './grid';

/** The width of the shot a stand and a sight cell must clear: a champion, 0.5 m either side. */
export const SIGHT_CLEARANCE = CHAMPION_RADIUS;

/**
 * The points and the obstacle table a clear shot and a sight-cell scan use instead of allocating.
 * `from` takes the centre of the cell under test, `a` and `b` the two ends of a shifted segment.
 * `table` holds the obstacles of `arena` as numbers (see `obstacleTable`). A bot owns one.
 */
export interface SightScratch {
  from: Vec2;
  a: Vec2;
  b: Vec2;
  /** The width of the shot `clearShotWith` tests, so no double is passed to the call. */
  clearance: number;
  /** The distance band `nearestSightCellIn` looks for, for the same reason. */
  rangeMin: number;
  rangeMax: number;
  /**
   * The width of the shot a stand and a sight cell must clear on this think: 0.5 m (a champion),
   * or the width of F while the bot could press it now (see `computeCues`). Read by the stands of
   * the bot and by `nearestSightCellIn`; the finisher, the reach test and the tests' stall
   * oracle keep `SIGHT_CLEARANCE`.
   */
  standClearance: number;
  /** The arena `table` was built from, an identity check like the navigation grid's arena. */
  arena: GameState['arena'] | undefined;
  table: Float64Array;
  measure: Measure;
  /**
   * The smallest squared distance `nearestSightCellIn` has found, in a field: kept in a local of
   * the scan, V8's Maglev tier boxed (16 B) the double each time it was written (the kite scene
   * of the heap check read 16 B a think, with every call inlined; see allocation.test.ts).
   */
  bestDistance: number;
}

/** Points that start as doubles, as the sim's geometry does, so no field changes representation. */
export function createSightScratch(): SightScratch {
  return {
    from: { x: 0.5, y: 0.5 },
    a: { x: 0.5, y: 0.5 },
    b: { x: 0.5, y: 0.5 },
    clearance: 0.5,
    rangeMin: 0.5,
    rangeMax: 0.5,
    standClearance: SIGHT_CLEARANCE,
    arena: undefined,
    table: new Float64Array(0),
    measure: createMeasure(),
    bestDistance: 0.5,
  };
}

// One obstacle is TABLE_STRIDE numbers: kind (CIRCLE or RECT), blocks projectiles (1 or 0), x, y,
// then r for a circle, w and h for a rect.
const TABLE_STRIDE = 6;
const CIRCLE = 0;
const RECT = 1;

/**
 * The obstacles of the arena as numbers, rebuilt when the arena object is another one. The
 * obstacle objects themselves cannot be read without allocating: a field that holds 1 in one
 * circle and 1.5 in the next has two representations, and V8 boxes the double it loads from one
 * of them (16 B per read, measured). A typed array loads every value as a double.
 */
function obstacleTable(scratch: SightScratch, arena: GameState['arena']): Float64Array {
  if (scratch.arena === arena) return scratch.table;
  const obstacles = arena.obstacles;
  const table = new Float64Array(obstacles.length * TABLE_STRIDE);
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i] as Obstacle;
    const at = i * TABLE_STRIDE;
    table[at + 1] = o.blocksProjectiles ? 1 : 0;
    table[at + 2] = o.x;
    table[at + 3] = o.y;
    if (o.type === 'circle') {
      table[at] = CIRCLE;
      table[at + 4] = o.r;
    } else {
      table[at] = RECT;
      table[at + 4] = o.w;
      table[at + 5] = o.h;
    }
  }
  scratch.arena = arena;
  scratch.table = table;
  return table;
}

/**
 * Whether the segment from `from` to `to` clears every obstacle that blocks projectiles; touching
 * counts as blocked. The sim's `hasLineOfSight` gives the same answer, and a test compares the
 * two on random segments. This copy exists because the sim's allocates about 128 B per call on
 * arena01 (each sweep it calls returns a double that V8 boxes), which a bot that tests a dozen
 * shots a think cannot afford. It is the circle sweep of the sim's `sweepCircleAt` and the slab
 * test of its `sweepRectAt` with a radius of 0, written inline over the scratch's obstacle table,
 * with the same operations in the same order. The default scratch allocates, for a direct call.
 */
export function lineOfSight(
  state: GameState,
  from: Vec2,
  to: Vec2,
  scratch: SightScratch = createSightScratch(),
): boolean {
  const table = obstacleTable(scratch, state.arena);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (let at = 0; at < table.length; at += TABLE_STRIDE) {
    if (table[at + 1] === 0) continue;
    const ox = table[at + 2] as number;
    const oy = table[at + 3] as number;
    if (table[at] === CIRCLE) {
      const r = table[at + 4] as number;
      const fx = from.x - ox;
      const fy = from.y - oy;
      const q = fx * fx + fy * fy - r * r;
      // A start inside the circle, or touching it, is blocked.
      if (q <= 0) return false;
      const a = dx * dx + dy * dy;
      // A zero-length segment never leaves its start, which is outside.
      if (a === 0) continue;
      const b = 2 * (fx * dx + fy * dy);
      // Outside and moving away or sideways: no root at t >= 0.
      if (b >= 0) continue;
      const disc = b * b - 4 * a * q;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t <= 1) return false;
    } else {
      const w = table[at + 4] as number;
      const h = table[at + 5] as number;
      const minX = ox - w / 2 - 0;
      const maxX = ox + w / 2 + 0;
      const minY = oy - h / 2;
      const maxY = oy + h / 2;
      let tMin = 0;
      let tMax = 1;
      if (dx === 0) {
        if (from.x < minX || from.x > maxX) continue;
      } else {
        let t1 = (minX - from.x) / dx;
        let t2 = (maxX - from.x) / dx;
        if (t1 > t2) {
          const swap = t1;
          t1 = t2;
          t2 = swap;
        }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) continue;
      }
      if (dy === 0) {
        if (from.y < minY || from.y > maxY) continue;
      } else {
        let t1 = (minY - from.y) / dy;
        let t2 = (maxY - from.y) / dy;
        if (t1 > t2) {
          const swap = t1;
          t1 = t2;
          t2 = swap;
        }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) continue;
      }
      // Both slabs overlap inside [0, 1]: the segment touches the rectangle.
      return false;
    }
  }
  return true;
}

/**
 * Whether a shot of radius `clearance` from `from` to `to` clears every obstacle that blocks
 * projectiles: the sim's line of sight along the centre segment and along two segments shifted
 * sideways by `clearance`, one on each side. A pure function of the state. A position on the
 * edge of a shadow has a line of sight but no clear shot, and a bolt aimed from it with the
 * smallest error hits the obstacle. A zero-length shot has only the centre segment. The shifted
 * segments are written into `scratch`, which only a direct call (a test) leaves to the default
 * and so allocates. `from` and `to` must not be `scratch.a` or `scratch.b`, which the shifted
 * segments overwrite; `scratch.from` is not written, so it may be `from`.
 */
export function clearShot(
  state: GameState,
  from: Vec2,
  to: Vec2,
  clearance: number,
  scratch: SightScratch = createSightScratch(),
): boolean {
  scratch.clearance = clearance;
  return clearShotWith(state, from, to, scratch);
}

/**
 * `clearShot` with the width of the shot in `scratch.clearance`: the think path writes it there,
 * so it passes no double to a call V8 might not inline (16 B each).
 */
export function clearShotWith(
  state: GameState,
  from: Vec2,
  to: Vec2,
  scratch: SightScratch,
): boolean {
  if (!lineOfSight(state, from, to, scratch)) return false;
  const clearance = scratch.clearance;
  distanceInto(scratch.measure, to, from);
  const length = scratch.measure.metres;
  if (!(length > 0) || !(clearance > 0)) return true;
  const px = (-(to.y - from.y) / length) * clearance;
  const py = ((to.x - from.x) / length) * clearance;
  const { a, b } = scratch;
  a.x = from.x + px;
  a.y = from.y + py;
  b.x = to.x + px;
  b.y = to.y + py;
  if (!lineOfSight(state, a, b, scratch)) return false;
  a.x = from.x - px;
  a.y = from.y - py;
  b.x = to.x - px;
  b.y = to.y - py;
  return lineOfSight(state, a, b, scratch);
}

/**
 * How far, in cells, a bot looks for a cell that sees its target: 8 cells, or 4 m. That
 * reaches the far side of the shadow an arena01 obstacle casts when a bot is left within about
 * 3 m sideways of the kite band.
 */
export const SIGHT_RADIUS = 8;

/**
 * The free cell nearest to p, within `radius` cells of p's own cell, whose centre has a clear
 * shot to the target, of the width in `scratch.standClearance` (a champion's 0.5 m by default),
 * at a distance in [rangeMin, rangeMax]; -1 when there is none or p is off the grid or not
 * finite. The bot's own cell never counts. The scan runs in index order and keeps the smallest
 * squared distance from p to the cell centre, so a tie goes to the lower index. No segment test:
 * the path follower routes to the cell. The cell centres are computed as numbers and written into
 * `scratch`; the default allocates, for a direct call.
 */
export function nearestSightCell(
  grid: NavGrid,
  state: GameState,
  p: Vec2,
  target: Vec2,
  rangeMin: number,
  rangeMax: number,
  radius: number = SIGHT_RADIUS,
  scratch: SightScratch = createSightScratch(),
): number {
  scratch.rangeMin = rangeMin;
  scratch.rangeMax = rangeMax;
  return nearestSightCellIn(grid, state, p, target, radius, scratch);
}

/**
 * `nearestSightCell` with the range in `scratch.rangeMin` and `scratch.rangeMax`: the think path
 * writes them there, so it passes no double to a call V8 might not inline (16 B each).
 */
export function nearestSightCellIn(
  grid: NavGrid,
  state: GameState,
  p: Vec2,
  target: Vec2,
  radius: number,
  scratch: SightScratch,
): number {
  const rangeMin = scratch.rangeMin;
  const rangeMax = scratch.rangeMax;
  const home = cellIndexAt(grid, p);
  if (home < 0) return -1;
  const homeCol = home % grid.cols;
  const homeRow = Math.floor(home / grid.cols);
  const rowMin = Math.max(0, homeRow - radius);
  const rowMax = Math.min(grid.rows - 1, homeRow + radius);
  const colMin = Math.max(0, homeCol - radius);
  const colMax = Math.min(grid.cols - 1, homeCol + radius);

  let best = -1;
  scratch.bestDistance = Infinity;
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const index = row * grid.cols + col;
      if (index === home || grid.blocked[index] !== false) continue;
      const cx = grid.originX + (col + 0.5) * grid.cellSize;
      const cy = grid.originY + (row + 0.5) * grid.cellSize;
      scratch.from.x = cx;
      scratch.from.y = cy;
      distanceInto(scratch.measure, scratch.from, target);
      const toTarget = scratch.measure.metres;
      if (toTarget < rangeMin || toTarget > rangeMax) continue;
      const distance = (cx - p.x) * (cx - p.x) + (cy - p.y) * (cy - p.y);
      // Strict, and the scan runs in index order, so a tie keeps the lower index.
      if (distance >= scratch.bestDistance) continue;
      // The clear shot sweep runs last: it is the costly filter. `scratch.from` holds the cell
      // centre, written above for the distance.
      scratch.clearance = scratch.standClearance;
      if (!clearShotWith(state, scratch.from, target, scratch)) continue;
      best = index;
      scratch.bestDistance = distance;
    }
  }
  return best;
}
