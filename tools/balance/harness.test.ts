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
  playMatch,
  playCells,
  playSpec,
  renderReport,
  reportBlock,
  sameReport,
  summarizeCell,
  summarizeChampions,
  withReport,
} from './harness.ts';
import type { Cell, Config, MatchRecord } from './harness.ts';
import { loadInputs } from './inputs.ts';

const DATA = loadInputs(new URL('../../', import.meta.url));
const KIT_IDS = DATA.kits.map((kit) => kit.id);
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
  it('has the four kits, sorted, and both arenas', () => {
    expect(KIT_IDS).toEqual(['hargrim', 'lumeth', 'quillon', 'skerrow']);
    expect(DATA.arenas.map((a) => a.id)).toEqual(['arena01', 'arena02']);
    expect(pairings(KIT_IDS)).toHaveLength(6);
    expect(configs(KIT_IDS)).toHaveLength(24);
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
  // the centre pillar's inflated circle, no plan out), and the tolerance of the bots' geometry ends
  // it. No end tick is pinned: any change to the bots would move it, and this row says only that the
  // match ends.
  it('ends the match of #123, seed 6, in a decision and not at the budget', () => {
    const config: Config = { mode: '3v3', x: 'quillon', y: 'skerrow', fill: ['lumeth', 'hargrim'] };
    const record = playMatch(config, arenaOf('arena01'), DATA.kits, 6);
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
  const report = renderReport({ head: 'abc1234', seeds: 2, kitIds: ['a', 'b', 'c'], cells: [SYNTHETIC] });
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

  it('marks a cell at 50 percent as in band and counts it', () => {
    const even: Cell = {
      ...SYNTHETIC,
      played: [
        { fill: 'c', seed: 1, record: record('A', [round(1000, 300)]) },
        { fill: 'c', seed: 2, record: record('A', [round(1000, 300)]) },
      ],
    };
    const text = renderReport({ head: 'abc1234', seeds: 2, kitIds: ['a', 'b'], cells: [even] });
    expect(text).toContain('| 50.0 | 1/1 | 0/1 | in band |');
    expect(text).toContain('Cells in band: 1 of 1.');
  });

  it('says so when no match hit the budget', () => {
    const none = renderReport({
      head: 'abc1234',
      seeds: 2,
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
      const cells = playCells(DATA, 2);
      return { cells, text: renderReport({ head: 'abc1234', seeds: 2, kitIds: KIT_IDS, cells }) };
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

describe('a run over too few kits', () => {
  it('throws before the first match when a pairing has no fill in a mode', () => {
    // Three kits give every pairing one fill in 2v2 and none in 3v3, which needs two champions outside the pair.
    const three = { kits: DATA.kits.slice(0, 3), arenas: DATA.arenas };
    let played = 0;
    expect(() =>
      playCells(three, 1, () => {
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
      playCells(one, 1, () => {
        played++;
      }),
    ).toThrow(/no pairing/);
    expect(played).toBe(0);
  });
});

describe('the committed block and --check', () => {
  const report = renderReport({ head: 'abc1234', seeds: 2, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
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
    const other = renderReport({ head: 'fff0000', seeds: 2, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
    expect(other).not.toBe(report);
    expect(sameReport(other, report)).toBe(true);
    expect(sameReport(report.replace('66.7', '66.8'), report)).toBe(false);
    expect(sameReport(report.replace('\n\n', '\n'), report)).toBe(false);
    expect(sameReport(report, report.replace('\n\n', '\n'))).toBe(false);
    // A block that continues the other one is not the same.
    expect(sameReport(report, `${report}\nmore`)).toBe(false);
    expect(sameReport(`${report}\nmore`, report)).toBe(false);
    const moreSeeds = renderReport({ head: 'abc1234', seeds: 3, kitIds: ['a', 'b'], cells: [SYNTHETIC] });
    expect(sameReport(moreSeeds, report)).toBe(false);
    expect(sameReport(report.replace('| outside |', '| in band |'), report)).toBe(false);
  });
});
