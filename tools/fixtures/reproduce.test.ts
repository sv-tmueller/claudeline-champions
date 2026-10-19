import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { KitDef } from '@claudeline/sim';
import { formatFixture } from './format.ts';
import { fixtureUrl, loadKit } from './files.ts';
import { buildFixture, searchFixture } from './search.ts';

// The search reproduces the committed fixtures byte for byte: the proof that the player, the
// stop rule and the writer are the ones that produced them (the record is in the header of
// packages/sim/test/roster-fixtures.test.ts). Each row is one search: 1.06, 1.30, 1.52 and 1.72 s
// on the runner (CI run 39288426574, ubuntu-latest, Node 22), 0.33 to 0.60 s locally.
//
// What a kit change does to a row (decisions 12 and 13 of batch #134, balance.md section 6.3):
// - A change that turns the fixture coverage red rebuilds the fixture with the tool in the same
//   commit, and its row then takes the new attempt and the current kit (no pins).
// - A change that keeps the coverage green regenerates only the checksums of the fixture, so its
//   segments and actions stay the ones searched on the kit before the change. The search on the
//   current kit may then settle elsewhere (Skerrow on attempt 2, Lumeth on attempt 5), so the row
//   is pinned on the kit as searched: a pin puts the number the search ran on back in memory, and
//   the fixture is then written with the checkpoints of the current kit.
// A row names the kit numbers it is pinned on, each with the change that moved it.

/** A kit number the committed script was searched on, put back in memory for the search. */
interface Pin {
  /** The keys down from the kit to a number. */
  path: (string | number)[];
  /** The value the search ran on. */
  searched: number;
  /** The change that moved it since, so a reader knows the pin is deliberate. */
  why: string;
}

interface Row {
  kit: string;
  /** The first attempt that covers everything on the kit as searched. */
  attempt: number;
  pins: Pin[];
}

const ROWS: Row[] = [
  { kit: 'hargrim', attempt: 1, pins: [] },
  { kit: 'quillon', attempt: 23, pins: [] },
  {
    kit: 'skerrow',
    attempt: 6,
    pins: [
      {
        // Rend's base damage; its EX keeps its own number.
        path: ['slots', 'E', 'effects', 0, 'effects', 0, 'amount'],
        searched: 20,
        why: '#125 (decision 28 of batch #105) changed Rend from 20 to 14 and regenerated only the checkpoints',
      },
    ],
  },
  {
    kit: 'lumeth',
    attempt: 2,
    pins: [
      {
        // Binding Sigil's area radius.
        path: ['slots', 'Q', 'effects', 0, 'radius'],
        searched: 1.5,
        why: '#125 (decision 28 of batch #105) changed the radius from 1.5 to 2.0 and regenerated only the checkpoints',
      },
    ],
  },
  { kit: 'ondrel', attempt: 2, pins: [] },
  { kit: 'brimwick', attempt: 10, pins: [] },
];

function committed(kit: string): string {
  return readFileSync(fixtureUrl(kit), 'utf8');
}

/** The kit as the committed script was searched on it: a copy of the current kit with the pins put back. */
function searchedKit(id: string, pins: Pin[]): KitDef {
  const kit = structuredClone(loadKit(id)) as unknown as Record<string, unknown>;
  for (const pin of pins) {
    let holder: unknown = kit;
    for (const key of pin.path.slice(0, -1)) holder = (holder as Record<string | number, unknown>)[key];
    const last = pin.path[pin.path.length - 1] as string | number;
    if (typeof (holder as Record<string | number, unknown> | undefined)?.[last] !== 'number') {
      throw new Error(`${id}: the pin ${pin.path.join('.')} is not a number of the kit (${pin.why})`);
    }
    (holder as Record<string | number, number>)[last] = pin.searched;
  }
  return kit as unknown as KitDef;
}

describe('the fixture search reproduces the committed fixtures', () => {
  it.each(ROWS.map((row) => [row.kit, row.attempt, row] as const))(
    '%s settles on attempt %i on the kit as searched and writes the committed file',
    (id, attempt, row) => {
      const outcome = searchFixture(searchedKit(id, row.pins));
      if (!outcome.ok) throw new Error(`${id}: ${JSON.stringify(outcome)}`);
      expect(outcome.attempt).toBe(attempt);
      if (row.pins.length === 0) {
        expect(formatFixture(outcome.fixture)).toBe(committed(id));
        return;
      }
      // The checkpoints and the checksum are those of the current kit.
      const rebuilt = buildFixture(loadKit(id), outcome.fixture.segments, outcome.fixture.actions);
      expect(rebuilt.problems).toEqual([]);
      expect(rebuilt.missing).toEqual([]);
      expect(formatFixture(rebuilt.fixture)).toBe(committed(id));
    },
  );
});
