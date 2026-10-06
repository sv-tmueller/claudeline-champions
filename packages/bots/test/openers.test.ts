import { describe, expect, it } from 'vitest';
import type { AbilitySpec, KitDef, Slot, SlotSpec } from '@claudeline/sim';
import { dashBand } from '../src/casting';
import { jsonKits } from './helpers';

function kitById(id: string): KitDef {
  const kit = jsonKits().find((k) => k.id === id);
  if (kit === undefined) throw new Error(`no kit ${id}`);
  return kit;
}

function slotOf(id: string, slot: Slot): SlotSpec {
  return kitById(id).slots[slot];
}

describe('the dash band of an opener', () => {
  // A base ability with no band whose first effect is a dash of distance D gets [D - 1, D]: its
  // windup is 0, so the target cannot walk out of reach, and the dash ends against the body.
  it('is [4, 5] for Rush and [5, 6] for Lunge, read from the kit', () => {
    expect(dashBand(slotOf('hargrim', 'SPACE'))).toEqual([4, 5]);
    expect(dashBand(slotOf('skerrow', 'SPACE'))).toEqual([5, 6]);
  });

  it('is none for an EX dash that has a band of its own, for the ultimate and for other shapes', () => {
    expect(dashBand(slotOf('hargrim', 'SPACE').ex as AbilitySpec)).toBeNull();
    expect(dashBand(slotOf('skerrow', 'SPACE').ex as AbilitySpec)).toBeNull();
    expect(dashBand(slotOf('hargrim', 'F'))).toBeNull();
    expect(dashBand(slotOf('quillon', 'SPACE'))).toBeNull();
    expect(dashBand(slotOf('hargrim', 'R'))).toBeNull();
  });
});
