import type { ArenaDef, CircleObstacle, Obstacle, RectObstacle } from '@claudeline/sim';
import { obstacleShapes, pointBlocked } from './geometry';

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
  /** The obstacles as numbers for `segmentClear`, see `obstacleShapes` in geometry.ts. */
  shapes: readonly number[];
}

export const NAV_CELL_SIZE = 0.5;

/**
 * A copy of an obstacle whose number fields are all double fields. A literal that starts with
 * 0.5 makes them so, and the assignments after it write in place; `{ ...o }` would give a circle
 * of radius 1 and one of radius 1.5 two representations of `r`, and V8 boxes the double it loads
 * from one of them on every read (16 B, measured), which the think path reads a lot.
 */
function copyObstacle(o: Obstacle): Obstacle {
  if (o.type === 'circle') {
    const c: CircleObstacle = {
      type: 'circle',
      x: 0.5,
      y: 0.5,
      r: 0.5,
      height: 0.5,
      blocksProjectiles: o.blocksProjectiles,
    };
    c.x = o.x;
    c.y = o.y;
    c.r = o.r;
    c.height = o.height;
    return c;
  }
  const r: RectObstacle = {
    type: 'rect',
    x: 0.5,
    y: 0.5,
    w: 0.5,
    h: 0.5,
    height: 0.5,
    blocksProjectiles: o.blocksProjectiles,
  };
  r.x = o.x;
  r.y = o.y;
  r.w = o.w;
  r.h = o.h;
  r.height = o.height;
  return r;
}

// The epsilon keeps float noise (0.1 * 3 / 0.1) from adding a whole extra cell.
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
    obstacles: arena.obstacles.map(copyObstacle),
    shapes: [],
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
  return { ...grid, blocked, shapes: obstacleShapes(grid.obstacles) };
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
  const out: Vec2 = { x: 0, y: 0 };
  cellCenterInto(out, grid, index);
  return out;
}

/** `cellCenter` written into `out`, for the think path. */
export function cellCenterInto(out: Vec2, grid: NavGrid, index: number): void {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  out.x = grid.originX + (col + 0.5) * grid.cellSize;
  out.y = grid.originY + (row + 0.5) * grid.cellSize;
}

/** True for a blocked cell and for any cell outside the grid. */
export function isBlocked(grid: NavGrid, col: number, row: number): boolean {
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return true;
  return grid.blocked[row * grid.cols + col] !== false;
}
