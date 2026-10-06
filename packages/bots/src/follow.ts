import { segmentClear } from './geometry';
import { cellCenter, cellCenterInto, cellIndexAt } from './grid';
import type { NavGrid, Vec2 } from './grid';
import { createMeasure, distanceInto } from './hypot';
import { findPath } from './path';
import { steerTowardInto } from './steer';
import type { MoveCommand } from './steer';

// What the checks of the follower use instead of allocating: a distance, and a cell centre.
const measure = createMeasure();
const cell: Vec2 = { x: 0.5, y: 0.5 };

/** Ticks after which the follower plans again even when nothing changed. */
export const REPLAN_INTERVAL = 30;
/** A moved goal or a blocked next point only forces a replan from this age on. */
export const REPLAN_MIN_AGE = 6;
/** How far, in cells, the start and goal fallback searches for a free cell. */
export const FALLBACK_RADIUS = 4;

export interface PathFollower {
  /** A copy of the goal the current plan was made for, or null before the first plan. */
  goal: Vec2 | null;
  points: Vec2[];
  index: number;
  /** Calls since the last plan. */
  age: number;
}

export function createFollower(): PathFollower {
  return { goal: null, points: [], index: 0, age: 0 };
}

/**
 * The free cell nearest to p within `radius` cells of p's own cell, or -1. Candidates are
 * ordered by squared distance from p to the cell centre, ties by lower cell index, and a
 * candidate counts only when the straight segment from p to its centre is clear.
 */
export function nearestFreeCell(
  grid: NavGrid,
  p: Vec2,
  radius: number = FALLBACK_RADIUS,
): number {
  const home = cellIndexAt(grid, p);
  if (home < 0) return -1;
  const homeCol = home % grid.cols;
  const homeRow = Math.floor(home / grid.cols);
  const rowMin = Math.max(0, homeRow - radius);
  const rowMax = Math.min(grid.rows - 1, homeRow + radius);
  const colMin = Math.max(0, homeCol - radius);
  const colMax = Math.min(grid.cols - 1, homeCol + radius);

  let best = -1;
  let bestDistance = Infinity;
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const index = row * grid.cols + col;
      if (grid.blocked[index] !== false) continue;
      cellCenterInto(cell, grid, index);
      const distance = (cell.x - p.x) * (cell.x - p.x) + (cell.y - p.y) * (cell.y - p.y);
      // Strict, and the scan runs in index order, so a tie keeps the lower index.
      if (distance >= bestDistance) continue;
      if (!segmentClear(grid, p, cell)) continue;
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** The points a segment is cut into: at most one cell apart, at least one. */
function segmentPoints(grid: NavGrid, a: Vec2, b: Vec2): number {
  distanceInto(measure, b, a);
  return Math.max(1, Math.ceil(measure.metres / grid.cellSize));
}

/**
 * Each segment cut into points at most one cell apart: eight-direction steering drifts. `exit`,
 * when given, is the first point of the result. The array is made at its final length, counted in
 * a first pass, so that no growing array leaves its old backing stores as garbage (what a plan
 * allocates is its points, and V8's growth policy differs between versions).
 */
function splitPath(grid: NavGrid, path: readonly Vec2[], exit: Vec2 | undefined): Vec2[] {
  const first = path[0];
  if (first === undefined) return [];
  let total = exit === undefined ? 0 : 1;
  if (path.length === 1) {
    total += 1;
  } else {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a === undefined || b === undefined) continue;
      total += segmentPoints(grid, a, b);
    }
  }
  const points = new Array<Vec2>(total);
  let at = 0;
  if (exit !== undefined) points[at++] = exit;
  if (path.length === 1) {
    points[at] = { x: first.x, y: first.y };
    return points;
  }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) continue;
    const count = segmentPoints(grid, a, b);
    for (let k = 1; k <= count; k++) {
      points[at++] = { x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count };
    }
  }
  return points;
}

function plan(grid: NavGrid, follower: PathFollower, position: Vec2, goal: Vec2): void {
  follower.goal = { x: goal.x, y: goal.y };
  follower.points = [];
  follower.index = 0;
  follower.age = 0;

  const startCell = cellIndexAt(grid, position);
  let goalCell = cellIndexAt(grid, goal);
  if (startCell < 0 || goalCell < 0) return;
  if (grid.blocked[goalCell] !== false) goalCell = nearestFreeCell(grid, goal);
  if (goalCell < 0) return;
  const goalPoint = cellCenter(grid, goalCell);

  if (grid.blocked[startCell] === false) {
    follower.points = splitPath(grid, findPath(grid, position, goalPoint), undefined);
    return;
  }
  const exit = nearestFreeCell(grid, position);
  if (exit < 0) return;
  const exitPoint = cellCenter(grid, exit);
  const route = findPath(grid, exitPoint, goalPoint);
  if (route.length === 0) return;
  follower.points = splitPath(grid, route, exitPoint);
}

/** Skips the points already reached; `scratch` takes the steering test of each. */
function advance(follower: PathFollower, position: Vec2, scratch: MoveCommand): void {
  while (follower.index < follower.points.length) {
    const point = follower.points[follower.index];
    if (point === undefined) return;
    steerTowardInto(scratch, position, point);
    if (scratch.moveX !== 0 || scratch.moveY !== 0) return;
    follower.index++;
  }
}

function needsPlan(grid: NavGrid, follower: PathFollower, position: Vec2, goal: Vec2): boolean {
  if (follower.goal === null) return true;
  if (follower.age >= REPLAN_INTERVAL) return true;
  if (follower.age < REPLAN_MIN_AGE) return false;
  distanceInto(measure, goal, follower.goal);
  if (measure.metres > grid.cellSize) return true;
  const next = follower.points[follower.index];
  return next !== undefined && !segmentClear(grid, position, next);
}

/**
 * One step of path following: the move toward the current point, replanning when the plan
 * is stale. Mutates the follower. A bot that cannot plan stands and retries later.
 */
export function followPath(
  grid: NavGrid,
  follower: PathFollower,
  position: Vec2,
  goal: Vec2,
): MoveCommand {
  const out: MoveCommand = { moveX: 0, moveY: 0 };
  followPathInto(out, grid, follower, position, goal);
  return out;
}

/**
 * `followPath` written into `out`, which also serves as the scratch of the steering tests. The
 * steady state (no plan) allocates nothing: a plan allocates its path, the search itself runs on
 * scratch (see path.ts).
 */
export function followPathInto(
  out: MoveCommand,
  grid: NavGrid,
  follower: PathFollower,
  position: Vec2,
  goal: Vec2,
): void {
  if (follower.goal !== null) follower.age++;
  advance(follower, position, out);
  if (needsPlan(grid, follower, position, goal)) {
    plan(grid, follower, position, goal);
    advance(follower, position, out);
  }
  const point = follower.points[follower.index];
  if (point === undefined) {
    out.moveX = 0;
    out.moveY = 0;
  } else {
    steerTowardInto(out, position, point);
  }
}
