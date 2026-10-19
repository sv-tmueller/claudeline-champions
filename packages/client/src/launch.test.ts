import { createBot } from '@claudeline/bots';
import { describe, expect, it } from 'vitest';
import { DEV_LAUNCH_KEYS } from './dev-launch';
import { DIFFICULTIES, opensSelect, parseLaunch, relaunch } from './launch';

const KITS = ['hargrim', 'quillon'];
const ARENAS = ['arena01', 'arena02'];

describe('parseLaunch', () => {
  it('starts the match as hargrim on normal by default', () => {
    expect(parseLaunch('', KITS, ARENAS, false)).toEqual({
      scene: 'match',
      champion: 'hargrim',
      difficulty: 'normal',
      arena: 'arena01',
      teamSize: 2,
    });
  });

  it('reads a leading question mark like none', () => {
    expect(parseLaunch('?champion=quillon', KITS, ARENAS, false).champion).toBe('quillon');
    expect(parseLaunch('champion=quillon', KITS, ARENAS, false).champion).toBe('quillon');
  });

  it('picks the first kit of the roster order when the champion is missing, whatever the list order', () => {
    expect(parseLaunch('', ['quillon', 'hargrim'], ARENAS, false).champion).toBe('hargrim');
    expect(parseLaunch('', ['quillon'], ARENAS, false).champion).toBe('quillon');
  });

  it('falls back to the first kit for a champion without a kit', () => {
    expect(parseLaunch('?champion=lumeth', KITS, ARENAS, false).champion).toBe('hargrim');
    expect(parseLaunch('?champion=nobody', KITS, ARENAS, false).champion).toBe('hargrim');
    expect(parseLaunch('?champion=', KITS, ARENAS, false).champion).toBe('hargrim');
  });

  it('reads no inherited object key as a champion', () => {
    expect(parseLaunch('?champion=constructor', KITS, ARENAS, false).champion).toBe('hargrim');
  });

  it('reads the difficulty', () => {
    expect(parseLaunch('?difficulty=easy', KITS, ARENAS, false).difficulty).toBe('easy');
    expect(parseLaunch('?difficulty=hard', KITS, ARENAS, false).difficulty).toBe('hard');
    expect(parseLaunch('?difficulty=normal', KITS, ARENAS, false).difficulty).toBe('normal');
  });

  it('reads any other difficulty as normal', () => {
    for (const bad of ['', 'EASY', 'impossible', 'constructor', '__proto__']) {
      expect(parseLaunch(`?difficulty=${bad}`, KITS, ARENAS, false).difficulty, bad).toBe('normal');
    }
  });

  it('opens the sandbox only in a dev build', () => {
    expect(parseLaunch('?scene=sandbox', KITS, ARENAS, true).scene).toBe('sandbox');
    expect(parseLaunch('?scene=sandbox', KITS, ARENAS, false).scene).toBe('match');
    expect(parseLaunch('?scene=other', KITS, ARENAS, true).scene).toBe('match');
  });

  it('ignores the champion in the sandbox', () => {
    expect(parseLaunch('?scene=sandbox&champion=quillon', KITS, ARENAS, true).champion).toBe('hargrim');
  });

  it('keeps the difficulty in the sandbox', () => {
    expect(parseLaunch('?scene=sandbox&difficulty=hard', KITS, ARENAS, true).difficulty).toBe('hard');
  });
});

describe('parseLaunch: the arena', () => {
  it('reads ?arena=arena02 as arena02', () => {
    expect(parseLaunch('?arena=arena02', KITS, ARENAS, false).arena).toBe('arena02');
    expect(parseLaunch('?arena=arena01', KITS, ARENAS, false).arena).toBe('arena01');
  });

  it('reads an unknown, empty or inherited id as arena01', () => {
    for (const bad of ['arena03', '', 'constructor', '__proto__', 'ARENA02']) {
      expect(parseLaunch(`?arena=${bad}`, KITS, ARENAS, false).arena, bad).toBe('arena01');
    }
  });

  it('reads the first id when the list has no arena01', () => {
    expect(parseLaunch('', KITS, ['arena02', 'arena03'], false).arena).toBe('arena02');
    expect(parseLaunch('?arena=arena09', KITS, ['arena02', 'arena03'], false).arena).toBe('arena02');
  });

  it('keeps arena01 in the sandbox whatever the address asks, because the walk spec and the probe stand on its coordinates', () => {
    expect(parseLaunch('?scene=sandbox&arena=arena02', KITS, ARENAS, true).arena).toBe('arena01');
  });

  it('keeps the arena next to the other parameters', () => {
    expect(parseLaunch('?champion=quillon&difficulty=hard&arena=arena02', KITS, ARENAS, false)).toEqual({
      scene: 'match',
      champion: 'quillon',
      difficulty: 'hard',
      arena: 'arena02',
      teamSize: 2,
    });
  });
});

describe('parseLaunch: the team size', () => {
  it('reads ?teamsize=3 as 3 and ?teamsize=2 as 2', () => {
    expect(parseLaunch('?teamsize=3', KITS, ARENAS, false).teamSize).toBe(3);
    expect(parseLaunch('?teamsize=2', KITS, ARENAS, false).teamSize).toBe(2);
  });

  it('reads any other value as 2', () => {
    for (const bad of ['', '4', '1', '0', '3v3', '03', '3.0', ' 3', 'constructor', '__proto__']) {
      expect(parseLaunch(`?teamsize=${bad}`, KITS, ARENAS, false).teamSize, bad).toBe(2);
    }
  });

  it('keeps the team size next to the other parameters', () => {
    expect(parseLaunch('?champion=quillon&difficulty=hard&arena=arena02&teamsize=3', KITS, ARENAS, false)).toEqual({
      scene: 'match',
      champion: 'quillon',
      difficulty: 'hard',
      arena: 'arena02',
      teamSize: 3,
    });
  });

  it('reads 2 in the sandbox whatever the address asks, because its roster is four champions', () => {
    expect(parseLaunch('?scene=sandbox&teamsize=3', KITS, ARENAS, true).teamSize).toBe(2);
  });
});

describe('DIFFICULTIES', () => {
  it('lists the three tiers of the bots, and each one makes a bot', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
    for (const difficulty of DIFFICULTIES) expect(() => createBot(1, difficulty, 1)).not.toThrow();
  });
});

describe('opensSelect', () => {
  it('opens on a bare address, a lone question mark and unrelated keys', () => {
    for (const search of ['', '?', '?foo=1', '?utm_source=x', '?server=', '?foo=1&bar=2']) {
      expect(opensSelect(search, []), search).toBe(true);
    }
  });

  it('skips the screen when any of the four keys is present, whatever the value', () => {
    for (const key of ['champion', 'difficulty', 'arena', 'teamsize']) {
      for (const value of ['', 'hargrim', 'brutal', '4', 'constructor']) {
        expect(opensSelect(`?${key}=${value}`, []), `${key}=${value}`).toBe(false);
      }
      expect(opensSelect(`?foo=1&${key}=x`, []), key).toBe(false);
      expect(opensSelect(key, []), `${key} without a value`).toBe(false);
    }
  });

  it('reads a leading question mark like none, and the keys case-sensitively', () => {
    expect(opensSelect('champion=quillon', [])).toBe(false);
    expect(opensSelect('?Champion=x', [])).toBe(true);
    expect(opensSelect('?TEAMSIZE=3', [])).toBe(true);
  });

  it('counts the dev keys it is given and no others', () => {
    for (const search of ['?scene=sandbox', '?timescale=100', '?scene=', '?timescale=']) {
      expect(opensSelect(search, DEV_LAUNCH_KEYS), search).toBe(false);
      expect(opensSelect(search, []), search).toBe(true);
    }
    expect(opensSelect('?foo=1', DEV_LAUNCH_KEYS)).toBe(true);
    expect(opensSelect('', DEV_LAUNCH_KEYS)).toBe(true);
  });
});

describe('relaunch', () => {
  it('writes the whole setup, so the address reads back as the same launch and skips the select', () => {
    for (const champion of KITS) {
      for (const difficulty of DIFFICULTIES) {
        for (const arena of ARENAS) {
          for (const teamSize of [2, 3] as const) {
            const query = relaunch(champion, difficulty, arena, teamSize);
            expect(query.startsWith('?'), query).toBe(true);
            expect(parseLaunch(query, KITS, ARENAS, false), query).toEqual({
              scene: 'match',
              champion,
              difficulty,
              arena,
              teamSize,
            });
            expect(opensSelect(query, []), query).toBe(false);
            expect(opensSelect(query, DEV_LAUNCH_KEYS), query).toBe(false);
          }
        }
      }
    }
  });

  it('writes the four keys in a fixed order', () => {
    expect(relaunch('hargrim', 'normal', 'arena01', 2)).toBe(
      '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2',
    );
  });
});
