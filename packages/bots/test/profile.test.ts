import { describe, expect, it } from 'vitest';
import type { KitDef, SlotSpec } from '@claudeline/sim';
import { profileFor, rulesFor } from '../src/profile';
import { jsonKits, rosterKits } from './helpers';
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

  it('keeps the table for a champion with no rule, whatever its kit', () => {
    // No champion of the roster is left without a rule; one that is not on it keeps the table.
    expect(profileFor('dummy', quietKit('dummy'))).toEqual({ rangeMin: 4, rangeMax: 8 });
    expect(profileFor('dummy', withM1(quietKit('dummy'), boltSlot(21, 40)))).toEqual({
      rangeMin: 4,
      rangeMax: 8,
    });
  });

  it('reads Lumeth from the base M1 band too: 20 m/s for 36 ticks reaches 12 m, so rangeMax is 11', () => {
    const lumeth = rosterKits().find((kit) => kit.id === 'lumeth') as KitDef;
    expect(profileFor('lumeth', lumeth)).toEqual({ rangeMin: 6, rangeMax: 11 });
    // Derived, not hard-coded: 21 m/s for 40 ticks reaches 14 m.
    expect(profileFor('lumeth', withM1(quietKit('lumeth'), boltSlot(21, 40)))).toEqual({
      rangeMin: 6,
      rangeMax: 13,
    });
    // With no M1 band, no kit or a kit of another id she keeps the table: 6 to 10 m.
    expect(profileFor('lumeth', quietKit('lumeth'))).toEqual({ rangeMin: 6, rangeMax: 10 });
    expect(profileFor('lumeth')).toEqual({ rangeMin: 6, rangeMax: 10 });
    expect(profileFor('lumeth', quietKit('hargrim'))).toEqual({ rangeMin: 6, rangeMax: 10 });
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
    const none = { openers: [], escapes: [], holdF: false, wait: null, escapeWithin: null };
    expect(rulesFor('hargrim')).toEqual(none);
    expect(rulesFor('hargrim', quillon)).toEqual(none);
  });

  it('gives Skerrow the wait of 6 to 8 m for SPACE with at most 90 ticks, frozen, and no one else', () => {
    const kits = jsonKits();
    const kit = (id: string) => kits.find((k) => k.id === id) as KitDef;
    const wait = rulesFor('skerrow', kit('skerrow')).wait;
    expect(wait).toEqual({ slot: 'SPACE', band: [6, 8], maxTicks: 90 });
    expect(Object.isFrozen(wait)).toBe(true);
    expect(Object.isFrozen(wait?.band)).toBe(true);
    expect(rulesFor('hargrim', kit('hargrim')).wait).toBeNull();
    expect(rulesFor('quillon', kit('quillon')).wait).toBeNull();
  });

  it('gives Skerrow the Quiet Dart opener on a target with an escape ready, and no one else', () => {
    const kits = jsonKits();
    const rules = rulesFor('skerrow', kits.find((k) => k.id === 'skerrow') as KitDef);
    expect(rules.openers.map((o) => `${o.slot}:${o.when}`)).toEqual(['SPACE:null', 'Q:escapeReady']);
    for (const id of ['hargrim', 'quillon']) {
      const other = rulesFor(id, kits.find((k) => k.id === id) as KitDef);
      expect(other.openers.map((o) => o.when), id).not.toContain('escapeReady');
    }
  });

  it('gives Lumeth the escape trigger of 3 m, and Hargrim, Quillon and Skerrow none', () => {
    const kits = rosterKits();
    const kit = (id: string) => kits.find((k) => k.id === id) as KitDef;
    expect(rulesFor('lumeth', kit('lumeth')).escapeWithin).toBe(3);
    for (const id of ['hargrim', 'quillon', 'skerrow']) {
      expect(rulesFor(id, kit(id)).escapeWithin, id).toBeNull();
    }
  });

  it('gives Lumeth Binding Sigil beside an ally and Lantern Burst, then Glide, as her escapes, frozen', () => {
    const kits = rosterKits();
    const rules = rulesFor('lumeth', kits.find((k) => k.id === 'lumeth') as KitDef);
    expect(rules.openers).toEqual([{ slot: 'Q', band: null, motion: null, when: 'nearAlly' }]);
    expect(rules.escapes).toEqual(['E', 'SPACE']);
    expect(rules.holdF).toBe(false);
    expect(rules.wait).toBeNull();
    expect(Object.isFrozen(rules)).toBe(true);
    expect(Object.isFrozen(rules.openers)).toBe(true);
    expect(Object.isFrozen(rules.escapes)).toBe(true);
    for (const opener of rules.openers) expect(Object.isFrozen(opener)).toBe(true);
  });
});
