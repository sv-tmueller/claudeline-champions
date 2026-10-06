import { describe, expect, it } from 'vitest';
import type { AbilitySpec, KitDef, Slot, SlotSpec } from '@claudeline/sim';
import { dashBand } from '../src/casting';
import { jsonKits } from './helpers';
import { pressOf, sceneOf } from './scenes';

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

describe('Rush, the dash opener of Hargrim', () => {
  it('presses base SPACE from 4 to 5 m with no energy, and not at 3.95 or 5.05 m', () => {
    for (const d of [4, 4.5, 5]) {
      expect(pressOf(sceneOf('hargrim', d, { ready: ['SPACE'] })), `at ${d} m`).toBe('SPACE');
    }
    for (const d of [3.95, 5.05]) {
      expect(pressOf(sceneOf('hargrim', d, { ready: ['SPACE'] })), `at ${d} m`).toBeNull();
    }
  });

  it('presses base SPACE, without SHIFT, while an ultimate reserve holds the EX variants', () => {
    // 80 energy with F ready: the reserve holds the EX dash back, so Rush is the base dash.
    const state = sceneOf('hargrim', 4.5, { energy: 80, ready: ['SPACE', 'F'] });
    expect(pressOf(state)).toBe('SPACE');
  });
});

describe('Chain Hook, the opener of Hargrim on a target that runs', () => {
  const E_ONLY = { ready: ['E'] } as const;

  it('presses E from 4 to 7 m at a target walking away', () => {
    for (const d of [4, 6, 7]) {
      expect(pressOf(sceneOf('hargrim', d, { ...E_ONLY, enemyVx: 5.5 })), `at ${d} m`).toBe('E');
    }
  });

  it('does not press E at 3.5 or 7.5 m, though the kit band reaches 8 m', () => {
    for (const d of [3.5, 7.5]) {
      expect(pressOf(sceneOf('hargrim', d, { ...E_ONLY, enemyVx: 5.5 })), `at ${d} m`).toBeNull();
    }
  });

  it('does not press E at a target that stands or closes in', () => {
    expect(pressOf(sceneOf('hargrim', 6, { ...E_ONLY, enemyVx: 0 }))).toBeNull();
    expect(pressOf(sceneOf('hargrim', 6, { ...E_ONLY, enemyVx: -5.5 }))).toBeNull();
  });
});

describe('Snare Orb, the opener of Quillon on a target that closes in', () => {
  const Q_AND_M2 = { ready: ['Q', 'M2'] } as const;

  it('presses Q at 8 m at a target walking toward her, and M2 at one that stands', () => {
    expect(pressOf(sceneOf('quillon', 8, { ...Q_AND_M2, enemyVx: -5.5 }))).toBe('Q');
    expect(pressOf(sceneOf('quillon', 8, { ...Q_AND_M2, enemyVx: 0 }))).toBe('M2');
  });

  it('presses M2, not Q, at a target walking away', () => {
    expect(pressOf(sceneOf('quillon', 8, { ...Q_AND_M2, enemyVx: 5.5 }))).toBe('M2');
  });

  it('does not press Q on a closing target beyond the kit band less the margin', () => {
    expect(pressOf(sceneOf('quillon', 9, { ready: ['Q'], enemyVx: -5.5 }))).toBe('Q');
    expect(pressOf(sceneOf('quillon', 9.05, { ready: ['Q'], enemyVx: -5.5 }))).toBeNull();
  });
});
