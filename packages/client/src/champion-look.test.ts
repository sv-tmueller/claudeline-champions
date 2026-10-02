import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEAD_COLOUR,
  DEAD_OPACITY,
  createChampionLooks,
  lookMode,
} from './champion-look';

const shared = new MeshStandardMaterial({ color: '#4477aa' });
const trim = new MeshStandardMaterial({ color: '#ffcc00' });

// Clones of one glb share their materials, so every champion here does too.
function champion(): Group {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(), shared);
  const head = new Mesh(new BoxGeometry(), trim);
  const nested = new Group();
  nested.add(head);
  group.add(body, nested);
  return group;
}

function materials(root: Group): unknown[] {
  const found: unknown[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) found.push(object.material);
  });
  return found;
}

describe('champion looks', () => {
  it('flashes every mesh of one champion with one shared white material', () => {
    const roots = [champion(), champion()];
    const looks = createChampionLooks(roots);
    looks.set(0, 'flash');
    const [a, b] = materials(roots[0] as Group) as MeshBasicMaterial[];
    expect(a).toBe(b);
    expect(a?.color.getHexString()).toBe('ffffff');
    // The other champion is untouched.
    expect(materials(roots[1] as Group)).toEqual([shared, trim]);
    looks.set(1, 'flash');
    expect(materials(roots[1] as Group)[0]).toBe(a);
  });

  it('restores the original materials and never edits them', () => {
    const roots = [champion()];
    const looks = createChampionLooks(roots);
    const colour = shared.color.getHex();
    const opacity = shared.opacity;
    looks.set(0, 'flash');
    looks.set(0, 'dead');
    looks.set(0, 'normal');
    expect(materials(roots[0] as Group)).toEqual([shared, trim]);
    expect(shared.color.getHex()).toBe(colour);
    expect(shared.opacity).toBe(opacity);
    expect(shared.transparent).toBe(false);
  });

  it('shows a dead champion grey and faded', () => {
    const roots = [champion()];
    const looks = createChampionLooks(roots);
    looks.set(0, 'dead');
    const [mine] = materials(roots[0] as Group) as MeshBasicMaterial[];
    expect(mine?.color.getHexString()).toBe(DEAD_COLOUR.slice(1));
    expect(mine?.transparent).toBe(true);
    expect(mine?.opacity).toBe(DEAD_OPACITY);
  });

  it('reassigns materials only when the mode changes', () => {
    const roots = [champion()];
    const looks = createChampionLooks(roots);
    looks.set(0, 'flash');
    const mesh = (roots[0] as Group).children[0] as Mesh;
    const probe = new MeshBasicMaterial();
    mesh.material = probe;
    looks.set(0, 'flash');
    expect(mesh.material).toBe(probe);
    looks.set(0, 'normal');
    expect(mesh.material).toBe(shared);
  });

  it('gives flash priority over dead', () => {
    expect(lookMode(true, false)).toBe('flash');
    expect(lookMode(true, true)).toBe('flash');
    expect(lookMode(false, false)).toBe('dead');
    expect(lookMode(false, true)).toBe('normal');
  });

  it('ignores an unknown champion index', () => {
    const looks = createChampionLooks([champion()]);
    expect(() => looks.set(5, 'flash')).not.toThrow();
  });
});
