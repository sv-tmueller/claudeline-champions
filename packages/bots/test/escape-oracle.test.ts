import { describe, expect, it } from 'vitest';
import { Button, cloneState, createMatch, step } from '@claudeline/sim';
import type { ChampionState, GameState, PlayerInput, SlotSpec } from '@claudeline/sim';
import { oracleLanding, teleportAfterWalksAhead } from './escape-oracle';
import { jsonKits } from './helpers';
import { quietKit } from './kits';
import { OPEN } from './scenes';

// The turn-order model of the escape oracle, on a hand-built state. The oracle calls a teleport
// that is not the standing landing explained when a champion ahead of the caster moved, or when any
// champion died before the caster's cast: a melee arc of a champion ahead kills a champion with a
// higher id without moving, and the dead no longer push a landing out of their body (#182, review
// finding 2).
describe('teleportAfterWalksAhead', () => {
  /**
   * A fixture champion (0) whose M1 is a melee arc with no windup swings north on this tick, at a
   * Quillon (3) with 1 health standing 0.3 m west of where the caster's Skip would land. The caster
   * is Quillon (1) at (-6, 0), aiming 4 m east, away from the dummy (2) at (-9, 0). Champion 0 does
   * not move and is the only champion ahead of the caster; the oracle's standing clone gives it no
   * input, so there the Quillon lives and pushes the landing out of its body.
   */
  function scene(): { before: GameState; inputs: PlayerInput[] } {
    const arc: SlotSpec = {
      cooldownTicks: 36,
      windupTicks: 0,
      movement: 'free',
      effects: [
        {
          type: 'meleeArc',
          radius: 2.5,
          cosHalfAngle: 0.6427876097,
          effects: [{ type: 'damage', amount: 50 }],
        },
      ],
    };
    const state = createMatch(
      {
        teamSize: 2,
        players: [
          { championId: 'striker', team: 'A' },
          { championId: 'quillon', team: 'A' },
          { championId: 'dummy', team: 'B' },
          { championId: 'quillon', team: 'B' },
        ],
      },
      OPEN,
      1,
      [...jsonKits(), quietKit('striker', { M1: arc })],
    );
    const at = (id: number, x: number, y: number) => {
      const c = state.champions[id] as ChampionState;
      c.x = x;
      c.y = y;
      return c;
    };
    at(0, -2.3, -1.5);
    at(1, -6, 0);
    at(2, -9, 0);
    at(3, -2.3, 0).health = 1;
    const inputs: PlayerInput[] = [
      { moveX: 0, moveY: 0, aimX: -230, aimY: 0, buttons: Button.M1 },
      { moveX: 0, moveY: 0, aimX: -200, aimY: 0, buttons: Button.SPACE },
    ];
    return { before: cloneState(state), inputs };
  }

  it('counts a champion that died to a cast ahead of the caster, though nobody ahead moved', () => {
    const { before, inputs } = scene();
    const model = teleportAfterWalksAhead(before, 1, inputs);
    if (model === null) throw new Error('no teleport');
    // Nobody ahead of the caster moved: champion 0 swings in place.
    const after = cloneState(before);
    step(after, inputs);
    expect([after.champions[0]?.x, after.champions[0]?.y]).toEqual([
      before.champions[0]?.x,
      before.champions[0]?.y,
    ]);
    // Champion 3, with a higher id than the caster, is dead by the caster's turn.
    expect(after.champions[3]?.alive).toBe(false);
    expect(model.aheadMoved).toBe(true);
  });

  it('gives the end the real step reaches, which the standing landing does not', () => {
    const { before, inputs } = scene();
    const model = teleportAfterWalksAhead(before, 1, inputs);
    if (model === null) throw new Error('no teleport');
    const caster = before.champions[1] as ChampionState;
    const enemy = before.champions[2] as ChampionState;
    const standing = oracleLanding(before, caster, enemy, 'SPACE', 4);
    if (standing === null) throw new Error('no standing landing');
    // The standing landing is pushed out of the living Quillon; the dead one leaves it at (-2, 0).
    expect([model.x, model.y]).toEqual([-2, 0]);
    expect([standing.x, standing.y]).not.toEqual([model.x, model.y]);
    const real = cloneState(before);
    step(real, inputs);
    const event = real.events.find((e) => e.type === 'teleport' && e.championId === 1);
    expect(event?.type === 'teleport' && [event.toX, event.toY]).toEqual([model.x, model.y]);
  });

  it('does not count a swing that kills nobody: no champion ahead moved and none died', () => {
    const { before, inputs } = scene();
    // With the victim out of the arc's reach nobody dies and nobody ahead moves.
    (before.champions[3] as ChampionState).y = 8;
    const model = teleportAfterWalksAhead(before, 1, inputs);
    if (model === null) throw new Error('no teleport');
    expect(model.aheadMoved).toBe(false);
  });
});
