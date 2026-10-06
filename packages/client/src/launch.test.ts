import { createBot } from '@claudeline/bots';
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, parseLaunch } from './launch';

const KITS = ['hargrim', 'quillon'];
const ARENAS = ['arena01', 'arena02'];

describe('parseLaunch', () => {
  it('starts the match as hargrim on normal by default', () => {
    expect(parseLaunch('', KITS, ARENAS, false)).toEqual({
      scene: 'match',
      champion: 'hargrim',
      difficulty: 'normal',
      arena: 'arena01',
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
    });
  });
});

describe('DIFFICULTIES', () => {
  it('lists the three tiers of the bots, and each one makes a bot', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
    for (const difficulty of DIFFICULTIES) expect(() => createBot(1, difficulty, 1)).not.toThrow();
  });
});
