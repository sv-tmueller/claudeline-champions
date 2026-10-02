import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/index';
import type { GameState } from '../src/index';
import { arena01, champion, config2v2, legacyState } from './helpers';
import { kitWith } from './kits';

const DASH = { dirX: 1, dirY: 0, stepLength: 0.1, ticksLeft: 3, castId: null, then: [] };

describe('legacyState', () => {
  it('drops the fields the toolkit and the kit contract added and leaves the original alone', () => {
    const state = createMatch(config2v2(), arena01, 1);
    state.projectiles.push({
      id: 4, ownerId: 0, team: 'A', x: 0, y: 0, vx: 1, vy: 0, radius: 0.2, remainingTicks: 5,
      pierce: false, hitIds: [], effects: [], castId: null,
    });
    state.areas.push({
      id: 5, type: 'circle', ownerId: 0, team: 'A', x: 0, y: 0, radius: 1, targets: 'all',
      remainingTicks: 5, intervalTicks: 1, ticksToNextApply: 0, effects: [], castId: null,
    });
    const projected = legacyState(state);
    for (const c of projected.champions) {
      for (const key of ['dash', 'cooldowns', 'cast']) expect(key in c, key).toBe(false);
    }
    expect('castId' in (projected.projectiles[0] as object)).toBe(false);
    expect('castId' in (projected.areas[0] as object)).toBe(false);
    expect('kits' in projected).toBe(false);
    expect('casts' in projected).toBe(false);
    expect(state.champions.every((c) => c.dash === null && c.cast === null)).toBe(true);
    expect(state.kits).toEqual([]);
  });

  const rejects: [string, string, (state: GameState) => void][] = [
    ['a dash', 'champion 1 has a dash', (s) => void (champion(s, 1).dash = DASH)],
    [
      'a status',
      'champion 2 has statuses',
      (s) => void champion(s, 2).statuses.push({ type: 'stun', sourceId: 0, slot: null, remainingTicks: 5 }),
    ],
    ['a cooldown', 'champion 3 has a cooldown', (s) => void (champion(s, 3).cooldowns[4] = 1)],
    ['a short cooldown list', 'champion 0 has a cooldown', (s) => void champion(s, 0).cooldowns.pop()],
    [
      'a cast',
      'champion 1 has a cast',
      (s) =>
        void (champion(s, 1).cast = { castId: 4, slot: 'Q', ex: false, windupTicks: 5, windupLeft: 3 }),
    ],
    [
      'a projectile cast id',
      'entity 4 has a cast id',
      (s) =>
        void s.projectiles.push({
          id: 4, ownerId: 0, team: 'A', x: 0, y: 0, vx: 1, vy: 0, radius: 0.2, remainingTicks: 5,
          pierce: false, hitIds: [], effects: [], castId: 9,
        }),
    ],
    [
      'an area cast id',
      'entity 5 has a cast id',
      (s) =>
        void s.areas.push({
          id: 5, type: 'circle', ownerId: 0, team: 'A', x: 0, y: 0, radius: 1, targets: 'all',
          remainingTicks: 5, intervalTicks: 1, ticksToNextApply: 0, effects: [], castId: 9,
        }),
    ],
    ['a kit', 'state has kits', (s) => void s.kits.push(kitWith('x'))],
    [
      'a cast record',
      'state has casts',
      (s) => void s.casts.push({ id: 4, casterId: 0, slot: 'M1', ex: false, credited: [] }),
    ],
  ];
  for (const [name, message, mutate] of rejects) {
    it(`rejects a state with ${name}`, () => {
      const state = createMatch(config2v2(), arena01, 1);
      mutate(state);
      expect(() => legacyState(state)).toThrow(message);
    });
  }
});
