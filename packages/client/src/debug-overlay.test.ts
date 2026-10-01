import { LineLoop } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { readArena } from './arena';
import { OVERLAY_Y, buildDebugOverlay } from './debug-overlay';

const arena = readArena(arena01Json);

function loops(): LineLoop[] {
  const group = buildDebugOverlay(arena);
  return group.children.filter((c): c is LineLoop => c instanceof LineLoop);
}

function points(loop: LineLoop): [number, number, number][] {
  const position = loop.geometry.getAttribute('position');
  const out: [number, number, number][] = [];
  for (let i = 0; i < position.count; i++) out.push([position.getX(i), position.getY(i), position.getZ(i)]);
  return out;
}

describe('buildDebugOverlay', () => {
  it('starts hidden', () => {
    expect(buildDebugOverlay(arena).visible).toBe(false);
  });

  it('has one loop per obstacle plus the boundary', () => {
    expect(loops()).toHaveLength(10);
  });

  it('draws every point at the overlay height', () => {
    for (const loop of loops()) {
      for (const [, y] of points(loop)) expect(y).toBeCloseTo(OVERLAY_Y, 6);
    }
  });

  it('draws the boundary at half the arena size, with sim y mapped to -z', () => {
    const boundary = loops()[0];
    if (!boundary) throw new Error('no boundary loop');
    const pts = points(boundary);
    expect(Math.max(...pts.map((p) => p[0]))).toBe(15);
    expect(Math.min(...pts.map((p) => p[0]))).toBe(-15);
    expect(Math.max(...pts.map((p) => p[2]))).toBe(10);
    expect(Math.min(...pts.map((p) => p[2]))).toBe(-10);
  });

  it('draws a rect at x +- w/2 and z +- h/2 (Obstacle_1)', () => {
    const rect = loops()[2];
    if (!rect) throw new Error('no rect loop');
    const pts = points(rect);
    expect(pts).toHaveLength(4);
    const xs = new Set(pts.map((p) => p[0]));
    const zs = new Set(pts.map((p) => p[2]));
    expect([...xs].sort((a, b) => a - b)).toEqual([-8.5, -7.5]);
    expect([...zs].sort((a, b) => a - b)).toEqual([-1.5, 1.5]);
  });

  it('draws a circle with all points at radius r around its centre (Obstacle_5)', () => {
    const circle = loops()[6];
    if (!circle) throw new Error('no circle loop');
    // Obstacle_5 is the circle at sim (-5, -5), r = 1, which is three (-5, 5).
    const pts = points(circle);
    expect(pts).toHaveLength(64);
    for (const [x, , z] of pts) expect(Math.hypot(x + 5, z - 5)).toBeCloseTo(1, 5);
  });

  it('is drawn on top of the scene', () => {
    for (const loop of loops()) {
      const material = Array.isArray(loop.material) ? loop.material[0] : loop.material;
      expect(material).toMatchObject({ depthTest: false, depthWrite: false });
      expect(loop.renderOrder).toBe(1);
    }
  });
});
