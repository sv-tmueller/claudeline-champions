import { describe, expect, it } from 'vitest';
import { orbPointFor } from '@claudeline/sim';
import type { MatchConfig } from '@claudeline/sim';
import orbsJson from '../../../data/orbs.json';
import { createRun } from './helpers';
import { SIX_SET, play } from './press-oracle';
import type { Played } from './press-oracle';
import { NORMAL_2V2, SEEDS_2V2, cellOf, configOf, expectEnded } from './six-cells';
import type { Cell } from './six-cells';

// The seeded 2v2 with the energy orb on (#225, bots.md The energy orb): a Quillon with a Hargrim
// against a Lumeth with a Hargrim, 3 rounds to win, the orb of `data/orbs.json` on each arena,
// normal bots with the seeds of the other cells, played to matchEnd. The rule is that of
// orb.test.ts: a bot contests the orb when it is up, no enemy is in its reach and it is nearer than
// every enemy. Here it is measured as a match: the bots take the orb in most of the rounds in which
// it becomes collectible, nothing stalls past 120 ticks, the budget holds, every press passes the
// press oracle and `think` leaves the state alone (play checks the last two on every tick).
//
// Why this pair and not the Hargrim and Quillon mirror of the product's match: the mirror's rounds
// end before tick 1200 but for one of its 6 rounds (both arenas), so it has 0 and 1 orb rounds on
// the two arenas and nothing to assert; the pair with Lumeth, whose
// rounds last 1000 to 1800 ticks, has 4 and 3 (bots.md, The energy orb, has the scan of all 42
// pairings). The two cells
// are the only committed matches of the batch (testing.md, Check suite: the unit job is near its
// time). A cell takes 3.7 s locally (a Linux x86 host, Node 24.22): the timeout of 60 s is that of
// the other long cells (brimwick.test.ts).

// What the first run measured: the end tick and the longest ordinary round, see six-cells.ts.
const CELLS: Cell[] = [
  cellOf('quillon', 'lumeth', 'arena01', 8176, 1823),
  cellOf('quillon', 'lumeth', 'arena02', 7329, 1666),
];

function playOrb(cell: Cell): Played {
  const point = orbPointFor(orbsJson, cell.arena);
  if (point === undefined) throw new Error(`no orb point for ${cell.arena.id}`);
  const config: MatchConfig = { ...configOf(cell.mine, cell.other), energyOrb: point };
  const run = createRun(SEEDS_2V2, NORMAL_2V2, 7, {
    config,
    kits: SIX_SET.kits(),
    arena: cell.arena,
  });
  return play(SIX_SET, run, cell.budget);
}

describe('a 2v2 with the energy orb on, played to matchEnd', () => {
  it.each(CELLS)('takes the orb in most rounds on $arena.id', { timeout: 60_000 }, (cell) => {
    const result = playOrb(cell);
    console.log(
      `orb match ${cell.arena.id}: ended ${result.state.tick}, longest round ${Math.max(...result.rounds)}, orb rounds ${result.orb.rounds}, taken ${result.orb.taken} (A ${result.orb.byTeam.A}, B ${result.orb.byTeam.B}), worst stall ${result.worst.length}`,
    );
    expectEnded(cell, result);
    expect(result.orb.rounds, result.summary).toBeGreaterThan(0);
    // The rule's point: more than half of the rounds in which the orb is collectible end with it taken.
    expect(result.orb.taken * 2, result.summary).toBeGreaterThan(result.orb.rounds);
    expect(result.orb.byTeam.A + result.orb.byTeam.B).toBe(result.orb.taken);
  });
});
