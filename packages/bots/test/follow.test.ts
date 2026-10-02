import { describe, expect, it } from 'vitest';
import { BASE_MOVE_SPEED, DT, createMatch, step } from '@claudeline/sim';
import type { ArenaDef, GameState } from '@claudeline/sim';
import { buildNavGrid, cellCenter, cellIndexAt, findPath } from '../src/index';
import type { NavGrid, Vec2 } from '../src/index';
import { pointBlocked, segmentClear } from '../src/geometry';
import {
  FALLBACK_RADIUS,
  REPLAN_INTERVAL,
  REPLAN_MIN_AGE,
  createFollower,
  followPath,
  nearestFreeCell,
} from '../src/follow';
import type { PathFollower } from '../src/follow';
import { arena01, config2v2 } from './helpers';

const grid = buildNavGrid(arena01);

/** A match where only champion 0 is alive, so nothing else blocks the walk. */
function soloMatch(arena: ArenaDef = arena01): GameState {
  const state = createMatch(config2v2(), arena, 1);
  for (const c of state.champions) if (c.id !== 0) c.alive = false;
  return state;
}

function walker(state: GameState) {
  const c = state.champions[0];
  if (!c) throw new Error('no champion 0');
  return c;
}

function arrived(follower: PathFollower): boolean {
  return follower.goal !== null && follower.index >= follower.points.length;
}

interface WalkResult {
  arrived: boolean;
  ticks: number;
  longestPushedRun: number;
  finite: boolean;
  distanceToGoal: number;
  follower: PathFollower;
}

/** Walks champion 0 with the real sim step; `before` runs ahead of each tick. */
function walk(
  state: GameState,
  goal: Vec2,
  maxTicks: number,
  follower: PathFollower = createFollower(),
  before?: (tick: number, follower: PathFollower) => void,
  navGrid: NavGrid = grid,
): WalkResult {
  const w = walker(state);
  let ticks = 0;
  let pushedRun = 0;
  let longestPushedRun = 0;
  let finite = true;
  while (ticks < maxTicks) {
    before?.(ticks, follower);
    const move = followPath(navGrid, follower, w, goal);
    if (arrived(follower) && move.moveX === 0 && move.moveY === 0) break;
    const prevX = w.x;
    const prevY = w.y;
    step(state, [{ ...move, aimX: w.aimX, aimY: w.aimY, buttons: 0 }]);
    ticks++;
    const pushed = Math.hypot(w.x - (prevX + w.vx * DT), w.y - (prevY + w.vy * DT)) > 1e-9;
    pushedRun = pushed ? pushedRun + 1 : 0;
    longestPushedRun = Math.max(longestPushedRun, pushedRun);
    if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) finite = false;
  }
  return {
    arrived: arrived(follower),
    ticks,
    longestPushedRun,
    finite,
    distanceToGoal: Math.hypot(w.x - goal.x, w.y - goal.y),
    follower,
  };
}

function pathLength(path: readonly Vec2[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/** Brute force: every cell in the grid, filtered and ordered by the documented rule. */
function bruteNearestFreeCell(g: NavGrid, p: Vec2, radius: number): number {
  const home = cellIndexAt(g, p);
  if (home < 0) return -1;
  const homeCol = home % g.cols;
  const homeRow = Math.floor(home / g.cols);
  let best = -1;
  let bestD2 = Infinity;
  for (let index = 0; index < g.cols * g.rows; index++) {
    const col = index % g.cols;
    const row = Math.floor(index / g.cols);
    if (Math.abs(col - homeCol) > radius || Math.abs(row - homeRow) > radius) continue;
    if (g.blocked[index] !== false) continue;
    const c = cellCenter(g, index);
    if (!segmentClear(g, p, c)) continue;
    const d2 = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d2 < bestD2) {
      best = index;
      bestD2 = d2;
    }
  }
  return best;
}

describe('createFollower', () => {
  it('starts with no plan', () => {
    expect(createFollower()).toEqual({ goal: null, points: [], index: 0, age: 0 });
  });
});

describe('followPath splitting', () => {
  it('cuts every segment into points at most one cell apart', () => {
    const follower = createFollower();
    const start = { x: -12, y: 2 };
    followPath(grid, follower, start, { x: 12, y: -2 });
    expect(follower.points.length).toBeGreaterThan(10);
    const startCentre = cellCenter(grid, cellIndexAt(grid, start));
    let previous = startCentre;
    for (const point of follower.points) {
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThanOrEqual(
        grid.cellSize + 1e-9,
      );
      previous = point;
    }
    const last = follower.points[follower.points.length - 1];
    const goalCentre = cellCenter(grid, cellIndexAt(grid, { x: 12, y: -2 }));
    expect(last).toEqual(goalCentre);
  });

  it('stores a fresh copy of the goal', () => {
    const follower = createFollower();
    const goal = { x: 0, y: 9 };
    followPath(grid, follower, { x: -12, y: 2 }, goal);
    goal.x = 99;
    expect(follower.goal).toEqual({ x: 0, y: 9 });
  });

  it('walks to the centre of the goal cell when the bot already stands in it', () => {
    const follower = createFollower();
    const move = followPath(grid, follower, { x: -11.9, y: 2.1 }, { x: -11.8, y: 2.2 });
    expect(follower.points).toEqual([cellCenter(grid, cellIndexAt(grid, { x: -11.8, y: 2.2 }))]);
    expect(move).toEqual({ moveX: 1, moveY: 1 });
  });
});

describe('walking with the real sim step', () => {
  const goals: Vec2[] = [
    { x: 0, y: 9 },
    { x: -2.25, y: 5.75 },
    { x: 6.25, y: 8.75 },
    { x: 0.25, y: -8.75 },
    { x: -6, y: 7 },
    { x: 12, y: -2 },
  ];

  for (const goal of goals) {
    it(`reaches (${goal.x}, ${goal.y}) within one cell and is never pushed for long`, () => {
      const state = soloMatch();
      const start = { x: walker(state).x, y: walker(state).y };
      expect(start).toEqual({ x: -12, y: 2 });

      let target = goal;
      const goalCell = cellIndexAt(grid, goal);
      if (grid.blocked[goalCell] !== false) {
        const free = nearestFreeCell(grid, goal);
        expect(free).toBeGreaterThanOrEqual(0);
        target = cellCenter(grid, free);
      }
      const route = findPath(grid, start, target);
      expect(route.length).toBeGreaterThanOrEqual(2);
      const maxTicks = Math.ceil((1.3 * pathLength(route)) / (BASE_MOVE_SPEED * DT));

      const result = walk(state, goal, maxTicks);
      expect(result.finite).toBe(true);
      expect(result.arrived, `not arrived after ${result.ticks} of ${maxTicks} ticks`).toBe(true);
      expect(result.distanceToGoal).toBeLessThanOrEqual(grid.cellSize * Math.SQRT2);
      expect(result.longestPushedRun).toBeLessThanOrEqual(5);
    });
  }
});

describe('replanning', () => {
  it('replans when the goal moves more than one cell, resetting age', () => {
    const state = soloMatch();
    const follower = createFollower();
    const w = walker(state);
    for (let i = 0; i < 10; i++) {
      step(state, [{ ...followPath(grid, follower, w, { x: 0, y: 9 }), aimX: 0, aimY: 0, buttons: 0 }]);
    }
    expect(follower.age).toBe(9);
    const before = follower.points;
    followPath(grid, follower, w, { x: -10, y: -8 });
    expect(follower.age).toBe(0);
    expect(follower.points).not.toBe(before);
    expect(follower.goal).toEqual({ x: -10, y: -8 });

    const result = walk(state, { x: -10, y: -8 }, 1200, follower);
    expect(result.arrived).toBe(true);
    expect(result.distanceToGoal).toBeLessThanOrEqual(grid.cellSize * Math.SQRT2);
  });

  it('does not replan before the interval for a goal that moved 0.3 m', () => {
    const state = soloMatch();
    const follower = createFollower();
    const w = walker(state);
    followPath(grid, follower, w, { x: 0, y: 9 });
    const planned = follower.points;
    for (let i = 1; i < REPLAN_INTERVAL; i++) {
      followPath(grid, follower, w, { x: 0.3, y: 9 });
      expect(follower.points).toBe(planned);
      expect(follower.age).toBe(i);
    }
    followPath(grid, follower, w, { x: 0.3, y: 9 });
    expect(follower.age).toBe(0);
    expect(follower.points).not.toBe(planned);
  });

  it('ignores a goal that moved far until the minimum age', () => {
    const follower = createFollower();
    const w = { x: -12, y: 2 };
    followPath(grid, follower, w, { x: 0, y: 9 });
    const planned = follower.points;
    for (let i = 1; i < REPLAN_MIN_AGE; i++) {
      followPath(grid, follower, w, { x: -10, y: -8 });
      expect(follower.points).toBe(planned);
    }
    followPath(grid, follower, w, { x: -10, y: -8 });
    expect(follower.points).not.toBe(planned);
    expect(follower.age).toBe(0);
  });

  it('never lets age exceed the interval', () => {
    const state = soloMatch();
    let maxAge = 0;
    const result = walk(state, { x: 12, y: -2 }, 400, createFollower(), (_tick, f) => {
      maxAge = Math.max(maxAge, f.age);
    });
    expect(result.ticks).toBeGreaterThan(REPLAN_INTERVAL);
    expect(maxAge).toBeLessThanOrEqual(REPLAN_INTERVAL);
  });

  it('replans when a displacement leaves the next point behind an obstacle, and still arrives', () => {
    const state = soloMatch();
    const w = walker(state);
    const goal = { x: 12, y: -2 };
    const follower = createFollower();
    walk(state, goal, 40, follower);
    expect(follower.age).toBeGreaterThanOrEqual(REPLAN_MIN_AGE);
    expect(follower.age).toBeLessThan(REPLAN_INTERVAL - 1);

    const next = follower.points[follower.index];
    if (!next) throw new Error('no next point');
    const candidates: Vec2[] = [];
    for (const dx of [-2, -1, 0, 1, 2]) {
      for (const dy of [-2, -1, 0, 1, 2]) candidates.push({ x: w.x + dx, y: w.y + dy });
    }
    const spot = candidates.find((p) => !pointBlocked(grid, p) && !segmentClear(grid, p, next));
    if (!spot) throw new Error('no displacement clips an obstacle');
    w.x = spot.x;
    w.y = spot.y;

    const planned = follower.points;
    followPath(grid, follower, w, goal);
    expect(follower.points).not.toBe(planned);
    expect(follower.age).toBe(0);

    const result = walk(state, goal, 1500, follower);
    expect(result.arrived).toBe(true);
    expect(result.distanceToGoal).toBeLessThanOrEqual(grid.cellSize * Math.SQRT2);
  });
});

describe('start and goal fallback', () => {
  const stuck = { x: 1.42, y: 1.42 };

  it('starts from a legal position inside a blocked cell', () => {
    const cell = cellIndexAt(grid, stuck);
    expect(cell).toBe(22 * grid.cols + 32);
    expect(grid.blocked[cell]).toBe(true);
    expect(pointBlocked(grid, stuck)).toBe(false);
  });

  it('nearestFreeCell equals a brute-force search', () => {
    expect(FALLBACK_RADIUS).toBe(4);
    const probes: Vec2[] = [stuck, { x: -1.42, y: 1.42 }, { x: 2.1, y: 0 }, { x: -12, y: 2 }];
    for (const p of probes) {
      expect(nearestFreeCell(grid, p), `${p.x},${p.y}`).toBe(
        bruteNearestFreeCell(grid, p, FALLBACK_RADIUS),
      );
    }
    expect(nearestFreeCell(grid, stuck, 1)).toBe(bruteNearestFreeCell(grid, stuck, 1));
  });

  it('walks out of a blocked start cell and arrives', () => {
    const state = soloMatch();
    const w = walker(state);
    w.x = stuck.x;
    w.y = stuck.y;
    const result = walk(state, { x: -12, y: 2 }, 1200);
    expect(result.arrived).toBe(true);
    expect(result.distanceToGoal).toBeLessThanOrEqual(grid.cellSize * Math.SQRT2);
    expect(result.finite).toBe(true);
  });

  it('finds nothing and does not move from inside an inflated obstacle', () => {
    const inside = { x: 0, y: 1.9 };
    expect(pointBlocked(grid, inside)).toBe(true);
    expect(nearestFreeCell(grid, inside)).toBe(-1);
    const follower = createFollower();
    expect(followPath(grid, follower, inside, { x: -12, y: 2 })).toEqual({ moveX: 0, moveY: 0 });
    expect(follower.points).toEqual([]);
    expect(follower.goal).toEqual({ x: -12, y: 2 });
  });

  it('ends near a goal whose cell is blocked', () => {
    const state = soloMatch();
    const goal = stuck;
    expect(grid.blocked[cellIndexAt(grid, goal)]).toBe(true);
    const result = walk(state, goal, 1200);
    expect(result.arrived).toBe(true);
    expect(result.distanceToGoal).toBeLessThanOrEqual(2);
  });

  it('gives no move and does not throw when the goal is sealed off', () => {
    const wall = (x: number, y: number, w: number, h: number) =>
      ({ type: 'rect', x, y, w, h, height: 1, blocksProjectiles: true }) as const;
    const sealed: ArenaDef = {
      ...arena01,
      obstacles: [wall(10, 2, 4, 0.5), wall(10, -2, 4, 0.5), wall(8, 0, 0.5, 4.5), wall(12, 0, 0.5, 4.5)],
    };
    const sealedGrid = buildNavGrid(sealed);
    const follower = createFollower();
    const goal = { x: 10, y: 0 };
    expect(grid.blocked[cellIndexAt(grid, goal)]).toBe(false);
    for (let i = 0; i < 70; i++) {
      expect(followPath(sealedGrid, follower, { x: -12, y: 2 }, goal)).toEqual({
        moveX: 0,
        moveY: 0,
      });
    }
    expect(follower.points).toEqual([]);
  });

  it('gives no move for non-finite inputs and never throws', () => {
    const follower = createFollower();
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const v of bad) {
      expect(followPath(grid, follower, { x: v, y: 2 }, { x: 0, y: 9 })).toEqual({
        moveX: 0,
        moveY: 0,
      });
      expect(followPath(grid, follower, { x: -12, y: 2 }, { x: 0, y: v })).toEqual({
        moveX: 0,
        moveY: 0,
      });
    }
    expect(nearestFreeCell(grid, { x: Number.NaN, y: 0 })).toBe(-1);
  });

  it('gives no move for a position or goal outside the arena', () => {
    const follower = createFollower();
    expect(followPath(grid, follower, { x: 50, y: 2 }, { x: 0, y: 9 })).toEqual({
      moveX: 0,
      moveY: 0,
    });
    expect(followPath(grid, createFollower(), { x: -12, y: 2 }, { x: 0, y: 90 })).toEqual({
      moveX: 0,
      moveY: 0,
    });
  });
});
