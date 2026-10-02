import { describe, expect, it } from 'vitest';
import { championName } from './roster';

describe('champion display names', () => {
  it.each([
    ['hargrim', 'Hargrim'],
    ['quillon', 'Quillon'],
    ['lumeth', 'Lumeth'],
    ['skerrow', 'Skerrow'],
  ])('names %s %s, as docs/design/roster-v1.md does', (id, name) => {
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
