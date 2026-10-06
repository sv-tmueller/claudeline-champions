import type { TeamId } from '@claudeline/sim';
import { MeshBasicMaterial, SphereGeometry, type Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  AREA_Y,
  PROJECTILE_ALLY_COLOUR,
  PROJECTILE_ENEMY_COLOUR,
  PROJECTILE_Y,
  createAreaViews,
  createEntityViews,
  createProjectileViews,
  type ViewEntity,
} from './entity-views';

function entity(id: number, x: number, y: number, team: TeamId = 'A', radius = 0.25): ViewEntity {
  return { id, team, x, y, radius };
}

interface HasGroup {
  group: { children: readonly unknown[] };
}

function meshes(views: HasGroup): Mesh[] {
  return views.group.children as Mesh[];
}

function visible(views: HasGroup): Mesh[] {
  return meshes(views).filter((mesh) => mesh.visible);
}

function colourOf(mesh: Mesh): string {
  return `#${(mesh.material as MeshBasicMaterial).color.getHexString()}`;
}

describe('entity views', () => {
  it('draws halfway between the captured and the synced position at alpha 0.5', () => {
    const views = createProjectileViews('A');
    const shot = entity(7, 2, 4);
    const list = [shot];
    views.capture(list);
    shot.x = 4;
    shot.y = 8;
    views.sync(list);
    views.draw(0.5);
    const mesh = visible(views)[0]!;
    // Sim (x, y) maps to three (x, height, -y).
    expect(mesh.position.x).toBeCloseTo(3, 12);
    expect(mesh.position.z).toBeCloseTo(-6, 12);
    expect(mesh.position.y).toBe(PROJECTILE_Y);
    views.draw(0);
    expect(mesh.position.x).toBeCloseTo(2, 12);
    views.draw(0.999);
    expect(mesh.position.x).toBeCloseTo(4, 2);
  });

  it('scales a projectile mesh by its radius', () => {
    const views = createProjectileViews('A');
    const list = [entity(7, 0, 0, 'A', 0.4)];
    views.capture(list);
    views.sync(list);
    expect(visible(views)[0]!.scale.toArray()).toEqual([0.4, 0.4, 0.4]);
  });

  it('keeps a mesh per id and releases it when the id leaves a replaced array', () => {
    const views = createProjectileViews('A');
    const first = [entity(5, 0, 0), entity(6, 1, 0), entity(9, 2, 0)];
    views.capture(first);
    views.sync(first);
    const meshOf = new Map<number, Mesh>();
    visible(views).forEach((mesh, i) => meshOf.set(first[i]!.id, mesh));
    expect(views.count).toBe(3);

    // stepProjectiles reassigns the array, so a cached reference would go stale.
    const second = [entity(5, 0.1, 0), entity(9, 2.1, 0)];
    views.capture(second);
    views.sync(second);
    expect(views.count).toBe(2);
    expect(meshOf.get(6)!.visible).toBe(false);
    expect(meshOf.get(5)!.visible).toBe(true);
    expect(meshOf.get(9)!.visible).toBe(true);
    views.draw(0);
    expect(meshOf.get(5)!.position.x).toBeCloseTo(0.1, 12);

    // A new id takes the released slot instead of growing the pool.
    const before = meshes(views).length;
    const third = [entity(5, 0.2, 0), entity(9, 2.2, 0), entity(11, 3, 0)];
    views.capture(third);
    views.sync(third);
    expect(meshes(views)).toHaveLength(before);
    expect(visible(views)).toHaveLength(3);
    expect(meshOf.get(6)!.visible).toBe(true);
  });

  it('shows a shot spawned between two steps, from where it spawned', () => {
    const views = createProjectileViews('A');
    const list: ViewEntity[] = [];
    views.capture(list);
    views.sync(list);
    expect(views.count).toBe(0);

    // F4: the toolkit spawns between steps, so no event reaches the views.
    const shot = entity(20, 5, 0);
    list.push(shot);
    views.capture(list);
    shot.x = 6;
    views.sync(list);
    views.draw(0.5);
    expect(views.count).toBe(1);
    expect(visible(views)[0]!.position.x).toBeCloseTo(5.5, 12);
  });

  it('shows a shot that only sync sees at its spawn position', () => {
    const views = createProjectileViews('A');
    views.sync([entity(20, 5, 0)]);
    views.draw(0.5);
    expect(visible(views)[0]!.position.x).toBe(5);
  });

  it('doubles the pool when it runs out of slots', () => {
    const views = createProjectileViews('A');
    expect(meshes(views)).toHaveLength(16);
    const list = Array.from({ length: 40 }, (_, i) => entity(100 + i, i, 0));
    views.capture(list);
    views.sync(list);
    expect(views.count).toBe(40);
    expect(meshes(views)).toHaveLength(64);
    expect(new Set(visible(views)).size).toBe(40);
  });

  it('does not grow the pool in steady state', () => {
    const views = createProjectileViews('A');
    for (let round = 0; round < 50; round++) {
      const list = [entity(round * 2, 0, 0), entity(round * 2 + 1, 1, 0)];
      views.capture(list);
      views.sync(list);
    }
    expect(meshes(views)).toHaveLength(16);
  });

  it('uses the ally material for the local team and the enemy material otherwise', () => {
    const list = [entity(1, 0, 0, 'A'), entity(2, 0, 0, 'B')];
    const asA = createProjectileViews('A');
    asA.sync(list);
    const [ally, enemy] = visible(asA) as [Mesh, Mesh];
    expect(colourOf(ally)).toBe(PROJECTILE_ALLY_COLOUR);
    expect(colourOf(enemy)).toBe(PROJECTILE_ENEMY_COLOUR);

    const asB = createProjectileViews('B');
    asB.sync(list);
    const [first, second] = visible(asB) as [Mesh, Mesh];
    expect(colourOf(first)).toBe(PROJECTILE_ENEMY_COLOUR);
    expect(colourOf(second)).toBe(PROJECTILE_ALLY_COLOUR);
  });

  it('shares one geometry and two materials across all meshes', () => {
    const views = createProjectileViews('A');
    expect(new Set(meshes(views).map((mesh) => mesh.geometry)).size).toBe(1);
    views.sync([entity(1, 0, 0, 'A'), entity(2, 0, 0, 'B'), entity(3, 0, 0, 'A')]);
    expect(new Set(visible(views).map((mesh) => mesh.material)).size).toBe(2);
  });

  it('draws areas flat on the ground as translucent discs', () => {
    const views = createAreaViews('A');
    views.sync([entity(30, 1, 2, 'B', 3)]);
    views.draw(0);
    const mesh = visible(views)[0]!;
    expect(mesh.position.toArray()).toEqual([1, AREA_Y, -2]);
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
    expect(mesh.scale.toArray()).toEqual([3, 3, 1]);
    const material = mesh.material as MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.opacity).toBeLessThan(0.5);
  });

  it('builds a generic pool from the given geometry and materials', () => {
    const ally = new MeshBasicMaterial();
    const enemy = new MeshBasicMaterial();
    const views = createEntityViews({
      geometry: new SphereGeometry(1, 4, 4),
      allyMaterial: ally,
      enemyMaterial: enemy,
      localTeam: 'B',
      y: 2,
      flat: false,
    });
    views.sync([entity(1, 0, 0, 'B')]);
    views.draw(0);
    const mesh = visible(views)[0]!;
    expect(mesh.material).toBe(ally);
    expect(mesh.position.y).toBe(2);
  });
});

// The frame path must allocate nothing: a call to Vector3.set with three raw
// doubles boxes them wherever the engine does not inline it (testing.md, the
// heap probe), so draw writes the position fields of the mesh directly.
describe('entity views draw without a position.set call', () => {
  const pools = [
    ['projectiles', () => createProjectileViews('A'), PROJECTILE_Y],
    ['areas', () => createAreaViews('A'), AREA_Y],
  ] as const;
  const alphas = [0, 0.1, 0.25, 0.5, 0.999, 1];

  it.each(pools)('positions every %s mesh at prev + (cur - prev) * alpha, y negated, with no set call', (_name, make, height) => {
    const views = make();
    // Fractional values that do not interpolate exactly, and a zero y for the -0 case.
    const shots = [entity(1, 0.1, 0.7), entity(2, -3.3, 0), entity(3, 12.125, -4.6)];
    views.capture(shots);
    const moved = [entity(1, 0.4, 1.3), entity(2, -2.1, 0.15), entity(3, 11.5, -4.0)];
    views.sync(moved);
    const shown = visible(views);
    expect(shown).toHaveLength(3);
    const sets = shown.map((mesh) => vi.spyOn(mesh.position, 'set'));
    for (const alpha of alphas) {
      views.draw(alpha);
      shown.forEach((mesh, i) => {
        const from = shots[i]!;
        const to = moved[i]!;
        expect(mesh.position.x, `x of mesh ${i} at alpha ${alpha}`).toBe(from.x + (to.x - from.x) * alpha);
        expect(mesh.position.y, `y of mesh ${i} at alpha ${alpha}`).toBe(height);
        expect(mesh.position.z, `z of mesh ${i} at alpha ${alpha}`).toBe(-(from.y + (to.y - from.y) * alpha));
      });
    }
    sets.forEach((spy, i) => expect(spy, `position.set on mesh ${i}`).not.toHaveBeenCalled());
  });

  it.each(pools)('keeps the unused %s slots hidden through draw', (_name, make) => {
    const views = make();
    const list = [entity(1, 1, 1), entity(2, 2, 2)];
    views.capture(list);
    views.sync(list);
    views.draw(0.5);
    expect(visible(views)).toHaveLength(2);
    expect(meshes(views).filter((mesh) => !mesh.visible)).toHaveLength(14);
    views.sync([list[0]!]);
    views.draw(0.5);
    expect(visible(views)).toHaveLength(1);
    expect(views.count).toBe(1);
  });
});
