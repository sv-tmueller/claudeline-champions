import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS_TO_WIN, RING_SOURCE_ID, createMatch, step } from '@claudeline/sim';
import type { ArenaDef, MatchConfig, PlayerInput, TeamId } from '@claudeline/sim';
import { createBot } from '@claudeline/bots';
import {
  MATCH_BUDGET_TICKS,
  REPORT_END,
  REPORT_START,
  botSeed,
  configs,
  inBand,
  matchConfig,
  pairings,
  fillCount,
  modeLines,
  planCells,
  playMatch,
  playCells,
  playSpec,
  renderReport,
  reportBlock,
  sameModeReport,
  sameReport,
  seedSchedule,
  seedsPerConfig,
  summarizeCell,
  summarizeChampions,
  withReport,
} from './harness.ts';
import type { Cell, Config, MatchRecord } from './harness.ts';
import { loadInputs } from './inputs.ts';

const DATA = loadInputs(new URL('../../', import.meta.url));
const KIT_IDS = DATA.kits.map((kit) => kit.id);
// The runs below play the four v1 kits whatever HARNESS_KITS holds, so their cost does not grow when
// the roster does (the six-kit shape is the cell plan test, which plays nothing).
const V1_IDS = ['hargrim', 'lumeth', 'quillon', 'skerrow'];
const V1 = { kits: DATA.kits.filter((kit) => V1_IDS.includes(kit.id)), arenas: DATA.arenas };
function arenaOf(id: string): ArenaDef {
  const arena = DATA.arenas.find((a) => a.id === id);
  if (arena === undefined) throw new Error(`no arena ${id}`);
  return arena;
}

const KITS = ['a', 'b', 'c', 'd'];

describe('the pairings, the fills and the configs', () => {
  it('has 6 unordered pairings over four kits, each once, in kit order', () => {
    const all = pairings(KITS).map((p) => `${p.x} v ${p.y}`);
    expect(all).toEqual(['a v b', 'a v c', 'a v d', 'b v c', 'b v d', 'c v d']);
  });

  it('has 24 configs: 2 fills for each pairing in 2v2 and 2 in 3v3', () => {
    const all = configs(KITS);
    expect(all).toHaveLength(24);
    expect(all.filter((c) => c.mode === '2v2')).toHaveLength(12);
    expect(all.filter((c) => c.mode === '3v3')).toHaveLength(12);
  });

  it('fills 2v2 with each champion outside the pair, and 3v3 with the other two in both orders', () => {
    const fills = (mode: string, x: string, y: string) =>
      configs(KITS)
        .filter((c) => c.mode === mode && c.x === x && c.y === y)
        .map((c) => c.fill.join('+'));
    expect(fills('2v2', 'a', 'b')).toEqual(['c', 'd']);
    expect(fills('2v2', 'b', 'd')).toEqual(['a', 'c']);
    expect(fills('3v3', 'a', 'b')).toEqual(['c+d', 'd+c']);
    expect(fills('3v3', 'c', 'd')).toEqual(['a+b', 'b+a']);
  });

  it('puts X first on team A for odd seeds and on team B for even seeds, the same fill on both', () => {
    const config = { mode: '2v2', x: 'a', y: 'b', fill: ['c'] } as const;
    const odd = matchConfig(config, 7);
    expect(odd.teamSize).toBe(2);
    expect(odd.players).toEqual([
      { championId: 'a', team: 'A' },
      { championId: 'c', team: 'A' },
      { championId: 'b', team: 'B' },
      { championId: 'c', team: 'B' },
    ]);
    const even = matchConfig(config, 8);
    expect(even.players).toEqual([
      { championId: 'b', team: 'A' },
      { championId: 'c', team: 'A' },
      { championId: 'a', team: 'B' },
      { championId: 'c', team: 'B' },
    ]);
    const three = matchConfig({ mode: '3v3', x: 'a', y: 'b', fill: ['c', 'd'] }, 1);
    expect(three.teamSize).toBe(3);
    expect(three.players.map((p) => `${p.championId}${p.team}`)).toEqual([
      'aA',
      'cA',
      'dA',
      'bB',
      'cB',
      'dB',
    ]);
  });

  it("gives the bot of champion id the seed of the client's rule, seed * 100 + id", () => {
    expect(botSeed(1, 0)).toBe(100);
    expect(botSeed(37, 5)).toBe(3705);
    expect(botSeed(100, 3)).toBe(10003);
  });
});

describe('the shipped data', () => {
  it('has the six kits, sorted, and both arenas', () => {
    expect(KIT_IDS).toEqual(['brimwick', 'hargrim', 'lumeth', 'ondrel', 'quillon', 'skerrow']);
    expect(DATA.arenas.map((a) => a.id)).toEqual(['arena01', 'arena02']);
    expect(pairings(KIT_IDS)).toHaveLength(15);
    // 4 fills in each 2v2 pairing and 12 in each 3v3 pairing.
    expect(configs(KIT_IDS)).toHaveLength(15 * (4 + 12));
  });
});

describe('the seed schedule', () => {
  it('counts the fills of a pairing: kits - 2 in 2v2, ordered pairs of the others in 3v3', () => {
    expect(fillCount('2v2', 4)).toBe(2);
    expect(fillCount('3v3', 4)).toBe(2);
    expect(fillCount('2v2', 6)).toBe(4);
    expect(fillCount('3v3', 6)).toBe(12);
    // It is the count the configs have.
    for (const mode of ['2v2', '3v3'] as const) {
      const first = configs(KITS).filter((c) => c.mode === mode && c.x === 'a' && c.y === 'b');
      expect(first).toHaveLength(fillCount(mode, KITS.length));
    }
  });

  it('gives the largest even number of seeds at or under 200 over the fills', () => {
    expect(seedsPerConfig(2)).toBe(100);
    expect(seedsPerConfig(4)).toBe(50);
    expect(seedsPerConfig(12)).toBe(16);
    // 200 / 3 is 66.7 and 200 / 7 is 28.6: rounded down to an even count, so the sides stay balanced.
    expect(seedsPerConfig(3)).toBe(66);
    expect(seedsPerConfig(7)).toBe(28);
    for (let fills = 1; fills <= 100; fills++) {
      const seeds = seedsPerConfig(fills);
      expect(seeds % 2, `${fills} fills`).toBe(0);
      expect(seeds * fills, `${fills} fills`).toBeLessThanOrEqual(200);
      expect((seeds + 2) * fills, `${fills} fills`).toBeGreaterThan(200);
    }
  });

  it('refuses a cell with so many fills that no even seed count fits', () => {
    expect(() => seedsPerConfig(101)).toThrow(/fills/);
    expect(() => seedsPerConfig(0)).toThrow(/fills/);
  });

  it('is 100 and 100 at four kits, today\'s 200 matches a cell', () => {
    expect(seedSchedule(4)).toEqual({ '2v2': 100, '3v3': 100 });
  });

  it('is 50 and 16 at six kits', () => {
    expect(seedSchedule(6)).toEqual({ '2v2': 50, '3v3': 16 });
  });
});

describe('the cell plan', () => {
  const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];
  const ARENAS = ['arena01', 'arena02'];
  // Nothing is played here: the shape of a six-kit run, which no unit test plays.
  const plan = planCells(SIX, ARENAS, seedSchedule(6));

  it('has 15 pairings and 60 cells over six kits and two arenas', () => {
    expect(pairings(SIX)).toHaveLength(15);
    expect(plan).toHaveLength(60);
  });

  it('has 4 fills in each 2v2 cell and 12 in each 3v3 cell', () => {
    expect(plan.filter((c) => c.mode === '2v2').every((c) => c.configs.length === 4)).toBe(true);
    expect(plan.filter((c) => c.mode === '3v3').every((c) => c.configs.length === 12)).toBe(true);
    expect(plan.filter((c) => c.mode === '2v2')).toHaveLength(30);
    expect(plan.filter((c) => c.mode === '3v3')).toHaveLength(30);
    // A cell holds the configs of its own pairing and mode only.
    const cell = plan.find((c) => c.mode === '3v3' && c.x === 'b' && c.y === 'e');
    expect(cell?.configs.map((c) => c.fill.join('+'))).toEqual([
      'a+c', 'a+d', 'a+f', 'c+a', 'c+d', 'c+f', 'd+a', 'd+c', 'd+f', 'f+a', 'f+c', 'f+d',
    ]);
  });

  it('puts 50 seeds on the 2v2 cells and 16 on the 3v3 cells, 200 and 192 matches', () => {
    expect(new Set(plan.filter((c) => c.mode === '2v2').map((c) => c.seeds))).toEqual(new Set([50]));
    expect(new Set(plan.filter((c) => c.mode === '3v3').map((c) => c.seeds))).toEqual(new Set([16]));
    const matches = (c: (typeof plan)[number]) => c.configs.length * c.seeds;
    expect(plan.filter((c) => c.mode === '2v2').map(matches)).toEqual(Array<number>(30).fill(200));
    expect(plan.filter((c) => c.mode === '3v3').map(matches)).toEqual(Array<number>(30).fill(192));
  });

  it('orders the cells by mode, then arena, then pairing', () => {
    const name = (c: (typeof plan)[number]) => `${c.mode} ${c.arena} ${c.x} v ${c.y}`;
    expect(plan.slice(0, 3).map(name)).toEqual(['2v2 arena01 a v b', '2v2 arena01 a v c', '2v2 arena01 a v d']);
    expect(plan.slice(14, 17).map(name)).toEqual(['2v2 arena01 e v f', '2v2 arena02 a v b', '2v2 arena02 a v c']);
    expect(plan.slice(29, 32).map(name)).toEqual(['2v2 arena02 e v f', '3v3 arena01 a v b', '3v3 arena01 a v c']);
    expect(name(plan[59] as (typeof plan)[number])).toBe('3v3 arena02 e v f');
  });

  it('plans one mode only when the schedule names one', () => {
    const only = planCells(SIX, ARENAS, { '3v3': 16 });
    expect(only).toHaveLength(30);
    expect(only.every((c) => c.mode === '3v3')).toBe(true);
  });

  it('refuses a mode that has a pairing with no fill, and no pairing at all', () => {
    expect(() => planCells(['a', 'b', 'c'], ARENAS, { '2v2': 2, '3v3': 2 })).toThrow(/no fill/);
    expect(() => planCells(['a', 'b'], ARENAS, { '2v2': 2 })).toThrow(/no fill/);
    expect(() => planCells(['a'], ARENAS, { '2v2': 2 })).toThrow(/no pairing/);
    // Three kits have every fill of 2v2, so a 2v2-only plan is fine there.
    expect(planCells(['a', 'b', 'c'], ARENAS, { '2v2': 2 })).toHaveLength(6);
  });
});

/** What the reference loop reads off a match, in the harness's own record shape. */
function referenceRecord(match: MatchConfig, arena: ArenaDef, seed: number): MatchRecord {
  const state = createMatch({ ...match, roundsToWin: DEFAULT_ROUNDS_TO_WIN }, arena, seed, DATA.kits);
  const bots = state.champions.map((c) => createBot(c.id, 'normal', seed * 100 + c.id));
  const rounds: MatchRecord['rounds'] = [];
  let startedAt = 0;
  let sudden = false;
  let firstHit: number | null = null;
  let winner: TeamId | null = null;
  for (let t = 0; t < 60_000 && state.match?.phase !== 'matchEnd'; t++) {
    const inputs: PlayerInput[] = bots.map((bot) => ({ ...bot.think(state) }));
    step(state, inputs);
    for (const e of state.events) {
      if (e.type === 'roundStarted') {
        startedAt = state.tick;
        sudden = false;
        firstHit = null;
      } else if (e.type === 'suddenDeathStarted') {
        sudden = true;
      } else if (e.type === 'damage' && e.sourceId !== RING_SOURCE_ID) {
        const source = state.champions[e.sourceId];
        const target = state.champions[e.targetId];
        if (firstHit === null && source !== undefined && target !== undefined && source.team !== target.team) {
          firstHit = state.tick - startedAt;
        }
      } else if (e.type === 'roundEnded') {
        rounds.push({
          length: state.tick - startedAt,
          suddenDeath: sudden,
          draw: e.winner === null,
          firstHit,
        });
      } else if (e.type === 'matchEnded') {
        winner = e.winner;
      }
    }
  }
  return { winner, endTick: state.tick, budgetHit: state.match?.phase !== 'matchEnd', rounds };
}

describe('playMatch', () => {
  // X on team A (odd seed): the match config is written out here, not taken from matchConfig.
  it('equals a reference loop in a 2v2 on arena01', { timeout: 30_000 }, () => {
    const config: Config = { mode: '2v2', x: 'hargrim', y: 'lumeth', fill: ['quillon'] };
    const match: MatchConfig = {
      teamSize: 2,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'lumeth', team: 'B' },
        { championId: 'quillon', team: 'B' },
      ],
    };
    const record = playMatch(config, arenaOf('arena01'), DATA.kits, 3);
    expect(record).toEqual(referenceRecord(match, arenaOf('arena01'), 3));
    expect(record.winner).not.toBeNull();
    expect(record.rounds.length).toBeGreaterThanOrEqual(3);
  });

  // X on team B (even seed), three a side.
  it('equals a reference loop in a 3v3 on arena02', { timeout: 30_000 }, () => {
    const config: Config = { mode: '3v3', x: 'quillon', y: 'skerrow', fill: ['hargrim', 'lumeth'] };
    const match: MatchConfig = {
      teamSize: 3,
      players: [
        { championId: 'skerrow', team: 'A' },
        { championId: 'hargrim', team: 'A' },
        { championId: 'lumeth', team: 'A' },
        { championId: 'quillon', team: 'B' },
        { championId: 'hargrim', team: 'B' },
        { championId: 'lumeth', team: 'B' },
      ],
    };
    const record = playMatch(config, arenaOf('arena02'), DATA.kits, 4);
    expect(record).toEqual(referenceRecord(match, arenaOf('arena02'), 4));
    expect(record.winner).not.toBeNull();
  });

  it('stops at the tick budget with a budget hit and no winner', () => {
    const config: Config = { mode: '2v2', x: 'hargrim', y: 'quillon', fill: ['skerrow'] };
    const record = playMatch(config, arenaOf('arena01'), DATA.kits, 1, 500);
    expect(record.budgetHit).toBe(true);
    expect(record.winner).toBeNull();
    expect(record.endTick).toBe(500);
    // 180 ticks of warmup and no round can end in the next 320.
    expect(record.rounds).toEqual([]);
  });

  // The match of issue #123, seed 6: Quillon v Skerrow, three a side with Lumeth and Hargrim, on
  // arena01. Its Hargrims stood from tick 480 to the budget on the bots of 9a9c653 (one ulp inside
  // the centre pillar's inflated circle, no plan out); main's bots end it, but so do main's bots
  // without the tolerance (the match takes another course), so this row is red on 9a9c653 and not
  // under a mutation of the tolerance, which touching.test.ts pins. No end tick is pinned: any
  // change to the bots would move it, and this row says only that the match ends.
  it('ends the match of #123, seed 6, in a decision and not at the budget', () => {
    const config: Config = { mode: '3v3', x: 'quillon', y: 'skerrow', fill: ['lumeth', 'hargrim'] };
    const record = playMatch(config, arenaOf('arena01'), DATA.kits, 6);
    expect(record.budgetHit).toBe(false);
    expect(record.winner).not.toBeNull();
  });

  // The two kits the six-kit report adds, one match a mode on seed 1 (first fill, arena01): each ends in
  // a decision inside the budget. They are the smoke rows of the new kits; the cells themselves are played by
  // `npm run balance`, never by a unit test.
  it.each([
    { name: 'a 2v2', config: { mode: '2v2', x: 'brimwick', y: 'ondrel', fill: ['hargrim'] } as Config },
    { name: 'a 3v3', config: { mode: '3v3', x: 'brimwick', y: 'ondrel', fill: ['hargrim', 'lumeth'] } as Config },
  ])('ends Brimwick v Ondrel in $name at seed 1 with no budget hit', ({ config }) => {
    const record = playMatch(config, arenaOf('arena01'), DATA.kits, 1);
    expect(record.budgetHit).toBe(false);
    expect(record.winner).not.toBeNull();
  });

  // The runs of packages/bots/test/lumeth.test.ts, with its configs, bot seeds 101 and up by champion
  // id and match seed 7: the harness plays the same match as the bots' own tests, so the end ticks
  // they pin (6623, 7521, 6773 and 10934) come out of it too.
  it.each([
    { name: 'a 2v2 on arena01', arena: 'arena01', size: 2, endTick: 6623 },
    { name: 'a 2v2 on arena02', arena: 'arena02', size: 2, endTick: 7521 },
    { name: 'a 3v3 on arena01', arena: 'arena01', size: 3, endTick: 6773 },
    { name: 'a 3v3 on arena02', arena: 'arena02', size: 3, endTick: 10934 },
  ] as const)('reproduces the end tick of the Lumeth run of the bots tests, $name', ({ arena, size, endTick }) => {
    const team = (ids: readonly string[], t: TeamId) => ids.map((championId) => ({ championId, team: t }));
    const match: MatchConfig =
      size === 2
        ? {
            teamSize: 2,
            players: [...team(['hargrim', 'lumeth'], 'A'), ...team(['hargrim', 'quillon'], 'B')],
          }
        : {
            teamSize: 3,
            players: [
              ...team(['hargrim', 'quillon', 'lumeth'], 'A'),
              ...team(['hargrim', 'quillon', 'lumeth'], 'B'),
            ],
          };
    const record = playSpec({
      match,
      arena: arenaOf(arena),
      matchSeed: 7,
      botSeeds: [101, 102, 103, 104, 105, 106],
      kits: DATA.kits,
      maxTicks: MATCH_BUDGET_TICKS,
    });
    expect(record.budgetHit).toBe(false);
    expect(record.endTick).toBe(endTick);
  });
});

// Synthetic records: two seeds on two fills of one 2v2 cell, so every figure is worked out by hand.
// Seed 1 puts X on team A and seed 2 on team B.
function round(length: number, firstHit: number | null, flags: { sudden?: true; draw?: true } = {}) {
  return { length, firstHit, suddenDeath: flags.sudden === true, draw: flags.draw === true };
}
function record(winner: TeamId | null, rounds: MatchRecord['rounds'], budgetHit = false): MatchRecord {
  return { winner, endTick: 9000, budgetHit, rounds };
}
const TWO = { '2v2': 2, '3v3': 2 };
const SYNTHETIC: Cell = {
  mode: '2v2',
  arena: 'arena01',
  x: 'a',
  y: 'b',
  played: [
    // X on A wins 3 rounds to 0.
    { fill: 'c', seed: 1, record: record('A', [round(1000, 300), round(2000, 500), round(1500, 400)]) },
    // X on B loses; the second round went to sudden death.
    { fill: 'c', seed: 2, record: record('A', [round(1200, 200), round(8000, null, { sudden: true })]) },
    // The budget: no winner, nothing counted for the rate.
    { fill: 'd', seed: 1, record: record(null, [], true) },
    // X on B wins; one round was drawn.
    {
      fill: 'd',
      seed: 2,
      record: record('B', [round(600, 100, { draw: true }), round(900, 150), round(700, null)]),
    },
  ],
};

describe('the aggregation', () => {
  it('counts the rate over the decided matches, by fill and by side', () => {
    const s = summarizeCell(SYNTHETIC);
    expect(s.matches).toBe(4);
    expect(s.seeds).toBe(2);
    expect(s.decided).toBe(3);
    expect(s.xWins).toBe(2);
    expect(s.asA).toEqual({ wins: 1, decided: 1 });
    expect(s.asB).toEqual({ wins: 1, decided: 2 });
    expect(s.fills).toEqual([
      { fill: 'c', xWins: 1, decided: 2 },
      { fill: 'd', xWins: 1, decided: 1 },
    ]);
    expect(s.budgetHits).toEqual([{ fill: 'd', seed: 1 }]);
  });

  it('measures the non-sudden rounds, the sudden-death rounds, the first hits and the draws', () => {
    const s = summarizeCell(SYNTHETIC);
    expect(s.rounds).toEqual({ total: 8, normal: 7, normalTicks: 7900, longest: 2000, sudden: 1, draws: 1 });
    expect(s.firstHits).toEqual({ count: 6, ticks: 1650 });
  });

  it('puts the band at 40 to 60 percent inclusive, on the exact rate', () => {
    expect(inBand(40, 100)).toBe(true);
    expect(inBand(60, 100)).toBe(true);
    expect(inBand(39, 100)).toBe(false);
    expect(inBand(61, 100)).toBe(false);
    expect(inBand(79, 200)).toBe(false);
    expect(inBand(80, 200)).toBe(true);
    expect(inBand(0, 0)).toBe(false);
  });

  it('sums the champions over the cells they are in, as X or as Y', () => {
    const other: Cell = {
      ...SYNTHETIC,
      arena: 'arena02',
      x: 'b',
      y: 'c',
      played: [{ fill: 'a', seed: 1, record: record('B', [round(1000, 100)]) }],
    };
    const cells = [summarizeCell(SYNTHETIC), summarizeCell(other)];
    const by = (id: string) => summarizeChampions(['a', 'b', 'c'], cells).find((c) => c.id === id);
    // a is X in the first cell: 2 of 3. b is Y there (1 of 3) and X in the second, on A and
    // losing: 1 of 4 in all. c is Y in the second, where it wins as B: 1 of 1.
    expect(by('a')).toMatchObject({ wins: 2, decided: 3 });
    expect(by('b')).toMatchObject({ wins: 1, decided: 4 });
    expect(by('c')).toMatchObject({ wins: 1, decided: 1 });
    expect(by('a')?.groups).toEqual([{ mode: '2v2', arena: 'arena01', wins: 2, decided: 3 }]);
  });
});

describe('the report', () => {
  const report = renderReport({ head: 'abc1234', seeds: TWO, kitIds: ['a', 'b', 'c'], cells: [SYNTHETIC] });
  const lines = report.split('\n');

  it('opens with the marker and the short head, and closes with the end marker', () => {
    expect(lines[0]).toBe(REPORT_START);
    expect(lines[1]).toBe('Generated by `npm run balance` from the sources at `abc1234`.');
    expect(lines.at(-1)).toBe(REPORT_END);
    expect(report.endsWith(`${REPORT_END}\n`)).toBe(false);
  });

  it('has one row for the cell, with the rate, the sides, the verdict and the round figures', () => {
    const row =
      '| 2v2 | arena01 | a v b | c 50.0, d 100.0 | 2 / 4 | 66.7 | 1/1 | 1/2 | outside | 1129 | 2000 | 1 of 8 | 275 | 1 | 1 |';
    expect(lines.filter((l) => l.startsWith('| 2v2 |'))).toEqual([row]);
  });

  it('lists the budget hits and the cells in band', () => {
    expect(report).toContain('Cells in band: 0 of 1.');
    expect(report).toContain('- a v b, 2v2, arena01, with d: seed 1');
  });

  it('has a row for each champion, with n/a where it has no decided match', () => {
    expect(report).toContain('| a | 66.7 | 66.7 |');
    expect(report).toContain('| b | 33.3 | 33.3 |');
    expect(report).toContain('| c | - | n/a |');
  });

  it('says "for each config" when the modes share a seed count, and each count when they differ', () => {
    const same = renderReport({ head: 'abc1234', seeds: { '2v2': 100, '3v3': 100 }, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
    expect(same).toContain("Seeds 1 to 100 for each config, every bot at the normal tier. X's rate");
    const differ = renderReport({ head: 'abc1234', seeds: { '2v2': 50, '3v3': 16 }, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
    expect(differ).toContain('Seeds 1 to 50 for each 2v2 config and 1 to 16 for each 3v3 config, every bot at');
    expect(differ).not.toContain('for each config');
    // One mode played: its count alone, for each config.
    const one = renderReport({ head: 'abc1234', seeds: { '3v3': 16 }, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
    expect(one).toContain('Seeds 1 to 16 for each config, every bot');
  });

  it('marks a cell at 50 percent as in band and counts it', () => {
    const even: Cell = {
      ...SYNTHETIC,
      played: [
        { fill: 'c', seed: 1, record: record('A', [round(1000, 300)]) },
        { fill: 'c', seed: 2, record: record('A', [round(1000, 300)]) },
      ],
    };
    const text = renderReport({ head: 'abc1234', seeds: TWO, kitIds: ['a', 'b'], cells: [even] });
    expect(text).toContain('| 50.0 | 1/1 | 0/1 | in band |');
    expect(text).toContain('Cells in band: 1 of 1.');
  });

  it('says so when no match hit the budget', () => {
    const none = renderReport({
      head: 'abc1234',
      seeds: TWO,
      kitIds: ['a', 'b'],
      cells: [{ ...SYNTHETIC, played: SYNTHETIC.played.filter((p) => !p.record.budgetHit) }],
    });
    expect(none).toContain('No match hit the budget of 60000 ticks.');
  });
});

describe('a run', () => {
  // Runner (ubuntu-latest, Node 22): 47.3 to 59.6 s before the dodge of #137, 62.4 s on 787cd0c (unit job
  // 117369238607); 22.4 s locally (Apple M5 Pro, Node 22.23.2; 18.6 s before). Timeout: twice the slowest runner
  // time is 124.8 s, so 150 s (testing.md, Check suite; it was 120 s).
  it('plays 24 cells over the shipped data, and two 2-seed runs render the same bytes', { timeout: 150_000 }, () => {
    const run = () => {
      const cells = playCells(V1, TWO);
      return { cells, text: renderReport({ head: 'abc1234', seeds: TWO, kitIds: V1_IDS, cells }) };
    };
    const first = run();
    const second = run();
    expect(second.text).toBe(first.text);
    expect(first.cells).toHaveLength(24);
    // The order: the modes, then the arenas, then the pairings.
    expect(first.cells.slice(0, 7).map((c) => `${c.mode} ${c.arena} ${c.x} v ${c.y}`)).toEqual([
      '2v2 arena01 hargrim v lumeth',
      '2v2 arena01 hargrim v quillon',
      '2v2 arena01 hargrim v skerrow',
      '2v2 arena01 lumeth v quillon',
      '2v2 arena01 lumeth v skerrow',
      '2v2 arena01 quillon v skerrow',
      '2v2 arena02 hargrim v lumeth',
    ]);
    // Two seeds on each of the two fills of a 2v2, and on the two orders of the fill of a 3v3.
    expect(first.cells.map((c) => c.played.length)).toEqual([
      ...Array<number>(12).fill(4),
      ...Array<number>(12).fill(4),
    ]);
    expect(first.cells.flatMap((c) => c.played).every((p) => !p.record.budgetHit)).toBe(true);
  });
});

describe('a run of one mode', () => {
  // 24 matches: 1.8 s locally (Apple M5 Pro, Node 22.23.2), 2.7 s on the runner (ubuntu-latest, Node 22).
  // Timeout: twice the runner time is 5.4 s, so 10 s (testing.md, Check suite).
  it('plays only the cells of the mode the schedule names, with its seed count', { timeout: 10_000 }, () => {
    const cells = playCells(V1, { '2v2': 1 });
    // 6 pairings on 2 arenas; one seed on each of the 2 fills.
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.mode === '2v2' && c.played.length === 2)).toBe(true);
    expect(cells.flatMap((c) => c.played).every((p) => p.seed === 1)).toBe(true);
  });
});

describe('a run of the 3v3 mode alone', () => {
  // Replaces the 3v3 row of the CLI test (run.test.ts), which at six kits plays 360 matches: 34 s locally and
  // about 75 s on a runner (#195). This plays the same path on the four v1 kits, 24 matches: the 3v3 cells of a
  // one-seed schedule and their rendering, with no 2v2 row.
  // 3.1 s locally (Apple M5 Pro, Node 22.23.2); 5.3 s on the runner for the 24-match CLI row it stands in for
  // (job 122044371924), so about 7 s. Twice that is 14 s: the timeout is 15 s (testing.md, Check suite).
  it('plays and renders the 3v3 cells of a one-seed schedule, and no 2v2 cell', { timeout: 15_000 }, () => {
    const seeds = { '3v3': 1 };
    const cells = playCells(V1, seeds);
    // 6 pairings on 2 arenas; 2 ordered fills and one seed each.
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.mode === '3v3' && c.played.length === 2)).toBe(true);
    const lines = renderReport({ head: 'abc1234', seeds, kitIds: V1_IDS, cells }).split('\n');
    expect(lines.filter((line) => /^\| 3v3 \|/.test(line))).toHaveLength(12);
    expect(lines.filter((line) => /^\| 2v2 \|/.test(line))).toHaveLength(0);
  });
});

describe('a run over too few kits', () => {
  it('throws before the first match when a pairing has no fill in a mode', () => {
    // Three kits give every pairing one fill in 2v2 and none in 3v3, which needs two champions outside the pair.
    const three = { kits: DATA.kits.slice(0, 3), arenas: DATA.arenas };
    let played = 0;
    expect(() =>
      playCells(three, { '2v2': 1, '3v3': 1 }, () => {
        played++;
      }),
    ).toThrow(/no fill/);
    expect(played).toBe(0);
  });

  it('throws before the first match when there is no pairing at all', () => {
    // One kit has no pairing, so the check above never runs and the run would play 0 matches and return [].
    const one = { kits: DATA.kits.slice(0, 1), arenas: DATA.arenas };
    let played = 0;
    expect(() =>
      playCells(one, { '2v2': 1, '3v3': 1 }, () => {
        played++;
      }),
    ).toThrow(/no pairing/);
    expect(played).toBe(0);
  });
});

describe('the committed block and --check', () => {
  const report = renderReport({ head: 'abc1234', seeds: TWO, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
  const doc = `# Balance\n\nBefore.\n\n${report}\n\nAfter.\n`;

  it('finds the block between its markers, and null when there is none', () => {
    expect(reportBlock(doc)).toBe(report);
    expect(reportBlock('# Balance\n')).toBeNull();
  });

  it('replaces the block and keeps the text around it', () => {
    const next = `${REPORT_START}\nnew\n${REPORT_END}`;
    expect(withReport(doc, next)).toBe(`# Balance\n\nBefore.\n\n${next}\n\nAfter.\n`);
    expect(() => withReport('# Balance\n', next)).toThrow();
  });

  it('ignores the head line and nothing else', () => {
    const other = renderReport({ head: 'fff0000', seeds: TWO, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
    expect(other).not.toBe(report);
    expect(sameReport(other, report)).toBe(true);
    expect(sameReport(report.replace('66.7', '66.8'), report)).toBe(false);
    expect(sameReport(report.replace('\n\n', '\n'), report)).toBe(false);
    expect(sameReport(report, report.replace('\n\n', '\n'))).toBe(false);
    // A block that continues the other one is not the same.
    expect(sameReport(report, `${report}\nmore`)).toBe(false);
    expect(sameReport(`${report}\nmore`, report)).toBe(false);
    const moreSeeds = renderReport({ head: 'abc1234', seeds: { '2v2': 3, '3v3': 3 }, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
    expect(sameReport(moreSeeds, report)).toBe(false);
    expect(sameReport(report.replace('| outside |', '| in band |'), report)).toBe(false);
  });
});

describe('--check of one mode', () => {
  const cells: Cell[] = [
    SYNTHETIC,
    { ...SYNTHETIC, mode: '3v3', x: 'a', y: 'c', played: [{ fill: 'b+d', seed: 1, record: record('A', [round(1000, 300)]) }] },
    { ...SYNTHETIC, mode: '3v3', arena: 'arena02', played: [{ fill: 'c+d', seed: 1, record: record(null, [], true) }] },
  ];
  const block = renderReport({ head: 'abc1234', seeds: TWO, kitIds: ['a', 'b', 'c', 'd'], cells });

  it('reads the cell rows and the budget-hit lines of one mode', () => {
    expect(modeLines(block, '2v2')).toEqual([
      expect.stringMatching(/^\| 2v2 \| arena01 \| a v b \|/),
      '- a v b, 2v2, arena01, with d: seed 1',
    ]);
    expect(modeLines(block, '3v3')).toEqual([
      expect.stringMatching(/^\| 3v3 \| arena01 \| a v c \|/),
      expect.stringMatching(/^\| 3v3 \| arena02 \| a v b \|/),
      '- a v b, 3v3, arena02, with c+d: seed 1',
    ]);
  });

  it('fails when a row of the mode changed', () => {
    expect(sameModeReport(block, block.replace('| 66.7 | 1/1 |', '| 66.8 | 1/1 |'), '2v2')).toBe(false);
    expect(sameModeReport(block, block.replace('| 1 of 8 |', '| 2 of 8 |'), '2v2')).toBe(false);
  });

  it('fails when a budget-hit line of the mode changed, appeared or went', () => {
    expect(sameModeReport(block, block.replace('with d: seed 1', 'with d: seed 2'), '2v2')).toBe(false);
    expect(sameModeReport(block, block.replace('- a v b, 2v2, arena01, with d: seed 1\n', ''), '2v2')).toBe(false);
    expect(sameModeReport(block.replace('- a v b, 3v3, arena02, with c+d: seed 1\n', ''), block, '3v3')).toBe(false);
  });

  it('passes when only a row or a budget-hit line of the other mode changed', () => {
    const otherRow = block.replace('| 3v3 | arena01 | a v c | b+d 100.0 |', '| 3v3 | arena01 | a v c | b+d 0.0 |');
    expect(otherRow).not.toBe(block);
    expect(sameModeReport(block, otherRow, '2v2')).toBe(true);
    expect(sameModeReport(block, otherRow, '3v3')).toBe(false);
    const otherHit = block.replace('with c+d: seed 1', 'with c+d: seed 9');
    expect(sameModeReport(block, otherHit, '2v2')).toBe(true);
    expect(sameModeReport(block, otherHit, '3v3')).toBe(false);
  });

  it('passes on the other lines of the block, the head and the rows of the other mode', () => {
    const other = renderReport({ head: 'fff0000', seeds: TWO, kitIds: ['a', 'b', 'c', 'd'], cells });
    expect(sameModeReport(block, other.replace('Cells in band: 0 of 3.', 'Cells in band: 1 of 3.'), '2v2')).toBe(true);
    expect(sameModeReport(block, other, '2v2')).toBe(true);
  });

  it('compares a block of one mode with the committed block of both', () => {
    const only2v2 = renderReport({ head: 'abc1234', seeds: { '2v2': 2 }, kitIds: ['a', 'b', 'c', 'd'], cells: [SYNTHETIC] });
    expect(sameModeReport(block, only2v2, '2v2')).toBe(true);
    // The fresh run of 2v2 has no 3v3 row, so it cannot stand for the 3v3 rows of the committed block.
    expect(sameModeReport(block, only2v2, '3v3')).toBe(false);
  });

  it('fails when neither block has a row of the mode, so an empty comparison never passes', () => {
    const only2v2 = renderReport({ head: 'abc1234', seeds: { '2v2': 2 }, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
    expect(sameModeReport(only2v2, only2v2, '3v3')).toBe(false);
  });
});
