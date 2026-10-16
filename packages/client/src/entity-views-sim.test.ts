import { createMatch, debug, parseArenaDef, step, type GameState } from '@claudeline/sim';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createAreaViews, createProjectileViews, type EntityViews } from './entity-views';

// These drive the views with the real sim, in the order main.ts uses: capture
// before each step, step, then sync. The unit tests in entity-views.test.ts use
// synthetic entities, so they cannot show that the views follow what the sim does
// with its entity arrays (it replaces them) or with the toolkit spawns.

function match(): GameState {
  return createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'a', team: 'A' },
        { championId: 'b', team: 'A' },
        { championId: 'c', team: 'B' },
        { championId: 'd', team: 'B' },
      ],
    },
    parseArenaDef(arena01Json),
    1,
  );
}

interface Views {
  projectiles: EntityViews;
  areas: EntityViews;
}

function createViews(): Views {
  return { projectiles: createProjectileViews('A'), areas: createAreaViews('A') };
}

/** One frame with one step, as main.ts runs it. */
function frame(state: GameState, views: Views): void {
  views.projectiles.capture(state.projectiles);
  views.areas.capture(state.areas);
  step(state, state.champions.map(() => undefined));
  // `step` replaces the arrays, so they are read fresh here.
  views.projectiles.sync(state.projectiles);
  views.areas.sync(state.areas);
}

function pool(views: EntityViews): Mesh[] {
  return views.group.children as Mesh[];
}

function shown(views: EntityViews): number {
  return pool(views).filter((mesh) => mesh.visible).length;
}

/** A shot along +x on the north side, clear of every obstacle and champion. */
function shoot(state: GameState, index: number, lifetimeTicks: number): number {
  return debug.spawnProjectile(state, {
    ownerId: 0,
    x: -4 + index * 0.1,
    y: 9,
    dirX: 1,
    dirY: 0,
    speed: 5,
    radius: 0.1,
    lifetimeTicks,
    pierce: false,
    effects: [{ type: 'damage', amount: 1 }],
  });
}

describe('entity views against the real sim', () => {
  it('shows a spawned area and releases it when the sim ends it', () => {
    const state = match();
    const views = createViews();
    debug.spawnArea(state, {
      ownerId: 0,
      x: 3,
      y: -8,
      radius: 1.5,
      durationTicks: 4,
      intervalTicks: 1,
      targets: 'enemies',
      effects: [{ type: 'damage', amount: 1 }],
    });
    expect(views.areas.count).toBe(0);

    frame(state, views);
    expect(state.areas).toHaveLength(1);
    expect(views.areas.count).toBe(1);
    const [disc] = pool(views.areas).filter((mesh) => mesh.visible) as [Mesh];
    // The area is flat on the ground at its sim position, scaled by its radius.
    views.areas.draw({ alpha: 0 });
    expect(disc.position.x).toBeCloseTo(3, 12);
    expect(disc.position.z).toBeCloseTo(8, 12);
    expect(disc.scale.x).toBe(1.5);

    let frames = 1;
    while (state.areas.length > 0) {
      expect(views.areas.count).toBe(state.areas.length);
      frame(state, views);
      frames++;
      expect(frames).toBeLessThan(20);
    }
    // Released with the sim, and the mesh is hidden, not removed.
    expect(views.areas.count).toBe(0);
    expect(disc.visible).toBe(false);
    expect(pool(views.areas)).toContain(disc);
    expect(views.projectiles.count).toBe(0);
  });

  it('grows the pool 16, 32, 64 for 40 projectiles and hides the finished ones', () => {
    const state = match();
    const views = createViews();
    expect(pool(views.projectiles)).toHaveLength(16);

    // Spawned between steps, like the F4 key: no spawn event ever reaches the views.
    for (let i = 0; i < 16; i++) shoot(state, i, 8);
    frame(state, views);
    expect(views.projectiles.count).toBe(16);
    expect(pool(views.projectiles)).toHaveLength(16);

    shoot(state, 16, 8);
    frame(state, views);
    expect(views.projectiles.count).toBe(17);
    expect(pool(views.projectiles)).toHaveLength(32);

    for (let i = 17; i < 40; i++) shoot(state, i, 8);
    frame(state, views);
    expect(state.projectiles).toHaveLength(40);
    expect(views.projectiles.count).toBe(40);
    expect(pool(views.projectiles)).toHaveLength(64);
    expect(shown(views.projectiles)).toBe(40);

    let frames = 0;
    while (state.projectiles.length > 0) {
      expect(views.projectiles.count).toBe(state.projectiles.length);
      expect(shown(views.projectiles)).toBe(state.projectiles.length);
      frame(state, views);
      frames++;
      expect(frames).toBeLessThan(20);
    }
    // All gone with the sim; the pool keeps its 64 meshes, all hidden.
    expect(views.projectiles.count).toBe(0);
    expect(shown(views.projectiles)).toBe(0);
    expect(pool(views.projectiles)).toHaveLength(64);
  });

  it('keeps the view counts equal to the sim lists while both kinds come and go', () => {
    const state = match();
    const views = createViews();
    for (let i = 0; i < 6; i++) {
      shoot(state, i, 3 + i);
      frame(state, views);
      expect(views.projectiles.count).toBe(state.projectiles.length);
      expect(views.areas.count).toBe(state.areas.length);
    }
    debug.spawnArea(state, {
      ownerId: 0,
      x: 0,
      y: -8,
      radius: 1,
      durationTicks: 3,
      intervalTicks: 1,
      targets: 'all',
      effects: [{ type: 'damage', amount: 1 }],
    });
    for (let i = 0; i < 12; i++) {
      frame(state, views);
      expect(views.projectiles.count).toBe(state.projectiles.length);
      expect(views.areas.count).toBe(state.areas.length);
    }
    expect(state.areas).toHaveLength(0);
    expect(state.projectiles).toHaveLength(0);
  });
});
