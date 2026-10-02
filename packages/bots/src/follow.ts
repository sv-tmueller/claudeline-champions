import { segmentClear } from './geometry';
import { cellCenter, cellIndexAt } from './grid';
import type { NavGrid, Vec2 } from './grid';
import { findPath } from './path';
import { steerToward } from './steer';
import type { MoveCommand } from './steer';

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

const STAND: Readonly<MoveCommand> = { moveX: 0, moveY: 0 };

function stand(): MoveCommand {
  return { moveX: STAND.moveX, moveY: STAND.moveY };
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
      const c = cellCenter(grid, index);
      const distance = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
      // Strict, and the scan runs in index order, so a tie keeps the lower index.
      if (distance >= bestDistance) continue;
      if (!segmentClear(grid, p, c)) continue;
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** Each segment cut into points at most one cell apart: eight-direction steering drifts. */
function splitPath(grid: NavGrid, path: readonly Vec2[]): Vec2[] {
  const first = path[0];
  if (first === undefined) return [];
  if (path.length === 1) return [{ x: first.x, y: first.y }];
  const points: Vec2[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) continue;
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / grid.cellSize));
    for (let k = 1; k <= count; k++) {
      points.push({ x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count });
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
    follower.points = splitPath(grid, findPath(grid, position, goalPoint));
    return;
  }
  const exit = nearestFreeCell(grid, position);
  if (exit < 0) return;
  const exitPoint = cellCenter(grid, exit);
  const route = findPath(grid, exitPoint, goalPoint);
  if (route.length === 0) return;
  follower.points = [exitPoint, ...splitPath(grid, route)];
}

function advance(follower: PathFollower, position: Vec2): void {
  while (follower.index < follower.points.length) {
    const point = follower.points[follower.index];
    if (point === undefined) return;
    const move = steerToward(position, point);
    if (move.moveX !== 0 || move.moveY !== 0) return;
    follower.index++;
  }
}

function needsPlan(grid: NavGrid, follower: PathFollower, position: Vec2, goal: Vec2): boolean {
  if (follower.goal === null) return true;
  if (follower.age >= REPLAN_INTERVAL) return true;
  if (follower.age < REPLAN_MIN_AGE) return false;
  if (Math.hypot(goal.x - follower.goal.x, goal.y - follower.goal.y) > grid.cellSize) return true;
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
  if (follower.goal !== null) follower.age++;
  advance(follower, position);
  if (needsPlan(grid, follower, position, goal)) {
    plan(grid, follower, position, goal);
    advance(follower, position);
  }
  const point = follower.points[follower.index];
  return point === undefined ? stand() : steerToward(position, point);
}
