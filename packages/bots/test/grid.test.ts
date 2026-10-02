import { describe, expect, it } from 'vitest';
import { CHAMPION_RADIUS } from '@claudeline/sim';
import type { ArenaDef } from '@claudeline/sim';
import { NAV_CELL_SIZE, buildNavGrid, cellCenter, cellIndexAt, isBlocked } from '../src/grid';
import { arena01, clearanceAt, oracleBlocked } from './helpers';

const grid = buildNavGrid(arena01);

function centreOf(col: number, row: number) {
  return { x: -15 + (col + 0.5) * 0.5, y: -10 + (row + 0.5) * 0.5 };
}

describe('buildNavGrid on arena01', () => {
  it('covers the 30 x 20 arena with 60 x 40 cells of 0.5 m', () => {
    expect(NAV_CELL_SIZE).toBe(0.5);
    expect(grid.cols).toBe(60);
    expect(grid.rows).toBe(40);
    expect(grid.cellSize).toBe(0.5);
    expect(grid.originX).toBe(-15);
    expect(grid.originY).toBe(-10);
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(20);
    expect(grid.blocked).toHaveLength(60 * 40);
  });

  it('marks exactly the cells the oracle blocks at every cell centre', () => {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const c = centreOf(col, row);
        expect(grid.blocked[row * grid.cols + col], `cell ${col},${row}`).toBe(
          oracleBlocked(arena01, c.x, c.y),
        );
      }
    }
  });

  it('blocks every cell within the inflated central pillar', () => {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const c = centreOf(col, row);
        if (Math.hypot(c.x, c.y) < 1.5 + CHAMPION_RADIUS) {
          expect(isBlocked(grid, col, row), `cell ${col},${row}`).toBe(true);
        }
      }
    }
  });

  it('blocks every cell whose centre is inside a rectangle', () => {
    for (const o of arena01.obstacles) {
      if (o.type !== 'rect') continue;
      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
          const c = centreOf(col, row);
          if (Math.abs(c.x - o.x) < o.w / 2 && Math.abs(c.y - o.y) < o.h / 2) {
            expect(isBlocked(grid, col, row), `cell ${col},${row}`).toBe(true);
          }
        }
      }
    }
  });

  it('inflates the rectangles by the champion radius', () => {
    // The rect at (-6, 5), 3 x 1, blocks centres in x -8..-4, y 4..6: cols 14..21, rows 28..31.
    for (let row = 27; row <= 32; row++) {
      for (let col = 13; col <= 22; col++) {
        const inside = col >= 14 && col <= 21 && row >= 28 && row <= 31;
        expect(isBlocked(grid, col, row), `cell ${col},${row}`).toBe(inside);
      }
    }
    // The rect at (0, 7), 4 x 1: cols 25..34, rows 32..35.
    for (let row = 31; row <= 36; row++) {
      for (let col = 24; col <= 35; col++) {
        const inside = col >= 25 && col <= 34 && row >= 32 && row <= 35;
        expect(isBlocked(grid, col, row), `cell ${col},${row}`).toBe(inside);
      }
    }
  });

  it('blocks the one-cell boundary ring and nothing just inside it', () => {
    for (let col = 0; col < grid.cols; col++) {
      expect(isBlocked(grid, col, 0)).toBe(true);
      expect(isBlocked(grid, col, grid.rows - 1)).toBe(true);
    }
    for (let row = 0; row < grid.rows; row++) {
      expect(isBlocked(grid, 0, row)).toBe(true);
      expect(isBlocked(grid, grid.cols - 1, row)).toBe(true);
    }
    expect(isBlocked(grid, 1, 1)).toBe(false);
    expect(isBlocked(grid, grid.cols - 2, grid.rows - 2)).toBe(false);
  });

  it('keeps the cells next to the pillar on row 24 free', () => {
    // Row 24 is y = 2.25, just outside the 2.0 m inflated pillar.
    expect(isBlocked(grid, 29, 24)).toBe(false);
    expect(isBlocked(grid, 30, 24)).toBe(false);
    expect(isBlocked(grid, 29, 23)).toBe(true);
  });

  it('keeps all six spawn points in free cells', () => {
    const spawns = [...arena01.spawns.teamA, ...arena01.spawns.teamB];
    const expected: [number, number][] = [
      [6, 24],
      [6, 16],
      [6, 20],
      [54, 24],
      [54, 16],
      [54, 20],
    ];
    spawns.forEach(([x, y], i) => {
      const index = cellIndexAt(grid, { x, y });
      const [col, row] = expected[i] ?? [-1, -1];
      expect(index).toBe(row * 60 + col);
      expect(grid.blocked[index]).toBe(false);
    });
  });

  it('keeps at least 0.15 m of clearance at every free cell centre', () => {
    for (let index = 0; index < grid.blocked.length; index++) {
      if (grid.blocked[index]) continue;
      const c = cellCenter(grid, index);
      expect(clearanceAt(arena01, c.x, c.y)).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('is plain JSON data that carries a copy of the obstacles', () => {
    expect(JSON.parse(JSON.stringify(grid))).toEqual(grid);
    expect(grid.obstacles).toEqual(arena01.obstacles);
    expect(grid.obstacles).not.toBe(arena01.obstacles);
  });
});

describe('cell lookups', () => {
  it('maps points to cells by floor and back to centres', () => {
    expect(cellIndexAt(grid, { x: -15, y: -10 })).toBe(0);
    expect(cellIndexAt(grid, { x: -14.51, y: -9.51 })).toBe(0);
    expect(cellIndexAt(grid, { x: -14.5, y: -10 })).toBe(1);
    expect(cellIndexAt(grid, { x: 0, y: 0 })).toBe(20 * 60 + 30);
    expect(cellCenter(grid, 0)).toEqual({ x: -14.75, y: -9.75 });
    expect(cellCenter(grid, 20 * 60 + 30)).toEqual({ x: 0.25, y: 0.25 });
  });

  it('returns -1 outside the grid and for non-finite points', () => {
    expect(cellIndexAt(grid, { x: 15, y: 0 })).toBe(-1);
    expect(cellIndexAt(grid, { x: -15.01, y: 0 })).toBe(-1);
    expect(cellIndexAt(grid, { x: 0, y: 10 })).toBe(-1);
    expect(cellIndexAt(grid, { x: 0, y: -10.01 })).toBe(-1);
    expect(cellIndexAt(grid, { x: Number.NaN, y: 0 })).toBe(-1);
    expect(cellIndexAt(grid, { x: 0, y: Number.POSITIVE_INFINITY })).toBe(-1);
  });

  it('treats out of range cells as blocked', () => {
    expect(isBlocked(grid, -1, 5)).toBe(true);
    expect(isBlocked(grid, 5, -1)).toBe(true);
    expect(isBlocked(grid, 60, 5)).toBe(true);
    expect(isBlocked(grid, 5, 40)).toBe(true);
  });
});

describe('buildNavGrid arguments', () => {
  it('rounds dimensions up and tolerates float noise', () => {
    const arena: ArenaDef = { ...arena01, obstacles: [], size: { width: 30.2, height: 20 } };
    const g = buildNavGrid(arena, 0.5);
    expect(g.cols).toBe(61);
    expect(g.rows).toBe(40);
    expect(g.originX).toBe(-15.1);
    expect(buildNavGrid(arena01, 1).cols).toBe(30);
    expect(buildNavGrid({ ...arena01, size: { width: 0.3 * 3, height: 1 } }, 0.3).cols).toBe(3);
  });

  it('throws on a non-positive or non-finite cell size', () => {
    for (const bad of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildNavGrid(arena01, bad)).toThrow();
    }
  });
});
