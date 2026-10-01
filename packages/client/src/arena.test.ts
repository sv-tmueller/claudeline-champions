import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { TEAM_FACING, readArena, twoVsTwoPlacements } from './arena';

describe('readArena', () => {
  it('reads arena01', () => {
    const arena = readArena(arena01Json);
    expect(arena.id).toBe('arena01');
    expect(arena.size).toEqual({ width: 30, height: 20 });
    expect(arena.obstacles).toHaveLength(9);
    expect(arena.obstacles[0]).toEqual({ type: 'circle', x: 0, y: 0, r: 1.5 });
    expect(arena.obstacles[1]).toEqual({ type: 'rect', x: -8, y: 0, w: 1, h: 3 });
  });

  it('throws on an unknown obstacle type', () => {
    const bad = { ...arena01Json, obstacles: [{ type: 'hexagon', x: 0, y: 0 }] };
    expect(() => readArena(bad)).toThrow(/hexagon/);
  });

  it('throws on a malformed spawn tuple', () => {
    const bad = { ...arena01Json, spawns: { teamA: [[1]], teamB: [] } };
    expect(() => readArena(bad)).toThrow(/spawn/);
  });
});

describe('twoVsTwoPlacements', () => {
  it('takes the first two spawns per team and faces each team at the other', () => {
    const placements = twoVsTwoPlacements(readArena(arena01Json));
    expect(placements).toEqual([
      { team: 'teamA', x: -12, y: 2, facing: 0 },
      { team: 'teamA', x: -12, y: -2, facing: 0 },
      { team: 'teamB', x: 12, y: 2, facing: Math.PI },
      { team: 'teamB', x: 12, y: -2, facing: Math.PI },
    ]);
  });

  it('exposes the facing convention', () => {
    expect(TEAM_FACING).toEqual({ teamA: 0, teamB: Math.PI });
  });

  it('throws when a team has fewer than two spawns', () => {
    const arena = readArena({ ...arena01Json, spawns: { teamA: [[0, 0]], teamB: [[1, 1], [2, 2]] } });
    expect(() => twoVsTwoPlacements(arena)).toThrow(/teamA/);
  });
});
