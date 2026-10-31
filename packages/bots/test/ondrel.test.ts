import { describe, expect, it } from 'vitest';
import type { ChampionState, MatchConfig } from '@claudeline/sim';
import { createRun } from './helpers';
import { ESCAPES, SIX_SET, TICKS, expectNoStall, play } from './press-oracle';
import { NORMAL_2V2, SEEDS_2V2, cellOf, configOf, expectEnded, playCell } from './six-cells';

// Seeded matches of bots with Ondrel on the six shipped kits, played to matchEnd on both arenas:
// against each of the four shipped kits, and against Brimwick (that pair is played here only;
// the cells of brimwick.test.ts are the four shipped kits). The cells
// are in six-cells.ts. A cell takes 2 to 5 s locally (Apple M5 Pro, Node 22.23.2; the file alone 27
// to 40 s) and 7.0 to 25.4 s on the runner (ubuntu-latest, Node 22, run 40366453951 of 056def8; the
// file 120 to 161 s beside the other long matches): the timeout of 60 s is at least twice the
// slowest cell (testing.md, Check suite, with the long-match precedent of lumeth.test.ts).
const CELLS = [
  cellOf('ondrel', 'hargrim', 'arena01', 3403, 1305),
  cellOf('ondrel', 'hargrim', 'arena02', 5573, 1444),
  cellOf('ondrel', 'quillon', 'arena01', 5126, 1470),
  cellOf('ondrel', 'quillon', 'arena02', 5533, 1023),
  cellOf('ondrel', 'lumeth', 'arena01', 4924, 1607),
  cellOf('ondrel', 'lumeth', 'arena02', 6725, 1313),
  cellOf('ondrel', 'skerrow', 'arena01', 3281, 1105),
  cellOf('ondrel', 'skerrow', 'arena02', 5468, 1204),
  cellOf('ondrel', 'brimwick', 'arena01', 3703, 1027),
  cellOf('ondrel', 'brimwick', 'arena02', 4124, 1329),
];

describe('a match of bots with Ondrel, played to matchEnd', () => {
  it.each(CELLS)('ends $name with a winner on 3 rounds within its budget', { timeout: 60_000 }, (cell) => {
    expectEnded(cell, playCell(cell));
  });

  // What fires across the cells, as measured: every slot but the ultimate, which these matches
  // never reach with 100 energy (the declared start edit below does), and Reed Step as an escape
  // in every cell without another dash escaper. `glides` counts the dash escapes of every champion
  // in the cell, so the cells where another kit's Glide could count are left out: the escapers are
  // read from `ESCAPES`, which today gives Lumeth alone, and the fillers have no dash row.
  it('starts M1, M2, Reed Step, Reed Fence, Undertow and Reed Screen, and escapes by dashing', { timeout: 60_000 }, () => {
    const all = CELLS.map(playCell);
    const casts = (slot: string) => all.reduce((n, r) => n + (r.slots[`ondrel:${slot}`] ?? 0), 0);
    for (const slot of ['M1', 'M2', 'SPACE', 'Q', 'E', 'R']) {
      expect(casts(slot), `${slot} casts`).toBeGreaterThan(0);
    }
    const others = Object.entries(ESCAPES)
      .filter(([key, row]) => row.dash !== undefined && !key.startsWith('ondrel:'))
      .map(([key]) => key.split(':')[0]);
    const own = CELLS.filter((cell) =>
      configOf(cell.mine, cell.other).players.every((p) => !others.includes(p.championId)),
    );
    expect(own).toHaveLength(8);
    // Since #213 (a melee champion stands inside its reach, not on the edge of it) the match of
    // Ondrel against Quillon on arena02 ends at tick 2969 with no dash escape (`glides` 0, it had
    // some before). The other seven cells escape by dashing.
    for (const cell of own) {
      if (cell.name === 'ondrel against quillon on arena02') continue;
      expect(playCell(cell).glides, cell.name).toBeGreaterThan(0);
    }
  });
});

/** Ondrel and Quillon against Hargrim and Quillon, Ondrel at champion 0. */
const config = (): MatchConfig => ({
  teamSize: 2,
  players: [
    { championId: 'ondrel', team: 'A' },
    { championId: 'quillon', team: 'A' },
    { championId: 'hargrim', team: 'B' },
    { championId: 'quillon', team: 'B' },
  ],
});

describe('a free-play match with Ondrel and a start edit', () => {
  // A declared start edit (the precedent of Reaper's Dance in headless-kits.test.ts): Ondrel at 100
  // energy, so that Drowned Ground is reachable. It is not held, so a healthy target gets it. A
  // miss after a change to the bots, the sim or the Node version is governed by batch #53 decision
  // 8.3; the fallback is Ondrel against a Quillon, the other two champions dead, 9 m apart.
  // Runner time 7.1 s (job 121726022078) and 11.5 s (job 122125510999), local 2.5 s (Apple M5 Pro,
  // Node 22.23.2). Twice the slowest is 23 s, above the 20 s top of the rule (testing.md, Check
  // suite), so the 30 s of the long-match precedent applies.
  it('starts Drowned Ground at 100 energy against healthy targets', { timeout: 30_000 }, () => {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, { config: config(), kits: SIX_SET.kits() });
    (run.state.champions[0] as ChampionState).energy = 100;
    const played = play(SIX_SET, run);
    expect(played.ultimates[0], played.summary).toBeGreaterThan(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  });
});

describe('a free-play match with Ondrel, her escape and a start edit', () => {
  // Declared start edits: Reed Screen is pressed ahead of Reed Step only when Reed Step cannot be,
  // and the oracle has to know that, whole: a rooted Ondrel cannot dash, and a boxed-in one has no
  // landing. In both runs Reed Step is ready, so the oracle's check of "Reed Step ready and with a
  // landing" is what lets the press of Reed Screen through. A miss after a change to the bots, the
  // sim or the Node version is governed by batch #53 decision 8.3.
  it('presses Reed Screen while rooted, with Reed Step ready, and the oracle lets it through', () => {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, { config: config(), kits: SIX_SET.kits() });
    const ondrel = run.state.champions[0] as ChampionState;
    const hargrim = run.state.champions[2] as ChampionState;
    hargrim.x = ondrel.x + 2;
    hargrim.y = ondrel.y;
    ondrel.statuses.push({ type: 'root', sourceId: 2, slot: null, remainingTicks: 600 });
    const played = play(SIX_SET, run, 120);
    expect(played.slots['ondrel:R'], played.summary).toBeGreaterThan(0);
    expect(played.slots['ondrel:SPACE'] ?? 0, played.summary).toBe(0);
  });

  it('presses Reed Screen boxed in at the north-east corner, with Reed Step ready and no landing', () => {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, { config: config(), kits: SIX_SET.kits() });
    const ondrel = run.state.champions[0] as ChampionState;
    const hargrim = run.state.champions[2] as ChampionState;
    ondrel.x = 14.4;
    ondrel.y = 9.4;
    hargrim.x = 12.4;
    hargrim.y = 7.4;
    // Reed Screen pushes nobody off and the fight moves on, so a Reed Step may follow later.
    const played = play(SIX_SET, run, 120);
    expect(played.slots['ondrel:R'], played.summary).toBeGreaterThan(0);
  });
});
