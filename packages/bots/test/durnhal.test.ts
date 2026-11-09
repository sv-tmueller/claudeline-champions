import { describe, expect, it } from 'vitest';
import type { ChampionState, MatchConfig } from '@claudeline/sim';
import { createRun } from './helpers';
import { ESCAPES, SEVEN_SET, TICKS, expectNoStall, play } from './press-oracle';
import { NORMAL_2V2, SEEDS_2V2, cellOf, configOf, expectEnded, playCellOn } from './six-cells';

// Seeded matches of bots with Durnhal on the seven shipped kits (#211), played to matchEnd on both
// arenas against each of the six other shipped kits. The cells are in six-cells.ts, played on
// `SEVEN_SET`. A cell takes 4.3 to 10.3 s locally (Linux x64, Node 22.23.4, load about 4; the file
// alone 66 s) and 5.2 to 17.1 s on the runner (ubuntu-latest, Node 22: the three attempts of run
// 41517296595 of 07464a5, the file 155, 107 and 113 s beside the other long matches; 3.3 to 7.3 s
// in an earlier run, job 125520587212): the timeout of 60 s is at least twice the slowest cell
// (testing.md, Check suite, with the long-match precedent of ondrel.test.ts).
const CELLS = [
  cellOf('durnhal', 'hargrim', 'arena01', 5235, 1199),
  cellOf('durnhal', 'hargrim', 'arena02', 4764, 1193),
  cellOf('durnhal', 'quillon', 'arena01', 2843, 758),
  cellOf('durnhal', 'quillon', 'arena02', 3301, 899),
  cellOf('durnhal', 'lumeth', 'arena01', 3937, 1140),
  cellOf('durnhal', 'lumeth', 'arena02', 4647, 1217),
  cellOf('durnhal', 'skerrow', 'arena01', 2390, 558),
  cellOf('durnhal', 'skerrow', 'arena02', 2523, 706),
  cellOf('durnhal', 'ondrel', 'arena01', 5226, 1530),
  cellOf('durnhal', 'ondrel', 'arena02', 3971, 1706),
  cellOf('durnhal', 'brimwick', 'arena01', 5103, 1674),
  cellOf('durnhal', 'brimwick', 'arena02', 3889, 1202),
];

const played = (cell: (typeof CELLS)[number]) => playCellOn(cell, SEVEN_SET);

describe('a match of bots with Durnhal, played to matchEnd', () => {
  it.each(CELLS)('ends $name with a winner on 3 rounds within its budget', { timeout: 60_000 }, (cell) => {
    expectEnded(cell, played(cell));
  });

  // What fires across the cells, as measured: every slot but the ultimate, which these matches
  // never reach with 100 energy (the declared start edit below does), and Bulwark Charge as a dash
  // escape in every cell without another dash escaper. `glides` counts the dash escapes of every
  // champion in the cell, so the cells where another kit's dash could count are left out: the
  // escapers are read from `ESCAPES`, which gives Lumeth, Ondrel and Durnhal himself a dash row.
  // Bulwark Charge is an escape only (decision 8 of batch #223), so every press of it is a dash
  // escape and `slots['durnhal:SPACE']` is its count: the oracle fails a press off the trigger.
  it('starts M1, M2, Bulwark Charge, Q, Breaker Throw and Aegis Line, and escapes by dashing', { timeout: 60_000 }, () => {
    const all = CELLS.map(played);
    const casts = (slot: string) => all.reduce((n, r) => n + (r.slots[`durnhal:${slot}`] ?? 0), 0);
    for (const slot of ['M1', 'M2', 'SPACE', 'Q', 'E', 'R']) {
      expect(casts(slot), `${slot} casts`).toBeGreaterThan(0);
    }
    const others = Object.entries(ESCAPES)
      .filter(([key, row]) => row.dash !== undefined && !key.startsWith('durnhal:'))
      .map(([key]) => key.split(':')[0]);
    const own = CELLS.filter((cell) =>
      configOf(cell.mine, cell.other).players.every((p) => !others.includes(p.championId)),
    );
    expect(own).toHaveLength(8);
    for (const cell of own) expect(played(cell).glides, cell.name).toBeGreaterThan(0);
  });
});

/** Durnhal and Quillon against Hargrim and Quillon, Durnhal at champion 0. */
const config = (): MatchConfig => ({
  teamSize: 2,
  players: [
    { championId: 'durnhal', team: 'A' },
    { championId: 'quillon', team: 'A' },
    { championId: 'hargrim', team: 'B' },
    { championId: 'quillon', team: 'B' },
  ],
});

describe('a free-play match with Durnhal and a start edit', () => {
  // A declared start edit (the precedent of Drowned Ground in ondrel.test.ts): Durnhal at 100
  // energy, so that Last Bastion is reachable. It is not held, so a healthy target gets it. A miss
  // after a change to the bots, the sim or the Node version is governed by batch #53 decision 8.3;
  // the fallback is Durnhal against a Hargrim, the other two champions dead, 3 m apart.
  // Runner time 10.9, 6.1 and 8.5 s (the three attempts of run 41517296595), local 6.0 s (Linux
  // x64, Node 22.23.4). Twice the slowest is 21.7 s, above the 20 s top of the rule (testing.md,
  // Check suite), so the 30 s of the long-match precedent applies.
  it('starts Last Bastion at 100 energy against healthy targets', { timeout: 30_000 }, () => {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, { config: config(), kits: SEVEN_SET.kits() });
    (run.state.champions[0] as ChampionState).energy = 100;
    const result = play(SEVEN_SET, run);
    expect(result.ultimates[0], result.summary).toBeGreaterThan(0);
    expect(result.tally.blockedEscapes, result.summary).toBe(0);
    expect(result.state.tick).toBe(TICKS);
    expectNoStall(result);
  });
});

describe('a free-play match with Durnhal, his escape and a start edit', () => {
  // Declared start edits: Aegis Line is pressed ahead of Bulwark Charge only when Bulwark Charge
  // cannot be, and the oracle has to know that, whole: a rooted Durnhal cannot dash, and a boxed-in
  // one has no landing. Durnhal has 20 percent health so that he retreats (he never kites: the
  // trigger is a retreat with the target within 6 m). In both runs Bulwark Charge is ready, so the
  // oracle's check of "Bulwark Charge ready and with a landing" is what lets the press of Aegis
  // Line through. A miss after a change to the bots, the sim or the Node version is governed by
  // batch #53 decision 8.3. Each run takes 0.34 to 0.46 s on the runner (120 ticks) and has no
  // timeout of its own.
  function weak() {
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, { config: config(), kits: SEVEN_SET.kits() });
    const durnhal = run.state.champions[0] as ChampionState;
    durnhal.health = durnhal.maxHealth * 0.2;
    return run;
  }

  it('presses Aegis Line while rooted, with Bulwark Charge ready, and the oracle lets it through', () => {
    const run = weak();
    const durnhal = run.state.champions[0] as ChampionState;
    const hargrim = run.state.champions[2] as ChampionState;
    hargrim.x = durnhal.x + 2;
    hargrim.y = durnhal.y;
    durnhal.statuses.push({ type: 'root', sourceId: 2, slot: null, remainingTicks: 600 });
    const result = play(SEVEN_SET, run, 120);
    expect(result.slots['durnhal:R'], result.summary).toBeGreaterThan(0);
    expect(result.slots['durnhal:SPACE'] ?? 0, result.summary).toBe(0);
  });

  it('presses Aegis Line boxed in at the north-east corner, with Bulwark Charge ready and no landing', () => {
    const run = weak();
    const durnhal = run.state.champions[0] as ChampionState;
    const hargrim = run.state.champions[2] as ChampionState;
    durnhal.x = 14.4;
    durnhal.y = 9.4;
    hargrim.x = 12.4;
    hargrim.y = 7.4;
    // Aegis Line pushes nobody off and the fight moves on, so a Bulwark Charge may follow later.
    const result = play(SEVEN_SET, run, 120);
    expect(result.slots['durnhal:R'], result.summary).toBeGreaterThan(0);
  });
});
