import { describe, expect, it } from 'vitest';
import { selectEntries } from './result-dom';

describe('champion select entries', () => {
  it('lists the four roster ids in order, with their names', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'normal');
    expect(entries.map((entry) => [entry.id, entry.name])).toEqual([
      ['hargrim', 'Hargrim'],
      ['quillon', 'Quillon'],
      ['lumeth', 'Lumeth'],
      ['skerrow', 'Skerrow'],
    ]);
  });

  it('links an id with a kit to a relaunch with the current difficulty', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'hard');
    expect(entries[0]).toMatchObject({ available: true, href: '?champion=hargrim&difficulty=hard' });
    expect(entries[1]).toMatchObject({ available: true, href: '?champion=quillon&difficulty=hard' });
  });

  it('greys an id without a kit and gives it no link', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'normal');
    expect(entries[2]).toMatchObject({ available: false, href: null });
    expect(entries[3]).toMatchObject({ available: false, href: null });
  });

  it('picks up a later kit file without a change', () => {
    const entries = selectEntries(['hargrim', 'quillon', 'lumeth'], 'easy');
    expect(entries[2]).toMatchObject({ available: true, href: '?champion=lumeth&difficulty=easy' });
  });

  it('builds relative hrefs, so the build works under a subdirectory', () => {
    for (const entry of selectEntries(['hargrim'], 'normal')) {
      expect(entry.href === null || entry.href.startsWith('?')).toBe(true);
    }
  });
});
