import { DEFAULT_ROUNDS_TO_WIN, RING_SOURCE_ID, createMatch, step } from '@claudeline/sim';
import type { ArenaDef, KitDef, MatchConfig, PlayerConfig, PlayerInput, TeamId } from '@claudeline/sim';
import { createBot } from '@claudeline/bots';

// The bot-versus-bot balance harness: pure. It plays the shipped bots through the entry points of
// @claudeline/sim and @claudeline/bots, reads no file and no clock, and returns plain data, so the
// same inputs give the same report byte for byte. run.ts reads the data/ files and writes the doc.

export type Mode = '2v2' | '3v3';

/** An unordered pairing of two different kits, X before Y in kit order. */
export interface Pairing {
  x: string;
  y: string;
}

/**
 * One match-up: X and the fill against Y and the same fill. X is the first champion of its team,
 * the fill follows. The mode fixes the fill's size, 1 in 2v2 and 2 in 3v3.
 */
export interface Config extends Pairing {
  mode: Mode;
  fill: readonly string[];
}

/** The pairings of the kits: every unordered pair of different ids, in the order of `kitIds`. */
export function pairings(kitIds: readonly string[]): Pairing[] {
  const all: Pairing[] = [];
  kitIds.forEach((x, i) => {
    for (const y of kitIds.slice(i + 1)) all.push({ x, y });
  });
  return all;
}

/** The champions outside the pair, in kit order. */
function outside(pairing: Pairing, kitIds: readonly string[]): string[] {
  return kitIds.filter((id) => id !== pairing.x && id !== pairing.y);
}

/**
 * The fills of a pairing: each champion outside it in 2v2, and in 3v3 each ordered pair of
 * champions outside it, so both orders of the two (the order sets the spawn slots, which swing a
 * cell by tens of points).
 */
function fillsOf(mode: Mode, pairing: Pairing, kitIds: readonly string[]): string[][] {
  const others = outside(pairing, kitIds);
  if (mode === '2v2') return others.map((id) => [id]);
  return others.flatMap((z) => others.filter((w) => w !== z).map((w) => [z, w]));
}

/** Every config over the kits: the 2v2 ones, then the 3v3 ones, each by pairing and then by fill. */
export function configs(kitIds: readonly string[]): Config[] {
  const modes: Mode[] = ['2v2', '3v3'];
  return modes.flatMap((mode) =>
    pairings(kitIds).flatMap((pairing) =>
      fillsOf(mode, pairing, kitIds).map((fill) => ({ ...pairing, mode, fill })),
    ),
  );
}

/** True when X plays on team A: odd seeds, so that the sides alternate with the seed. */
export function xOnTeamA(seed: number): boolean {
  return seed % 2 === 1;
}

/** The match config of a seed: X and the fill on one team, Y and the fill on the other, by `xOnTeamA`. */
export function matchConfig(config: Config, seed: number): MatchConfig {
  const xTeam: TeamId = xOnTeamA(seed) ? 'A' : 'B';
  const yTeam: TeamId = xTeam === 'A' ? 'B' : 'A';
  const team = (lead: string, team: TeamId): PlayerConfig[] =>
    [lead, ...config.fill].map((championId) => ({ championId, team }));
  const x = team(config.x, xTeam);
  const y = team(config.y, yTeam);
  return {
    teamSize: config.mode === '2v2' ? 2 : 3,
    players: xTeam === 'A' ? [...x, ...y] : [...y, ...x],
  };
}

/** The seed of the bot of champion `id` in the match of seed `seed`: the client's rule (bot-driver.ts). */
export function botSeed(seed: number, id: number): number {
  return seed * 100 + id;
}

/** A match that has not ended after this many ticks is a budget hit (the longest measured ends near 25 500). */
export const MATCH_BUDGET_TICKS = 60_000;

/** One round of a match. Ticks count from the start of the round. */
export interface RoundRecord {
  /** The ticks from `roundStarted` to `roundEnded`. */
  length: number;
  /** The round went to sudden death. */
  suddenDeath: boolean;
  /** The round was drawn: no team won it. */
  draw: boolean;
  /** The tick of the first `damage` from a champion to a champion of the other team, ring excluded. */
  firstHit: number | null;
}

/** One match: the winning team (null when it hit the budget), the tick it ended on and its rounds. */
export interface MatchRecord {
  winner: TeamId | null;
  endTick: number;
  /** The match had not ended after `maxTicks` ticks. Its unfinished round is not in `rounds`. */
  budgetHit: boolean;
  rounds: RoundRecord[];
}

/** Everything a match needs: `playSpec` is `playMatch` without the config and seed rules. */
export interface MatchSpec {
  match: MatchConfig;
  arena: ArenaDef;
  matchSeed: number;
  /** The seed of the bot of champion id i is `botSeeds[i]`. */
  botSeeds: readonly number[];
  kits: readonly KitDef[];
  maxTicks: number;
}

/**
 * Plays one match with a normal bot for every champion: each tick every bot thinks, then the sim
 * steps, until `matchEnded` or `maxTicks` ticks. The kits are handed to `createMatch` as given,
 * which validates them.
 */
export function playSpec(spec: MatchSpec): MatchRecord {
  const state = createMatch(
    { ...spec.match, roundsToWin: DEFAULT_ROUNDS_TO_WIN },
    spec.arena,
    spec.matchSeed,
    spec.kits,
  );
  const bots = state.champions.map((c) => {
    const seed = spec.botSeeds[c.id];
    if (seed === undefined) throw new Error(`no bot seed for champion ${c.id}`);
    return createBot(c.id, 'normal', seed);
  });
  // A bot returns its own record and the sim copies it in `step`, so no copy is needed here.
  const inputs: PlayerInput[] = [];
  const rounds: RoundRecord[] = [];
  let winner: TeamId | null = null;
  let startedAt = 0;
  let suddenDeath = false;
  let firstHit: number | null = null;
  let ended = false;
  while (!ended && state.tick < spec.maxTicks) {
    bots.forEach((bot, i) => {
      inputs[i] = bot.think(state);
    });
    step(state, inputs);
    for (const e of state.events) {
      if (e.type === 'roundStarted') {
        startedAt = state.tick;
        suddenDeath = false;
        firstHit = null;
      } else if (e.type === 'suddenDeathStarted') {
        suddenDeath = true;
      } else if (e.type === 'damage') {
        if (firstHit === null && e.sourceId !== RING_SOURCE_ID) {
          const source = state.champions[e.sourceId];
          const target = state.champions[e.targetId];
          if (source !== undefined && target !== undefined && source.team !== target.team) {
            firstHit = state.tick - startedAt;
          }
        }
      } else if (e.type === 'roundEnded') {
        rounds.push({ length: state.tick - startedAt, suddenDeath, draw: e.winner === null, firstHit });
      } else if (e.type === 'matchEnded') {
        winner = e.winner;
        ended = true;
      }
    }
  }
  return { winner, endTick: state.tick, budgetHit: !ended, rounds };
}

/**
 * Plays the match of `config` on `arena` with seed `seed`: the match seed is `seed`, the bot of
 * champion id i has `botSeed(seed, i)`, and the sides follow `matchConfig`.
 */
export function playMatch(
  config: Config,
  arena: ArenaDef,
  kits: readonly KitDef[],
  seed: number,
  maxTicks: number = MATCH_BUDGET_TICKS,
): MatchRecord {
  const match = matchConfig(config, seed);
  return playSpec({
    match,
    arena,
    matchSeed: seed,
    botSeeds: match.players.map((_, id) => botSeed(seed, id)),
    kits,
    maxTicks,
  });
}

/** What a run plays: every kit (raw JSON) and every arena, in report order. */
export interface RunInputs {
  kits: readonly KitDef[];
  arenas: readonly ArenaDef[];
}

/**
 * Plays every cell: the modes, then the arenas, then the pairings; within a cell each fill in
 * turn with the seeds 1 to `seeds`. `onMatch` hears of each finished match, for progress only.
 */
export function playCells(
  inputs: RunInputs,
  seeds: number,
  onMatch?: (done: number) => void,
): Cell[] {
  const kitIds = inputs.kits.map((kit) => kit.id);
  const all = configs(kitIds);
  const allPairings = pairings(kitIds);
  // One kit (or none) has no pairing, so the loop below never runs and the run would play 0 matches.
  if (allPairings.length === 0) throw new Error('There is no pairing: a run needs at least two kits.');
  // A pairing with no fill in a mode (fewer than three kits in 2v2, four in 3v3) would read as a cell
  // of 0 matches, so refuse before the first match.
  for (const mode of ['2v2', '3v3'] as const) {
    for (const pairing of allPairings) {
      if (!all.some((c) => c.mode === mode && c.x === pairing.x && c.y === pairing.y)) {
        throw new Error(`${pairing.x} v ${pairing.y} has no fill in ${mode}: it needs more kits.`);
      }
    }
  }
  const cells: Cell[] = [];
  let done = 0;
  for (const mode of ['2v2', '3v3'] as const) {
    for (const arena of inputs.arenas) {
      for (const pairing of allPairings) {
        const cell: Cell = { mode, arena: arena.id, x: pairing.x, y: pairing.y, played: [] };
        const mine = all.filter((c) => c.mode === mode && c.x === pairing.x && c.y === pairing.y);
        for (const config of mine) {
          for (let seed = 1; seed <= seeds; seed++) {
            const record = playMatch(config, arena, inputs.kits, seed);
            cell.played.push({ fill: config.fill.join('+'), seed, record });
            onMatch?.(++done);
          }
        }
        cells.push(cell);
      }
    }
  }
  return cells;
}

/** One played match of a cell: the fill it had and the seed, with its record. */
export interface Played {
  fill: string;
  seed: number;
  record: MatchRecord;
}

/** A cell of the report: a mode, an arena and a pairing, with every match of every fill. */
export interface Cell extends Pairing {
  mode: Mode;
  arena: string;
  played: Played[];
}

/** Wins out of the matches that ended. */
export interface Tally {
  wins: number;
  decided: number;
}

export interface CellSummary extends Pairing {
  mode: Mode;
  arena: string;
  /** The distinct seeds played. */
  seeds: number;
  matches: number;
  /** The matches that ended before the budget; the rate is over these. */
  decided: number;
  xWins: number;
  /** X's results when it played on team A (odd seeds) and on team B. */
  asA: Tally;
  asB: Tally;
  fills: { fill: string; xWins: number; decided: number }[];
  budgetHits: { fill: string; seed: number }[];
  rounds: {
    total: number;
    /** The rounds that did not go to sudden death, their summed ticks and the longest. */
    normal: number;
    normalTicks: number;
    longest: number;
    sudden: number;
    draws: number;
  };
  firstHits: { count: number; ticks: number };
}

/** The band of decision 6 of batch #105: X's win rate, in percent, from 40 to 60 inclusive. */
export const BAND_LOW = 40;
export const BAND_HIGH = 60;

/** True when `wins` of `decided` is inside the band; compared on the exact rate, in integers. */
export function inBand(wins: number, decided: number): boolean {
  return decided > 0 && wins * 100 >= BAND_LOW * decided && wins * 100 <= BAND_HIGH * decided;
}

/** Counts a cell's matches: the budget hits are listed and left out of every rate. */
export function summarizeCell(cell: Cell): CellSummary {
  const summary: CellSummary = {
    mode: cell.mode,
    arena: cell.arena,
    x: cell.x,
    y: cell.y,
    seeds: new Set(cell.played.map((p) => p.seed)).size,
    matches: cell.played.length,
    decided: 0,
    xWins: 0,
    asA: { wins: 0, decided: 0 },
    asB: { wins: 0, decided: 0 },
    fills: [],
    budgetHits: [],
    rounds: { total: 0, normal: 0, normalTicks: 0, longest: 0, sudden: 0, draws: 0 },
    firstHits: { count: 0, ticks: 0 },
  };
  for (const { fill, seed, record } of cell.played) {
    let entry = summary.fills.find((f) => f.fill === fill);
    if (entry === undefined) {
      entry = { fill, xWins: 0, decided: 0 };
      summary.fills.push(entry);
    }
    for (const r of record.rounds) {
      summary.rounds.total++;
      if (r.draw) summary.rounds.draws++;
      if (r.suddenDeath) {
        summary.rounds.sudden++;
      } else {
        summary.rounds.normal++;
        summary.rounds.normalTicks += r.length;
        summary.rounds.longest = Math.max(summary.rounds.longest, r.length);
      }
      if (r.firstHit !== null) {
        summary.firstHits.count++;
        summary.firstHits.ticks += r.firstHit;
      }
    }
    if (record.winner === null) {
      summary.budgetHits.push({ fill, seed });
      continue;
    }
    const xTeam: TeamId = xOnTeamA(seed) ? 'A' : 'B';
    const won = record.winner === xTeam ? 1 : 0;
    const side = xTeam === 'A' ? summary.asA : summary.asB;
    summary.decided++;
    summary.xWins += won;
    side.decided++;
    side.wins += won;
    entry.decided++;
    entry.xWins += won;
  }
  return summary;
}

export interface ChampionSummary extends Tally {
  id: string;
  /** The champion's tally in each mode and arena, in the order of the cells. */
  groups: { mode: Mode; arena: string; wins: number; decided: number }[];
}

/** The markers of the generated block in docs/design/balance.md. */
export const REPORT_START = '<!-- balance:report -->';
export const REPORT_END = '<!-- /balance:report -->';
/** The head line is the only line `--check` does not compare. */
const HEAD_PREFIX = 'Generated by `npm run balance`';

/** `wins` of `decided` in percent with one decimal, worked out in integers; `n/a` without a match. */
function percent(wins: number, decided: number): string {
  if (decided === 0) return 'n/a';
  const tenths = Math.round((wins * 1000) / decided);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** The mean of `ticks` over `count`, to a whole tick; a dash without any. */
function mean(ticks: number, count: number): string {
  return count === 0 ? '-' : String(Math.round(ticks / count));
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function cellRow(s: CellSummary): string {
  const fills = s.fills.map((f) => `${f.fill} ${percent(f.xWins, f.decided)}`).join(', ');
  return row([
    s.mode,
    s.arena,
    `${s.x} v ${s.y}`,
    fills,
    `${s.seeds} / ${s.matches}`,
    percent(s.xWins, s.decided),
    `${s.asA.wins}/${s.asA.decided}`,
    `${s.asB.wins}/${s.asB.decided}`,
    inBand(s.xWins, s.decided) ? 'in band' : 'outside',
    mean(s.rounds.normalTicks, s.rounds.normal),
    String(s.rounds.longest),
    `${s.rounds.sudden} of ${s.rounds.total}`,
    mean(s.firstHits.ticks, s.firstHits.count),
    String(s.rounds.draws),
    String(s.budgetHits.length),
  ]);
}

const CELL_HEADER = [
  'Mode',
  'Arena',
  'X v Y',
  "Fills (X's rate)",
  'Seeds / matches',
  'X rate %',
  'X wins as A',
  'X wins as B',
  'Verdict',
  'Round mean',
  'Round longest',
  'Sudden-death rounds',
  'First hit mean',
  'Drawn rounds',
  'Budget hits',
];

export interface ReportInput {
  /** The short head the sources were read at; it goes into the head line only. */
  head: string;
  /** The seeds played, 1 to `seeds`. */
  seeds: number;
  kitIds: readonly string[];
  cells: readonly Cell[];
}

/** The generated block of balance.md, from its start marker to its end marker, with no trailing newline. */
export function renderReport(input: ReportInput): string {
  const summaries = input.cells.map(summarizeCell);
  const inside = summaries.filter((s) => inBand(s.xWins, s.decided)).length;
  const lines: string[] = [
    REPORT_START,
    `${HEAD_PREFIX} from the sources at \`${input.head}\`.`,
    '',
    `Seeds 1 to ${input.seeds} for each config, every bot at the normal tier. X's rate`,
    'is the share of the decided matches X won, in percent; the band is 40 to 60',
    'inclusive, on the exact rate.',
    `Cells in band: ${inside} of ${summaries.length}.`,
    '',
    '### Cells',
    '',
    row(CELL_HEADER),
    row(CELL_HEADER.map(() => '---')),
    ...summaries.map(cellRow),
    '',
    '### Budget hits',
    '',
  ];
  const hits = summaries.flatMap((s) =>
    s.budgetHits.map((h) => `- ${s.x} v ${s.y}, ${s.mode}, ${s.arena}, with ${h.fill}: seed ${h.seed}`),
  );
  if (hits.length === 0) {
    lines.push(`No match hit the budget of ${MATCH_BUDGET_TICKS} ticks.`);
  } else {
    lines.push(`Matches that did not end in ${MATCH_BUDGET_TICKS} ticks, left out of the rates:`, '', ...hits);
  }
  const champions = summarizeChampions(input.kitIds, summaries);
  const groups = summaries
    .filter((s, i) => summaries.findIndex((o) => o.mode === s.mode && o.arena === s.arena) === i)
    .map((s) => ({ mode: s.mode, arena: s.arena }));
  const header = ['Champion', ...groups.map((g) => `${g.mode} ${g.arena}`), 'All'];
  lines.push(
    '',
    '### Champions',
    '',
    'Win rate in percent over the cells the champion is in, as X or as Y.',
    '',
    row(header),
    row(header.map(() => '---')),
    ...champions.map((c) =>
      row([
        c.id,
        ...groups.map((g) => {
          const found = c.groups.find((o) => o.mode === g.mode && o.arena === g.arena);
          return found === undefined ? '-' : percent(found.wins, found.decided);
        }),
        percent(c.wins, c.decided),
      ]),
    ),
    REPORT_END,
  );
  return lines.join('\n');
}

/** The block of a document, from the start marker to the end marker; null without both. */
export function reportBlock(doc: string): string | null {
  const start = doc.indexOf(REPORT_START);
  const end = doc.indexOf(REPORT_END);
  if (start < 0 || end < start) return null;
  return doc.slice(start, end + REPORT_END.length);
}

/** The document with its block replaced by `report`; throws when it has no block. */
export function withReport(doc: string, report: string): string {
  const old = reportBlock(doc);
  if (old === null) throw new Error(`the document has no block between ${REPORT_START} and ${REPORT_END}`);
  return doc.replace(old, () => report);
}

/** The lines of a block except the head line, which `--check` does not compare. */
export function withoutHead(block: string): string[] {
  return block.split('\n').filter((line) => !line.startsWith(HEAD_PREFIX));
}

/** True when two blocks are the same except for the head line (`--check`). */
export function sameReport(a: string, b: string): boolean {
  const x = withoutHead(a);
  const y = withoutHead(b);
  return x.length === y.length && x.every((line, i) => line === y[i]);
}

/** A champion's matches in the cells it is X or Y in: X's wins for X, the rest for Y. */
export function summarizeChampions(
  kitIds: readonly string[],
  cells: readonly CellSummary[],
): ChampionSummary[] {
  return kitIds.map((id) => {
    const summary: ChampionSummary = { id, wins: 0, decided: 0, groups: [] };
    for (const cell of cells) {
      if (cell.x !== id && cell.y !== id) continue;
      const wins = cell.x === id ? cell.xWins : cell.decided - cell.xWins;
      let group = summary.groups.find((g) => g.mode === cell.mode && g.arena === cell.arena);
      if (group === undefined) {
        group = { mode: cell.mode, arena: cell.arena, wins: 0, decided: 0 };
        summary.groups.push(group);
      }
      group.wins += wins;
      group.decided += cell.decided;
      summary.wins += wins;
      summary.decided += cell.decided;
    }
    return summary;
  });
}
