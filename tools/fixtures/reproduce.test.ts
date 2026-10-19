import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { KitDef } from '@claudeline/sim';
import { formatFixture } from './format.ts';
import { fixtureUrl, loadKit } from './files.ts';
import { buildFixture, searchFixture } from './search.ts';

// The search reproduces the committed fixtures byte for byte: the proof that the player, the
// stop rule and the writer are the ones that produced them (the record is in the header of
// packages/sim/test/roster-fixtures.test.ts). Each row is one search, about 0.1 to 0.5 s.

function committed(kit: string): string {
  return readFileSync(fixtureUrl(kit), 'utf8');
}

describe('the fixture search reproduces the committed fixtures on the current kits', () => {
  it.each([
    ['hargrim', 1],
    ['quillon', 23],
    ['skerrow', 6],
  ])('%s settles on attempt %i and writes the whole committed file', (kit, attempt) => {
    const outcome = searchFixture(loadKit(kit));
    if (!outcome.ok) throw new Error(`${kit}: ${JSON.stringify(outcome)}`);
    expect(outcome.attempt).toBe(attempt);
    expect(formatFixture(outcome.fixture)).toBe(committed(kit));
  });
});

describe('the fixture search reproduces the committed Lumeth fixture on the kit it was searched on', () => {
  // #125 changed Binding Sigil's radius from 1.5 to 2.0 and regenerated only the checkpoints of the
  // Lumeth fixture, so its segments and actions come from the search on the kit before #125. On
  // today's kit the search departs from the committed script from about tick 1716. The pre-#125 kit
  // is today's with the radius put back in memory; the current kit's checkpoints then give the file.
  it('lumeth settles on attempt 2 and, with the checkpoints of the current kit, writes the committed file', () => {
    const current = loadKit('lumeth');
    const before = structuredClone(current) as unknown as {
      slots: { Q: { effects: { radius: number }[] } };
    };
    const sigil = before.slots.Q.effects[0];
    if (sigil === undefined || sigil.radius !== 2) throw new Error('Binding Sigil is not the Q area of radius 2');
    sigil.radius = 1.5;

    const outcome = searchFixture(before as unknown as KitDef);
    if (!outcome.ok) throw new Error(`lumeth: ${JSON.stringify(outcome)}`);
    expect(outcome.attempt).toBe(2);

    const rebuilt = buildFixture(current, outcome.fixture.segments, outcome.fixture.actions);
    expect(rebuilt.problems).toEqual([]);
    expect(formatFixture(rebuilt.fixture)).toBe(committed('lumeth'));
  });
});
