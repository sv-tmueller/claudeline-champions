import { describe, expect, it } from 'vitest';
import type { ChampionState, MatchConfig } from '@claudeline/sim';
import { createRun } from './helpers';
import { SIX_SET, TICKS, expectNoStall, play } from './press-oracle';
import { NORMAL_2V2, SEEDS_2V2, cellOf, expectEnded, playCell } from './six-cells';

// Seeded matches of bots with Brimwick on the six shipped kits, played to matchEnd on both arenas,
// against each of the four shipped kits (Ondrel's pair is in ondrel.test.ts). The cells are in
// six-cells.ts. A cell takes 2 to 5 s locally (Apple M5 Pro, Node 22.23.2; the file alone 27 to 40
// s) and 7.2 to 22.2 s on the runner (ubuntu-latest, Node 22, run 40366453951 of 056def8; the file
// 120 to 161 s beside the other long matches): the timeout of 60 s is at least twice the slowest
// cell (testing.md, Check suite, with the long-match precedent of lumeth.test.ts).
const CELLS = [
  cellOf('brimwick', 'hargrim', 'arena01', 4046, 1412),
  cellOf('brimwick', 'hargrim', 'arena02', 4347, 1039),
  cellOf('brimwick', 'quillon', 'arena01', 4802, 1028),
  cellOf('brimwick', 'quillon', 'arena02', 3787, 800),
  cellOf('brimwick', 'lumeth', 'arena01', 6551, 1710),
  cellOf('brimwick', 'lumeth', 'arena02', 6159, 2325),
  cellOf('brimwick', 'skerrow', 'arena01', 4057, 1226),
  cellOf('brimwick', 'skerrow', 'arena02', 2323, 552),
];

describe('a match of bots with Brimwick, played to matchEnd', () => {
  it.each(CELLS)('ends $name with a winner on 3 rounds within its budget', { timeout: 60_000 }, (cell) => {
    expectEnded(cell, playCell(cell));
  });

  // What fires across the cells, as measured: every slot but the ultimate, which these matches
  // never reach with 100 energy (the declared start edits below do), and Flare Step as a teleport
  // escape in every cell.
  it('starts M1, M2, Flare Step, Flash Powder, Starshell and Smoke Pot, and escapes by teleporting', { timeout: 60_000 }, () => {
    const all = CELLS.map(playCell);
    const casts = (slot: string) => all.reduce((n, r) => n + (r.slots[`brimwick:${slot}`] ?? 0), 0);
    for (const slot of ['M1', 'M2', 'SPACE', 'Q', 'E', 'R']) {
      expect(casts(slot), `${slot} casts`).toBeGreaterThan(0);
    }
    expect(
      all.reduce((n, r) => n + r.tally.escapes, 0),
      'teleport escapes',
    ).toBeGreaterThan(0);
  });
});

describe('a free-play match with Brimwick and a start edit', () => {
  /** Brimwick and Quillon against Hargrim and Quillon, Brimwick at champion 0. */
  const config = (): MatchConfig => ({
    teamSize: 2,
    players: [
      { championId: 'brimwick', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'hargrim', team: 'B' },
      { championId: 'quillon', team: 'B' },
    ],
  });

  function withEnemyHealth(health: number) {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, { config: config(), kits: SIX_SET.kits() });
    (run.state.champions[0] as ChampionState).energy = 100;
    for (const id of [2, 3]) (run.state.champions[id] as ChampionState).health = health;
    return play(SIX_SET, run);
  }

  // Declared start edits (the precedent of Reaper's Dance in headless-kits.test.ts): Brimwick at 100
  // energy and both enemies at 55 health, the damage F does, so the hold lets Grand Finale go, and
  // at 56, where it does not (it never starts in 3600 ticks of the pinned seeds). They run the whole
  // play loop, so the oracle's Grand Finale row (the hold, the band, the clear shot, the gates) runs
  // on a real press. A miss after a change to the bots, the sim or the Node version is governed by
  // batch #53 decision 8.3; the fallback is Brimwick against a Quillon at 55 health, the other two
  // champions dead, 9 m apart.
  it('starts Grand Finale at targets at 55 health', { timeout: 30_000 }, () => {
    const played = withEnemyHealth(55);
    expect(played.ultimates[0], played.summary).toBeGreaterThan(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  });

  it('holds Grand Finale against targets at 56 health in the open', { timeout: 30_000 }, () => {
    const played = withEnemyHealth(56);
    expect(played.ultimates[0], played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  });
});
