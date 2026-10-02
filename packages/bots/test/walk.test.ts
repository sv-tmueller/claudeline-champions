import { describe, expect, it } from 'vitest';
import { BASE_MOVE_SPEED, DT, createMatch, step } from '@claudeline/sim';
import { buildNavGrid, findPath, steerToward } from '../src/index';
import type { Vec2 } from '../src/index';
import { arena01, config2v2 } from './helpers';

/**
 * Steering toward a fixed far waypoint drifts off the segment, so the follower aims at points
 * at most one cell apart along each segment. Batch 4 lifts this into src.
 */
function followPoints(path: readonly Vec2[], maxGap: number): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxGap));
    for (let k = 1; k <= count; k++) {
      points.push({ x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count });
    }
  }
  return points;
}

describe('walking a found path with the real sim step', () => {
  it('reaches the goal within one cell and is never pushed back by an obstacle', () => {
    const state = createMatch(config2v2(), arena01, 1);
    const grid = buildNavGrid(state.arena);
    const walker = state.champions[0];
    if (!walker) throw new Error('no champion 0');
    const goal = { x: 0, y: 9 };
    const start = { x: walker.x, y: walker.y };
    expect(start).toEqual({ x: -12, y: 2 });

    const path = findPath(grid, start, goal);
    expect(path.length).toBeGreaterThanOrEqual(3);

    let pathLength = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a && b) pathLength += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const maxTicks = Math.ceil((1.3 * pathLength) / (BASE_MOVE_SPEED * DT));

    const points = followPoints(path, grid.cellSize);
    let target = 0;
    let ticks = 0;
    let pushedRun = 0;
    let longestPushedRun = 0;
    let finite = true;

    while (ticks < maxTicks) {
      let move = steerToward(walker, points[target] ?? goal);
      while (target < points.length && move.moveX === 0 && move.moveY === 0) {
        target++;
        move = steerToward(walker, points[target] ?? goal);
      }
      if (target >= points.length) break;

      const prevX = walker.x;
      const prevY = walker.y;
      step(state, [{ ...move, aimX: walker.aimX, aimY: walker.aimY, buttons: 0 }]);
      ticks++;

      const pushed =
        Math.hypot(walker.x - (prevX + walker.vx * DT), walker.y - (prevY + walker.vy * DT)) > 1e-9;
      pushedRun = pushed ? pushedRun + 1 : 0;
      longestPushedRun = Math.max(longestPushedRun, pushedRun);
      if (!Number.isFinite(walker.x) || !Number.isFinite(walker.y)) finite = false;
    }

    expect(finite).toBe(true);
    expect(target, `not arrived after ${ticks} of ${maxTicks} ticks`).toBeGreaterThanOrEqual(
      points.length,
    );
    expect(Math.hypot(walker.x - goal.x, walker.y - goal.y)).toBeLessThanOrEqual(grid.cellSize);
    expect(longestPushedRun).toBeLessThanOrEqual(5);
  });
});
