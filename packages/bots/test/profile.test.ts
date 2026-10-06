import { describe, expect, it } from 'vitest';
import type { KitDef, SlotSpec } from '@claudeline/sim';
import { profileFor, rulesFor } from '../src/profile';
import { jsonKits } from './helpers';
import { boltSlot, hargrimKit, quietKit, quillonKit } from './kits';

function withM1(kit: KitDef, m1: SlotSpec): KitDef {
  return { ...kit, slots: { ...kit.slots, M1: m1 } };
}

function arcSlot(radius: number): SlotSpec {
  return {
    cooldownTicks: 36,
    windupTicks: 9,
    movement: 'slowed',
    effects: [{ type: 'meleeArc', radius, cosHalfAngle: 0.643, effects: [{ type: 'damage', amount: 12 }] }],
  };
}

describe('profileFor with a kit', () => {
  it('reads Hargrim and Quillon from the base M1 band minus the margin', () => {
    expect(profileFor('hargrim', hargrimKit())).toEqual({ rangeMin: 0, rangeMax: 2 });
    expect(profileFor('quillon', quillonKit())).toEqual({ rangeMin: 6, rangeMax: 13 });
  });

  it('derives rangeMax instead of hard-coding it', () => {
    // Quillon M1 of 21 m/s for 45 ticks reaches 15.75 m, so rangeMax is 14.75.
    expect(profileFor('quillon', withM1(quillonKit(), boltSlot(21, 45)))).toEqual({
      rangeMin: 6,
      rangeMax: 14.75,
    });
    // Hargrim M1 arc of 3 m reaches 3.5 m, so rangeMax is 2.5.
    expect(profileFor('hargrim', withM1(hargrimKit(), arcSlot(3)))).toEqual({
      rangeMin: 0,
      rangeMax: 2.5,
    });
  });

  it('falls back to the table when the derived rangeMax is at most 1 m', () => {
    // An arc of 1 m reaches 1.5 m: rangeMax 0.5.
    expect(profileFor('hargrim', withM1(hargrimKit(), arcSlot(1)))).toEqual({ rangeMin: 0, rangeMax: 3 });
  });

  it('falls back to the table when the derived rangeMax is at most rangeMin', () => {
    // 21 m/s for 20 ticks reaches 7 m: rangeMax 6, not above rangeMin 6.
    expect(profileFor('quillon', withM1(quillonKit(), boltSlot(21, 20)))).toEqual({
      rangeMin: 6,
      rangeMax: 13,
    });
  });

  it('falls back to the table when M1 has no band', () => {
    expect(profileFor('hargrim', quietKit('hargrim'))).toEqual({ rangeMin: 0, rangeMax: 3 });
    expect(profileFor('quillon', quietKit('quillon'))).toEqual({ rangeMin: 6, rangeMax: 13 });
  });

  it('ignores a kit whose id differs from the champion id', () => {
    expect(profileFor('hargrim', quillonKit())).toEqual({ rangeMin: 0, rangeMax: 3 });
    expect(profileFor('quillon', hargrimKit())).toEqual({ rangeMin: 6, rangeMax: 13 });
  });

  it('keeps the table for a champion with no rule, even with a kit of its id', () => {
    expect(profileFor('lumeth', quietKit('lumeth'))).toEqual({ rangeMin: 6, rangeMax: 10 });
    expect(profileFor('lumeth', withM1(quietKit('lumeth'), boltSlot(21, 40)))).toEqual({
      rangeMin: 6,
      rangeMax: 10,
    });
  });

  it('reads Skerrow from the base M1 band too: the arc of 2.5 m less the margin is 1.5 m', () => {
    const skerrow = jsonKits().find((kit) => kit.id === 'skerrow') as KitDef;
    expect(profileFor('skerrow', skerrow)).toEqual({ rangeMin: 0, rangeMax: 1.5 });
    // Without a kit, or with a kit of another id, she keeps the table: 2.5 m.
    expect(profileFor('skerrow')).toEqual({ rangeMin: 0, rangeMax: 2.5 });
    expect(profileFor('skerrow', quietKit('hargrim'))).toEqual({ rangeMin: 0, rangeMax: 2.5 });
  });

  it('returns a fresh object every call', () => {
    const kit = hargrimKit();
    expect(profileFor('hargrim', kit)).not.toBe(profileFor('hargrim', kit));
  });
});

describe('profileFor without a kit', () => {
  it('keeps the table', () => {
    expect(profileFor('hargrim')).toEqual({ rangeMin: 0, rangeMax: 3 });
    expect(profileFor('quillon')).toEqual({ rangeMin: 6, rangeMax: 13 });
    expect(profileFor('constructor')).toEqual({ rangeMin: 4, rangeMax: 8 });
  });
});

describe('rulesFor', () => {
  it('hands out frozen rules: the row, its openers and escapes, and each opener and band', () => {
    for (const kit of jsonKits()) {
      const rules = rulesFor(kit.id, kit);
      expect(rules.openers.length + rules.escapes.length, kit.id).toBeGreaterThan(0);
      expect(Object.isFrozen(rules), `${kit.id} row`).toBe(true);
      expect(Object.isFrozen(rules.openers), `${kit.id} openers`).toBe(true);
      expect(Object.isFrozen(rules.escapes), `${kit.id} escapes`).toBe(true);
      for (const opener of rules.openers) {
        expect(Object.isFrozen(opener), `${kit.id} ${opener.slot}`).toBe(true);
        if (Array.isArray(opener.band)) expect(Object.isFrozen(opener.band)).toBe(true);
      }
    }
  });

  it('gives no rule without a kit or with a kit of another id', () => {
    const quillon = jsonKits().find((kit) => kit.id === 'quillon') as KitDef;
    expect(rulesFor('hargrim')).toEqual({ openers: [], escapes: [], holdF: false });
    expect(rulesFor('hargrim', quillon)).toEqual({ openers: [], escapes: [], holdF: false });
  });
});
