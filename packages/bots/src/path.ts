import { segmentClear } from './geometry';
import { cellCenter, cellCenterInto, cellIndexAt, isBlocked } from './grid';
import type { NavGrid, Vec2 } from './grid';

// Neighbour order E, N, W, S, NE, NW, SW, SE. It does not change the result: the open set's
// (f, h, cell) total order breaks every tie.
const NEIGHBOUR_COLS = new Int8Array([1, 0, -1, 0, 1, -1, -1, 1]);
const NEIGHBOUR_ROWS = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1]);

/**
 * What a plan search uses instead of allocating: the cost and parent tables, the closed set (a
 * cell is closed when its entry is the current generation, so a search clears nothing), the open
 * set as three arrays (f, h and cell of each entry), the path before and after string pulling, and
 * the two points of the edge test. There is one, shared by every bot and sized to the largest grid
 * seen, since a search never runs inside another. The entry to push and the cell popped travel in
 * fields, so no double crosses a call (V8 boxes one at a call it does not inline, 16 B).
 *
 * An open entry is pushed when a cell's cost improves, at most once per neighbour that closes
 * before it, so 8 entries a cell is the most a search can hold; one more throws.
 */
interface SearchScratch {
  /** The most cells a search over this scratch can hold. */
  cells: number;
  g: Float64Array;
  parent: Int32Array;
  closed: Uint32Array;
  generation: number;
  openF: Float64Array;
  openH: Float64Array;
  openCell: Int32Array;
  openSize: number;
  pushF: number;
  pushH: number;
  pushCell: number;
  popCell: number;
  raw: Int32Array;
  rawLength: number;
  pulled: Int32Array;
  pulledLength: number;
  a: Vec2;
  b: Vec2;
}

function createSearchScratch(cells: number): SearchScratch {
  return {
    cells,
    g: new Float64Array(cells),
    parent: new Int32Array(cells),
    closed: new Uint32Array(cells),
    generation: 0,
    openF: new Float64Array(8 * cells),
    openH: new Float64Array(8 * cells),
    openCell: new Int32Array(8 * cells),
    openSize: 0,
    pushF: 0.5,
    pushH: 0.5,
    pushCell: 0,
    popCell: 0,
    raw: new Int32Array(cells),
    rawLength: 0,
    pulled: new Int32Array(cells),
    pulledLength: 0,
    a: { x: 0.5, y: 0.5 },
    b: { x: 0.5, y: 0.5 },
  };
}

let scratch: SearchScratch = createSearchScratch(0);

/** The shared scratch, made again when `cells` is more than it holds (a larger arena). */
function scratchFor(cells: number): SearchScratch {
  if (scratch.cells < cells) scratch = createSearchScratch(cells);
  return scratch;
}

/** True when open slot `i` goes before slot `j` in the (f, h, cell) total order. */
function slotBefore(s: SearchScratch, i: number, j: number): boolean {
  const fi = s.openF[i] as number;
  const fj = s.openF[j] as number;
  if (fi !== fj) return fi < fj;
  const hi = s.openH[i] as number;
  const hj = s.openH[j] as number;
  if (hi !== hj) return hi < hj;
  return (s.openCell[i] as number) < (s.openCell[j] as number);
}

/**
 * Pushes the entry in `pushF`, `pushH` and `pushCell` into a binary min-heap with a total order, so
 * pop order never depends on insertion order.
 */
function openPush(s: SearchScratch): void {
  if (s.openSize >= s.openCell.length) throw new Error('plan search open set is full');
  const f = s.pushF;
  const h = s.pushH;
  const cell = s.pushCell;
  let i = s.openSize++;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const pf = s.openF[parent] as number;
    const ph = s.openH[parent] as number;
    const pc = s.openCell[parent] as number;
    if (!(f < pf || (f === pf && (h < ph || (h === ph && cell < pc))))) break;
    s.openF[i] = pf;
    s.openH[i] = ph;
    s.openCell[i] = pc;
    i = parent;
  }
  s.openF[i] = f;
  s.openH[i] = h;
  s.openCell[i] = cell;
}

/** Pops the first entry: its cell goes into `popCell`. False when the open set is empty. */
function openPop(s: SearchScratch): boolean {
  if (s.openSize === 0) return false;
  s.popCell = s.openCell[0] as number;
  const n = --s.openSize;
  if (n === 0) return true;
  // The last entry fills the hole at the top and sifts down.
  const f = s.openF[n] as number;
  const h = s.openH[n] as number;
  const cell = s.openCell[n] as number;
  let i = 0;
  for (;;) {
    const left = 2 * i + 1;
    if (left >= n) break;
    const right = left + 1;
    const child = right < n && slotBefore(s, right, left) ? right : left;
    const cf = s.openF[child] as number;
    const ch = s.openH[child] as number;
    const cc = s.openCell[child] as number;
    if (!(cf < f || (cf === f && (ch < h || (ch === h && cc < cell))))) break;
    s.openF[i] = cf;
    s.openH[i] = ch;
    s.openCell[i] = cc;
    i = child;
  }
  s.openF[i] = f;
  s.openH[i] = h;
  s.openCell[i] = cell;
  return true;
}

/** The octile distance from (col, row) to the goal cell, written into `pushH`. */
function heuristic(
  s: SearchScratch,
  col: number,
  row: number,
  goalCol: number,
  goalRow: number,
): void {
  const dx = Math.abs(col - goalCol);
  const dy = Math.abs(row - goalRow);
  s.pushH = dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * True when the supercover of the line between two cell centres holds only free cells and the
 * exact segment between the centres clears every inflated obstacle. A step through a grid
 * vertex needs both side cells free, which is the no-corner-cutting rule.
 */
export function lineOfWalk(grid: NavGrid, a: number, b: number): boolean {
  return walk(scratchFor(grid.cols * grid.rows), grid, a, b);
}

function walk(s: SearchScratch, grid: NavGrid, a: number, b: number): boolean {
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
  cellCenterInto(s.a, grid, a);
  cellCenterInto(s.b, grid, b);
  return segmentClear(grid, s.a, s.b);
}

function canStep(
  s: SearchScratch,
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
  cellCenterInto(s.a, grid, from);
  cellCenterInto(s.b, grid, nextRow * grid.cols + nextCol);
  return segmentClear(grid, s.a, s.b);
}

/** Searches from start to goal: the cells of the path go into `raw`, none when unreachable. */
function searchCells(s: SearchScratch, grid: NavGrid, start: number, goal: number): void {
  const cols = grid.cols;
  const total = cols * grid.rows;
  if (s.generation === 0xffffffff) {
    s.closed.fill(0);
    s.generation = 0;
  }
  const generation = ++s.generation;
  s.g.fill(Infinity, 0, total);
  s.parent.fill(-1, 0, total);
  s.openSize = 0;
  const goalCol = goal % cols;
  const goalRow = Math.floor(goal / cols);

  s.g[start] = 0;
  heuristic(s, start % cols, Math.floor(start / cols), goalCol, goalRow);
  s.pushF = s.pushH;
  s.pushCell = start;
  openPush(s);

  while (openPop(s)) {
    const cell = s.popCell;
    if (s.closed[cell] === generation) continue;
    s.closed[cell] = generation;
    if (cell === goal) break;

    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const cost = s.g[cell] as number;
    for (let n = 0; n < 8; n++) {
      const dc = NEIGHBOUR_COLS[n] as number;
      const dr = NEIGHBOUR_ROWS[n] as number;
      const nextCol = col + dc;
      const nextRow = row + dr;
      if (isBlocked(grid, nextCol, nextRow)) continue;
      const next = nextRow * cols + nextCol;
      if (s.closed[next] === generation) continue;
      if (!canStep(s, grid, cell, col, row, dc, dr)) continue;
      const nextCost = cost + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (nextCost < (s.g[next] as number)) {
        s.g[next] = nextCost;
        s.parent[next] = cell;
        heuristic(s, nextCol, nextRow, goalCol, goalRow);
        s.pushF = nextCost + s.pushH;
        s.pushCell = next;
        openPush(s);
      }
    }
  }

  s.rawLength = 0;
  if (s.closed[goal] !== generation) return;
  let length = 0;
  for (let cell = goal; cell !== -1; cell = s.parent[cell] as number) length++;
  s.rawLength = length;
  let at = length;
  for (let cell = goal; cell !== -1; cell = s.parent[cell] as number) s.raw[--at] = cell;
}

/** Greedy forward scan over `raw`: keep the farthest cell still in line of walk from the anchor. */
function pullString(s: SearchScratch, grid: NavGrid): void {
  const raw = s.raw;
  const length = s.rawLength;
  s.pulledLength = 0;
  if (length === 0) return;
  s.pulled[0] = raw[0] as number;
  let count = 1;
  let anchor = 0;
  while (anchor < length - 1) {
    let far = anchor + 1;
    const from = raw[anchor] as number;
    while (far + 1 < length && walk(s, grid, from, raw[far + 1] as number)) far++;
    s.pulled[count++] = raw[far] as number;
    anchor = far;
  }
  s.pulledLength = count;
}

/**
 * Waypoints from the start cell centre to the goal cell centre, or `[]` when the start or
 * goal is outside the grid, non-finite or blocked, or the goal is unreachable. The search runs on
 * shared scratch: what a call allocates is the waypoints it returns.
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] {
  const start = cellIndexAt(grid, from);
  const goal = cellIndexAt(grid, to);
  if (start < 0 || goal < 0) return [];
  if (grid.blocked[start] !== false || grid.blocked[goal] !== false) return [];
  if (start === goal) return [cellCenter(grid, goal)];
  const s = scratchFor(grid.cols * grid.rows);
  searchCells(s, grid, start, goal);
  pullString(s, grid);
  const path: Vec2[] = [];
  for (let i = 0; i < s.pulledLength; i++) path.push(cellCenter(grid, s.pulled[i] as number));
  return path;
}
