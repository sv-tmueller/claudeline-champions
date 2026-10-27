import { expect } from 'vitest';
import { DEFAULT_ROUNDS_TO_WIN } from '@claudeline/sim';
import type { ArenaDef, MatchConfig } from '@claudeline/sim';
import { arena01, arena02, createRun } from './helpers';
import { SIX_SET, expectNoStall, play } from './press-oracle';
import type { Played } from './press-oracle';

// The seeded matches of ondrel.test.ts and brimwick.test.ts: a bot of the new kit and a filler
// against a bot of one of the shipped kits and a filler, on both arenas, played to matchEnd (3
// rounds to win) on the six shipped kits. Every press of every tick passes the press oracle, the
// invariants hold, the bots leave the state alone and no bot stalls for more than 120 ticks. The
// seeds are pinned: a miss after a change to the bots, the sim or the Node version is governed by
// batch #53 decision 8.3.

export const NORMAL_2V2 = ['normal', 'normal', 'normal', 'normal'] as const;
export const SEEDS_2V2 = [101, 102, 103, 104];

/**
 * The tick budget of a match, by the formula of lumeth.test.ts and the client's match-setup.test.ts:
 * the end tick when the budget was set, plus two rounds of `round` ticks and one sudden-death round
 * of 7000, rounded up to 1000. `round` is the longest round that did not go to sudden death,
 * rounded up to 100. A run whose longest round passes its term fails, so the term follows the
 * rounds and not the old figures.
 */
export function budgetOf(endTick: number, round: number): number {
  return Math.ceil((endTick + 2 * round + 7000) / 1000) * 1000;
}

/** One cell: the champion `mine` with a filler against `other` with the same filler, on one arena. */
export interface Cell {
  name: string;
  mine: string;
  other: string;
  arena: ArenaDef;
  /** The tick the match ended on when the budget was set. */
  endTick: number;
  /** The longest round that did not go to sudden death, rounded up to 100. */
  round: number;
  budget: number;
}

/**
 * The filler of both teams: Hargrim, or Quillon when Hargrim is one of the two champions, so that
 * no champion is the filler of its own cell.
 */
export function fillerOf(mine: string, other: string): string {
  return mine === 'hargrim' || other === 'hargrim' ? 'quillon' : 'hargrim';
}

/** A cell from what its first run measured: the end tick and the longest ordinary round. */
export function cellOf(
  mine: string,
  other: string,
  arenaName: 'arena01' | 'arena02',
  endTick: number,
  longestRound: number,
): Cell {
  const round = Math.ceil(longestRound / 100) * 100;
  return {
    name: `${mine} against ${other} on ${arenaName}`,
    mine,
    other,
    arena: arenaName === 'arena01' ? arena01 : arena02,
    endTick,
    round,
    budget: budgetOf(endTick, round),
  };
}

export function configOf(mine: string, other: string): MatchConfig {
  const fill = fillerOf(mine, other);
  return {
    teamSize: 2,
    roundsToWin: DEFAULT_ROUNDS_TO_WIN,
    players: [
      { championId: mine, team: 'A' },
      { championId: fill, team: 'A' },
      { championId: other, team: 'B' },
      { championId: fill, team: 'B' },
    ],
  };
}

const played = new Map<string, Played>();

/** Plays a cell once; the tests of a file share it. */
export function playCell(cell: Cell): Played {
  const known = played.get(cell.name);
  if (known !== undefined) return known;
  const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, {
    config: configOf(cell.mine, cell.other),
    kits: SIX_SET.kits(),
    arena: cell.arena,
  });
  const result = play(SIX_SET, run, cell.budget);
  played.set(cell.name, result);
  return result;
}

/** The asserts every cell shares: a winner on 3 rounds inside the budget, no stall, no blocked escape. */
export function expectEnded(cell: Cell, result: Played): void {
  const { state } = result;
  expect(state.match?.phase, result.summary).toBe('matchEnd');
  const score = state.match?.score;
  expect(Math.max(score?.A ?? 0, score?.B ?? 0), result.summary).toBe(DEFAULT_ROUNDS_TO_WIN);
  // Strictly: play stops at matchEnd, and a run that went on would end on the budget.
  expect(state.tick, result.summary).toBeLessThan(cell.budget);
  // The term holds for the rounds of this run: none that ended before sudden death ran longer.
  expect(Math.max(...result.rounds), result.summary).toBeLessThanOrEqual(cell.round);
  expect(result.tally.blockedEscapes, result.summary).toBe(0);
  expectNoStall(result);
}
