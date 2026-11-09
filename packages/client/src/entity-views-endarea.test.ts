import { createMatch, debug, parseArenaDef, step, type GameState, type PlayerInput, type SimEvent } from '@claudeline/sim';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createAreaViews, createProjectileViews, type EntityViews } from './entity-views';
import { HARGRIM_KIT, QUILLON_KIT } from './test-kits';

// Spec 4.3: a projectile that ends on a lifetime, an obstacle or the arena edge spawns an endArea.
// The client needs no new event kind: the sim emits `projectileExpired` and then `areaSpawned`, and
// the area views draw the spawned area from the area entity. This drives the real sim with the
// real `debug` toolkit in the order main.ts uses (capture, step, sync): a projectile is gone the
// frame the area appears, and the disc is drawn at the end position.

const OWNER = 0;

interface Scene {
  state: GameState;
  projectiles: EntityViews;
  areas: EntityViews;
  /** One frame of main.ts: capture both pools, one step, sync both. */
  frame(): SimEvent[];
}

function scene(): Scene {
  const state = createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'hargrim', team: 'B' },
        { championId: 'quillon', team: 'B' },
      ],
      roundsToWin: 3,
    },
    parseArenaDef(arena01Json),
    1,
    [HARGRIM_KIT, QUILLON_KIT],
  );
  const projectiles = createProjectileViews('A');
  const areas = createAreaViews('A');
  const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
  const s: Scene = {
    state,
    projectiles,
    areas,
    frame(): SimEvent[] {
      projectiles.capture(state.projectiles);
      areas.capture(state.areas);
      step(state, inputs);
      const events = [...state.events];
      projectiles.sync(state.projectiles);
      areas.sync(state.areas);
      return events;
    },
  };
  while (state.match?.phase === 'warmup') s.frame();
  return s;
}

/** A non-piercing shot from team A's spawn east along y = 8, clear of every champion and wall. */
function fire(state: GameState): void {
  debug.spawnProjectile(state, {
    ownerId: OWNER,
    x: -12,
    y: 8,
    dirX: 1,
    dirY: 0,
    speed: 20,
    radius: 0.3,
    lifetimeTicks: 120,
    pierce: false,
    effects: [{ type: 'damage', amount: 12 }],
    endArea: {
      radius: 2.5,
      durationTicks: 120,
      intervalTicks: 60,
      targets: 'enemies',
      effects: [{ type: 'damage', amount: 10 }],
    },
  });
}

describe('the area views draw the area a projectile leaves where it ends', () => {
  it('shows the spawn from the existing areaSpawned event, and the projectile is gone that frame', () => {
    const s = scene();
    fire(s.state);
    let spawn: SimEvent | undefined;
    let expired: SimEvent | undefined;
    let countWhenSpawned = -1;
    let sawProjectile = false;
    for (let i = 0; i < 400 && s.areas.count === 0; i++) {
      const events = s.frame();
      if (s.projectiles.count > 0) sawProjectile = true;
      for (const event of events) {
        if (event.type === 'areaSpawned') {
          spawn = event;
          countWhenSpawned = s.projectiles.count;
        }
        if (event.type === 'projectileExpired') expired = event;
      }
    }
    expect(sawProjectile, 'the projectile view was shown in flight').toBe(true);
    // The sim emits the despawn first, the spawn second, in the same frame.
    expect(expired).toMatchObject({ type: 'projectileExpired', reason: 'boundary' });
    expect(spawn).toMatchObject({ type: 'areaSpawned', ownerId: OWNER, radius: 2.5 });
    expect(countWhenSpawned).toBe(0);
    expect(s.projectiles.count).toBe(0);
    expect(s.areas.count).toBe(1);
    // The disc is flat on the ground at the end position the area entity carries.
    s.areas.draw({ alpha: 0 });
    const shown = (s.areas.group.children as Mesh[]).filter((mesh) => mesh.visible);
    expect(shown).toHaveLength(1);
    const [disc] = shown as [Mesh];
    const area = s.state.areas[0];
    if (!area) throw new Error('no area');
    expect(disc.scale.x).toBeCloseTo(2.5, 9);
    expect(disc.position.x).toBeCloseTo(area.x, 9);
    expect(disc.position.z).toBeCloseTo(-area.y, 9);
    expect(area.x).toBeCloseTo(14.7, 9);
    expect(area.y).toBeCloseTo(8, 9);
  });

  it('shows a fused endArea as an armed area from the same areaSpawned path', () => {
    const s = scene();
    debug.spawnProjectile(s.state, {
      ownerId: OWNER,
      x: -12,
      y: 2,
      dirX: 1,
      dirY: 0,
      speed: 20,
      radius: 0.3,
      lifetimeTicks: 6,
      pierce: false,
      effects: [{ type: 'damage', amount: 12 }],
      endArea: {
        radius: 2,
        durationTicks: 60,
        intervalTicks: 60,
        targets: 'enemies',
        effects: [{ type: 'damage', amount: 10 }],
        fuseTicks: 30,
      },
    });
    for (let i = 0; i < 40 && s.areas.count === 0; i++) s.frame();
    expect(s.areas.count).toBe(1);
    const area = s.state.areas[0];
    if (!area) throw new Error('no area');
    // The spawned area is armed: the view reads `fuseTicks` from the entity, no event of its own.
    expect(area.fuseTicks).toBe(30);
    s.areas.draw({ alpha: 0 });
    const [disc] = (s.areas.group.children as Mesh[]).filter((mesh) => mesh.visible) as [Mesh];
    expect(disc.children.filter((child) => (child as Mesh).visible)).toHaveLength(2);
  });
});
