import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS_TO_WIN } from '@claudeline/sim';
import type { ArenaDef, MatchConfig } from '@claudeline/sim';
import { arena01, arena02, configLumeth, configLumeth3v3, createRun } from './helpers';
import { LUMETH_SET, expectNoStall, play } from './press-oracle';
import type { Played } from './press-oracle';

// Seeded matches of bots with Lumeth on the four shipped kits, played to matchEnd (3 rounds to win)
// on both arenas: Hargrim and Lumeth against Hargrim and Quillon, and the 3v3 roster of the client
// (Hargrim, Quillon and Lumeth a side). Every press of every tick passes the press oracle (its
// ally rows included), the invariants hold, the bots leave the state alone and no bot stalls for
// more than 120 ticks. The seeds are pinned: a miss after a change to the bots, the sim or the Node
// version is governed by batch #53 decision 8.3.

const NORMAL_2V2 = ['normal', 'normal', 'normal', 'normal'] as const;
const NORMAL_3V3 = ['normal', 'normal', 'normal', 'normal', 'normal', 'normal'] as const;
const SEEDS_2V2 = [101, 102, 103, 104];
const SEEDS_3V3 = [101, 102, 103, 104, 105, 106];

/**
 * The tick budget of a match, by the formula of the client's match-setup.test.ts and the e2e rows:
 * the end tick when the budget was set, plus two rounds of `round` ticks and one sudden-death
 * round of 7000, rounded up to 1000. The round term is the longest round that did not go to sudden
 * death, rounded up to 100: 1653 ticks in the 2v2 runs here (1700), and 3331 in the client's 3v3 of
 * the same roster (3400; the 3v3 runs here have 1969 at most, with other seeds). A run whose longest
 * round passes its term fails, so the term follows the rounds and not the old figures.
 */
function budgetOf(endTick: number, round: number): number {
  return Math.ceil((endTick + 2 * round + 7000) / 1000) * 1000;
}

interface Row {
  name: string;
  config: () => MatchConfig;
  arena: ArenaDef;
  seeds: number[];
  tiers: readonly ('normal')[];
  /** The tick the match ended on when the budget was set. */
  endTick: number;
  round: number;
  budget: number;
}

const ROWS: Row[] = [
  {
    name: 'a 2v2 on arena01',
    config: configLumeth,
    arena: arena01,
    seeds: SEEDS_2V2,
    tiers: NORMAL_2V2,
    endTick: 7860,
    round: 1700,
    budget: 19_000,
  },
  {
    name: 'a 2v2 on arena02',
    config: configLumeth,
    arena: arena02,
    seeds: SEEDS_2V2,
    tiers: NORMAL_2V2,
    endTick: 4860,
    round: 1700,
    budget: 16_000,
  },
  {
    name: 'a 3v3 on arena01',
    config: configLumeth3v3,
    arena: arena01,
    seeds: SEEDS_3V3,
    tiers: NORMAL_3V3,
    endTick: 11167,
    round: 3400,
    budget: 25_000,
  },
  {
    name: 'a 3v3 on arena02',
    config: configLumeth3v3,
    arena: arena02,
    seeds: SEEDS_3V3,
    tiers: NORMAL_3V3,
    endTick: 7373,
    round: 3400,
    budget: 22_000,
  },
];

const played = new Map<string, Played>();

/** Plays a row once; the tests of the file share it, so the four matches run four times in all. */
function playRow(row: Row): Played {
  const known = played.get(row.name);
  if (known !== undefined) return known;
  const config: MatchConfig = { ...row.config(), roundsToWin: DEFAULT_ROUNDS_TO_WIN };
  const run = createRun(row.seeds, row.tiers, 7, { config, kits: LUMETH_SET.kits(), arena: row.arena });
  const result = play(LUMETH_SET, run, row.budget);
  console.log(`lumeth ${row.name}: matchEnd at tick ${result.state.tick}; ${result.summary}`);
  played.set(row.name, result);
  return result;
}

function lumeths(result: Played): number[] {
  return result.state.champions.flatMap((c) => (c.championId === 'lumeth' ? [c.id] : []));
}

describe('a match of bots with Lumeth, played to matchEnd', () => {
  it.each(ROWS)('ends $name with a winner on 3 rounds within its budget', { timeout: 120_000 }, (row) => {
    const result = playRow(row);
    const { state } = result;
    expect(state.match?.phase, result.summary).toBe('matchEnd');
    const score = state.match?.score;
    expect(Math.max(score?.A ?? 0, score?.B ?? 0), result.summary).toBe(DEFAULT_ROUNDS_TO_WIN);
    // Strictly: play stops at matchEnd, and a run that went on would end on the budget.
    expect(state.tick, result.summary).toBeLessThan(row.budget);
    expect(budgetOf(row.endTick, row.round)).toBe(row.budget);
    // The term holds for the rounds of this run: none that ended before sudden death ran longer.
    expect(Math.max(...result.rounds), result.summary).toBeLessThanOrEqual(row.round);
    expect(result.tally.blockedEscapes, result.summary).toBe(0);
    expectNoStall(result);
  });

  it.each(ROWS)('has a Lumeth heal an ally in $name', { timeout: 120_000 }, (row) => {
    const result = playRow(row);
    const heals = lumeths(result).map((id) => result.allyHeals[id] ?? 0);
    expect(Math.max(...heals), result.summary).toBeGreaterThan(0);
  });

  // What fires in these four matches, as measured: Lumeth presses M2 at an ally and R, hits an enemy
  // with M1, and escapes with Lantern Burst and with Glide (both in the 3v3 on arena02). The two
  // start-edit runs of headless-kits.test.ts (a Hargrim 2 m from Lumeth with Lantern Burst ready,
  // and with it cooling down) are the declared fallback for those two: a miss here after a change
  // to the bots, the sim or the Node version is governed by batch #53 decision 8.3.
  it('shows across the four matches an M2 ally heal, an R, an M1 hit on an enemy and both escapes', () => {
    const all = ROWS.map(playRow);
    const sum = (key: string) => all.reduce((n, r) => n + (r.hits[key] ?? 0), 0);
    const casts = (key: string) => all.reduce((n, r) => n + (r.slots[key] ?? 0), 0);
    expect(sum('lumeth:M2:ally'), 'M2 ally heals').toBeGreaterThan(0);
    expect(casts('lumeth:R'), 'R casts').toBeGreaterThan(0);
    expect(sum('lumeth:M1:enemy'), 'M1 hits on an enemy').toBeGreaterThan(0);
    expect(casts('lumeth:E'), 'Lantern Burst escapes').toBeGreaterThan(0);
    expect(all.reduce((n, r) => n + r.glides, 0), 'Glide escapes').toBeGreaterThan(0);
  });
});

describe('the press oracle in the warmup of a match', () => {
  it('accepts a press the sim ignores: the buttons of a bot that thinks in the warmup start nothing', () => {
    const config: MatchConfig = { ...configLumeth(), roundsToWin: DEFAULT_ROUNDS_TO_WIN };
    const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, { config, kits: LUMETH_SET.kits() });
    // A declared start edit: the two Hargrims stand 1.5 m apart, so each presses M1 in the warmup
    // (180 ticks) as soon as its reaction and cast delays are over.
    const first = run.state.champions[0];
    const second = run.state.champions[2];
    if (first === undefined || second === undefined) throw new Error('no champions');
    first.x = -3;
    first.y = 3;
    second.x = -1.5;
    second.y = 3;
    const result = play(LUMETH_SET, run, 100);
    expect(result.state.match?.phase).toBe('warmup');
    expect(result.presses[0], result.summary).toBeGreaterThan(0);
    expect(result.slots, result.summary).toEqual({});
  });
});
