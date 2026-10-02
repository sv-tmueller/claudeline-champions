import { MeshBasicMaterial, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import {
  RING_COLOUR,
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
    impact.spawn(3, 4, 100);
    impact.draw(100, 0);
    const [mesh] = shown(impact.group) as [Mesh];
    expect(mesh.position.toArray()).toEqual([3, RING_Y, -4]);
  });

  it('grows from 0.5 m to 1.2 m and fades out over RING_TICKS', () => {
    const impact = createImpactRings();
    impact.spawn(0, 0, 10);
    impact.draw(10, 0);
    const [mesh] = shown(impact.group) as [Mesh];
    expect(mesh.scale.x).toBeCloseTo(0.5, 12);
    expect(mesh.scale.y).toBeCloseTo(0.5, 12);
    expect(opacity(mesh)).toBeCloseTo(1, 12);

    impact.draw(10 + RING_TICKS / 2, 0);
    expect(mesh.scale.x).toBeCloseTo(0.85, 12);
    expect(opacity(mesh)).toBeCloseTo(0.5, 12);

    // The sub-tick fraction counts as age.
    impact.draw(10, 0.5);
    expect(mesh.scale.x).toBeCloseTo(0.5 + (0.7 * 0.5) / RING_TICKS, 12);
  });

  it('hides a finished ring', () => {
    const impact = createImpactRings();
    impact.spawn(0, 0, 10);
    impact.draw(10 + RING_TICKS - 1, 0.9);
    expect(shown(impact.group)).toHaveLength(1);
    impact.draw(10 + RING_TICKS, 0);
    expect(shown(impact.group)).toHaveLength(0);
  });

  it('reuses the oldest ring when the pool is full', () => {
    const impact = createImpactRings();
    for (let i = 0; i < RING_POOL_SIZE; i++) impact.spawn(i, 0, 1);
    const first = rings(impact.group)[0] as Mesh;
    expect(first.position.x).toBe(0);
    impact.spawn(100, 0, 2);
    impact.draw(2, 0);
    expect(first.position.x).toBe(100);
    expect(shown(impact.group)).toHaveLength(RING_POOL_SIZE);
    // The second ring is now the oldest.
    impact.spawn(101, 0, 2);
    expect((rings(impact.group)[1] as Mesh).position.x).toBe(101);
  });

  it('counts the rings it spawned', () => {
    const impact = createImpactRings();
    impact.spawn(0, 0, 1);
    impact.spawn(0, 0, 1);
    expect(impact.spawned).toBe(2);
  });
});
