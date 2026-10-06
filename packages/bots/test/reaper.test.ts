import { describe, expect, it } from 'vitest';
import { step } from '@claudeline/sim';
import type { ChampionState, PlayerInput, SimEvent } from '@claudeline/sim';
import { createBot } from '../src/bot';
import { arena01, copyInput, createTeleportTally, tallyTeleports } from './helpers';
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

// The sim fires a teleport toward the aim of the tick it fires on (cast.ts, `fireFrom`), after an
// 18 tick windup, and the bot aims at the target on every tick of it. A target that steps behind
// the pillar during the windup makes the teleport blocked: the sim reports it and the champion
// stays where it is.
describe("a blocked Reaper's Dance", () => {
  /**
   * Skerrow at (-5, 3) and a target at (3, 3) with 40 health, 8 m apart on a clear lane. When
   * Skerrow starts F the target is moved to (3, -3) if `hide`, which puts the pillar at (0, 0)
   * between them. Plays until the cast fires and returns the tally, the teleport events and
   * where Skerrow stood when the cast started.
   */
  function playF(hide: boolean) {
    const state = sceneOf('skerrow', 0, {
      arena: arena01,
      me: [-5, 3],
      enemy: [3, 3],
      energy: 100,
      ready: ['F'],
    });
    const target = state.champions[2] as ChampionState;
    target.health = 40;
    const me = state.champions[0] as ChampionState;
    const bot = createBot(0, 'hard', 1);
    const tally = createTeleportTally();
    const teleports: SimEvent[] = [];
    let at: [number, number] | null = null;
    for (let t = 0; t < 120 && teleports.length === 0; t++) {
      const inputs: (PlayerInput | undefined)[] = [];
      inputs[0] = copyInput(bot.think(state));
      step(state, inputs);
      // No escape press: every teleport is Reaper's Dance.
      tallyTeleports(tally, state.events, []);
      teleports.push(...state.events.filter((e) => e.type === 'teleport'));
      if (at === null && state.events.some((e) => e.type === 'castStarted' && e.slot === 'F')) {
        at = [me.x, me.y];
        if (hide) {
          target.x = 3;
          target.y = -3;
        }
      }
    }
    return { tally, teleports, at };
  }

  it('is blocked by the pillar: Skerrow stays, and the tally counts it apart from the escapes', () => {
    const { tally, teleports, at } = playF(true);
    expect(teleports).toHaveLength(1);
    const event = teleports[0];
    if (event?.type !== 'teleport') throw new Error('no teleport');
    expect(event.blocked).toBe(true);
    // It stood through the windup where the cast began, and the blocked teleport left it there.
    expect([event.fromX, event.fromY]).toEqual(at);
    expect([event.toX, event.toY]).toEqual(at);
    expect(tally).toEqual({ escapes: 0, blockedEscapes: 0, others: 1, blockedOthers: 1 });
  });

  it('is not blocked on a clear lane, and moves Skerrow', () => {
    const { tally, teleports, at } = playF(false);
    expect(teleports).toHaveLength(1);
    const event = teleports[0];
    if (event?.type !== 'teleport') throw new Error('no teleport');
    expect(event.blocked).toBe(false);
    expect([event.fromX, event.fromY]).toEqual(at);
    expect([event.toX, event.toY]).not.toEqual(at);
    expect(tally).toEqual({ escapes: 0, blockedEscapes: 0, others: 1, blockedOthers: 0 });
  });
});
