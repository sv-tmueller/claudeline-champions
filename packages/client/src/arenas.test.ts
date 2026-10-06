import { parseArenaDef } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import arena02Json from '../../../data/arenas/arena02.json';
import { arenaById } from './arenas';

const ARENAS = [parseArenaDef(arena01Json), parseArenaDef(arena02Json)];

describe('arenaById', () => {
  it('returns the arena with the id', () => {
    expect(arenaById(ARENAS, 'arena02').id).toBe('arena02');
    expect(arenaById(ARENAS, 'arena01').id).toBe('arena01');
  });

  it('throws on a missing id, naming it', () => {
    expect(() => arenaById(ARENAS, 'arena03')).toThrow(/arena03/);
    expect(() => arenaById([], 'arena01')).toThrow(/arena01/);
  });
});
