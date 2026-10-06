import { describe, expect, it } from 'vitest';
import { Button, step } from '@claudeline/sim';
import type { ChampionState, PlayerInput, SlotSpec } from '@claudeline/sim';
import { createBot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import { arena01, clearShotOracle, copyInput } from './helpers';
import { boltAbility, boltSlot, quietKit } from './kits';
import { THINKS, pressOf, sceneOf } from './scenes';

describe('the energy reserve and the reach of the ultimate', () => {
  // The champion 'tester' has the default profile. Its F is a burst around the champion with the
  // reach band [0, 6], so a target within 5 m is in reach of F; its M2 is a bolt of reach 12 m with
  // an EX variant of the same reach.
  const burst: SlotSpec = {
    cooldownTicks: 600,
    windupTicks: 0,
    movement: 'free',
    effects: [
      {
        type: 'area',
        placement: { type: 'self' },
        radius: 5.5,
        durationTicks: 1,
        intervalTicks: 1,
        targets: 'enemies',
        effects: [{ type: 'damage', amount: 1 }],
      },
    ],
  };
  const kit = () =>
    quietKit('tester', {
      F: burst,
      M2: boltSlot(20, 36, { cooldownTicks: 60, ex: boltAbility(20, 36) }),
    });

  it('spends the EX variant at 80 energy while the target is out of reach of F', () => {
    const state = sceneOf('tester', 9, { kits: [kit()], energy: 80, ready: ['M2', 'F'] });
    expect(pressOf(state)).toBe('M2+SHIFT');
  });

  it('holds the EX variant at 80 energy while the target is in reach of F, and spends it at 74', () => {
    const held = sceneOf('tester', 4, { kits: [kit()], energy: 80, ready: ['M2', 'F'] });
    expect(pressOf(held)).toBe('M2');
    const below = sceneOf('tester', 4, { kits: [kit()], energy: 74, ready: ['M2', 'F'] });
    expect(pressOf(below)).toBe('M2+SHIFT');
  });
});

describe('the stand of a bot whose ultimate is wider than a champion', () => {
  // The pillar of arena01 is a circle of radius 1.5 at the origin. On a level line at height 2.05
  // the centre line of a shot clears it by 0.55: a shot of 0.5 m fits, one of 0.6 m (the ultimate
  // of Quillon) does not.
  const edge = (energy: number) =>
    sceneOf('quillon', 8, {
      arena: arena01,
      me: [-4, 2.05],
      enemy: [4, 2.05],
      energy,
    });

  it('sits on a shadow edge where a 0.5 m shot fits and a 0.6 m shot does not', () => {
    const state = edge(100);
    const me = state.champions[0] as ChampionState;
    const enemy = state.champions[2] as ChampionState;
    expect(clearShotOracle(state, me, enemy, 0.5)).toBe(true);
    expect(clearShotOracle(state, me, enemy, 0.6)).toBe(false);
  });

  it('moves at 100 energy and presses F within 120 ticks', () => {
    const state = edge(100);
    const me = state.champions[0] as ChampionState;
    const bot = createBot(0, 'hard', 1);
    let moved = false;
    let pressedAt = -1;
    for (let tick = 0; tick < 120 && pressedAt < 0; tick++) {
      const input = bot.think(state);
      if (input.moveX !== 0 || input.moveY !== 0) moved = true;
      if ((input.buttons & Button.F) !== 0) pressedAt = tick;
      const inputs: (PlayerInput | undefined)[] = [];
      inputs[0] = copyInput(input);
      step(state, inputs);
    }
    expect(moved).toBe(true);
    expect(pressedAt, 'F was never pressed').toBeGreaterThan(0);
    expect(me.y).toBeGreaterThan(2.05);
  });

  it('stands at 99 energy: the shot of every other ability fits', () => {
    const state = edge(99);
    const bot = createBot(0, 'hard', 1);
    for (let i = 0; i < THINKS; i++) {
      const input = bot.think(state);
      if (i > TIERS.hard.delay) {
        expect([input.moveX, input.moveY], `think ${i}`).toEqual([0, 0]);
      }
    }
    expect(bot.inspect().intent).toBe('engage');
  });
});
