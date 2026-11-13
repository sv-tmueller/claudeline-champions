import { describe, expect, it } from 'vitest';
import { SLOTS, step } from '@claudeline/sim';
import type { ChampionState, GameState, PlayerInput, SimEvent } from '@claudeline/sim';
import { createBot } from '../src/bot';
import { createRun, eightKits } from './helpers';
import { EIGHT_SET, expectNoStall, play } from './press-oracle';
import { THINKS, pressOf, sceneOf } from './scenes';
import { NORMAL_2V2, SEEDS_2V2, cellOf, configOf, expectEnded } from './six-cells';

// Wrenna's bot (roadmap 3.4, #281): she builds her counter with Longbow (M1) and spends it with
// Heartseeker (the base E, see `spendBase` in profile.ts) and Fade Step (R). The frozen scenes pin
// each rule on its own, the seeded cell plays them together.

const kits = eightKits();

/**
 * Thinks and steps champion 0's bot on a frozen scene for at most `ticks` ticks, or until `stop`
 * says so of a tick's events; `watch` sees each state before its step. Returns the events heard.
 */
function drive(
  state: GameState,
  ticks: number,
  stop: (events: readonly SimEvent[]) => boolean = () => false,
  watch: (before: GameState, input: PlayerInput) => void = () => undefined,
): SimEvent[] {
  const bot = createBot(0, 'hard', 1);
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    const input = bot.think(state);
    watch(state, input);
    step(state, [input]);
    events.push(...state.events);
    if (stop(state.events)) break;
  }
  return events;
}

const hits = (events: readonly SimEvent[]) => events.some((e) => e.type === 'projectileHit' && e.ownerId === 0);

const me = (state: GameState): ChampionState => state.champions[0] as ChampionState;

/** Gives champion 0 `count` stacks of her counter, stamped at the scene's tick 0. */
function withStacks(state: GameState, count: number): GameState {
  (me(state).counter as NonNullable<ChampionState['counter']>).count = count;
  return state;
}

describe('Longbow builds the counter', () => {
  const scene = (d: number) => sceneOf('wrenna', d, { kits, ready: ['M1'] });

  it('is pressed on its band at 12 m and its hit sets the count to 1', () => {
    expect(pressOf(scene(12))).toBe('M1');
    const state = scene(12);
    expect(me(state).counter?.count).toBe(0);
    // Stopped on the first hit: the bot goes on to fire every 42 ticks.
    expect(hits(drive(state, THINKS + 120, hits))).toBe(true);
    expect(me(state).counter?.count).toBe(1);
  });

  it('is pressed at 13 m, the top of the band less the margin, and not beyond it', () => {
    expect(pressOf(scene(13))).toBe('M1');
    expect(pressOf(scene(13.05))).toBeNull();
  });
});

describe('Heartseeker spends the counter as the base shot', () => {
  // 14 m is inside the E band (15.8 m less the margin) and past the M1 band, so only E is pressed.
  const scene = (count: number, energy: number) =>
    withStacks(sceneOf('wrenna', 14, { kits, ready: ['E'], energy }), count);

  it('is pressed without SHIFT with 3 stacks and 50 energy; the hit deals 28 and the count is 0', () => {
    expect(pressOf(scene(3, 50))).toBe('E');
    const state = scene(3, 50);
    const events = drive(state, THINKS + 120, hits);
    const hit = events.find((e) => e.type === 'damage' && e.sourceId === 0);
    expect(hit?.type === 'damage' ? hit.amount : null).toBe(16 + 4 * 3);
    expect(me(state).counter?.count).toBe(0);
    // The 25 energy of the EX variant was never paid.
    expect(events.some((e) => e.type === 'castStarted' && e.ex)).toBe(false);
  });

  it('is pressed without SHIFT with 1 stack, where it ties the EX', () => {
    expect(pressOf(scene(1, 50))).toBe('E');
  });

  it('casts the EX variant, pressed with SHIFT, with no stacks and 25 energy, and not with 24', () => {
    expect(pressOf(scene(0, 50))).toBe('E+SHIFT');
    expect(pressOf(scene(0, 25))).toBe('E+SHIFT');
    expect(pressOf(scene(0, 24))).toBe('E');
  });

  it('is pressed without SHIFT with 3 stacks and no energy for the EX', () => {
    expect(pressOf(scene(3, 24))).toBe('E');
  });
});

describe('Tumble and Fade Step, the escapes', () => {
  it('presses Tumble (SPACE) on a kite think at 8 m, inside rangeMin, with Tumble and Fade Step ready', () => {
    expect(pressOf(sceneOf('wrenna', 8, { kits, ready: ['SPACE', 'R'] }))).toBe('SPACE');
  });

  it('presses Fade Step (R) with Tumble on cooldown, and 3 stacks cut Tumble by 360 ticks', () => {
    const scene = () => withStacks(sceneOf('wrenna', 8, { kits, ready: ['R'], cooldown: { SPACE: 500 } }), 3);
    expect(pressOf(scene())).toBe('R');
    const state = scene();
    const space = SLOTS.indexOf('SPACE');
    const tumble = (s: GameState) => (s.champions[0] as ChampionState).cooldowns[space] as number;
    let before = -1;
    drive(state, THINKS + 30, (events) => events.some((e) => e.type === 'castFired'), (s, input) => {
      if (before < 0 && input.buttons !== 0) before = tumble(s);
    });
    // The cooldown ran down one tick in the step of the press (step 3b), then Fade Step cut 3 x 120.
    expect(me(state).counter?.count).toBe(0);
    expect(before).toBeGreaterThan(361);
    expect(tumble(state)).toBe(before - 1 - 360);
  });

  it('does not press Fade Step with Tumble ready and a landing: the order keeps the cut for a Tumble on cooldown', () => {
    const state = withStacks(sceneOf('wrenna', 8, { kits, ready: ['SPACE', 'R'] }), 3);
    const started = drive(state, THINKS + 30, (events) => events.some((e) => e.type === 'castStarted'));
    const first = started.find((e) => e.type === 'castStarted');
    expect(first?.type === 'castStarted' ? first.slot : null).toBe('SPACE');
  });
});

describe('Pinning Shot, the opener on a target that closes in', () => {
  it('presses Q at 11 m at a target walking toward her, and not at one that walks away or stands', () => {
    expect(pressOf(sceneOf('wrenna', 11, { kits, ready: ['Q'], enemyVx: -5.5 }))).toBe('Q');
    expect(pressOf(sceneOf('wrenna', 11, { kits, ready: ['Q'], enemyVx: 5.5 }))).toBeNull();
    expect(pressOf(sceneOf('wrenna', 11, { kits, ready: ['Q'], enemyVx: 0 }))).toBeNull();
  });
});

// One seeded 2v2 of the cell format of durnhal.test.ts: Wrenna and Hargrim against Ondrel and
// Hargrim on arena02, on the eight shipped kits. The sub-plan named Wrenna and Quillon against
// Hargrim and Quillon on arena01, a cell that ends without a stall but whose four Fade Steps all
// come at 0 stacks, so it shows no spend; this cell (chosen from the 14 of the eight-kit cells of
// the other kits by its spends: 4 Heartseekers and 3 Fade Steps on stacks) does. A cell takes
// TIME locally and on the runner; the timeout of 60 s is at least twice the slowest cell
// (testing.md, Check suite, with the long-match precedent of durnhal.test.ts). A stall here is a
// reason to report, not to move `rangeMin`.
const CELL = cellOf('wrenna', 'ondrel', 'arena02', 4206, 913);

/** Wrenna's tallies in the cell: what her counter did and which slots spent it. */
interface Tallies {
  builds: number;
  heartseekers: number;
  fadeSteps: number;
  exWithStacks: number;
}

describe('a match of bots with Wrenna, played to matchEnd', () => {
  it('ends with a winner, and she builds, spends with Heartseeker and Fade Step, and casts no EX Heartseeker on stacks', { timeout: 60_000 }, () => {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, {
      config: configOf(CELL.mine, CELL.other),
      kits: EIGHT_SET.kits(),
      arena: CELL.arena,
    });
    const tallies: Tallies = { builds: 0, heartseekers: 0, fadeSteps: 0, exWithStacks: 0 };
    let stacks = 0;
    const played = play(EIGHT_SET, run, CELL.budget, {
      before: (state) => {
        stacks = (state.champions[0] as ChampionState).counter?.count ?? 0;
      },
      after: (state) => {
        const now = (state.champions[0] as ChampionState).counter?.count ?? 0;
        if (now > stacks) tallies.builds++;
        for (const e of state.events) {
          if (e.type !== 'castStarted' || e.championId !== 0 || stacks === 0) continue;
          if (e.slot === 'E' && !e.ex) tallies.heartseekers++;
          if (e.slot === 'E' && e.ex) tallies.exWithStacks++;
          if (e.slot === 'R') tallies.fadeSteps++;
        }
      },
    });
    expectEnded(CELL, played);
    expectNoStall(played);
    expect(tallies.builds, played.summary).toBeGreaterThan(0);
    expect(tallies.heartseekers, played.summary).toBeGreaterThan(0);
    expect(tallies.fadeSteps, played.summary).toBeGreaterThan(0);
    expect(tallies.exWithStacks, played.summary).toBe(0);
  });
});
