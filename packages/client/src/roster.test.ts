import { describe, expect, it } from 'vitest';
import { ROSTER_IDS, championName } from './roster';

describe('champion display names', () => {
  it.each([
    ['hargrim', 'Hargrim'],
    ['quillon', 'Quillon'],
    ['lumeth', 'Lumeth'],
    ['skerrow', 'Skerrow'],
    ['ondrel', 'Ondrel'],
    ['brimwick', 'Brimwick'],
  ])('names %s %s, as docs/design/roster-v1.md and roster-v2.md do', (id, name) => {
    expect(championName(id)).toBe(name);
  });

  it('falls back to the id for an unknown champion', () => {
    expect(championName('x')).toBe('x');
    expect(championName('placeholder')).toBe('placeholder');
  });

  it('does not read inherited object keys as names', () => {
    expect(championName('constructor')).toBe('constructor');
    expect(championName('toString')).toBe('toString');
  });
});

describe('roster ids', () => {
  it('lists the six champions in the order of docs/design/roster-v1.md, then roster-v2.md', () => {
    expect(ROSTER_IDS).toEqual(['hargrim', 'quillon', 'lumeth', 'skerrow', 'ondrel', 'brimwick']);
  });

  it('has a name for every id', () => {
    for (const id of ROSTER_IDS) expect(championName(id)).not.toBe(id);
  });
});
