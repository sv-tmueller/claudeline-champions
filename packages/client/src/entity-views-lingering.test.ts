import { Button, createMatch, debug, parseArenaDef, step, type GameState, type PlayerInput } from '@claudeline/sim';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createAreaViews, createProjectileViews, type EntityViews } from './entity-views';
import { BRIMWICK_KIT, HARGRIM_KIT, ONDREL_KIT, QUILLON_KIT } from './test-kits';

// The area views draw lingering areas in a match for the first time: every v1 area and every
// area of Brimwick lasts one tick, so it is made in step 3 and gone in step 6 of the same tick and
// never reaches `sync`. Ondrel's Mire, Reed Step, Reed Fence, Reed Screen and Drowned Ground last
// 120 to 300 ticks. This plays each one with the real sim and the real kits, capture, step and
// sync in main.ts order, and reads the views (entity-views-sim.test.ts uses toolkit spawns).

const OWNER = 0;

interface Scene {
  state: GameState;
  areas: EntityViews;
  /** One frame of main.ts: capture, one step with the owner's input, sync. */
  frame(buttons?: number, aimX?: number, aimY?: number): void;
}

/** The owner on team A at (-12, 2) with a Quillon, against a Hargrim and a Brimwick at x = 12. */
function scene(championId: 'ondrel' | 'brimwick'): Scene {
  const state = createMatch(
    {
      teamSize: 2,
      players: [
        { championId, team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'hargrim', team: 'B' },
        { championId: 'brimwick', team: 'B' },
      ],
      roundsToWin: 3,
    },
    parseArenaDef(arena01Json),
    1,
    [ONDREL_KIT, BRIMWICK_KIT, HARGRIM_KIT, QUILLON_KIT],
  );
  const areas = createAreaViews('A');
  const projectiles = createProjectileViews('A');
  const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
  const s: Scene = {
    state,
    areas,
    frame(buttons = 0, aimX = -600, aimY = 200) {
      inputs[OWNER] = { moveX: 0, moveY: 0, aimX, aimY, buttons };
      areas.capture(state.areas);
      projectiles.capture(state.projectiles);
      step(state, inputs);
      areas.sync(state.areas);
      projectiles.sync(state.projectiles);
    },
  };
  while (state.match?.phase === 'warmup') s.frame();
  return s;
}

interface Played {
  /** The area view count after each frame, the cast frame first. */
  counts: number[];
  /** The disc as drawn in the first frame an area view was shown, or null if none was. */
  disc: { x: number; z: number; scale: number; visible: number } | null;
  /** The areas the sim made, from each step's areaSpawned events. */
  spawned: number;
}

/** Presses `buttons` for the first frame, then idles `frames` frames in all, reading the area views after each. */
function play(s: Scene, buttons: number, aimX: number, aimY: number, frames = 360): Played {
  const played: Played = { counts: [], disc: null, spawned: 0 };
  for (let i = 0; i < frames; i++) {
    s.frame(i === 0 ? buttons : 0, aimX, aimY);
    played.spawned += s.state.events.filter((event) => event.type === 'areaSpawned').length;
    // The views follow the sim list in every frame.
    expect(s.areas.count).toBe(s.state.areas.length);
    played.counts.push(s.areas.count);
    if (played.disc === null && s.areas.count > 0) {
      s.areas.draw({ alpha: 0 });
      const shown = (s.areas.group.children as Mesh[]).filter((mesh) => mesh.visible);
      const [disc] = shown as [Mesh];
      played.disc = { x: disc.position.x, z: disc.position.z, scale: disc.scale.x, visible: shown.length };
    }
  }
  return played;
}

/** The frames that showed one view, as the first frame and the number: they must be one unbroken run. */
function run(counts: readonly number[]): { first: number; length: number } {
  const first = counts.indexOf(1);
  const length = counts.filter((count) => count === 1).length;
  expect(counts.slice(first, first + length).every((count) => count === 1), 'one unbroken run of one view').toBe(true);
  expect(Math.max(...counts), 'never more than one view').toBe(1);
  return { first, length };
}

describe('the area views draw the lingering areas of Ondrel', () => {
  // An area of `durationTicks` is made in step 3 and counted down in step 6 of the tick that makes
  // it, so a sync sees it for durationTicks - 1 frames: the 1 tick areas of v1 and Brimwick for none.
  // [label, buttons, aim in cm, radius, duration, expected disc x and y in metres]. The owner stands at (-12, 2).
  const CASES: [string, number, [number, number], number, number, [number, number]][] = [
    ['M2 Mire at the aim', Button.M2, [-600, 200], 2, 180, [-6, 2]],
    ['M2 Mire, an aim past 8 m, at 8 m', Button.M2, [200, 200], 2, 180, [-4, 2]],
    ['Reed Fence (Q), the one-hit circle left out', Button.Q, [-600, 200], 2.5, 120, [-12, 2]],
    ['Reed Screen (R)', Button.R, [-600, 200], 3, 180, [-12, 2]],
    ['Drowned Ground (F) at the aim', Button.F, [-600, 200], 4, 300, [-6, 2]],
  ];

  it.each(CASES)('shows exactly one view for %s, for its whole life, and then releases it', (_label, buttons, [aimX, aimY], radius, duration, [x, y]) => {
    const s = scene('ondrel');
    const owner = s.state.champions[OWNER];
    if (!owner) throw new Error('no owner');
    owner.energy = 100;
    const played = play(s, buttons, aimX, aimY);
    expect(run(played.counts).length).toBe(duration - 1);
    expect(played.counts.at(-1)).toBe(0);
    expect(played.disc?.visible).toBe(1);
    expect(played.disc?.scale).toBe(radius);
    // The disc is flat on the ground at the sim position: world y is scene z, flipped.
    expect(played.disc?.x).toBeCloseTo(x, 9);
    expect(played.disc?.z).toBeCloseTo(-y, 9);
  });

  it('shows the Mire of the EX M2 at 2.5 m for its whole life', () => {
    const s = scene('ondrel');
    const owner = s.state.champions[OWNER];
    if (!owner) throw new Error('no owner');
    owner.energy = 50;
    const played = play(s, Button.M2 | Button.SHIFT, -600, 200);
    expect(run(played.counts).length).toBe(179);
    expect(played.disc?.scale).toBe(2.5);
    expect(owner.energy).toBe(25);
  });

  it('shows the Reed Step disc at the point the dash started, not where it ended', () => {
    const s = scene('ondrel');
    const owner = s.state.champions[OWNER];
    if (!owner) throw new Error('no owner');
    const played = play(s, Button.SPACE, -600, 200);
    expect(run(played.counts).length).toBe(119);
    expect(played.disc?.scale).toBe(1.5);
    expect(played.disc?.x).toBeCloseTo(-12, 9);
    expect(played.disc?.z).toBeCloseTo(-2, 9);
    // The dash took her 4.5 m east.
    expect(owner.x).toBeCloseTo(-7.5, 6);
  });

  it('releases the view in the frame the round is decided, with the area still alive', () => {
    const s = scene('ondrel');
    const owner = s.state.champions[OWNER];
    if (!owner) throw new Error('no owner');
    owner.energy = 100;
    s.frame(Button.F, -600, 200);
    for (let i = 0; i < 80 && s.areas.count === 0; i++) s.frame(0, -600, 200);
    expect(s.areas.count).toBe(1);
    // Both champions of team B die in the next step, to a two-tick area of the dev tool at each of them:
    // the round is decided with the Drowned Ground still alive.
    for (const champion of s.state.champions) {
      if (champion.team !== 'B') continue;
      champion.health = 1;
      debug.spawnArea(s.state, {
        ownerId: OWNER,
        x: champion.x,
        y: champion.y,
        radius: 1,
        durationTicks: 2,
        intervalTicks: 1,
        targets: 'enemies',
        effects: [{ type: 'damage', amount: 5 }],
      });
    }
    expect(s.state.areas).toHaveLength(3);
    s.frame(0, -600, 200);
    expect(s.state.match?.phase).toBe('roundEnd');
    expect(s.state.areas).toHaveLength(0);
    expect(s.areas.count).toBe(0);
    expect((s.areas.group.children as Mesh[]).filter((mesh) => mesh.visible)).toHaveLength(0);
  });
});

describe('the area views never show the one-tick areas', () => {
  it.each([
    ['Brimwick M2', Button.M2],
    ['Brimwick R', Button.R],
  ] as const)('shows no view for %s', (_label, buttons) => {
    const s = scene('brimwick');
    const played = play(s, buttons, -600, 200, 120);
    expect(played.spawned, 'the one-tick area was made').toBe(1);
    expect(played.disc).toBeNull();
    expect(Math.max(...played.counts)).toBe(0);
  });
});
