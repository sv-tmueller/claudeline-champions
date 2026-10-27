import { describe, expect, it } from 'vitest';
import { createMatch, debug, step } from '../src/index';
import type { Effect, GameState, MatchConfig, Slot } from '../src/index';
import { spawnArea } from '../src/area';
import { landHit } from '../src/energy';
import { applyDamage } from '../src/health';
import { meleeArc } from '../src/melee';
import { spawnProjectile } from '../src/projectile';
import { nextId } from '../src/state';
import { applyShield, applyStatus } from '../src/status';
import { champion, openArena, place } from './helpers';
import { kitWith } from './kits';

// Champion 0 is a damage dealer and 1 a support, both team A; 2 and 3 are the damage dealers of
// team B. Casts are registered by hand here; cast.test.ts drives them through `step`.
const CONFIG: MatchConfig = {
  teamSize: 2,
  players: [
    { championId: 'dps', team: 'A' },
    { championId: 'sup', team: 'A' },
    { championId: 'dps', team: 'B' },
    { championId: 'dps', team: 'B' },
  ],
};

function setup(): GameState {
  const state = createMatch(CONFIG, openArena(), 1, [
    kitWith('dps'),
    kitWith('sup', {}, { support: true }),
  ]);
  place(state, 0, -3, 0);
  place(state, 1, -3, 5);
  place(state, 2, 3, 0);
  place(state, 3, 3, 5);
  return state;
}

function newCast(state: GameState, casterId: number, slot: Slot, ex = false): number {
  const id = nextId(state);
  state.casts.push({ id, casterId, slot, ex, credited: [] });
  return id;
}

const ORIGIN = { x: 0, y: 0 };
const DAMAGE: Effect[] = [{ type: 'damage', amount: 10 }];

function hit(state: GameState, castId: number | null, targetId: number, effects: readonly Effect[], ownerId = 0): void {
  landHit(state, { ownerId, castId }, targetId, effects, ORIGIN);
}

function gained(state: GameState) {
  return state.events.filter((e) => e.type === 'energyGained');
}

describe('landHit gains from enemies', () => {
  const table: [Slot, boolean, number][] = [
    ['M1', false, 5],
    ['M2', false, 10],
    ['SPACE', false, 10],
    ['Q', false, 10],
    ['E', false, 10],
    ['R', false, 10],
    ['F', false, 15],
    ['M1', true, 10],
    ['Q', true, 10],
  ];
  for (const [slot, ex, amount] of table) {
    it(`gives ${amount} for ${slot}${ex ? ' EX' : ''} and reports it`, () => {
      const state = setup();
      const castId = newCast(state, 0, slot, ex);
      hit(state, castId, 2, DAMAGE);
      expect(champion(state, 0).energy).toBe(amount);
      expect(gained(state)).toEqual([
        { type: 'energyGained', championId: 0, castId, targetId: 2, amount, energy: amount },
      ]);
    });
  }

  it('gives 15 for each enemy an ultimate hits', () => {
    const state = setup();
    const castId = newCast(state, 0, 'F');
    hit(state, castId, 2, DAMAGE);
    hit(state, castId, 3, DAMAGE);
    expect(champion(state, 0).energy).toBe(30);
    expect(gained(state).map((e) => (e as { energy: number }).energy)).toEqual([15, 30]);
  });

  it('keeps adding energy over casts', () => {
    const state = setup();
    hit(state, newCast(state, 0, 'M1'), 2, DAMAGE);
    hit(state, newCast(state, 0, 'M1'), 2, DAMAGE);
    hit(state, newCast(state, 0, 'Q'), 3, DAMAGE);
    expect(champion(state, 0).energy).toBe(20);
  });

  it('gives energy only once to a target per cast, and still to another target', () => {
    const state = setup();
    const castId = newCast(state, 0, 'E');
    hit(state, castId, 2, DAMAGE);
    state.events.length = 0;
    hit(state, castId, 2, DAMAGE);
    expect(champion(state, 0).energy).toBe(10);
    expect(gained(state)).toEqual([]);
    expect(state.casts[0]?.credited).toEqual([2]);
    hit(state, castId, 3, DAMAGE);
    expect(champion(state, 0).energy).toBe(20);
    expect(state.casts[0]?.credited).toEqual([2, 3]);
  });

  it('counts a hit that a shield absorbs completely', () => {
    const state = setup();
    applyShield(state, 2, { absorb: 50, ticks: 100 }, { sourceId: 3, slot: null });
    hit(state, newCast(state, 0, 'M1'), 2, DAMAGE);
    expect(champion(state, 2).health).toBe(120);
    expect(champion(state, 0).energy).toBe(5);
  });

  it('counts a hit that kills', () => {
    const state = setup();
    champion(state, 2).health = 4;
    hit(state, newCast(state, 0, 'M1'), 2, DAMAGE);
    expect(champion(state, 2).alive).toBe(false);
    expect(champion(state, 0).energy).toBe(5);
  });

  it('gives nothing for an invulnerable target, and does not mark it', () => {
    const state = setup();
    applyStatus(state, 2, { type: 'invulnerable', ticks: 30 }, { sourceId: 2, slot: null });
    const castId = newCast(state, 0, 'M1');
    hit(state, castId, 2, DAMAGE);
    expect(champion(state, 0).energy).toBe(0);
    expect(state.casts[0]?.credited).toEqual([]);
    // Once the invulnerability is gone the same cast may still earn from that target.
    champion(state, 2).statuses.length = 0;
    hit(state, castId, 2, DAMAGE);
    expect(champion(state, 0).energy).toBe(5);
  });

  it('gives nothing for a dead target', () => {
    const state = setup();
    champion(state, 2).alive = false;
    champion(state, 2).health = 0;
    hit(state, newCast(state, 0, 'M1'), 2, DAMAGE);
    expect(champion(state, 0).energy).toBe(0);
  });

  it('gives nothing for a status only, a shield only or a knockback only', () => {
    const lists: Effect[][] = [
      [{ type: 'applyStatus', status: { type: 'stun', ticks: 30 } }],
      [{ type: 'shield', absorb: 20, ticks: 60 }],
      [{ type: 'knockback', distance: 2, ticks: 8, direction: 'away' }],
      [{ type: 'heal', amount: 5 }],
    ];
    for (const effects of lists) {
      const state = setup();
      hit(state, newCast(state, 0, 'M2'), 2, effects);
      expect(champion(state, 0).energy, JSON.stringify(effects)).toBe(0);
      expect(state.casts[0]?.credited).toEqual([]);
    }
  });

  it('gives nothing for a damage over time pulse, only for the hit that applied it', () => {
    const state = setup();
    hit(state, newCast(state, 0, 'E'), 2, [
      { type: 'damage', amount: 5 },
      { type: 'applyStatus', status: { type: 'dot', perPulse: 3, ticks: 90 } },
    ]);
    expect(champion(state, 0).energy).toBe(10);
    for (let i = 0; i < 90; i++) step(state, []);
    expect(champion(state, 2).health).toBe(120 - 5 - 9);
    expect(champion(state, 0).energy).toBe(10);
  });

  it('gives nothing for damage to an ally', () => {
    const state = setup();
    hit(state, newCast(state, 0, 'M1'), 1, DAMAGE);
    expect(champion(state, 0).energy).toBe(0);
    expect(champion(state, 1).health).toBe(110);
  });

  it('gives a support energy for hitting an enemy too', () => {
    const state = setup();
    hit(state, newCast(state, 1, 'M2'), 2, DAMAGE, 1);
    expect(champion(state, 1).energy).toBe(10);
  });
});

describe('landHit support heals', () => {
  it('gives a support the table value when a heal restores health to an ally', () => {
    const table: [Slot, number][] = [['M1', 5], ['E', 10], ['F', 15]];
    for (const [slot, amount] of table) {
      const state = setup();
      champion(state, 0).health = 100;
      const castId = newCast(state, 1, slot);
      hit(state, castId, 0, [{ type: 'heal', amount: 8 }], 1);
      expect(champion(state, 1).energy, slot).toBe(amount);
      expect(gained(state)).toEqual([
        { type: 'energyGained', championId: 1, castId, targetId: 0, amount, energy: amount },
      ]);
    }
  });

  it('still gives the table value for a heal a wound cut, when it restores health', () => {
    const state = setup();
    champion(state, 0).health = 100;
    applyStatus(state, 0, { type: 'wound', ticks: 120, stacks: 3 }, { sourceId: 2, slot: 'Q' });
    const castId = newCast(state, 1, 'E');
    hit(state, castId, 0, [{ type: 'heal', amount: 8 }], 1);
    expect(champion(state, 0).health).toBe(100 + (8 * 70) / 100);
    expect(champion(state, 1).energy).toBe(10);
    expect(gained(state)).toEqual([
      { type: 'energyGained', championId: 1, castId, targetId: 0, amount: 10, energy: 10 },
    ]);
  });

  it('gives nothing when the heal restores nothing, then counts the same cast later', () => {
    const state = setup();
    const castId = newCast(state, 1, 'M1');
    hit(state, castId, 0, [{ type: 'heal', amount: 8 }], 1);
    expect(champion(state, 1).energy).toBe(0);
    expect(state.casts[0]?.credited).toEqual([]);
    champion(state, 0).health = 100;
    hit(state, castId, 0, [{ type: 'heal', amount: 8 }], 1);
    expect(champion(state, 1).energy).toBe(5);
  });

  it('gives nothing for healing itself', () => {
    const state = setup();
    champion(state, 1).health = 100;
    hit(state, newCast(state, 1, 'M1'), 1, [{ type: 'heal', amount: 8 }], 1);
    expect(champion(state, 1).health).toBe(108);
    expect(champion(state, 1).energy).toBe(0);
  });

  it('gives a kit that is not a support nothing for healing an ally', () => {
    const state = setup();
    champion(state, 1).health = 100;
    hit(state, newCast(state, 0, 'M1'), 1, [{ type: 'heal', amount: 8 }]);
    expect(champion(state, 1).health).toBe(108);
    expect(champion(state, 0).energy).toBe(0);
  });

  it('gives a support one gain per ally healed, however often', () => {
    const state = setup();
    champion(state, 0).health = 50;
    const castId = newCast(state, 1, 'F');
    hit(state, castId, 0, [{ type: 'heal', amount: 8 }], 1);
    hit(state, castId, 0, [{ type: 'heal', amount: 8 }], 1);
    expect(champion(state, 1).energy).toBe(15);
  });
});

describe('landHit energyGain', () => {
  it('adds its amount on top of a qualifying table gain', () => {
    const state = setup();
    const castId = newCast(state, 0, 'M1');
    hit(state, castId, 2, [{ type: 'damage', amount: 10 }, { type: 'energyGain', amount: 5 }]);
    expect(champion(state, 0).energy).toBe(10);
    expect(gained(state)).toEqual([
      { type: 'energyGained', championId: 0, castId, targetId: 2, amount: 10, energy: 10 },
    ]);
  });

  it('adds every energyGain in the list', () => {
    const state = setup();
    hit(state, newCast(state, 0, 'E'), 2, [
      { type: 'energyGain', amount: 3 },
      { type: 'damage', amount: 10 },
      { type: 'energyGain', amount: 4 },
    ]);
    expect(champion(state, 0).energy).toBe(17);
  });

  it('gives nothing alone, with a status only or for an unqualified target', () => {
    const state = setup();
    hit(state, newCast(state, 0, 'E'), 2, [{ type: 'energyGain', amount: 5 }]);
    hit(state, newCast(state, 0, 'E'), 2, [
      { type: 'applyStatus', status: { type: 'root', ticks: 30 } },
      { type: 'energyGain', amount: 5 },
    ]);
    hit(state, newCast(state, 0, 'E'), 1, [{ type: 'damage', amount: 5 }, { type: 'energyGain', amount: 5 }]);
    expect(champion(state, 0).energy).toBe(0);
  });

  it('adds only once per target per cast', () => {
    const state = setup();
    const castId = newCast(state, 0, 'M1');
    const effects: Effect[] = [{ type: 'damage', amount: 1 }, { type: 'energyGain', amount: 5 }];
    hit(state, castId, 2, effects);
    hit(state, castId, 2, effects);
    expect(champion(state, 0).energy).toBe(10);
  });
});

describe('landHit and the energy cap', () => {
  it('trims a gain to the room left and reports the trimmed amount', () => {
    const state = setup();
    champion(state, 0).energy = 98;
    const castId = newCast(state, 0, 'M1');
    hit(state, castId, 2, DAMAGE);
    expect(champion(state, 0).energy).toBe(100);
    expect(gained(state)).toEqual([
      { type: 'energyGained', championId: 0, castId, targetId: 2, amount: 2, energy: 100 },
    ]);
  });

  it('emits nothing at the cap but still marks the target', () => {
    const state = setup();
    champion(state, 0).energy = 100;
    const castId = newCast(state, 0, 'F');
    hit(state, castId, 2, DAMAGE);
    expect(champion(state, 0).energy).toBe(100);
    expect(gained(state)).toEqual([]);
    expect(state.casts[0]?.credited).toEqual([2]);
    champion(state, 0).energy = 40;
    hit(state, castId, 2, DAMAGE);
    expect(champion(state, 0).energy).toBe(40);
  });
});

describe('landHit without a cast or a living caster', () => {
  it('gives nothing for a hit with no cast id, and still applies the effects', () => {
    const state = setup();
    place(state, 2, 5, 0);
    hit(state, null, 2, [
      { type: 'damage', amount: 10 },
      { type: 'applyStatus', status: { type: 'slow', percent: 30, ticks: 30 } },
      { type: 'energyGain', amount: 5 },
    ]);
    expect(champion(state, 0).energy).toBe(0);
    expect(champion(state, 2).health).toBe(110);
    expect(champion(state, 2).statuses[0]).toMatchObject({ type: 'slow', slot: null });
    expect(state.events.some((e) => e.type === 'energyGained')).toBe(false);
  });

  it('gives a dead caster nothing, no event and no mark', () => {
    const state = setup();
    const castId = newCast(state, 0, 'M1');
    applyDamage(state, 0, 1000, 2);
    state.events.length = 0;
    hit(state, castId, 2, DAMAGE);
    expect(champion(state, 2).health).toBe(110);
    expect(champion(state, 0).energy).toBe(0);
    expect(gained(state)).toEqual([]);
    expect(state.casts[0]?.credited).toEqual([]);
  });

  it('gives the statuses it applies the slot of the cast', () => {
    const state = setup();
    hit(state, newCast(state, 0, 'E'), 2, [
      { type: 'applyStatus', status: { type: 'slow', percent: 30, ticks: 30 } },
    ]);
    expect(champion(state, 2).statuses[0]).toMatchObject({ type: 'slow', sourceId: 0, slot: 'E' });
    expect(state.events[0]).toMatchObject({ type: 'statusApplied', slot: 'E' });
  });

  it('throws for a cast that is not in the state', () => {
    const state = setup();
    expect(() => hit(state, 99, 2, DAMAGE)).toThrow('Invalid hit: unknown cast 99');
    expect(champion(state, 2).health).toBe(120);
  });
});

describe('entities that carry a cast id', () => {
  const bolt = (castId: number | null, extra: Partial<Parameters<typeof spawnProjectile>[1]> = {}) => ({
    spec: {
      ownerId: 0, x: -1, y: 0, dirX: 1, dirY: 0, speed: 20, radius: 0.3, lifetimeTicks: 30,
      pierce: false, effects: [{ type: 'damage' as const, amount: 10 }], ...extra,
    },
    castId,
  });

  it('stores the cast id on a projectile and an area, and null when none is given', () => {
    const state = setup();
    const castId = newCast(state, 0, 'Q');
    const a = bolt(castId);
    spawnProjectile(state, a.spec, castId);
    spawnProjectile(state, a.spec);
    spawnArea(state, { ownerId: 0, x: 0, y: 0, radius: 1, durationTicks: 3, intervalTicks: 1, targets: 'enemies', effects: DAMAGE }, castId);
    spawnArea(state, { ownerId: 0, x: 0, y: 0, radius: 1, durationTicks: 3, intervalTicks: 1, targets: 'enemies', effects: DAMAGE });
    expect(state.projectiles.map((p) => p.castId)).toEqual([castId, null]);
    expect(state.areas.map((p) => p.castId)).toEqual([castId, null]);
  });

  it('wraps the dev tool spawns so that they always store null', () => {
    const state = setup();
    const a = bolt(null);
    debug.spawnProjectile(state, a.spec);
    debug.spawnArea(state, { ownerId: 0, x: 0, y: 0, radius: 1, durationTicks: 3, intervalTicks: 1, targets: 'enemies', effects: DAMAGE });
    expect(state.projectiles[0]?.castId).toBeNull();
    expect(state.areas[0]?.castId).toBeNull();
    expect(debug.spawnProjectile.length).toBe(2);
    expect(debug.spawnArea.length).toBe(2);
  });

  it('rejects a cast id that is not in the state', () => {
    const state = setup();
    const a = bolt(null);
    expect(() => spawnProjectile(state, a.spec, 99)).toThrow('Invalid projectile: unknown cast 99');
    expect(() =>
      spawnArea(state, { ownerId: 0, x: 0, y: 0, radius: 1, durationTicks: 3, intervalTicks: 1, targets: 'enemies', effects: DAMAGE }, 99),
    ).toThrow('Invalid area: unknown cast 99');
    expect(() =>
      meleeArc(state, { ownerId: 0, x: 0, y: 0, dirX: 1, dirY: 0, radius: 1, cosHalfAngle: -1, effects: DAMAGE, castId: 99 }),
    ).toThrow('Invalid melee arc: unknown cast 99');
    expect(state.projectiles).toEqual([]);
    expect(state.areas).toEqual([]);
    expect(state.nextEntityId).toBe(4);
  });

  it('gives energy for a projectile hit', () => {
    const state = setup();
    place(state, 0, -1, 0);
    place(state, 2, 3, 0);
    const castId = newCast(state, 0, 'E');
    spawnProjectile(state, bolt(castId).spec, castId);
    for (let i = 0; i < 15; i++) step(state, []);
    expect(champion(state, 2).health).toBe(110);
    expect(champion(state, 0).energy).toBe(10);
  });

  it('gives a piercing projectile one gain per enemy and a second projectile of the cast none for the same one', () => {
    const state = setup();
    place(state, 0, -1, 0);
    place(state, 2, 3, 0);
    place(state, 3, 6, 0);
    const castId = newCast(state, 0, 'E');
    const pierce = bolt(castId, { pierce: true, lifetimeTicks: 40 });
    spawnProjectile(state, pierce.spec, castId);
    spawnProjectile(state, pierce.spec, castId);
    for (let i = 0; i < 25; i++) step(state, []);
    expect(champion(state, 2).health).toBe(100);
    expect(champion(state, 3).health).toBe(100);
    expect(champion(state, 0).energy).toBe(20);
    expect(state.casts[0]?.credited).toEqual([2, 3]);
  });

  it('gives an area that pulses one gain per target per cast', () => {
    const state = setup();
    place(state, 2, 0, 0);
    const castId = newCast(state, 0, 'M2');
    spawnArea(
      state,
      { ownerId: 0, x: 0, y: 0, radius: 2, durationTicks: 3, intervalTicks: 1, targets: 'enemies', effects: DAMAGE },
      castId,
    );
    for (let i = 0; i < 3; i++) step(state, []);
    expect(champion(state, 2).health).toBe(90);
    expect(champion(state, 0).energy).toBe(10);
  });

  it('gives a melee arc one gain per enemy it hits', () => {
    const state = setup();
    place(state, 2, 0, 0);
    place(state, 3, 0, 1);
    const castId = newCast(state, 0, 'M1');
    meleeArc(state, { ownerId: 0, x: 0, y: 0, dirX: 1, dirY: 0, radius: 2, cosHalfAngle: -1, effects: DAMAGE, castId });
    expect(champion(state, 0).energy).toBe(10);
    expect(state.casts[0]?.credited).toEqual([2, 3]);
    // Called without a cast id it gives nothing.
    meleeArc(state, { ownerId: 0, x: 0, y: 0, dirX: 1, dirY: 0, radius: 2, cosHalfAngle: -1, effects: DAMAGE });
    expect(champion(state, 0).energy).toBe(10);
  });
});
