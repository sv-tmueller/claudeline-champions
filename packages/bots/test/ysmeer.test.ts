import { describe, expect, it } from 'vitest';
import { step } from '@claudeline/sim';
import type { ChampionState, GameState, MatchConfig, SimEvent } from '@claudeline/sim';
import { createBot } from '../src/bot';
import { createRun, nineKits } from './helpers';
import { NINE_SET, TICKS, expectNoStall, play } from './press-oracle';
import { THINKS, pressOf, sceneOf } from './scenes';
import { NORMAL_2V2, SEEDS_2V2, cellOf, configOf, expectEnded } from './six-cells';

// Ysmeer's bot (roadmap 4.3, #307): no opener and no spend rule, so every slot is pressed on its
// kit band less the margin, and Drift then Eclipse are her escapes. The frozen scenes pin the
// escape order and the fuse of her Falling Star, the seeded cell plays the kit together.

const kits = nineKits();

describe('Drift and Eclipse, the escapes', () => {
  it('presses Drift (SPACE) on a kite think at 6 m, inside rangeMin, with Drift and Eclipse ready', () => {
    expect(pressOf(sceneOf('ysmeer', 6, { kits, ready: ['SPACE', 'R'] }))).toBe('SPACE');
  });

  it('presses Eclipse (R) at 6 m with Drift on cooldown', () => {
    expect(pressOf(sceneOf('ysmeer', 6, { kits, ready: ['R'], cooldown: { SPACE: 500 } }))).toBe('R');
  });

  it('presses neither at 9 m, inside her range: Drift is an escape only and Eclipse reaches 2.5 m', () => {
    expect(pressOf(sceneOf('ysmeer', 9, { kits, ready: ['SPACE', 'R'] }))).toBeNull();
  });
});

describe('Falling Star, the fused area', () => {
  /** Thinks and steps champion 0's bot on a frozen scene until `done` says so of a tick's events. */
  function drive(state: GameState, ticks: number, done: (events: readonly SimEvent[]) => boolean): SimEvent[] {
    const bot = createBot(0, 'hard', 1);
    const heard: SimEvent[] = [];
    for (let t = 0; t < ticks; t++) {
      step(state, [bot.think(state)]);
      heard.push(...state.events);
      if (done(state.events)) break;
    }
    return heard;
  }

  it('is pressed at 9 m at a standing target and deals 20 once the windup of 24 and the fuse of 45 ticks have passed', () => {
    const scene = () => sceneOf('ysmeer', 9, { kits, ready: ['M2'] });
    expect(pressOf(scene())).toBe('M2');
    const state = scene();
    const target = state.champions[2] as ChampionState;
    expect(target.health).toBe(target.maxHealth);
    let fired = -1;
    let hit = -1;
    let amount = 0;
    drive(state, THINKS + 200, (events) => {
      for (const e of events) {
        if (e.type === 'castFired' && e.championId === 0 && fired < 0) fired = state.tick;
        if (e.type === 'damage' && e.sourceId === 0 && hit < 0) {
          hit = state.tick;
          amount = e.amount;
        }
      }
      return hit >= 0;
    });
    expect(fired, 'the cast fires').toBeGreaterThan(0);
    // Armed on the tick the cast fires, inert for the fuse, one pulse at its end.
    expect(hit - fired).toBe(45);
    expect(amount).toBe(20);
    expect(target.health).toBe(target.maxHealth - 20);
  });
});

// One seeded 2v2 of the cell format of durnhal.test.ts: Ysmeer and Quillon (the filler of a cell
// against a Hargrim) against Hargrim and Quillon on arena01, on the nine shipped kits. The cell is
// the first of the 16 candidates, the eight other kits on the two arenas in roster order (Hargrim,
// Quillon, Lumeth, Skerrow, Ondrel, Brimwick, Durnhal, Wrenna; arena01 then arena02), and so the
// one the rule of the plan picks: all 16 end with a winner (30 000 ticks allowed), pass the press
// oracle and block no escape, and 15 fire the eight abilities below (against Hargrim on arena02 she
// fires no Comet EX). Seeds: bots 101 to 104 on normal tiers, match seed 7 (`six-cells.ts`). A stall
// here is a reason to report, not to move `rangeMin`.
// The cell takes 5.1 s locally (Linux x64, Node 24.22, load average 6 to 10) and 8.8 and 8.0 s on the
// runner (unit jobs of runs 43691427587 and 43692315600, fast runners: typecheck 15 and 16 s, Node
// 22); the free-play run below takes 4.4 s locally and 7.3 and 8.0 s there. Twice the cell is 17.7 s,
// but runners differ by about 1.4 (testing.md, Check suite), so on a slow one it is 25 s, above the
// 20 s top of the rule: both keep the 60 s and 30 s of the long-match and start-edit precedents
// (wrenna.test.ts, durnhal.test.ts).
const CELL = cellOf('ysmeer', 'hargrim', 'arena01', 3629, 1072);

/** Her tallies in the cell: the casts that fired, by slot, and the EX ones apart. */
function tally(): { casts: Map<string, number>; after: (state: GameState) => void } {
  const casts = new Map<string, number>();
  return {
    casts,
    after: (state) => {
      for (const e of state.events) {
        // `castFired`, not `castStarted`: a cast that starts can still be interrupted (#292).
        if (e.type !== 'castFired' || e.championId !== 0) continue;
        const key = `${e.slot}${e.ex ? ':ex' : ''}`;
        casts.set(key, (casts.get(key) ?? 0) + 1);
      }
    },
  };
}

describe('a match of bots with Ysmeer, played to matchEnd', () => {
  it('ends with a winner, and she fires every ability but the ultimate', { timeout: 60_000 }, () => {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, {
      config: configOf(CELL.mine, CELL.other),
      kits: NINE_SET.kits(),
      arena: CELL.arena,
    });
    const seen = tally();
    const played = play(NINE_SET, run, CELL.budget, { after: seen.after });
    expectEnded(CELL, played);
    for (const key of ['M1', 'M2', 'M2:ex', 'SPACE', 'Q', 'E', 'E:ex', 'R']) {
      expect(seen.casts.get(key) ?? 0, `${key} fires; ${played.summary}`).toBeGreaterThan(0);
    }
  });
});

/** Ysmeer and Quillon against Hargrim and Quillon in free play (no match flow), Ysmeer at champion 0. */
const freePlay = (): MatchConfig => ({
  teamSize: 2,
  players: [
    { championId: 'ysmeer', team: 'A' },
    { championId: 'quillon', team: 'A' },
    { championId: 'hargrim', team: 'B' },
    { championId: 'quillon', team: 'B' },
  ],
});

describe('a free-play match with Ysmeer and a start edit', () => {
  // A declared start edit (the precedent of Last Bastion in durnhal.test.ts): Ysmeer at 100 energy,
  // so that Supernova is reachable. Energy resets to 0 at the start of a round, so a match with
  // flow (the cell above) loses the edit, and her EX casts keep the bar under 100 in the cells (the
  // most any of the four longest candidates reached was 80). It is not held, so a healthy target
  // gets it. In free play, with no round start, the edit stands until she casts it. A miss after a change to the bots, the sim or the
  // Node version is governed by batch #53 decision 8.3.
  it('fires Supernova at 100 energy against healthy targets', { timeout: 30_000 }, () => {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, { config: freePlay(), kits: NINE_SET.kits() });
    (run.state.champions[0] as ChampionState).energy = 100;
    const seen = tally();
    const played = play(NINE_SET, run, TICKS, { after: seen.after });
    expect(seen.casts.get('F') ?? 0, played.summary).toBeGreaterThan(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  });
});
