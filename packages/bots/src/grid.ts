import type { ArenaDef, Obstacle } from '@claudeline/sim';
import { pointBlocked } from './geometry';

/** A point in world metres. `ChampionState` satisfies it structurally. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Plain JSON-safe data. Row-major (`index = row * cols + col`), row 0 south, col 0 west.
 * The obstacles are copied so exact segment tests need no arena.
 */
export interface NavGrid {
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  blocked: readonly boolean[];
  obstacles: readonly Obstacle[];
}

export const NAV_CELL_SIZE = 0.5;

// The epsilon keeps float noise (0.3 * 3 / 0.3) from adding a whole extra cell.
function cellCount(extent: number, cellSize: number): number {
  return Math.ceil(extent / cellSize - 1e-9);
}

export function buildNavGrid(arena: ArenaDef, cellSize: number = NAV_CELL_SIZE): NavGrid {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(`cellSize must be a positive finite number, got ${cellSize}`);
  }
  const { width, height } = arena.size;
  const cols = cellCount(width, cellSize);
  const rows = cellCount(height, cellSize);
  const originX = -width / 2;
  const originY = -height / 2;
  const grid: NavGrid = {
    cols,
    rows,
    cellSize,
    originX,
    originY,
    width,
    height,
    blocked: [],
    obstacles: arena.obstacles.map((o) => ({ ...o })),
  };
  const blocked: boolean[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      blocked.push(
        pointBlocked(grid, {
          x: originX + (col + 0.5) * cellSize,
          y: originY + (row + 0.5) * cellSize,
        }),
      );
    }
  }
  return { ...grid, blocked };
}

/** The cell containing p, or -1 when p is non-finite or outside the grid. */
export function cellIndexAt(grid: NavGrid, p: Vec2): number {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return -1;
  const col = Math.floor((p.x - grid.originX) / grid.cellSize);
  const row = Math.floor((p.y - grid.originY) / grid.cellSize);
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return -1;
  return row * grid.cols + col;
}

export function cellCenter(grid: NavGrid, index: number): Vec2 {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return {
    x: grid.originX + (col + 0.5) * grid.cellSize,
    y: grid.originY + (row + 0.5) * grid.cellSize,
  };
}

/** True for a blocked cell and for any cell outside the grid. */
export function isBlocked(grid: NavGrid, col: number, row: number): boolean {
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return true;
  return grid.blocked[row * grid.cols + col] !== false;
}
