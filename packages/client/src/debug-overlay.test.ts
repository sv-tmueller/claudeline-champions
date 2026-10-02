import { CHAMPION_RADIUS, parseArenaDef } from '@claudeline/sim';
import { Group, LineLoop } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { simToThree } from './camera';
import { OVERLAY_Y, buildDebugOverlay, updateChampionCircles } from './debug-overlay';

const arena = parseArenaDef(arena01Json);

function loops(): LineLoop[] {
  const group = buildDebugOverlay(arena, 4);
  return group.children.filter((c): c is LineLoop => c instanceof LineLoop);
}

function points(loop: LineLoop): [number, number, number][] {
  const position = loop.geometry.getAttribute('position');
  const out: [number, number, number][] = [];
  for (let i = 0; i < position.count; i++) out.push([position.getX(i), position.getY(i), position.getZ(i)]);
  return out;
}

describe('buildDebugOverlay', () => {
  it('names the group so tests and tools can find it', () => {
    expect(buildDebugOverlay(arena, 4).name).toBe('DebugOverlay');
  });

  it('starts hidden', () => {
    expect(buildDebugOverlay(arena, 4).visible).toBe(false);
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

describe('champion circles', () => {
  function circles(overlay: Group): LineLoop[] {
    const group = overlay.getObjectByName('ChampionCircles');
    if (!group) throw new Error('no ChampionCircles group');
    return group.children.filter((c): c is LineLoop => c instanceof LineLoop);
  }

  it('adds one named group with one circle per champion, apart from the static loops', () => {
    const overlay = buildDebugOverlay(arena, 4);
    expect(circles(overlay)).toHaveLength(4);
    expect(overlay.children.filter((c) => c instanceof LineLoop)).toHaveLength(10);
  });

  it('draws the circles like the other loops, on top of the scene', () => {
    for (const loop of circles(buildDebugOverlay(arena, 4))) {
      const material = Array.isArray(loop.material) ? loop.material[0] : loop.material;
      expect(material).toMatchObject({ depthTest: false, depthWrite: false });
      expect(loop.renderOrder).toBe(1);
    }
  });

  it('puts every circle point half a metre from the champion position after an update', () => {
    const overlay = buildDebugOverlay(arena, 4);
    const poses = [
      { x: -12, y: 2, facing: 0 },
      { x: -3.25, y: 7.5, facing: 1 },
      { x: 4, y: -6, facing: 2 },
      { x: 14.5, y: 0.25, facing: Math.PI },
    ];
    updateChampionCircles(overlay, poses);
    for (const [i, loop] of circles(overlay).entries()) {
      const pose = poses[i];
      if (!pose) throw new Error('missing pose');
      const centre = simToThree(pose.x, pose.y);
      const position = loop.geometry.getAttribute('position');
      expect(position.count).toBeGreaterThanOrEqual(32);
      for (let k = 0; k < position.count; k++) {
        const x = position.getX(k) + loop.position.x;
        const y = position.getY(k) + loop.position.y;
        const z = position.getZ(k) + loop.position.z;
        expect(Math.hypot(x - centre.x, z - centre.z)).toBeCloseTo(CHAMPION_RADIUS, 6);
        expect(y).toBeCloseTo(OVERLAY_Y, 6);
      }
    }
  });

  it('moves a circle again on the next update', () => {
    const overlay = buildDebugOverlay(arena, 1);
    updateChampionCircles(overlay, [{ x: 1, y: 1, facing: 0 }]);
    updateChampionCircles(overlay, [{ x: 2, y: 3, facing: 0 }]);
    const loop = circles(overlay)[0];
    expect([loop?.position.x, loop?.position.z]).toEqual([2, -3]);
  });
});
