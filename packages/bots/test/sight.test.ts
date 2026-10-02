import { describe, expect, it } from 'vitest';
import { createMatch, hasLineOfSight } from '@claudeline/sim';
import type { ArenaDef, GameState } from '@claudeline/sim';
import { buildNavGrid, cellCenter, cellIndexAt } from '../src/grid';
import type { NavGrid, Vec2 } from '../src/grid';
import { SIGHT_RADIUS, nearestSightCell } from '../src/sight';
import { arena01, config2v2 } from './helpers';

const open: ArenaDef = { ...arena01, id: 'open', obstacles: [] };
const wide: ArenaDef = { ...open, id: 'wide', size: { width: 50, height: 20 } };

function stateOf(arena: ArenaDef): GameState {
  return createMatch(config2v2(), arena, 1);
}

/** The documented filters and order, written as a scan over every cell of the grid. */
function bruteForce(
  grid: NavGrid,
  state: GameState,
  p: Vec2,
  target: Vec2,
  rangeMin: number,
  rangeMax: number,
  radius: number,
): number {
  const home = cellIndexAt(grid, p);
  if (home < 0) return -1;
  const homeCol = home % grid.cols;
  const homeRow = Math.floor(home / grid.cols);
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    if (Math.abs(col - homeCol) > radius || Math.abs(row - homeRow) > radius) continue;
    if (i === home || grid.blocked[i] !== false) continue;
    const c = cellCenter(grid, i);
    const d = Math.hypot(c.x - target.x, c.y - target.y);
    if (d < rangeMin || d > rangeMax) continue;
    if (!hasLineOfSight(state, c, target)) continue;
    const distance = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

describe('nearestSightCell', () => {
  it('pins the search radius at 8 cells', () => {
    expect(SIGHT_RADIUS).toBe(8);
    const state = stateOf(wide);
    const grid = buildNavGrid(wide);
    const home = cellIndexAt(grid, { x: -10.25, y: 0.25 });
    const p = cellCenter(grid, home);
    const target = { x: p.x + 20, y: p.y };

    // Only cells exactly 8 columns east (and a few rows off them) sit 16 m from the target.
    const eight = nearestSightCell(grid, state, p, target, 15.95, 16.05);
    expect(eight).toBeGreaterThanOrEqual(0);
    expect(cellCenter(grid, eight)).toEqual({ x: p.x + 8 * grid.cellSize, y: p.y });

    // Only cells 9 columns east sit 15.5 m from the target: one column past the radius.
    expect(nearestSightCell(grid, state, p, target, 15.45, 15.55)).toBe(-1);
    const nine = nearestSightCell(grid, state, p, target, 15.45, 15.55, 9);
    expect(cellCenter(grid, nine)).toEqual({ x: p.x + 9 * grid.cellSize, y: p.y });
  });

  it('agrees with a brute-force scan over every cell on arena01', () => {
    const state = stateOf(arena01);
    const grid = buildNavGrid(arena01);
    const target = { x: 4, y: 0 };
    let positions = 0;
    let found = 0;
    const extra: Vec2[] = [
      { x: -3, y: 0 },
      { x: -3.25, y: 0.25 },
    ];
    const lattice: Vec2[] = [];
    for (let x = -10; x <= 2; x += 0.25) {
      for (const y of [-3, 0, 3]) lattice.push({ x, y });
    }
    for (const p of [...extra, ...lattice]) {
      const expected = bruteForce(grid, state, p, target, 6, 13, SIGHT_RADIUS);
      expect(nearestSightCell(grid, state, p, target, 6, 13), `${p.x}, ${p.y}`).toBe(expected);
      positions++;
      if (expected >= 0) found++;
    }
    expect(positions).toBeGreaterThanOrEqual(20);
    expect(found).toBeGreaterThan(10);
    expect(found).toBeLessThan(positions);
  });

  it('agrees with a brute-force scan at the west and east edges, where the column window is clamped', () => {
    const state = stateOf(arena01);
    const grid = buildNavGrid(arena01);
    let positions = 0;
    for (const [x, target] of [
      [-14.25, { x: 4, y: 0 }],
      [14.25, { x: -4, y: 0 }],
    ] as const) {
      for (const y of [-6, -3, 3, 6, 8]) {
        const p = { x, y };
        const expected = bruteForce(grid, state, p, target, 6, 13, SIGHT_RADIUS);
        expect(nearestSightCell(grid, state, p, target, 6, 13), `${p.x}, ${p.y}`).toBe(expected);
        positions++;
      }
    }
    expect(positions).toBe(10);
  });

  it('keeps a cell exactly at both ends of the band: rangeMin 16 and rangeMax 16 find the cell 16 m away', () => {
    const state = stateOf(wide);
    const grid = buildNavGrid(wide);
    const p = cellCenter(grid, cellIndexAt(grid, { x: -10.25, y: 0.25 }));
    const target = { x: p.x + 20, y: p.y };
    const cell = nearestSightCell(grid, state, p, target, 16, 16);
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(cellCenter(grid, cell)).toEqual({ x: p.x + 4, y: p.y });
    expect(Math.hypot(p.x + 4 - target.x, p.y - target.y)).toBe(16);
  });

  it('keeps only cells inside the distance band', () => {
    const state = stateOf(open);
    const grid = buildNavGrid(open);
    const p = { x: 0.25, y: 0.25 };
    const target = { x: 7.25, y: 0.25 };
    const dist = (c: Vec2) => Math.hypot(c.x - target.x, c.y - target.y);
    const unfiltered = nearestSightCell(grid, state, p, target, 0, Infinity);
    expect(unfiltered).toBeGreaterThanOrEqual(0);

    const far = nearestSightCell(grid, state, p, target, 7.4, 13);
    expect(far).toBeGreaterThanOrEqual(0);
    expect(far).not.toBe(unfiltered);
    expect(dist(cellCenter(grid, far))).toBeGreaterThanOrEqual(7.4);

    const near = nearestSightCell(grid, state, p, target, 1, 6.6);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(near).not.toBe(unfiltered);
    expect(dist(cellCenter(grid, near))).toBeLessThanOrEqual(6.6);
  });

  it('never returns the cell the bot stands in, even when its centre sees the target', () => {
    const state = stateOf(arena01);
    const grid = buildNavGrid(arena01);
    const target = { x: 4, y: 0 };
    let found: Vec2 | undefined;
    for (let x = -9; x <= -2 && found === undefined; x += 0.05) {
      for (let y = -4; y <= 4 && found === undefined; y += 0.05) {
        const p = { x, y };
        const home = cellIndexAt(grid, p);
        const c = cellCenter(grid, home);
        const d = Math.hypot(c.x - target.x, c.y - target.y);
        if (grid.blocked[home] === false && d >= 6 && d <= 13) {
          if (!hasLineOfSight(state, p, target) && hasLineOfSight(state, c, target)) found = p;
        }
      }
    }
    if (found === undefined) throw new Error('no position without line of sight beside a lit centre');
    const home = cellIndexAt(grid, found);
    expect(hasLineOfSight(state, found, target)).toBe(false);
    expect(hasLineOfSight(state, cellCenter(grid, home), target)).toBe(true);
    const cell = nearestSightCell(grid, state, found, target, 6, 13);
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(cell).not.toBe(home);
    expect(hasLineOfSight(state, cellCenter(grid, cell), target)).toBe(true);
  });

  it('returns -1 for a position off the grid or not finite, without throwing', () => {
    const state = stateOf(arena01);
    const grid = buildNavGrid(arena01);
    const target = { x: 4, y: 0 };
    for (const p of [
      { x: 100, y: 0 },
      { x: 0, y: -100 },
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 1 },
    ]) {
      expect(() => nearestSightCell(grid, state, p, target, 6, 13), `${p.x}, ${p.y}`).not.toThrow();
      expect(nearestSightCell(grid, state, p, target, 6, 13), `${p.x}, ${p.y}`).toBe(-1);
    }
  });
});
