import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/index';
import type { MatchConfig, PlayerConfig } from '../src/index';
import { arena01, config2v2 } from './helpers';

function config3v3(): MatchConfig {
  return {
    teamSize: 3,
    players: [
      { championId: 'a1', team: 'A' },
      { championId: 'b1', team: 'B' },
      { championId: 'a2', team: 'A' },
      { championId: 'b2', team: 'B' },
      { championId: 'a3', team: 'A' },
      { championId: 'b3', team: 'B' },
    ],
  };
}

describe('createMatch', () => {
  it('places a 2v2 on the first two spawns of each team in slot order', () => {
    const state = createMatch(config2v2(), arena01, 1337);
    expect(state.champions.map((c) => [c.id, c.team, c.x, c.y])).toEqual([
      [0, 'A', -12, 2],
      [1, 'A', -12, -2],
      [2, 'B', 12, 2],
      [3, 'B', 12, -2],
    ]);
  });

  it('places a 3v3 by slot even when the players alternate teams', () => {
    const state = createMatch(config3v3(), arena01, 5);
    expect(state.champions.map((c) => [c.championId, c.x, c.y])).toEqual([
      ['a1', -12, 2],
      ['b1', 12, 2],
      ['a2', -12, -2],
      ['b2', 12, -2],
      ['a3', -12, 0],
      ['b3', 12, 0],
    ]);
  });

  it('faces team A along +x and team B along -x, with an aim 1 m ahead', () => {
    const state = createMatch(config2v2(), arena01, 1);
    const [a, , b] = state.champions;
    expect(a?.facing).toBe(0);
    expect([a?.aimX, a?.aimY]).toEqual([-1100, 200]);
    expect(b?.facing).toBe(Math.PI);
    expect([b?.aimX, b?.aimY]).toEqual([1100, 200]);
  });

  it('sets the initial champion values', () => {
    const state = createMatch(config2v2(), arena01, 1);
    for (const c of state.champions) {
      expect(c).toMatchObject({
        vx: 0,
        vy: 0,
        health: 120,
        maxHealth: 120,
        energy: 0,
        alive: true,
        statuses: [],
      });
    }
    expect(state.champions.map((c) => c.championId)).toEqual([
      'hargrim',
      'quillon',
      'lumeth',
      'skerrow',
    ]);
  });

  it('starts at tick 0 with no events and the seed as the rng state', () => {
    const state = createMatch(config2v2(), arena01, -1);
    expect(state.tick).toBe(0);
    expect(state.events).toEqual([]);
    expect(state.rng).toBe(0xffffffff);
    expect(createMatch(config2v2(), arena01, 1337).rng).toBe(1337);
  });

  it('copies the arena instead of sharing it', () => {
    const state = createMatch(config2v2(), arena01, 1);
    expect(state.arena).toEqual(arena01);
    expect(state.arena).not.toBe(arena01);
    expect(state.arena.obstacles).not.toBe(arena01.obstacles);
  });

  it('survives a JSON round trip unchanged', () => {
    const state = createMatch(config3v3(), arena01, 99);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('rejects a team size other than 2 or 3', () => {
    const bad = { ...config2v2(), teamSize: 4 } as unknown as MatchConfig;
    expect(() => createMatch(bad, arena01, 1)).toThrow('teamSize must be 2 or 3');
  });

  it('rejects a player count that does not match the team size', () => {
    const bad = { ...config2v2(), players: config2v2().players.slice(0, 3) };
    expect(() => createMatch(bad, arena01, 1)).toThrow('expected 4 players, got 3');
  });

  it('rejects uneven teams', () => {
    const players: PlayerConfig[] = config2v2().players.map((p) => ({ ...p, team: 'A' }));
    expect(() => createMatch({ teamSize: 2, players }, arena01, 1)).toThrow(
      'team A has 4 players, expected 2',
    );
  });

  it('rejects a team with fewer spawns than the team size', () => {
    const arena = { ...arena01, spawns: { ...arena01.spawns, teamB: [[12, 0]] as [number, number][] } };
    expect(() => createMatch(config2v2(), arena, 1)).toThrow('team B has 1 spawns, needs 2');
  });

  it('rejects a seed that is not an integer', () => {
    expect(() => createMatch(config2v2(), arena01, 1.5)).toThrow('seed must be an integer');
    expect(() => createMatch(config2v2(), arena01, NaN)).toThrow('seed must be an integer');
  });

  it('stores a +0 aim for a spawn y of -0.003', () => {
    const arena = { ...arena01, spawns: { ...arena01.spawns, teamA: [[-12, -0.003], [-12, -2]] as [number, number][] } };
    const state = createMatch(config2v2(), arena, 1);
    expect(Object.is(state.champions[0]?.aimY, 0)).toBe(true);
  });

  it('starts with no projectiles or areas and the entity ids after the champions', () => {
    const state = createMatch(config2v2(), arena01, 1);
    expect(state.projectiles).toEqual([]);
    expect(state.areas).toEqual([]);
    expect(state.nextEntityId).toBe(4);
    expect(createMatch(config3v3(), arena01, 1).nextEntityId).toBe(6);
  });
});

describe('createMatch toolkit state', () => {
  it('starts every champion without a dash', () => {
    const state = createMatch(config2v2(), arena01, 1);
    for (const c of state.champions) expect(c.dash).toBeNull();
  });

  it('starts every champion with seven zero cooldowns and no cast, and no kits or casts', () => {
    const state = createMatch(config2v2(), arena01, 1);
    for (const c of state.champions) {
      expect(c.cooldowns).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(c.cast).toBeNull();
    }
    expect(state.champions[0]?.cooldowns).not.toBe(state.champions[1]?.cooldowns);
    expect(state.kits).toEqual([]);
    expect(state.casts).toEqual([]);
  });
});
