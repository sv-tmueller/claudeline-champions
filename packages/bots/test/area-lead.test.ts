import { describe, expect, it } from 'vitest';
import { step } from '@claudeline/sim';
import type { GameState, PlayerInput, Slot } from '@claudeline/sim';
import { createBot } from '../src/bot';
import { copyInput, sixKits } from './helpers';
import { sceneOf } from './scenes';

// An ability with no projectile (Ondrel's Mire and Drowned Ground, Brimwick's Firecracker) is
// aimed with the nominal 20 m/s lead, `NOMINAL_PROJECTILE_SPEED` of bot.ts. The sim is the oracle:
// the pin steps a real match and counts how many pulses of the first area the bot placed hit an
// enemy that walks away at full speed across the line of fire (docs/architecture/bots.md, Aim,
// has the measurement of the other leads that this one was chosen from).

interface AreaRun {
  /** Pulses of the first area the bot placed. */
  pulses: number;
  /** Of those, the pulses whose targets include the enemy. */
  hits: number;
}

/**
 * Champion 0 (`id`) presses `slot` alone at an enemy `distance` metres east of it, which walks
 * north at 5.5 m/s from the first tick. Returns the pulses of the first area champion 0 spawns.
 */
function strafed(id: string, slot: Slot, distance: number): AreaRun {
  const state: GameState = sceneOf(id, distance, {
    kits: sixKits(),
    ready: [slot],
    energy: slot === 'F' ? 100 : 0,
  });
  const bot = createBot(0, 'hard', 1);
  let first = -1;
  let pulses = 0;
  let hits = 0;
  for (let t = 0; t < 400; t++) {
    const inputs: (PlayerInput | undefined)[] = [];
    inputs[0] = copyInput(bot.think(state));
    inputs[2] = { moveX: 0, moveY: 1, aimX: 0, aimY: 0, buttons: 0 };
    step(state, inputs);
    for (const event of state.events) {
      if (event.type === 'areaSpawned' && event.ownerId === 0 && first < 0) first = event.areaId;
      if (event.type === 'areaTick' && event.areaId === first) {
        pulses++;
        if (event.targetIds.includes(2)) hits++;
      }
    }
  }
  return { pulses, hits };
}

describe('the lead of an area press', () => {
  it('lands all five pulses of Drowned Ground on a target strafing at 6 m', () => {
    expect(strafed('ondrel', 'F', 6)).toEqual({ pulses: 5, hits: 5 });
  });

  it('lands two of the three pulses of the Mire on a target strafing at 7 m', () => {
    expect(strafed('ondrel', 'M2', 7)).toEqual({ pulses: 3, hits: 2 });
  });
});
