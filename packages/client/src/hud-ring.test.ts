import { SLOTS, createMatch, parseArenaDef, step, type GameState, type MatchState } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { Hud, type HudHandles } from './hud';
import { KILL_FEED_LINES, createKillFeed } from './kill-feed';
import { fake } from './test-fake';
import { TEST_KITS } from './test-kits';

// The ring warning through the real sim: a match with nobody casting, stepped to
// the round's 4800th tick (the countdown starts), its 5400th (the ring starts) and
// on. The HUD updates after every step, like a frame at scale 1.
function rig() {
  const state = createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'lumeth', team: 'B' },
        { championId: 'skerrow', team: 'B' },
      ],
      roundsToWin: 3,
    },
    parseArenaDef(arena01Json),
    1,
    TEST_KITS,
  );
  const ring = { root: fake(), countdown: fake(), radius: fake(), distance: fake() };
  const elements = {
    healthText: fake(),
    healthFill: fake(),
    energyFill: fake(),
    exMark: fake(),
    ultimateMark: fake(),
    shield: { root: fake(), fill: fake() },
    slots: SLOTS.map(() => ({ icon: fake(), seconds: fake() })),
    score: fake(),
    timer: fake(),
    ring,
    lines: Array.from({ length: KILL_FEED_LINES }, () => ({ line: fake(), killer: fake(), victim: fake() })),
  };
  const handles: HudHandles = elements;
  const hud = new Hud(handles, state.champions, 0, createKillFeed(), 3);
  return { hud, state, ring };
}

function match(state: GameState): MatchState {
  if (!state.match) throw new Error('no match');
  return state.match;
}

/** Steps and updates until the round phase has run `ticks` ticks. */
function stepToRoundTick(rigged: ReturnType<typeof rig>, ticks: number): void {
  const { hud, state } = rigged;
  while (match(state).phase !== 'round' || match(state).phaseTicks < ticks) {
    step(state, []);
    hud.update(state);
  }
}

describe('ring warning in the HUD', () => {
  it('writes nothing in the warmup and at the start of the round', () => {
    const rigged = rig();
    stepToRoundTick(rigged, 100);
    expect(rigged.ring.root.log).toEqual([]);
    expect(rigged.ring.countdown.log).toEqual([]);
    expect(rigged.ring.radius.log).toEqual([]);
    expect(rigged.ring.distance.log).toEqual([]);
  });

  it('counts down from 10 to 1, once per second, from 600 ticks before the ring', () => {
    const rigged = rig();
    stepToRoundTick(rigged, 4799);
    expect(rigged.ring.root.log).toEqual([]);
    stepToRoundTick(rigged, 4800);
    expect(rigged.ring.root.log).toEqual(['data-visible=true', 'data-counting=true']);
    expect(rigged.ring.countdown.log).toEqual(['text=10']);
    stepToRoundTick(rigged, 5400);
    expect(rigged.ring.countdown.log).toEqual(['text=10', 'text=9', 'text=8', 'text=7', 'text=6', 'text=5', 'text=4', 'text=3', 'text=2', 'text=1']);
    // No radius while it counts down.
    expect(rigged.ring.radius.log).toEqual([]);
  });

  it('shows the 18.0 m ring on its first tick and 17.0 m 120 ticks later, a value once per change', () => {
    const rigged = rig();
    // The sim creates the ring in the step that starts at 5400 phase ticks, so the first state with a ring reads 5401.
    stepToRoundTick(rigged, 5401);
    expect(match(rigged.state).ring?.radius).toBe(18);
    expect(rigged.ring.radius.log).toEqual(['text=18.0 m']);
    expect(rigged.ring.root.log).toEqual(['data-visible=true', 'data-counting=true', 'data-counting=false']);
    stepToRoundTick(rigged, 5521);
    // The ring shrinks 15 m over 1800 ticks: a decimetre every 12 ticks, with no repeat.
    expect(rigged.ring.radius.log).toEqual(
      Array.from({ length: 11 }, (_, i) => `text=${(18 - i / 10).toFixed(1)} m`),
    );
    expect(rigged.ring.radius.log.at(-1)).toBe('text=17.0 m');
  });

  it('writes nothing on a second update of the same state', () => {
    const rigged = rig();
    stepToRoundTick(rigged, 5401);
    const before = [rigged.ring.root, rigged.ring.countdown, rigged.ring.radius, rigged.ring.distance].map(
      (element) => element.log.length,
    );
    rigged.hud.update(rigged.state);
    rigged.hud.update(rigged.state);
    expect([rigged.ring.root, rigged.ring.countdown, rigged.ring.radius, rigged.ring.distance].map((e) => e.log.length)).toEqual(before);
  });

  it('flags the local champion outside once the ring passes it, with the distance', () => {
    const rigged = rig();
    stepToRoundTick(rigged, 5401);
    const champion = rigged.state.champions[0];
    if (!champion) throw new Error('no champion');
    champion.x = 14;
    champion.y = 0;
    const ring = match(rigged.state).ring;
    if (!ring) throw new Error('no ring');
    ring.radius = 14;
    rigged.hud.update(rigged.state);
    expect(rigged.ring.root.log.filter((entry) => entry.startsWith('data-outside'))).toEqual([]);
    ring.radius = 13.9;
    rigged.hud.update(rigged.state);
    expect(rigged.ring.root.log.filter((entry) => entry.startsWith('data-outside'))).toEqual(['data-outside=true']);
    expect(rigged.ring.distance.log).toEqual(['text=0.1 m']);
    ring.radius = 13;
    rigged.hud.update(rigged.state);
    rigged.hud.update(rigged.state);
    expect(rigged.ring.distance.log).toEqual(['text=0.1 m', 'text=1.0 m']);
    expect(rigged.ring.radius.log.at(-1)).toBe('text=13.0 m');
    // Back inside: the flag clears once.
    ring.radius = 16;
    rigged.hud.update(rigged.state);
    expect(rigged.ring.root.log.filter((entry) => entry.startsWith('data-outside'))).toEqual([
      'data-outside=true',
      'data-outside=false',
    ]);
  });

  it('clears a leftover outside flag in the update that shows the next round countdown', () => {
    const rigged = rig();
    stepToRoundTick(rigged, 5401);
    const ring = match(rigged.state).ring;
    const champion = rigged.state.champions[0];
    if (!ring || !champion) throw new Error('no ring or champion');
    champion.x = 14;
    champion.y = 0;
    ring.radius = 13;
    rigged.hud.update(rigged.state);
    expect(rigged.ring.root.log.at(-1)).toBe('data-outside=true');
    match(rigged.state).phase = 'roundEnd';
    rigged.hud.update(rigged.state);
    // The next round: the ring is gone and the countdown begins.
    match(rigged.state).phase = 'round';
    match(rigged.state).ring = null;
    match(rigged.state).phaseTicks = 4800;
    rigged.hud.update(rigged.state);
    expect(rigged.ring.root.log.slice(-5)).toEqual([
      'data-outside=true',
      'data-visible=false',
      'data-visible=true',
      'data-counting=true',
      'data-outside=false',
    ]);
  });

  it('hides at the round end', () => {
    const rigged = rig();
    stepToRoundTick(rigged, 5401);
    match(rigged.state).phase = 'roundEnd';
    rigged.hud.update(rigged.state);
    expect(rigged.ring.root.log.at(-1)).toBe('data-visible=false');
  });
});
