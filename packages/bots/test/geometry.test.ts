import { describe, expect, it } from 'vitest';
import { CHAMPION_RADIUS } from '@claudeline/sim';
import type { ArenaDef, Obstacle, RectObstacle } from '@claudeline/sim';
import { segmentClear } from '../src/geometry';
import { buildNavGrid } from '../src/grid';
import type { NavGrid, Vec2 } from '../src/grid';
import { createRng } from '../src/rng';
import { arena01, clearanceAt } from './helpers';

// `segmentClear` was rewritten to allocate nothing (numbers from `grid.shapes`, locals, one
// distance call site). This file is the proof that it still gives the answers it gave: the
// implementation from before the rewrite, copied below verbatim, and the oracle of the tests,
// which samples the clearance along the segment and shares no code with either.

function referenceDistanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function referenceDistanceToBox(p: Vec2, o: RectObstacle): number {
  const gapX = Math.max(Math.abs(p.x - o.x) - o.w / 2, 0);
  const gapY = Math.max(Math.abs(p.y - o.y) - o.h / 2, 0);
  return Math.hypot(gapX, gapY);
}

function referenceSegmentHitsBox(a: Vec2, b: Vec2, o: RectObstacle): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, o.x - o.w / 2, o.x + o.w / 2],
    [a.y, b.y - a.y, o.y - o.h / 2, o.y + o.h / 2],
  ];
  for (const [start, delta, min, max] of axes) {
    if (delta === 0) {
      if (start < min || start > max) return false;
      continue;
    }
    const ta = (min - start) / delta;
    const tb = (max - start) / delta;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return false;
  }
  return true;
}

function referenceDistanceSegmentToBox(a: Vec2, b: Vec2, o: RectObstacle): number {
  if (referenceSegmentHitsBox(a, b, o)) return 0;
  let best = Math.min(referenceDistanceToBox(a, o), referenceDistanceToBox(b, o));
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const corner = { x: o.x + (sx * o.w) / 2, y: o.y + (sy * o.h) / 2 };
      best = Math.min(best, referenceDistanceToSegment(corner, a, b));
    }
  }
  return best;
}

function referenceSegmentClear(grid: NavGrid, p: Vec2, q: Vec2): boolean {
  const limitX = grid.width / 2 - CHAMPION_RADIUS;
  const limitY = grid.height / 2 - CHAMPION_RADIUS;
  for (const e of [p, q]) {
    if (!(e.x >= -limitX && e.x <= limitX && e.y >= -limitY && e.y <= limitY)) return false;
  }
  for (const o of grid.obstacles) {
    if (o.type === 'circle') {
      if (referenceDistanceToSegment(o, p, q) < o.r + CHAMPION_RADIUS) return false;
    } else if (referenceDistanceSegmentToBox(p, q, o) < CHAMPION_RADIUS) {
      return false;
    }
  }
  return true;
}

const mixed: ArenaDef = {
  ...arena01,
  id: 'mixed',
  size: { width: 25.5, height: 17.25 },
  obstacles: [
    { type: 'circle', x: 1.3, y: 0.7, r: 1.1, height: 2, blocksProjectiles: true },
    { type: 'rect', x: -4.5, y: 2.25, w: 3.5, h: 1.25, height: 2, blocksProjectiles: true },
    { type: 'rect', x: 4, y: -2.5, w: 1, h: 4.5, height: 2, blocksProjectiles: false },
    { type: 'circle', x: -3, y: -3.5, r: 0.55, height: 2, blocksProjectiles: false },
    { type: 'rect', x: 0.5, y: -5, w: 6, h: 0.5, height: 2, blocksProjectiles: true },
  ],
};

function randomPoint(rng: { next(): number }, arena: ArenaDef): Vec2 {
  const { width, height } = arena.size;
  return { x: (rng.next() - 0.5) * (width + 1), y: (rng.next() - 0.5) * (height + 1) };
}

describe('segmentClear', () => {
  it('gives the answer the implementation before the rewrite gave, on random segments', () => {
    const rng = createRng(31);
    let clear = 0;
    let blocked = 0;
    for (const arena of [arena01, mixed]) {
      const grid = buildNavGrid(arena);
      for (let i = 0; i < 40000; i++) {
        // Half the segments are short, so near misses of a corner or an edge are common.
        const p = randomPoint(rng, arena);
        const q =
          i % 2 === 0
            ? randomPoint(rng, arena)
            : { x: p.x + (rng.next() - 0.5) * 3, y: p.y + (rng.next() - 0.5) * 3 };
        const expected = referenceSegmentClear(grid, p, q);
        if (segmentClear(grid, p, q) !== expected) {
          expect(segmentClear(grid, p, q), `${arena.id}: (${p.x}, ${p.y}) to (${q.x}, ${q.y})`).toBe(
            expected,
          );
        }
        if (expected) clear++;
        else blocked++;
      }
    }
    // Both answers are common, so a function that always said yes or no would fail.
    expect(clear).toBeGreaterThan(10000);
    expect(blocked).toBeGreaterThan(10000);
  });

  it('gives the answer the implementation before the rewrite gave, on touching segments', () => {
    const grid = buildNavGrid(arena01);
    // The inflated pillar reaches 2 m from the origin, the inflated box at (-8, 0) reaches
    // x = -8.5 - 0.5 and y = 1.5 + 0.5.
    const cases: [Vec2, Vec2][] = [
      [{ x: -5, y: 2 }, { x: 5, y: 2 }],
      [{ x: -5, y: -2 }, { x: 5, y: -2 }],
      [{ x: -2, y: -5 }, { x: -2, y: 5 }],
      [{ x: 2, y: -5 }, { x: 2, y: 5 }],
      [{ x: -10, y: 2 }, { x: -6, y: 2 }],
      [{ x: -9, y: -3 }, { x: -9, y: 3 }],
      [{ x: -7, y: -3 }, { x: -7, y: 3 }],
      [{ x: 1, y: 1 }, { x: 1, y: 1 }],
      [{ x: -2, y: 0 }, { x: -2, y: 0 }],
      [{ x: -14.5, y: 9.5 }, { x: 14.5, y: 9.5 }],
      [{ x: -14.5, y: 9.5 }, { x: 14.5, y: 9.6 }],
    ];
    for (const [p, q] of cases) {
      expect(segmentClear(grid, p, q), `(${p.x}, ${p.y}) to (${q.x}, ${q.y})`).toBe(
        referenceSegmentClear(grid, p, q),
      );
    }
  });

  it('agrees with the sampled clearance oracle away from the boundary of the rule', () => {
    const rng = createRng(77);
    const grid = buildNavGrid(arena01);
    let checked = 0;
    for (let i = 0; i < 8000; i++) {
      const p = randomPoint(rng, arena01);
      const q = { x: p.x + (rng.next() - 0.5) * 4, y: p.y + (rng.next() - 0.5) * 4 };
      // The least clearance along the segment, sampled every 0.01 m; the clearance changes by at
      // most the step, so a segment within 0.02 m of touching is left out.
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const samples = Math.max(1, Math.ceil(length / 0.01));
      let least = Infinity;
      for (let s = 0; s <= samples; s++) {
        const t = s / samples;
        least = Math.min(least, clearanceAt(arena01, p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t));
      }
      if (Math.abs(least) < 0.02) continue;
      checked++;
      expect(segmentClear(grid, p, q), `(${p.x}, ${p.y}) to (${q.x}, ${q.y}), least ${least}`).toBe(
        least > 0,
      );
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

describe('obstacle shapes of the grid', () => {
  it('hold every obstacle as numbers, in order, with the limit the segment must keep, less the 1e-9 of touching', () => {
    const obstacles: Obstacle[] = [
      { type: 'circle', x: 1.5, y: -2, r: 1.25, height: 2, blocksProjectiles: true },
      { type: 'rect', x: -3, y: 4.5, w: 2, h: 0.5, height: 1, blocksProjectiles: false },
    ];
    const grid = buildNavGrid({ ...arena01, obstacles });
    expect(grid.shapes).toEqual([
      0, 1.5, -2, 1.25, 0.5, 1.25 + CHAMPION_RADIUS - 1e-9,
      1, -3, 4.5, 2, 0.5, CHAMPION_RADIUS - 1e-9,
    ]);
  });
});
