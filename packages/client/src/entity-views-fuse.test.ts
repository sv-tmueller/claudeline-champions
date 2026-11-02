import { createMatch, debug, parseArenaDef, step, type GameState } from '@claudeline/sim';
import type { Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createAreaViews, type EntityViews } from './entity-views';

// The armed look of a fused area (rules 2.6), driven by the real sim in the order main.ts uses:
// capture, step, sync. The views read `fuseTicks` and `ticksToNextApply` from the area entity,
// with no event: the area is armed while `fuseTicks` is above 0.

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
      roundsToWin: 3,
    },
    parseArenaDef(arena01Json),
    1,
  );
}

/** One frame of main.ts: capture, one step, sync. */
function frame(state: GameState, views: EntityViews): void {
  views.capture(state.areas);
  step(state, state.champions.map(() => undefined));
  views.sync(state.areas);
}

function discs(views: EntityViews): Mesh[] {
  return (views.group.children as Mesh[]).filter((mesh) => mesh.visible);
}

/** Whether the shown disc wears the armed look: its ring outline is visible. */
function armed(views: EntityViews): boolean {
  const [disc] = discs(views);
  if (!disc) throw new Error('no disc shown');
  const ring = disc.getObjectByName('fuse-ring');
  if (!ring) throw new Error('no ring on the disc');
  return ring.visible;
}

function spawn(state: GameState, over: { fuseTicks: number; durationTicks?: number; intervalTicks?: number }): number {
  return debug.spawnArea(state, {
    ownerId: 0,
    x: 0,
    y: 8,
    radius: 2.5,
    durationTicks: over.durationTicks ?? 1,
    intervalTicks: over.intervalTicks ?? 1,
    targets: 'enemies',
    effects: [{ type: 'damage', amount: 5 }],
    fuseTicks: over.fuseTicks,
  });
}

function fresh(): { state: GameState; views: EntityViews } {
  const state = match();
  // Past the warmup, so the round clock runs and the fuse burns.
  while (state.match?.phase === 'warmup') step(state, []);
  return { state, views: createAreaViews('A') };
}

describe('the area views draw a fused area armed', () => {
  it('shows a fused one-hit area armed for its whole fuse and releases it in the detonation step', () => {
    const { state, views } = fresh();
    spawn(state, { fuseTicks: 30 });
    for (let n = 1; n <= 30; n++) {
      frame(state, views);
      expect(views.count, `frame ${n}`).toBe(1);
      expect(armed(views), `frame ${n}`).toBe(true);
    }
    frame(state, views);
    expect(state.areas).toHaveLength(0);
    expect(views.count).toBe(0);
    expect(discs(views)).toHaveLength(0);
  });

  it('turns a fused lingering area live on its first areaTick', () => {
    const { state, views } = fresh();
    spawn(state, { fuseTicks: 20, durationTicks: 90, intervalTicks: 30 });
    for (let n = 1; n <= 20; n++) {
      frame(state, views);
      expect(armed(views), `frame ${n}`).toBe(true);
    }
    expect(state.events.some((e) => e.type === 'areaTick')).toBe(false);
    frame(state, views);
    expect(state.events.some((e) => e.type === 'areaTick')).toBe(true);
    expect(views.count).toBe(1);
    expect(armed(views)).toBe(false);
    frame(state, views);
    expect(armed(views)).toBe(false);
  });

  it('gives a live lingering area the same disc as an unfused one', () => {
    const { state, views } = fresh();
    spawn(state, { fuseTicks: 15, durationTicks: 90, intervalTicks: 30 });
    for (let n = 1; n <= 16; n++) frame(state, views);
    const [disc] = discs(views) as [Mesh];
    expect((disc.material as MeshBasicMaterial).opacity).toBe(0.3);
  });

  it('burns the progress disc from nothing to the full area, and hides it when live', () => {
    const { state, views } = fresh();
    spawn(state, { fuseTicks: 40, durationTicks: 90, intervalTicks: 30 });
    frame(state, views);
    const [disc] = discs(views) as [Mesh];
    const fill = disc.getObjectByName('fuse-progress') as Mesh;
    expect(fill.visible).toBe(true);
    // One of 40 ticks has burnt: ticksToNextApply is 39.
    expect(fill.scale.x).toBeCloseTo(1 / 40, 12);
    expect(fill.scale.y).toBeCloseTo(1 / 40, 12);
    for (let n = 2; n <= 20; n++) frame(state, views);
    expect(fill.scale.x).toBeCloseTo(0.5, 12);
    for (let n = 21; n <= 40; n++) frame(state, views);
    expect(fill.scale.x).toBeCloseTo(1, 12);
    frame(state, views);
    expect(fill.visible).toBe(false);
  });

  it('releases an armed view when the round is decided, with the area still alive', () => {
    const { state, views } = fresh();
    spawn(state, { fuseTicks: 90 });
    frame(state, views);
    expect(views.count).toBe(1);
    // Both champions of team B die in the next step, to a dev area on each: the round is decided.
    for (const champion of state.champions) {
      if (champion.team !== 'B') continue;
      champion.health = 1;
      debug.spawnArea(state, {
        ownerId: 0, x: champion.x, y: champion.y, radius: 1, durationTicks: 2, intervalTicks: 1,
        targets: 'enemies', effects: [{ type: 'damage', amount: 5 }],
      });
    }
    frame(state, views);
    expect(state.match?.phase).toBe('roundEnd');
    expect(state.areas).toHaveLength(0);
    expect(views.count).toBe(0);
    expect(discs(views)).toHaveLength(0);
  });

  it('recycles a slot: a view released while armed and reused by an unfused area wears the live look', () => {
    const { state, views } = fresh();
    spawn(state, { fuseTicks: 15 });
    for (let n = 1; n <= 16; n++) frame(state, views);
    expect(views.count).toBe(0);
    debug.spawnArea(state, {
      ownerId: 0, x: 0, y: 8, radius: 2.5, durationTicks: 60, intervalTicks: 30,
      targets: 'enemies', effects: [{ type: 'damage', amount: 5 }],
    });
    frame(state, views);
    expect(views.count).toBe(1);
    expect(armed(views)).toBe(false);
    const [disc] = discs(views) as [Mesh];
    expect((disc.getObjectByName('fuse-progress') as Mesh).visible).toBe(false);
  });
});
