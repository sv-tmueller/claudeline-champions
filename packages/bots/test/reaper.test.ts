import { describe, expect, it } from 'vitest';
import type { ChampionState } from '@claudeline/sim';
import { pressOf, sceneOf } from './scenes';

// Reaper's Dance, Skerrow's ultimate: a teleport of 8 m and a 360 degree arc for 40 damage. The
// bot holds it for a target it can finish (health at most the 40 damage F does, read from the kit)
// or one with no way out (cornered: none of the five 1 m points away from the bot is free).
describe("Reaper's Dance, held for a low or cornered target", () => {
  const F_ONLY = { energy: 100, ready: ['F'] } as const;

  function withEnemyHealth(health: number, distance = 6) {
    const state = sceneOf('skerrow', distance, F_ONLY);
    (state.champions[2] as ChampionState).health = health;
    return state;
  }

  it('does not press F at a healthy target in the open', () => {
    expect(pressOf(sceneOf('skerrow', 6, F_ONLY))).toBeNull();
  });

  it('presses F at a target with 40 health, and not at one with 41', () => {
    expect(pressOf(withEnemyHealth(40))).toBe('F');
    expect(pressOf(withEnemyHealth(41))).toBeNull();
  });

  it('presses F at a full-health target in the north-east corner', () => {
    // Skerrow 6 m from the corner, on the diagonal: every point 1 m beyond the target, and each
    // turned by 45 and 90 degrees, lies outside the arena.
    const cornered = sceneOf('skerrow', 0, { ...F_ONLY, me: [10.2, 5.1], enemy: [14.4, 9.4] });
    expect(pressOf(cornered)).toBe('F');
  });

  it('does not press F at a full-health target against a wall with a way along it', () => {
    // At (14.4, 0) on the east wall: straight away is outside, but the 90 degree points along the
    // wall are free, so it is not cornered.
    const wall = sceneOf('skerrow', 0, { ...F_ONLY, me: [8.4, 0], enemy: [14.4, 0] });
    expect(pressOf(wall)).toBeNull();
  });
});

describe('the reserve of a champion whose ultimate is held', () => {
  it('spends the EX Lunge at 80 energy against a healthy target, and holds it against a low one', () => {
    // At 7 m a healthy target is in F's reach but F is held, so nothing holds the EX variant back.
    const healthy = sceneOf('skerrow', 7, { energy: 80, ready: ['SPACE', 'F'] });
    expect(pressOf(healthy)).toBe('SPACE+SHIFT');
    // A target at 40 health is one F finishes: the reserve holds the EX, and the base Lunge (5 to
    // 6 m) is not in band at 7 m.
    const low = sceneOf('skerrow', 7, { energy: 80, ready: ['SPACE', 'F'] });
    (low.champions[2] as ChampionState).health = 40;
    expect(pressOf(low)).toBeNull();
  });
});
