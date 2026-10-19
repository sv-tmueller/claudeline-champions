import type { ArenaDef } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import { arenaEntries, difficultyEntries, selectEntries, teamEntries } from './result-dom';

const ARENAS = [
  { id: 'arena01', name: 'Arena 1' },
  { id: 'arena02', name: 'Arena 2' },
];

const THREE_SPAWNS = { teamA: [[-12, 2], [-12, -2], [-12, 0]], teamB: [[12, 2], [12, -2], [12, 0]] } as ArenaDef['spawns'];
const TWO_SPAWNS = { teamA: THREE_SPAWNS.teamA.slice(0, 2), teamB: THREE_SPAWNS.teamB.slice(0, 2) } as ArenaDef['spawns'];

describe('champion select entries', () => {
  it('lists the four roster ids in order, with their names', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'normal', 'arena01', 2);
    expect(entries.map((entry) => [entry.id, entry.name])).toEqual([
      ['hargrim', 'Hargrim'],
      ['quillon', 'Quillon'],
      ['lumeth', 'Lumeth'],
      ['skerrow', 'Skerrow'],
    ]);
  });

  it('lists the four roster ids when the kit files are six, since an id the client has no name or model for is not on the select', () => {
    const six = ['hargrim', 'quillon', 'lumeth', 'skerrow', 'ondrel', 'brimwick'];
    const entries = selectEntries(six, 'normal', 'arena01', 2);
    expect(entries.map((entry) => entry.id)).toEqual(['hargrim', 'quillon', 'lumeth', 'skerrow']);
    expect(entries.every((entry) => entry.available)).toBe(true);
  });

  it('links an id with a kit to a relaunch with the current difficulty and arena', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'hard', 'arena01', 2);
    expect(entries[0]).toMatchObject({ available: true, href: '?champion=hargrim&difficulty=hard&arena=arena01&teamsize=2' });
    expect(entries[1]).toMatchObject({ available: true, href: '?champion=quillon&difficulty=hard&arena=arena01&teamsize=2' });
  });

  it('carries the arena that is being played, not the default', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'normal', 'arena02', 2);
    expect(entries[0]?.href).toBe('?champion=hargrim&difficulty=normal&arena=arena02&teamsize=2');
    expect(entries[1]?.href).toBe('?champion=quillon&difficulty=normal&arena=arena02&teamsize=2');
  });

  it('greys an id without a kit and gives it no link', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'normal', 'arena01', 2);
    expect(entries[2]).toMatchObject({ available: false, href: null });
    expect(entries[3]).toMatchObject({ available: false, href: null });
  });

  it('picks up a later kit file without a change', () => {
    const entries = selectEntries(['hargrim', 'quillon', 'lumeth'], 'easy', 'arena01', 2);
    expect(entries[2]).toMatchObject({ available: true, href: '?champion=lumeth&difficulty=easy&arena=arena01&teamsize=2' });
  });

  it('builds relative hrefs, so the build works under a subdirectory', () => {
    for (const entry of selectEntries(['hargrim'], 'normal', 'arena01', 2)) {
      expect(entry.href === null || entry.href.startsWith('?')).toBe(true);
    }
  });
});

describe('arena select entries', () => {
  it('lists the arenas in the order given, with their names', () => {
    const entries = arenaEntries(ARENAS, 'hargrim', 'normal', 'arena01', 2);
    expect(entries.map((entry) => [entry.id, entry.name])).toEqual([
      ['arena01', 'Arena 1'],
      ['arena02', 'Arena 2'],
    ]);
  });

  it('links each arena to a relaunch with the current champion and difficulty', () => {
    const entries = arenaEntries(ARENAS, 'quillon', 'hard', 'arena01', 2);
    expect(entries.map((entry) => entry.href)).toEqual([
      '?champion=quillon&difficulty=hard&arena=arena01&teamsize=2',
      '?champion=quillon&difficulty=hard&arena=arena02&teamsize=2',
    ]);
  });

  it('flags the arena being played as current and no other', () => {
    expect(arenaEntries(ARENAS, 'hargrim', 'normal', 'arena02', 2).map((entry) => entry.current)).toEqual([false, true]);
    expect(arenaEntries(ARENAS, 'hargrim', 'normal', 'arena01', 2).map((entry) => entry.current)).toEqual([true, false]);
  });

  it('builds relative hrefs, so the build works under a subdirectory', () => {
    for (const entry of arenaEntries(ARENAS, 'hargrim', 'normal', 'arena01', 2)) expect(entry.href.startsWith('?')).toBe(true);
  });
});

describe('the select keeps the team size', () => {
  it('writes the team size of 3 into every champion link', () => {
    const entries = selectEntries(['hargrim', 'quillon'], 'hard', 'arena02', 3);
    expect(entries[0]?.href).toBe('?champion=hargrim&difficulty=hard&arena=arena02&teamsize=3');
    expect(entries[1]?.href).toBe('?champion=quillon&difficulty=hard&arena=arena02&teamsize=3');
  });

  it('writes the team size of 3 into every arena link', () => {
    expect(arenaEntries(ARENAS, 'quillon', 'hard', 'arena01', 3).map((entry) => entry.href)).toEqual([
      '?champion=quillon&difficulty=hard&arena=arena01&teamsize=3',
      '?champion=quillon&difficulty=hard&arena=arena02&teamsize=3',
    ]);
  });
});

describe('team select entries', () => {
  it('lists 2v2 then 3v3, each linking to the whole setup with its own team size', () => {
    const entries = teamEntries('quillon', 'hard', 'arena02', 2, { spawns: THREE_SPAWNS });
    expect(entries.map((entry) => [entry.size, entry.label, entry.href])).toEqual([
      [2, '2v2', '?champion=quillon&difficulty=hard&arena=arena02&teamsize=2'],
      [3, '3v3', '?champion=quillon&difficulty=hard&arena=arena02&teamsize=3'],
    ]);
    expect(entries.map((entry) => entry.available)).toEqual([true, true]);
  });

  it('flags the size being played as current and no other', () => {
    expect(teamEntries('hargrim', 'normal', 'arena01', 2, { spawns: THREE_SPAWNS }).map((entry) => entry.current)).toEqual([true, false]);
    expect(teamEntries('hargrim', 'normal', 'arena01', 3, { spawns: THREE_SPAWNS }).map((entry) => entry.current)).toEqual([false, true]);
  });

  it('greys the 3v3 link of an arena with two spawns a team and flags 2v2 as the one played', () => {
    const entries = teamEntries('hargrim', 'normal', 'arena03', 3, { spawns: TWO_SPAWNS });
    expect(entries[1]).toMatchObject({ size: 3, available: false, href: null, current: false });
    expect(entries[0]).toMatchObject({ size: 2, available: true, current: true });
  });

  it('builds relative hrefs, so the build works under a subdirectory', () => {
    for (const entry of teamEntries('hargrim', 'normal', 'arena01', 2, { spawns: THREE_SPAWNS })) {
      expect(entry.href === null || entry.href.startsWith('?')).toBe(true);
    }
  });
});

describe('difficulty select entries', () => {
  it('lists easy, normal and hard in that order, with their labels', () => {
    const entries = difficultyEntries('hargrim', 'normal', 'arena01', 2);
    expect(entries.map((entry) => [entry.tier, entry.label])).toEqual([
      ['easy', 'Easy'],
      ['normal', 'Normal'],
      ['hard', 'Hard'],
    ]);
  });

  it('flags the launch tier as current and no other', () => {
    expect(difficultyEntries('hargrim', 'easy', 'arena01', 2).map((entry) => entry.current)).toEqual([true, false, false]);
    expect(difficultyEntries('hargrim', 'normal', 'arena01', 2).map((entry) => entry.current)).toEqual([false, true, false]);
    expect(difficultyEntries('hargrim', 'hard', 'arena01', 2).map((entry) => entry.current)).toEqual([false, false, true]);
  });

  it('links each tier to the whole setup with its own tier, the arena and the asked team size', () => {
    const entries = difficultyEntries('quillon', 'hard', 'arena02', 3);
    expect(entries.map((entry) => entry.href)).toEqual([
      '?champion=quillon&difficulty=easy&arena=arena02&teamsize=3',
      '?champion=quillon&difficulty=normal&arena=arena02&teamsize=3',
      '?champion=quillon&difficulty=hard&arena=arena02&teamsize=3',
    ]);
  });

  it('builds relative hrefs, so the build works under a subdirectory', () => {
    for (const entry of difficultyEntries('hargrim', 'normal', 'arena01', 2)) expect(entry.href.startsWith('?')).toBe(true);
  });
});
