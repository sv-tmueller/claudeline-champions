import { describe, expect, it } from 'vitest';
import { createMatch, hasLineOfSight } from '@claudeline/sim';
import type { ArenaDef, GameState } from '@claudeline/sim';
import { buildNavGrid, cellCenter, cellIndexAt } from '../src/grid';
import type { NavGrid, Vec2 } from '../src/grid';
import { SIGHT_CLEARANCE, SIGHT_RADIUS, clearShot, nearestSightCell } from '../src/sight';
import { arena01, clearShotOracle, config2v2 } from './helpers';

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
  clearance: number = 0.5,
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
    if (!clearShotOracle(state, c, target, clearance)) continue;
    const distance = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

describe('clearShot', () => {
  // The pillar of arena01 is a circle of radius 1.5 at the origin. A level line at height h
  // clears its centre line when h > 1.5, and a line shifted by c toward it when h - c > 1.5.
  const state = stateOf(arena01);

  it('pins the sight clearance at the champion radius, 0.5 m', () => {
    expect(SIGHT_CLEARANCE).toBe(0.5);
  });

  it('is a line of sight when the clearance is 0', () => {
    for (const h of [0, 1, 1.4, 1.6, 2, 5]) {
      const from = { x: -4, y: h };
      const to = { x: 4, y: h };
      expect(clearShot(state, from, to, 0), `h ${h}`).toBe(hasLineOfSight(state, from, to));
    }
  });

  it('fails on a shadow edge where the centre line clears the pillar and a shifted line hits it', () => {
    const from = { x: -4, y: 1.6 };
    const to = { x: 4, y: 1.6 };
    expect(hasLineOfSight(state, from, to)).toBe(true);
    expect(clearShot(state, from, to, 0.25)).toBe(false);
    expect(clearShot(state, from, to, 0.05)).toBe(true);
    expect(clearShot(state, from, to, 0.5)).toBe(false);
  });

  it('checks both sides: the pillar below the line fails it as the one above does', () => {
    expect(clearShot(state, { x: -4, y: -1.6 }, { x: 4, y: -1.6 }, 0.25)).toBe(false);
    expect(clearShot(state, { x: 4, y: 1.6 }, { x: -4, y: 1.6 }, 0.25)).toBe(false);
    expect(clearShot(state, { x: -4, y: 1.8 }, { x: 4, y: 1.8 }, 0.25)).toBe(true);
    expect(clearShot(state, { x: -4, y: -1.8 }, { x: 4, y: -1.8 }, 0.25)).toBe(true);
  });

  it('fails a shot behind the pillar and passes one in the open', () => {
    expect(clearShot(state, { x: -4, y: 0 }, { x: 4, y: 0 }, 0.25)).toBe(false);
    expect(clearShot(state, { x: -4, y: 4 }, { x: 4, y: 4 }, 0.25)).toBe(true);
  });

  it('ignores obstacles that do not block projectiles', () => {
    // The low rectangle at (-6, 5) does not block projectiles.
    expect(clearShot(state, { x: -9, y: 5 }, { x: -3, y: 5 }, 0.5)).toBe(true);
  });

  it('agrees with the oracle on a grid of positions and handles a zero-length shot', () => {
    for (let x = -6; x <= 6; x += 1.5) {
      for (let y = -6; y <= 6; y += 1.5) {
        const from = { x, y };
        const to = { x: 5, y: -2 };
        expect(clearShot(state, from, to, 0.3), `${x}, ${y}`).toBe(clearShotOracle(state, from, to, 0.3));
      }
    }
    expect(clearShot(state, { x: 3, y: 3 }, { x: 3, y: 3 }, 0.5)).toBe(true);
  });
});

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

  it('does not settle on a shadow edge: the cell it returns has a clear shot, not only a line of sight', () => {
    const state = stateOf(arena01);
    const grid = buildNavGrid(arena01);
    const target = { x: 4.25, y: 1.75 };
    let differs = 0;
    for (let x = -9; x <= -3; x += 0.5) {
      for (const y of [-1, 0, 1, 2, 3, 4]) {
        const p = { x, y };
        const cell = nearestSightCell(grid, state, p, target, 6, 13);
        if (cell >= 0) {
          expect(clearShotOracle(state, cellCenter(grid, cell), target, 0.5), `${x}, ${y}`).toBe(true);
        }
        // The nearest cell with a bare line of sight, the old rule.
        const plain = bruteForce(grid, state, p, target, 6, 13, SIGHT_RADIUS, 0);
        if (plain !== cell) differs++;
      }
    }
    expect(differs).toBeGreaterThan(0);
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
