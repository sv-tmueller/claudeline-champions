import {
  CHAMPION_RADIUS,
  ORB_COLLECTIBLE_TICKS,
  ORB_RADIUS,
  ORB_WARNING_TICKS,
  createMatch,
  parseArenaDef,
  step,
  type GameState,
  type PlayerInput,
} from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { SOUNDS, routeSounds } from './audio';
import { createAnims } from './champion-anim';
import { CombatFeedback, routeEvents } from './feedback';
import { createImpactRings } from './impact-rings';
import { KILL_KIND_ORB, createKillFeed, type KillFeed } from './kill-feed';
import { ORB_HIDDEN, ORB_TEXTS, ORB_UP, ORB_WARNING, createOrbView, type OrbView } from './orb-view';
import { TEST_KITS } from './test-kits';

// The orb view, the feedback that drives it and the sound, with the real sim: the order of one frame of
// main.ts (step, route the events, route the sounds, sync the view). The match is the standard 2v2 on
// arena01 with the orb on, played with no bots: champion 0 walks to the orb point or stands still.

const POINT = { x: 0, y: 2.5 };

interface Scene {
  state: GameState;
  view: OrbView;
  feed: KillFeed;
  /** Every sound played, in order. */
  plays: number[];
  /** One frame of main.ts. The human walks to the orb point when `walk` is on. */
  frame(walk: boolean): void;
}

function scene(withOrb = true): Scene {
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
      ...(withOrb ? { energyOrb: POINT } : {}),
    },
    parseArenaDef(arena01Json),
    1,
    TEST_KITS,
  );
  const view = createOrbView(state);
  const feed = createKillFeed();
  const feedback = new CombatFeedback(state.champions, 'A', createImpactRings(), feed, createAnims(4), view);
  const plays: number[] = [];
  const sound = { play: (id: number): void => void plays.push(id) };
  const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
  const human = state.champions[0];
  if (!human) throw new Error('no human');
  return {
    state,
    view,
    feed,
    plays,
    frame(walk) {
      inputs[0] = walk
        ? {
            moveX: Math.abs(POINT.x - human.x) > 0.25 ? (POINT.x > human.x ? 1 : -1) : 0,
            moveY: Math.abs(POINT.y - human.y) > 0.25 ? (POINT.y > human.y ? 1 : -1) : 0,
            aimX: 0,
            aimY: 0,
            buttons: 0,
          }
        : undefined;
      step(state, inputs);
      routeEvents(state, feedback);
      routeSounds(state, sound, 0);
      view.sync(state);
    },
  };
}

function phaseTicks(s: Scene): number {
  return s.state.match?.phaseTicks ?? -1;
}

/** Frames until `done`, with a limit. */
function until(s: Scene, walk: boolean, done: () => boolean, limit = 12_000): void {
  for (let i = 0; i < limit && !done(); i++) s.frame(walk);
  expect(done(), 'the condition was reached within the frame limit').toBe(true);
}

function shown(view: OrbView): { ring: boolean; sphere: boolean } {
  return { ring: view.ring.visible, sphere: view.sphere.visible };
}

describe('the orb view in a match with the orb on', () => {
  it('is hidden and sits on the orb point before the round', () => {
    const s = scene();
    expect(s.view.mode).toBe(ORB_HIDDEN);
    expect(shown(s.view)).toEqual({ ring: false, sphere: false });
    // The sim's (x, y) is the scene's (x, -y), on the floor.
    expect(s.view.ring.position.x).toBe(POINT.x);
    expect(s.view.ring.position.z).toBe(-POINT.y);
    expect(s.view.sphere.position.x).toBe(POINT.x);
    expect(s.view.sphere.position.z).toBe(-POINT.y);
    expect(s.view.sphere.position.y).toBeCloseTo(ORB_RADIUS, 9);
  });

  it('marks the warning on the step of orbSpawn, where the state reads 1021 ticks of the phase', () => {
    const s = scene();
    until(s, false, () => s.state.events.some((e) => e.type === 'orbSpawn'));
    expect(phaseTicks(s)).toBe(ORB_WARNING_TICKS + 1);
    expect(s.view.mode).toBe(ORB_WARNING);
    expect(shown(s.view)).toEqual({ ring: true, sphere: false });
  });

  it('draws the orb itself from the state that reads 1200, one step before the first that can take it', () => {
    const s = scene();
    until(s, false, () => phaseTicks(s) === ORB_COLLECTIBLE_TICKS - 1);
    expect(s.view.mode).toBe(ORB_WARNING);
    s.frame(false);
    expect(phaseTicks(s)).toBe(ORB_COLLECTIBLE_TICKS);
    expect(s.view.mode).toBe(ORB_UP);
    expect(shown(s.view)).toEqual({ ring: true, sphere: true });
    expect(s.state.match?.orb?.taken).toBe(false);
  });

  it('removes the orb on orbTaken and writes a feed line of kind orb that names the taker', () => {
    const s = scene();
    until(s, true, () => s.state.events.some((e) => e.type === 'orbTaken'));
    expect(phaseTicks(s)).toBe(ORB_COLLECTIBLE_TICKS + 1);
    expect(s.state.match?.orb?.taken).toBe(true);
    expect(s.view.mode).toBe(ORB_HIDDEN);
    expect(shown(s.view)).toEqual({ ring: false, sphere: false });
    expect(s.feed.count).toBe(1);
    expect(s.feed.line(0).kind).toBe(KILL_KIND_ORB);
    expect(s.feed.line(0).killerId).toBe(0);
    expect(s.feed.line(0).tick).toBe(s.state.tick);
    // It stays hidden to the end of the round, and the taking is no sound.
    for (let i = 0; i < 120; i++) s.frame(true);
    expect(s.view.mode).toBe(ORB_HIDDEN);
    expect(s.plays.filter((id) => id === SOUNDS.orbWarning)).toHaveLength(1);
  });

  it('plays the warning sound once, on the step of orbSpawn', () => {
    const s = scene();
    until(s, true, () => s.state.events.some((e) => e.type === 'orbSpawn'));
    expect(s.plays.filter((id) => id === SOUNDS.orbWarning)).toHaveLength(1);
    for (let i = 0; i < 300; i++) s.frame(true);
    expect(s.plays.filter((id) => id === SOUNDS.orbWarning)).toHaveLength(1);
  });

  it('hides an orb nobody takes at roundEnded, and shows the warning again in the next round', () => {
    const s = scene();
    until(s, false, () => s.state.events.some((e) => e.type === 'roundEnded'));
    expect(s.state.match?.orb?.taken).toBe(false);
    expect(s.view.mode).toBe(ORB_HIDDEN);
    expect(shown(s.view)).toEqual({ ring: false, sphere: false });
    expect(s.plays.filter((id) => id === SOUNDS.orbWarning)).toHaveLength(1);
    until(s, false, () => s.state.events.some((e) => e.type === 'roundStarted'));
    expect(s.view.mode).toBe(ORB_HIDDEN);
    until(s, false, () => s.state.events.some((e) => e.type === 'orbSpawn'));
    expect(s.view.mode).toBe(ORB_WARNING);
    expect(s.plays.filter((id) => id === SOUNDS.orbWarning)).toHaveLength(2);
  });

  it('names a mode text for each mode: hidden, warning, up', () => {
    expect([ORB_HIDDEN, ORB_WARNING, ORB_UP]).toEqual([0, 1, 2]);
    expect(ORB_TEXTS).toEqual(['hidden', 'warning', 'up']);
  });

  it('counts a change of mode, and nothing else', () => {
    const s = scene();
    const before = s.view.changes;
    until(s, false, () => s.view.mode === ORB_WARNING);
    expect(s.view.changes).toBe(before + 1);
    for (let i = 0; i < 100; i++) s.frame(false);
    expect(s.view.changes).toBe(before + 1);
    s.view.setMode(ORB_WARNING);
    expect(s.view.changes).toBe(before + 1);
  });
});

describe('the orb view in a match without the orb', () => {
  it('stays hidden: there is no point, and a match without the orb has no orbSpawn', () => {
    const s = scene(false);
    expect(s.state.match?.orb).toBeUndefined();
    for (let i = 0; i < ORB_COLLECTIBLE_TICKS + 200; i++) s.frame(true);
    expect(s.view.mode).toBe(ORB_HIDDEN);
    expect(shown(s.view)).toEqual({ ring: false, sphere: false });
    expect(s.feed.count).toBe(0);
    expect(s.plays.includes(SOUNDS.orbWarning)).toBe(false);
  });

  it('gives the ring the reach of a champion circle touching the orb', () => {
    const s = scene();
    const geometry = s.view.ring.geometry as unknown as { parameters: { outerRadius: number } };
    expect(geometry.parameters.outerRadius).toBeCloseTo(ORB_RADIUS + CHAMPION_RADIUS, 9);
  });
});
