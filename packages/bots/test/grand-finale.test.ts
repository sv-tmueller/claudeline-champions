import { describe, expect, it } from 'vitest';
import type { ChampionState } from '@claudeline/sim';
import { sixKits } from './helpers';
import { pressOf, sceneOf } from './scenes';

// Brimwick's Grand Finale is held like Reaper's Dance (reaper.test.ts): a target it can finish
// (health at most the 55 damage F does, read from the kit) or one with no way out (cornered). The
// roster-v2 profile of Ondrel does not hold Drowned Ground: the damage read from the kit is one
// pulse of the five, 10, so a hold on it would wait for a target the zone never finishes.
describe('Grand Finale, held for a low or cornered target', () => {
  const kits = sixKits();
  const F_ONLY = { kits, energy: 100, ready: ['F'] } as const;

  function withEnemyHealth(health: number, distance = 8) {
    const state = sceneOf('brimwick', distance, F_ONLY);
    (state.champions[2] as ChampionState).health = health;
    return state;
  }

  it('does not press F at a healthy target in the open', () => {
    expect(pressOf(sceneOf('brimwick', 8, F_ONLY))).toBeNull();
  });

  it('presses F at a target with 55 health, and not at one with 56', () => {
    expect(pressOf(withEnemyHealth(55))).toBe('F');
    expect(pressOf(withEnemyHealth(56))).toBeNull();
  });

  it('presses F at a full-health target in the north-east corner', () => {
    // Brimwick at (8.74, 3.74), 8 m from the enemy at (14.4, 9.4) on the diagonal: every point 1 m
    // beyond the target, and each turned by 45 and 90 degrees, lies outside the arena.
    const cornered = sceneOf('brimwick', 0, { ...F_ONLY, me: [8.74, 3.74], enemy: [14.4, 9.4] });
    expect(pressOf(cornered)).toBe('F');
  });

  it('does not press F at a full-health target against a wall with a way along it', () => {
    const wall = sceneOf('brimwick', 0, { ...F_ONLY, me: [8.4, 0], enemy: [14.4, 0] });
    expect(pressOf(wall)).toBeNull();
  });

  it('does not hold Drowned Ground: Ondrel presses F at a healthy target at 8 m', () => {
    expect(pressOf(sceneOf('ondrel', 8, F_ONLY))).toBe('F');
  });
});

describe('the reserve of Brimwick, whose ultimate is held', () => {
  const kits = sixKits();
  const reserve = (health?: number) => {
    // 10.2 m: past the base Firecracker band (10 m), inside the EX band (10.5 m), F in reach (11 m).
    const state = sceneOf('brimwick', 10.2, { kits, energy: 80, ready: ['M2', 'F'] });
    if (health !== undefined) (state.champions[2] as ChampionState).health = health;
    return state;
  };

  it('spends the EX Firecracker at 80 energy against a healthy target', () => {
    expect(pressOf(reserve())).toBe('M2+SHIFT');
  });

  it('holds the EX Firecracker for the finisher against a target at 55 health', () => {
    expect(pressOf(reserve(55))).toBeNull();
  });
});
