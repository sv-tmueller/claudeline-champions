import { createBot } from '@claudeline/bots';
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, parseLaunch } from './launch';

const KITS = ['hargrim', 'quillon'];

describe('parseLaunch', () => {
  it('starts the match as hargrim on normal by default', () => {
    expect(parseLaunch('', KITS, false)).toEqual({ scene: 'match', champion: 'hargrim', difficulty: 'normal' });
  });

  it('reads a leading question mark like none', () => {
    expect(parseLaunch('?champion=quillon', KITS, false).champion).toBe('quillon');
    expect(parseLaunch('champion=quillon', KITS, false).champion).toBe('quillon');
  });

  it('picks the first kit of the roster order when the champion is missing, whatever the list order', () => {
    expect(parseLaunch('', ['quillon', 'hargrim'], false).champion).toBe('hargrim');
    expect(parseLaunch('', ['quillon'], false).champion).toBe('quillon');
  });

  it('falls back to the first kit for a champion without a kit', () => {
    expect(parseLaunch('?champion=lumeth', KITS, false).champion).toBe('hargrim');
    expect(parseLaunch('?champion=nobody', KITS, false).champion).toBe('hargrim');
    expect(parseLaunch('?champion=', KITS, false).champion).toBe('hargrim');
  });

  it('reads no inherited object key as a champion', () => {
    expect(parseLaunch('?champion=constructor', KITS, false).champion).toBe('hargrim');
  });

  it('reads the difficulty', () => {
    expect(parseLaunch('?difficulty=easy', KITS, false).difficulty).toBe('easy');
    expect(parseLaunch('?difficulty=hard', KITS, false).difficulty).toBe('hard');
    expect(parseLaunch('?difficulty=normal', KITS, false).difficulty).toBe('normal');
  });

  it('reads any other difficulty as normal', () => {
    for (const bad of ['', 'EASY', 'impossible', 'constructor', '__proto__']) {
      expect(parseLaunch(`?difficulty=${bad}`, KITS, false).difficulty, bad).toBe('normal');
    }
  });

  it('opens the sandbox only in a dev build', () => {
    expect(parseLaunch('?scene=sandbox', KITS, true).scene).toBe('sandbox');
    expect(parseLaunch('?scene=sandbox', KITS, false).scene).toBe('match');
    expect(parseLaunch('?scene=other', KITS, true).scene).toBe('match');
  });

  it('ignores the champion in the sandbox', () => {
    expect(parseLaunch('?scene=sandbox&champion=quillon', KITS, true).champion).toBe('hargrim');
  });

  it('keeps the difficulty in the sandbox', () => {
    expect(parseLaunch('?scene=sandbox&difficulty=hard', KITS, true).difficulty).toBe('hard');
  });
});

describe('DIFFICULTIES', () => {
  it('lists the three tiers of the bots, and each one makes a bot', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
    for (const difficulty of DIFFICULTIES) expect(() => createBot(1, difficulty, 1)).not.toThrow();
  });
});
