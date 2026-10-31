import { describe, expect, it } from 'vitest';
import type { KitDef, SlotSpec } from '@claudeline/sim';
import { profileFor, rulesFor } from '../src/profile';
import { jsonKits, profileOf, rosterKits, sixKits } from './helpers';
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
    expect(profileFor('hargrim', hargrimKit())).toEqual(profileOf(0, 2));
    expect(profileFor('quillon', quillonKit())).toEqual(profileOf(6, 13));
  });

  it('derives rangeMax instead of hard-coding it', () => {
    // Quillon M1 of 21 m/s for 45 ticks reaches 15.75 m, so rangeMax is 14.75.
    expect(profileFor('quillon', withM1(quillonKit(), boltSlot(21, 45)))).toEqual(profileOf(6, 14.75));
    // Hargrim M1 arc of 3 m reaches 3.5 m, so rangeMax is 2.5.
    expect(profileFor('hargrim', withM1(hargrimKit(), arcSlot(3)))).toEqual(profileOf(0, 2.5));
  });

  it('falls back to the table when the derived rangeMax is at most 1 m', () => {
    // An arc of 1 m reaches 1.5 m: rangeMax 0.5.
    expect(profileFor('hargrim', withM1(hargrimKit(), arcSlot(1)))).toEqual(profileOf(0, 3));
  });

  it('falls back to the table when the derived rangeMax is at most rangeMin', () => {
    // 21 m/s for 20 ticks reaches 7 m: rangeMax 6, not above rangeMin 6.
    expect(profileFor('quillon', withM1(quillonKit(), boltSlot(21, 20)))).toEqual(profileOf(6, 13));
  });

  it('falls back to the table when M1 has no band', () => {
    expect(profileFor('hargrim', quietKit('hargrim'))).toEqual(profileOf(0, 3));
    expect(profileFor('quillon', quietKit('quillon'))).toEqual(profileOf(6, 13));
  });

  it('ignores a kit whose id differs from the champion id', () => {
    expect(profileFor('hargrim', quillonKit())).toEqual(profileOf(0, 3));
    expect(profileFor('quillon', hargrimKit())).toEqual(profileOf(6, 13));
  });

  it('keeps the table for a champion with no rule, whatever its kit', () => {
    // No champion of the roster is left without a rule; one that is not on it keeps the table.
    expect(profileFor('dummy', quietKit('dummy'))).toEqual(profileOf(4, 8));
    expect(profileFor('dummy', withM1(quietKit('dummy'), boltSlot(21, 40)))).toEqual(profileOf(4, 8));
  });

  it('reads Lumeth from the base M1 band too: 20 m/s for 36 ticks reaches 12 m, so rangeMax is 11', () => {
    const lumeth = rosterKits().find((kit) => kit.id === 'lumeth') as KitDef;
    expect(profileFor('lumeth', lumeth)).toEqual(profileOf(6, 11));
    // Derived, not hard-coded: 21 m/s for 40 ticks reaches 14 m.
    expect(profileFor('lumeth', withM1(quietKit('lumeth'), boltSlot(21, 40)))).toEqual(profileOf(6, 13));
    // With no M1 band, no kit or a kit of another id she keeps the table: 6 to 10 m.
    expect(profileFor('lumeth', quietKit('lumeth'))).toEqual(profileOf(6, 10));
    expect(profileFor('lumeth')).toEqual(profileOf(6, 10));
    expect(profileFor('lumeth', quietKit('hargrim'))).toEqual(profileOf(6, 10));
  });

  it('reads Skerrow from the base M1 band too: the arc of 2.5 m less the margin is 1.5 m', () => {
    const skerrow = jsonKits().find((kit) => kit.id === 'skerrow') as KitDef;
    expect(profileFor('skerrow', skerrow)).toEqual(profileOf(0, 1.5));
    // Without a kit, or with a kit of another id, she keeps the table: 2.5 m.
    expect(profileFor('skerrow')).toEqual(profileOf(0, 2.5));
    expect(profileFor('skerrow', quietKit('hargrim'))).toEqual(profileOf(0, 2.5));
  });

  it('reads Ondrel and Brimwick from the base M1 band: 20 m/s for 30 and 33 ticks, less the margin', () => {
    const six = sixKits();
    const ondrel = six.find((kit) => kit.id === 'ondrel') as KitDef;
    const brimwick = six.find((kit) => kit.id === 'brimwick') as KitDef;
    // Ondrel's M1 reaches 10 m, so rangeMax is 9; Brimwick's reaches 11 m, so 10.
    expect(profileFor('ondrel', ondrel)).toEqual(profileOf(5, 9));
    expect(profileFor('brimwick', brimwick)).toEqual(profileOf(7, 10));
  });

  it('derives the Ondrel and Brimwick rangeMax instead of hard-coding it', () => {
    // 21 m/s for 30 ticks reaches 10.5 m: 9.5. 22 m/s for 33 ticks reaches 12.1 m: 11.1.
    expect(profileFor('ondrel', withM1(quietKit('ondrel'), boltSlot(21, 30)))).toEqual(profileOf(5, 9.5));
    expect(profileFor('brimwick', withM1(quietKit('brimwick'), boltSlot(22, 33)))).toEqual(profileOf(7, 11.1));
  });

  it('keeps the Ondrel and Brimwick table with no kit, no M1 band or a kit of another id', () => {
    expect(profileFor('ondrel')).toEqual(profileOf(5, 9));
    expect(profileFor('brimwick')).toEqual(profileOf(7, 10));
    expect(profileFor('ondrel', quietKit('ondrel'))).toEqual(profileOf(5, 9));
    expect(profileFor('brimwick', quietKit('brimwick'))).toEqual(profileOf(7, 10));
    expect(profileFor('ondrel', quietKit('hargrim'))).toEqual(profileOf(5, 9));
    expect(profileFor('brimwick', quietKit('hargrim'))).toEqual(profileOf(7, 10));
  });

  it('falls back to the table when the derived Ondrel rangeMax is at most rangeMin', () => {
    // 20 m/s for 18 ticks reaches 6 m: rangeMax 5, not above rangeMin 5.
    expect(profileFor('ondrel', withM1(quietKit('ondrel'), boltSlot(20, 18)))).toEqual(profileOf(5, 9));
  });

  it('returns a fresh object every call', () => {
    const kit = hargrimKit();
    expect(profileFor('hargrim', kit)).not.toBe(profileFor('hargrim', kit));
  });
});

describe('profileFor without a kit', () => {
  it('keeps the table', () => {
    expect(profileFor('hargrim')).toEqual(profileOf(0, 3));
    expect(profileFor('quillon')).toEqual(profileOf(6, 13));
    expect(profileFor('constructor')).toEqual(profileOf(4, 8));
  });
});

describe('rulesFor', () => {
  it('hands out frozen rules: the row, its openers and escapes, and each opener and band', () => {
    for (const kit of sixKits()) {
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
    const none = { openers: [], escapes: [], holdF: false, wait: null, escapeWithin: null, allies: [] };
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

  it('gives Lumeth the escape trigger of 3 m, and the other five none', () => {
    const kits = sixKits();
    const kit = (id: string) => kits.find((k) => k.id === id) as KitDef;
    expect(rulesFor('lumeth', kit('lumeth')).escapeWithin).toBe(3);
    for (const id of ['hargrim', 'quillon', 'skerrow', 'ondrel', 'brimwick']) {
      expect(rulesFor(id, kit(id)).escapeWithin, id).toBeNull();
    }
  });

  it('gives Lumeth the ally slots F, R, M2 and M1, frozen, and Hargrim, Quillon and Skerrow none', () => {
    const kits = rosterKits();
    const kit = (id: string) => kits.find((k) => k.id === id) as KitDef;
    const lumeth = rulesFor('lumeth', kit('lumeth'));
    expect(lumeth.allies).toEqual(['F', 'R', 'M2', 'M1']);
    expect(Object.isFrozen(lumeth.allies)).toBe(true);
    // Hargrim's Rally Cry is an area on allies too, but the rule does not list it.
    for (const id of ['hargrim', 'quillon', 'skerrow']) {
      expect(rulesFor(id, kit(id)).allies, id).toEqual([]);
      expect(Object.isFrozen(rulesFor(id, kit(id)).allies), id).toBe(true);
    }
    // Without her kit she has no rule at all.
    expect(rulesFor('lumeth').allies).toEqual([]);
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

describe('rulesFor Ondrel and Brimwick', () => {
  const kits = sixKits();
  const kit = (id: string) => kits.find((k) => k.id === id) as KitDef;

  it('gives Ondrel Undertow on a target walking away and Reed Step, then Reed Screen, as escapes', () => {
    const rules = rulesFor('ondrel', kit('ondrel'));
    expect(rules.openers).toEqual([{ slot: 'E', band: null, motion: 'away', when: null }]);
    expect(rules.escapes).toEqual(['SPACE', 'R']);
    // The Drowned Ground reads 10 for one pulse, not the 50 of five: Ondrel does not hold it.
    expect(rules.holdF).toBe(false);
    expect(rules.wait).toBeNull();
    expect(rules.escapeWithin).toBeNull();
    expect(rules.allies).toEqual([]);
  });

  it('gives Brimwick Flash Powder on a target walking toward her and Flare Step, then Smoke Pot, and holds F', () => {
    const rules = rulesFor('brimwick', kit('brimwick'));
    expect(rules.openers).toEqual([{ slot: 'Q', band: null, motion: 'closing', when: null }]);
    expect(rules.escapes).toEqual(['SPACE', 'R']);
    expect(rules.holdF).toBe(true);
    expect(rules.wait).toBeNull();
    expect(rules.escapeWithin).toBeNull();
    expect(rules.allies).toEqual([]);
  });

  it('gives them no rule without their kit or with a kit of another id', () => {
    const none = { openers: [], escapes: [], holdF: false, wait: null, escapeWithin: null, allies: [] };
    for (const id of ['ondrel', 'brimwick']) {
      expect(rulesFor(id), id).toEqual(none);
      expect(rulesFor(id, kit('hargrim')), id).toEqual(none);
    }
  });
});

describe('the stand reach (#213)', () => {
  const skerrow = jsonKits().find((kit) => kit.id === 'skerrow') as KitDef;

  it('is 0.8 of rangeMax for the two champions that never kite, with a kit and without', () => {
    expect(profileFor('hargrim', hargrimKit()).standReach).toBe(2 * 0.8);
    expect(profileFor('skerrow', skerrow).standReach).toBe(1.5 * 0.8);
    expect(profileFor('hargrim').standReach).toBe(3 * 0.8);
    expect(profileFor('skerrow').standReach).toBe(2.5 * 0.8);
    // The table applies for a kit of another id or with no M1 band, and its stand reach with it.
    expect(profileFor('hargrim', quillonKit()).standReach).toBe(3 * 0.8);
    expect(profileFor('skerrow', quietKit('skerrow')).standReach).toBe(2.5 * 0.8);
  });

  it('is rangeMax for every champion that keeps its range, with a kit and without', () => {
    const roster = sixKits();
    for (const id of ['quillon', 'lumeth', 'ondrel', 'brimwick']) {
      const kit = roster.find((k) => k.id === id) as KitDef;
      expect(profileFor(id, kit).standReach, id).toBe(profileFor(id, kit).rangeMax);
      expect(profileFor(id).standReach, `${id} without a kit`).toBe(profileFor(id).rangeMax);
    }
    expect(profileFor('dummy').standReach).toBe(8);
  });

  it('stays above 1.1 m, so a walk to it ends before the bodies touch, and below rangeMax', () => {
    const roster = sixKits();
    for (const id of ['hargrim', 'skerrow']) {
      for (const kit of [roster.find((k) => k.id === id), undefined]) {
        const profile = profileFor(id, kit);
        expect(profile.standReach).toBeGreaterThan(1.1);
        expect(profile.standReach).toBeLessThan(profile.rangeMax);
      }
    }
  });
});
