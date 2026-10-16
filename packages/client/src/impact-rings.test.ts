import { MeshBasicMaterial, type Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PROJECTILE_ALLY_COLOUR, PROJECTILE_ENEMY_COLOUR } from './entity-views';
import {
  RING_COLOUR,
  RING_TINT_ALLY,
  RING_TINT_ENEMY,
  RING_POOL_SIZE,
  RING_TICKS,
  RING_Y,
  createImpactRings,
} from './impact-rings';

function rings(group: { children: readonly unknown[] }): Mesh[] {
  return group.children as Mesh[];
}

function shown(group: { children: readonly unknown[] }): Mesh[] {
  return rings(group).filter((mesh) => mesh.visible);
}

function opacity(mesh: Mesh): number {
  return (mesh.material as MeshBasicMaterial).opacity;
}

describe('impact rings', () => {
  it('starts with a fixed pool of hidden flat yellow rings', () => {
    const impact = createImpactRings();
    expect(rings(impact.group)).toHaveLength(RING_POOL_SIZE);
    expect(RING_POOL_SIZE).toBe(16);
    expect(shown(impact.group)).toHaveLength(0);
    const mesh = rings(impact.group)[0] as Mesh;
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
    expect((mesh.material as MeshBasicMaterial).color.getHexString()).toBe(RING_COLOUR.slice(1));
    expect(new Set(rings(impact.group).map((m) => m.geometry)).size).toBe(1);
    expect(new Set(rings(impact.group).map((m) => m.material)).size).toBe(RING_POOL_SIZE);
  });

  it('puts a ring at the contact point on the ground', () => {
    const impact = createImpactRings();
    impact.spawn({ x: 3, y: 4 }, 100);
    impact.draw(100, { alpha: 0 });
    const [mesh] = shown(impact.group) as [Mesh];
    expect(mesh.position.toArray()).toEqual([3, RING_Y, -4]);
  });

  it('grows from 0.5 m to 1.2 m and fades out over RING_TICKS', () => {
    const impact = createImpactRings();
    impact.spawn({ x: 0, y: 0 }, 10);
    impact.draw(10, { alpha: 0 });
    const [mesh] = shown(impact.group) as [Mesh];
    expect(mesh.scale.x).toBeCloseTo(0.5, 12);
    expect(mesh.scale.y).toBeCloseTo(0.5, 12);
    expect(opacity(mesh)).toBeCloseTo(1, 12);

    impact.draw(10 + RING_TICKS / 2, { alpha: 0 });
    expect(mesh.scale.x).toBeCloseTo(0.85, 12);
    expect(opacity(mesh)).toBeCloseTo(0.5, 12);

    // The sub-tick fraction counts as age.
    impact.draw(10, { alpha: 0.5 });
    expect(mesh.scale.x).toBeCloseTo(0.5 + (0.7 * 0.5) / RING_TICKS, 12);
  });

  it('hides a finished ring', () => {
    const impact = createImpactRings();
    impact.spawn({ x: 0, y: 0 }, 10);
    impact.draw(10 + RING_TICKS - 1, { alpha: 0.9 });
    expect(shown(impact.group)).toHaveLength(1);
    impact.draw(10 + RING_TICKS, { alpha: 0 });
    expect(shown(impact.group)).toHaveLength(0);
  });

  it('reuses the oldest ring when the pool is full', () => {
    const impact = createImpactRings();
    for (let i = 0; i < RING_POOL_SIZE; i++) impact.spawn({ x: i, y: 0 }, 1);
    const first = rings(impact.group)[0] as Mesh;
    expect(first.position.x).toBe(0);
    impact.spawn({ x: 100, y: 0 }, 2);
    impact.draw(2, { alpha: 0 });
    expect(first.position.x).toBe(100);
    expect(shown(impact.group)).toHaveLength(RING_POOL_SIZE);
    // The second ring is now the oldest.
    impact.spawn({ x: 101, y: 0 }, 2);
    expect((rings(impact.group)[1] as Mesh).position.x).toBe(101);
  });

  it('counts the rings that are showing, for the data-rings hook', () => {
    const impact = createImpactRings();
    expect(impact.visibleCount).toBe(0);
    impact.spawn({ x: 0, y: 0 }, 10);
    impact.spawn({ x: 1, y: 0 }, 12);
    expect(impact.visibleCount).toBe(2);
    impact.draw(10 + RING_TICKS, { alpha: 0 });
    expect(impact.visibleCount).toBe(1);
    impact.draw(12 + RING_TICKS, { alpha: 0 });
    expect(impact.visibleCount).toBe(0);
  });

  it('does not count a reused ring twice', () => {
    const impact = createImpactRings();
    for (let i = 0; i < RING_POOL_SIZE; i++) impact.spawn({ x: i, y: 0 }, 1);
    impact.spawn({ x: 100, y: 0 }, 2);
    expect(impact.visibleCount).toBe(RING_POOL_SIZE);
    impact.draw(2 + RING_TICKS, { alpha: 0 });
    expect(impact.visibleCount).toBe(0);
  });

  it('writes the fields of the ring position and does not call set', () => {
    const impact = createImpactRings();
    const spies = rings(impact.group).map((mesh) => vi.spyOn(mesh.position, 'set'));
    impact.spawn({ x: 1.5, y: -2.5 }, 10);
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect((rings(impact.group)[0] as Mesh).position.toArray()).toEqual([1.5, RING_Y, 2.5]);
  });

  describe('tints', () => {
    function hex(mesh: Mesh): string {
      return `#${(mesh.material as MeshBasicMaterial).color.getHexString()}`;
    }

    it('spawns yellow without a tint', () => {
      const impact = createImpactRings();
      impact.spawn({ x: 0, y: 0 }, 1);
      expect(hex(rings(impact.group)[0] as Mesh)).toBe(RING_COLOUR);
    });

    it('spawns in the ally projectile colour and in the enemy one on the tint', () => {
      const impact = createImpactRings();
      impact.spawn({ x: 0, y: 0 }, 1, RING_TINT_ALLY);
      impact.spawn({ x: 1, y: 0 }, 1, RING_TINT_ENEMY);
      expect(rings(impact.group).slice(0, 2).map(hex)).toEqual([PROJECTILE_ALLY_COLOUR, PROJECTILE_ENEMY_COLOUR]);
    });

    it('turns yellow again when a tinted ring slot is recycled', () => {
      const impact = createImpactRings();
      for (let i = 0; i < RING_POOL_SIZE; i++) impact.spawn({ x: i, y: 0 }, 1, i % 2 === 0 ? RING_TINT_ALLY : RING_TINT_ENEMY);
      impact.spawn({ x: 100, y: 0 }, 2);
      impact.spawn({ x: 101, y: 0 }, 2);
      expect(rings(impact.group).slice(0, 3).map(hex)).toEqual([RING_COLOUR, RING_COLOUR, PROJECTILE_ALLY_COLOUR]);
    });

    it('gives each ring its own colour: tinting one leaves the others', () => {
      const impact = createImpactRings();
      impact.spawn({ x: 0, y: 0 }, 1, RING_TINT_ALLY);
      expect(rings(impact.group).slice(1).every((mesh) => hex(mesh) === RING_COLOUR)).toBe(true);
    });
  });
});
