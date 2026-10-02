import { segmentClear } from './geometry';
import { cellCenter, cellIndexAt, isBlocked } from './grid';
import type { NavGrid, Vec2 } from './grid';

// Neighbour order E, N, W, S, NE, NW, SW, SE. It does not change the result: the open set's
// (f, h, cell) total order breaks every tie.
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

interface OpenEntry {
  f: number;
  h: number;
  cell: number;
}

function before(a: OpenEntry, b: OpenEntry): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.cell < b.cell;
}

function entryAt(heap: OpenEntry[], i: number): OpenEntry {
  const entry = heap[i];
  if (entry === undefined) throw new Error(`heap index ${i} out of range`);
  return entry;
}

/** A binary min-heap with a total order, so pop order never depends on insertion order. */
class OpenSet {
  private readonly heap: OpenEntry[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(entry: OpenEntry): void {
    const heap = this.heap;
    let i = heap.length;
    heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentEntry = entryAt(heap, parent);
      if (!before(entry, parentEntry)) break;
      heap[i] = parentEntry;
      heap[parent] = entry;
      i = parent;
    }
  }

  pop(): OpenEntry | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined) return undefined;
    if (heap.length === 0) return top;
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && before(entryAt(heap, left), entryAt(heap, smallest))) {
        smallest = left;
      }
      if (right < heap.length && before(entryAt(heap, right), entryAt(heap, smallest))) {
        smallest = right;
      }
      if (smallest === i) break;
      const child = entryAt(heap, smallest);
      heap[smallest] = entryAt(heap, i);
      heap[i] = child;
      i = smallest;
    }
    return top;
  }
}

function octile(grid: NavGrid, a: number, b: number): number {
  const dx = Math.abs((a % grid.cols) - (b % grid.cols));
  const dy = Math.abs(Math.floor(a / grid.cols) - Math.floor(b / grid.cols));
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * True when the supercover of the line between two cell centres holds only free cells and the
 * exact segment between the centres clears every inflated obstacle. A step through a grid
 * vertex needs both side cells free, which is the no-corner-cutting rule.
 */
export function lineOfWalk(grid: NavGrid, a: number, b: number): boolean {
  const total = grid.cols * grid.rows;
  if (!(a >= 0 && a < total && b >= 0 && b < total)) return false;
  let col = a % grid.cols;
  let row = Math.floor(a / grid.cols);
  const dc = (b % grid.cols) - col;
  const dr = Math.floor(b / grid.cols) - row;
  const nx = Math.abs(dc);
  const ny = Math.abs(dr);
  const stepX = dc < 0 ? -1 : 1;
  const stepY = dr < 0 ? -1 : 1;
  if (isBlocked(grid, col, row)) return false;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      if (isBlocked(grid, col + stepX, row) || isBlocked(grid, col, row + stepY)) return false;
      col += stepX;
      row += stepY;
      ix++;
      iy++;
    } else if (decision < 0) {
      col += stepX;
      ix++;
    } else {
      row += stepY;
      iy++;
    }
    if (isBlocked(grid, col, row)) return false;
  }
  return segmentClear(grid, cellCenter(grid, a), cellCenter(grid, b));
}

function canStep(
  grid: NavGrid,
  from: number,
  col: number,
  row: number,
  dc: number,
  dr: number,
): boolean {
  const nextCol = col + dc;
  const nextRow = row + dr;
  if (dc !== 0 && dr !== 0 && (isBlocked(grid, nextCol, row) || isBlocked(grid, col, nextRow))) {
    return false;
  }
  const next = nextRow * grid.cols + nextCol;
  return segmentClear(grid, cellCenter(grid, from), cellCenter(grid, next));
}

/** The cells from start to goal, or an empty array when the goal is unreachable. */
function searchCells(grid: NavGrid, start: number, goal: number): number[] {
  const total = grid.cols * grid.rows;
  const g = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open = new OpenSet();

  g[start] = 0;
  const h0 = octile(grid, start, goal);
  open.push({ f: h0, h: h0, cell: start });

  for (let entry = open.pop(); entry !== undefined; entry = open.pop()) {
    const cell = entry.cell;
    if (closed[cell] === 1) continue;
    closed[cell] = 1;
    if (cell === goal) break;

    const col = cell % grid.cols;
    const row = Math.floor(cell / grid.cols);
    const cost = g[cell] ?? Infinity;
    for (const [dc, dr] of NEIGHBOURS) {
      const nextCol = col + dc;
      const nextRow = row + dr;
      if (isBlocked(grid, nextCol, nextRow)) continue;
      const next = nextRow * grid.cols + nextCol;
      if (closed[next] === 1) continue;
      if (!canStep(grid, cell, col, row, dc, dr)) continue;
      const nextCost = cost + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (nextCost < (g[next] ?? Infinity)) {
        g[next] = nextCost;
        parent[next] = cell;
        const h = octile(grid, next, goal);
        open.push({ f: nextCost + h, h, cell: next });
      }
    }
  }

  if (closed[goal] !== 1) return [];
  const cells: number[] = [];
  for (let cell = goal; cell !== -1; cell = parent[cell] ?? -1) cells.push(cell);
  return cells.reverse();
}

/** Greedy forward scan: keep the farthest cell still in line of walk from the anchor. */
function pullString(grid: NavGrid, raw: readonly number[]): number[] {
  const first = raw[0];
  if (first === undefined) return [];
  const out = [first];
  let anchor = 0;
  while (anchor < raw.length - 1) {
    let far = anchor + 1;
    const from = raw[anchor] ?? -1;
    while (far + 1 < raw.length && lineOfWalk(grid, from, raw[far + 1] ?? -1)) far++;
    out.push(raw[far] ?? -1);
    anchor = far;
  }
  return out;
}

/**
 * Waypoints from the start cell centre to the goal cell centre, or `[]` when the start or
 * goal is outside the grid, non-finite or blocked, or the goal is unreachable.
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] {
  const start = cellIndexAt(grid, from);
  const goal = cellIndexAt(grid, to);
  if (start < 0 || goal < 0) return [];
  if (grid.blocked[start] !== false || grid.blocked[goal] !== false) return [];
  if (start === goal) return [cellCenter(grid, goal)];
  const raw = searchCells(grid, start, goal);
  return pullString(grid, raw).map((cell) => cellCenter(grid, cell));
}
