import { describe, expect, it } from 'vitest';
import type { ArenaDef, Obstacle } from '@claudeline/sim';
import { buildNavGrid, cellCenter, cellIndexAt } from '../src/grid';
import type { NavGrid } from '../src/grid';
import { findPath, lineOfWalk } from '../src/path';
import { arena01, oracleBlocked, oracleSegmentViolates } from './helpers';

const grid = buildNavGrid(arena01);

const A1 = { x: -12, y: 2 };
const B1 = { x: 12, y: 2 };

function rect(x: number, y: number, w: number, h: number): Obstacle {
  return { type: 'rect', x, y, w, h, height: 1, blocksProjectiles: true };
}

function arenaWith(obstacles: Obstacle[]): ArenaDef {
  return { ...arena01, obstacles };
}

function expectClearRoute(arena: ArenaDef, path: { x: number; y: number }[]) {
  for (const p of path) expect(oracleBlocked(arena, p.x, p.y)).toBe(false);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b) expect(oracleSegmentViolates(arena, a, b), `segment ${i}`).toBe(false);
  }
}

/** A hand-built open grid with explicit blocked cells, cells of 1 m. */
function handGrid(cols: number, rows: number, blockedCells: [number, number][]): NavGrid {
  const blocked = Array.from({ length: cols * rows }, () => false);
  for (const [col, row] of blockedCells) blocked[row * cols + col] = true;
  return {
    cols,
    rows,
    cellSize: 1,
    originX: -cols / 2,
    originY: -rows / 2,
    width: cols,
    height: rows,
    blocked,
    obstacles: [],
  };
}

describe('findPath on arena01', () => {
  it('collapses team A first spawn to team B first spawn into one straight walk', () => {
    expect(findPath(grid, A1, B1)).toEqual([
      { x: -11.75, y: 2.25 },
      { x: 12.25, y: 2.25 },
    ]);
  });

  it('keeps every waypoint and segment of every spawn to spawn route clear of obstacles', () => {
    for (const [ax, ay] of arena01.spawns.teamA) {
      for (const [bx, by] of arena01.spawns.teamB) {
        const path = findPath(grid, { x: ax, y: ay }, { x: bx, y: by });
        expect(path.length, `${ax},${ay} to ${bx},${by}`).toBeGreaterThanOrEqual(2);
        expectClearRoute(arena01, path);
      }
    }
  });

  it('routes around the rectangle between two points either side of it', () => {
    const path = findPath(grid, { x: 0.25, y: 9.25 }, { x: 0.25, y: 5.25 });
    expect(path.length).toBeGreaterThanOrEqual(3);
    expectClearRoute(arena01, path);
    expect(path[0]).toEqual({ x: 0.25, y: 9.25 });
    expect(path[path.length - 1]).toEqual({ x: 0.25, y: 5.25 });
  });

  it('is identical on repeated runs and on separately built grids', () => {
    const route = [
      [A1, B1],
      [
        { x: 0.25, y: 9.25 },
        { x: 0.25, y: 5.25 },
      ],
      [
        { x: -12, y: -2 },
        { x: 3, y: 8.5 },
      ],
    ] as const;
    const other = buildNavGrid(arena01);
    for (const [from, to] of route) {
      const first = findPath(grid, from, to);
      expect(findPath(grid, from, to)).toEqual(first);
      expect(findPath(other, from, to)).toEqual(first);
    }
  });

  it('returns fresh waypoint objects that are cell centres', () => {
    const path = findPath(grid, A1, B1);
    const again = findPath(grid, A1, B1);
    expect(path[0]).not.toBe(again[0]);
    for (const p of path) expect(cellCenter(grid, cellIndexAt(grid, p))).toEqual(p);
  });

  it('returns only the goal cell centre when start and goal share a cell', () => {
    expect(findPath(grid, { x: -12, y: 2 }, { x: -11.9, y: 2.1 })).toEqual([
      { x: -11.75, y: 2.25 },
    ]);
  });
});

describe('findPath with no route', () => {
  it('returns an empty path for goals inside an inflated obstacle', () => {
    for (const goal of [
      { x: 0, y: 0 },
      { x: -8, y: 0 },
      { x: 0, y: 1.9 },
    ]) {
      expect(findPath(grid, A1, goal)).toEqual([]);
    }
  });

  it('returns an empty path for goals outside the arena or not a number', () => {
    for (const goal of [
      { x: 20, y: 0 },
      { x: 15, y: 0 },
      { x: 0, y: -10.5 },
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
    ]) {
      expect(findPath(grid, A1, goal)).toEqual([]);
    }
  });

  it('returns an empty path for goals in the boundary ring', () => {
    expect(findPath(grid, A1, { x: -14.9, y: 0 })).toEqual([]);
  });

  it('returns an empty path for a blocked or outside start', () => {
    expect(findPath(grid, { x: 0, y: 0 }, B1)).toEqual([]);
    expect(findPath(grid, { x: -30, y: 0 }, B1)).toEqual([]);
    expect(findPath(grid, { x: Number.NaN, y: 0 }, B1)).toEqual([]);
  });

  it('returns an empty path when the goal is sealed in by walls', () => {
    const arena = arenaWith([
      rect(10, 7, 6, 1),
      rect(10, 3, 6, 1),
      rect(7, 5, 1, 5),
      rect(13, 5, 1, 5),
    ]);
    const sealed = buildNavGrid(arena);
    const inside = { x: 10, y: 5 };
    expect(sealed.blocked[cellIndexAt(sealed, inside)]).toBe(false);
    expect(findPath(sealed, A1, inside)).toEqual([]);
    expect(findPath(sealed, inside, A1)).toEqual([]);
    expect(findPath(sealed, A1, { x: 12, y: -2 }).length).toBeGreaterThan(0);
  });
});

describe('findPath corner rule', () => {
  it('does not cut between two blocked orthogonal cells', () => {
    const g = handGrid(3, 3, [
      [1, 0],
      [0, 1],
    ]);
    expect(findPath(g, { x: -1, y: -1 }, { x: 0, y: 0 })).toEqual([]);
  });

  it('does not cut a corner past a single blocked cell', () => {
    const g = handGrid(3, 3, [[1, 0]]);
    expect(findPath(g, { x: -1, y: -1 }, { x: 0, y: 0 })).toEqual([
      { x: -1, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});

describe('string pulling and the line of walk', () => {
  it('collapses an obstacle free arena into two waypoints', () => {
    const open = buildNavGrid(arenaWith([]));
    expect(findPath(open, { x: -12, y: 2 }, { x: 12, y: -8 })).toHaveLength(2);
    expect(findPath(open, { x: -12, y: 2 }, { x: 9, y: 2 })).toHaveLength(2);
    expect(findPath(open, { x: -12, y: -8 }, { x: 12, y: 8 })).toHaveLength(2);
  });

  it('lets every segment of a detour pass the line of walk', () => {
    const path = findPath(grid, { x: 0.25, y: 9.25 }, { x: 0.25, y: 5.25 });
    expect(path.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (!a || !b) throw new Error('missing waypoint');
      expect(lineOfWalk(grid, cellIndexAt(grid, a), cellIndexAt(grid, b)), `segment ${i}`).toBe(
        true,
      );
    }
  });

  it('refuses a line through an obstacle and a diagonal between two blocked cells', () => {
    const across = [cellIndexAt(grid, { x: 0.25, y: 9.25 }), cellIndexAt(grid, { x: 0.25, y: 5.25 })];
    expect(lineOfWalk(grid, across[0] ?? -1, across[1] ?? -1)).toBe(false);
    const g = handGrid(3, 3, [
      [1, 0],
      [0, 1],
    ]);
    expect(lineOfWalk(g, 0, 4)).toBe(false);
    expect(lineOfWalk(handGrid(3, 3, []), 0, 8)).toBe(true);
  });

  it('only accepts lines the oracle also finds clear', () => {
    const free: number[] = [];
    grid.blocked.forEach((isBlocked, index) => {
      if (!isBlocked) free.push(index);
    });
    let accepted = 0;
    for (let i = 0; i < free.length; i += 23) {
      for (let j = 0; j < free.length; j += 29) {
        const a = free[i] ?? -1;
        const b = free[j] ?? -1;
        if (!lineOfWalk(grid, a, b)) continue;
        accepted++;
        expect(oracleSegmentViolates(arena01, cellCenter(grid, a), cellCenter(grid, b))).toBe(
          false,
        );
      }
    }
    expect(accepted).toBeGreaterThan(100);
  });
});

describe('chords between free cells', () => {
  // A small circle on a grid vertex leaves all four cells around it free, yet the diagonal
  // between two of them runs straight through the inflated circle.
  const arena: ArenaDef = {
    ...arena01,
    size: { width: 6, height: 6 },
    obstacles: [{ type: 'circle', x: 0, y: 0, r: 0.1, height: 1, blocksProjectiles: true }],
  };
  const small = buildNavGrid(arena, 1);
  const sw = { x: -0.5, y: -0.5 };
  const ne = { x: 0.5, y: 0.5 };

  it('refuses a line of walk that clips an inflated obstacle although every cell is free', () => {
    const a = cellIndexAt(small, sw);
    const b = cellIndexAt(small, ne);
    for (const point of [sw, ne, { x: 0.5, y: -0.5 }, { x: -0.5, y: 0.5 }]) {
      expect(small.blocked[cellIndexAt(small, point)]).toBe(false);
    }
    expect(lineOfWalk(small, a, b)).toBe(false);
  });

  it('plans around the clipped diagonal', () => {
    const path = findPath(small, sw, ne);
    expect(path.length).toBeGreaterThanOrEqual(3);
    expectClearRoute(arena, path);
  });
});
