import { describe, expect, it } from 'vitest';
import { arenaEntries, selectEntries } from './result-dom';

const ARENAS = [
  { id: 'arena01', name: 'Arena 1' },
  { id: 'arena02', name: 'Arena 2' },
];

describe('champion select entries', () => {
  it('lists the four roster ids in order, with their names', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'normal', 'arena01');
    expect(entries.map((entry) => [entry.id, entry.name])).toEqual([
      ['hargrim', 'Hargrim'],
      ['quillon', 'Quillon'],
      ['lumeth', 'Lumeth'],
      ['skerrow', 'Skerrow'],
    ]);
  });

  it('links an id with a kit to a relaunch with the current difficulty and arena', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'hard', 'arena01');
    expect(entries[0]).toMatchObject({ available: true, href: '?champion=hargrim&difficulty=hard&arena=arena01' });
    expect(entries[1]).toMatchObject({ available: true, href: '?champion=quillon&difficulty=hard&arena=arena01' });
  });

  it('carries the arena that is being played, not the default', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'normal', 'arena02');
    expect(entries[0]?.href).toBe('?champion=hargrim&difficulty=normal&arena=arena02');
    expect(entries[1]?.href).toBe('?champion=quillon&difficulty=normal&arena=arena02');
  });

  it('greys an id without a kit and gives it no link', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'normal', 'arena01');
    expect(entries[2]).toMatchObject({ available: false, href: null });
    expect(entries[3]).toMatchObject({ available: false, href: null });
  });

  it('picks up a later kit file without a change', () => {
    const entries = selectEntries(['hargrim', 'quillon', 'lumeth'], 'easy', 'arena01');
    expect(entries[2]).toMatchObject({ available: true, href: '?champion=lumeth&difficulty=easy&arena=arena01' });
  });

  it('builds relative hrefs, so the build works under a subdirectory', () => {
    for (const entry of selectEntries(['hargrim'], 'normal', 'arena01')) {
      expect(entry.href === null || entry.href.startsWith('?')).toBe(true);
    }
  });
});

describe('arena select entries', () => {
  it('lists the arenas in the order given, with their names', () => {
    const entries = arenaEntries(ARENAS, 'hargrim', 'normal', 'arena01');
    expect(entries.map((entry) => [entry.id, entry.name])).toEqual([
      ['arena01', 'Arena 1'],
      ['arena02', 'Arena 2'],
    ]);
  });

  it('links each arena to a relaunch with the current champion and difficulty', () => {
    const entries = arenaEntries(ARENAS, 'quillon', 'hard', 'arena01');
    expect(entries.map((entry) => entry.href)).toEqual([
      '?champion=quillon&difficulty=hard&arena=arena01',
      '?champion=quillon&difficulty=hard&arena=arena02',
    ]);
  });

  it('flags the arena being played as current and no other', () => {
    expect(arenaEntries(ARENAS, 'hargrim', 'normal', 'arena02').map((entry) => entry.current)).toEqual([false, true]);
    expect(arenaEntries(ARENAS, 'hargrim', 'normal', 'arena01').map((entry) => entry.current)).toEqual([true, false]);
  });

  it('builds relative hrefs, so the build works under a subdirectory', () => {
    for (const entry of arenaEntries(ARENAS, 'hargrim', 'normal', 'arena01')) expect(entry.href.startsWith('?')).toBe(true);
  });
});
