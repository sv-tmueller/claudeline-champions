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
  ])('%s settles on attempt %i and writes the whole committed file', (kit, attempt) => {
    const outcome = searchFixture(loadKit(kit));
    if (!outcome.ok) throw new Error(`${kit}: ${JSON.stringify(outcome)}`);
    expect(outcome.attempt).toBe(attempt);
    expect(formatFixture(outcome.fixture)).toBe(committed(kit));
  });
});

/** The kit as it was before #125 changed one number, put back in memory only. */
function before125(id: string, put: (kit: Record<string, unknown>) => void): KitDef {
  const kit = structuredClone(loadKit(id)) as unknown as Record<string, unknown>;
  put(kit);
  return kit as unknown as KitDef;
}

describe('the fixture search reproduces the committed fixtures that #125 regenerated, on the kits they were searched on', () => {
  // #125 changed one number of Skerrow and one of Lumeth and regenerated only the checkpoints and
  // the checksum of their fixtures, so the segments and actions come from the search on the kit
  // before #125. On today's kits the search departs from the committed scripts: Skerrow settles on
  // another attempt, and Lumeth's script departs from about tick 1716. A kit is today's with the
  // number put back in memory; the current kit's checkpoints then give the committed file.
  function reproduces(id: string, searched: KitDef, attempt: number): void {
    const outcome = searchFixture(searched);
    if (!outcome.ok) throw new Error(`${id}: ${JSON.stringify(outcome)}`);
    expect(outcome.attempt).toBe(attempt);
    const rebuilt = buildFixture(loadKit(id), outcome.fixture.segments, outcome.fixture.actions);
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.missing).toEqual([]);
    expect(formatFixture(rebuilt.fixture)).toBe(committed(id));
  }

  it('skerrow, with Rend at 20 damage, settles on attempt 6 and, with the current checkpoints, writes the committed file', () => {
    const searched = before125('skerrow', (kit) => {
      const rend = (kit as { slots: { E: { effects: { effects: { amount: number }[] }[] } } }).slots.E.effects[0]
        ?.effects[0];
      if (rend?.amount !== 14) throw new Error('Rend is not the 14 damage of the current kit');
      rend.amount = 20;
    });
    reproduces('skerrow', searched, 6);
  });

  it('lumeth, with Binding Sigil at radius 1.5, settles on attempt 2 and, with the current checkpoints, writes the committed file', () => {
    const searched = before125('lumeth', (kit) => {
      const sigil = (kit as { slots: { Q: { effects: { radius: number }[] } } }).slots.Q.effects[0];
      if (sigil?.radius !== 2) throw new Error('Binding Sigil is not the radius 2 of the current kit');
      sigil.radius = 1.5;
    });
    reproduces('lumeth', searched, 2);
  });
});
