import { describe, expect, it } from 'vitest';
import { step } from '@claudeline/sim';
import type { GameState, PlayerInput, Slot } from '@claudeline/sim';
import { createBot } from '../src/bot';
import { copyInput, sixKits } from './helpers';
import { sceneOf } from './scenes';

// An ability with no projectile (Ondrel's Mire and Drowned Ground, Brimwick's Firecracker) is
// aimed with the nominal 20 m/s lead, `NOMINAL_PROJECTILE_SPEED` of bot.ts. The sim is the oracle:
// the pin steps a real match and counts how many pulses of the first area the bot placed hit an
// enemy that walks north at full speed, across the line of fire (docs/architecture/bots.md, Aim,
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
 * `ally` is where champion 1 stands (Binding Sigil's `nearAlly` gate needs one within 6 m).
 */
function strafed(
  id: string,
  slot: Slot,
  distance: number,
  ally?: readonly [number, number],
): AreaRun {
  const state: GameState = sceneOf(id, distance, {
    kits: sixKits(),
    ready: [slot],
    energy: slot === 'F' ? 100 : 0,
    ...(ally !== undefined ? { ally } : {}),
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

  // #187: a one-hit aim-placed area caps the lead offset at half the radius, measured from the
  // target's position. Firecracker (M2, r 1.5, cap 0.75) at 9 m: the nominal 20 m/s lead trails
  // the strafer's own walk over the flight, so the pulse lands outside the 1.5 m circle; the cap
  // drops the pulse back onto the target. The pin reads 1 of 1 capped against 0 of 1 nominal, and
  // so is red the moment the cap is dropped.
  it('lands the one-hit Firecracker pulse on a strafer the nominal lead misses', () => {
    expect(strafed('brimwick', 'M2', 9)).toEqual({ pulses: 1, hits: 1 });
  });

  // Binding Sigil (Q, r 2, cap 1) at 10 m, with an ally of champion 0 within 6 m of the enemy so
  // the `nearAlly` gate of casting.ts opens. The same reading: 1 of 1 capped, 0 of 1 nominal.
  it('lands the one-hit Binding Sigil pulse on a strafer the nominal lead misses', () => {
    expect(strafed('lumeth', 'Q', 10, [0, 0])).toEqual({ pulses: 1, hits: 1 });
  });
});
