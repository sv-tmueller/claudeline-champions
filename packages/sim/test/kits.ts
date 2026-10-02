// Test kits. `state.kits` is part of the checksum, so once the ability fixture is authored these
// values are frozen: change one and the committed checksums of `scripted-abilities-arena01-2v2.json`
// move. Every cosine is a decimal literal, never `Math.cos(...)`, so no platform can differ.
//
// Together the two kits use every top-level effect (projectile; area `self`, `ahead` and `aim`;
// meleeArc including a 360-degree arc; dash with `then`; fixed and up-to teleport; applyStatus,
// shield and heal on the caster), every hit effect (all eight status types, shield, knockback
// `away` and `toward`, energyGain), all three movement rules, a windup of 0 and above 0, exactly two
// EX variants per kit (one changing the windup) and an F on each. Values stay inside the ranges of
// docs/design/rules.md, which `validateKit` does not check.
import type { AbilitySpec, KitDef, Slot, SlotSpec } from '../src/index';

export const STRIKER_ID = 'test-striker';
export const MENDER_ID = 'test-mender';

/** The striker: damage dealer, `support: false`, 160 health. */
export function testStriker(): KitDef {
  return {
    id: STRIKER_ID,
    maxHealth: 160,
    moveSpeed: 5.5,
    support: false,
    ex: ['M2', 'SPACE'],
    slots: {
      // A 100 degree arc, 2.5 m, instant.
      M1: {
        cooldownTicks: 20,
        windupTicks: 0,
        movement: 'free',
        effects: [
          { type: 'meleeArc', radius: 2.5, cosHalfAngle: 0.643, effects: [{ type: 'damage', amount: 10 }] },
        ],
      },
      // A slowing slam 2.5 m ahead. The EX variant has no windup and a bigger area.
      M2: {
        cooldownTicks: 60,
        windupTicks: 12,
        movement: 'slowed',
        effects: [
          {
            type: 'area',
            placement: { type: 'ahead', distance: 2.5 },
            radius: 2,
            durationTicks: 1,
            intervalTicks: 1,
            targets: 'enemies',
            effects: [
              { type: 'damage', amount: 14 },
              { type: 'applyStatus', status: { type: 'slow', percent: 30, ticks: 90 } },
              { type: 'knockback', distance: 2, ticks: 8, direction: 'away' },
            ],
          },
        ],
        ex: {
          windupTicks: 0,
          movement: 'free',
          effects: [
            {
              type: 'area',
              placement: { type: 'ahead', distance: 2.5 },
              radius: 2.75,
              durationTicks: 1,
              intervalTicks: 1,
              targets: 'enemies',
              effects: [
                { type: 'damage', amount: 22 },
                { type: 'applyStatus', status: { type: 'slow', percent: 50, ticks: 120 } },
              ],
            },
          ],
        },
      },
      // A dash with a 360 degree arc at its end, and haste on the caster. The EX goes further and
      // stuns.
      SPACE: {
        cooldownTicks: 120,
        windupTicks: 0,
        movement: 'free',
        effects: [
          {
            type: 'dash',
            distance: 6,
            ticks: 12,
            then: [
              { type: 'meleeArc', radius: 2, cosHalfAngle: -1, effects: [{ type: 'damage', amount: 12 }] },
            ],
          },
          { type: 'applyStatus', status: { type: 'haste', percent: 20, ticks: 90 } },
        ],
        ex: {
          windupTicks: 0,
          movement: 'free',
          effects: [
            {
              type: 'dash',
              distance: 8,
              ticks: 12,
              then: [
                {
                  type: 'meleeArc',
                  radius: 2.5,
                  cosHalfAngle: -1,
                  effects: [
                    { type: 'damage', amount: 14 },
                    { type: 'applyStatus', status: { type: 'stun', ticks: 30 } },
                  ],
                },
              ],
            },
            { type: 'applyStatus', status: { type: 'haste', percent: 30, ticks: 120 } },
          ],
        },
      },
      // A piercing bolt that roots and pulls. Locked while it winds up.
      Q: {
        cooldownTicks: 150,
        windupTicks: 18,
        movement: 'locked',
        effects: [
          {
            type: 'projectile',
            speed: 20,
            radius: 0.4,
            lifetimeTicks: 40,
            pierce: true,
            effects: [
              { type: 'damage', amount: 12 },
              { type: 'applyStatus', status: { type: 'root', ticks: 60 } },
              { type: 'knockback', distance: 2, ticks: 8, direction: 'toward' },
            ],
          },
        ],
      },
      // A bolt with a damage over time and a bonus of 5 energy.
      E: {
        cooldownTicks: 150,
        windupTicks: 8,
        movement: 'free',
        effects: [
          {
            type: 'projectile',
            speed: 16,
            radius: 0.3,
            lifetimeTicks: 50,
            pierce: false,
            effects: [
              { type: 'damage', amount: 15 },
              { type: 'applyStatus', status: { type: 'dot', perPulse: 3, ticks: 120 } },
              { type: 'energyGain', amount: 5 },
            ],
          },
        ],
      },
      // Teleport up to 8 m toward the aim, then a 360 degree arc where it arrives.
      R: {
        cooldownTicks: 240,
        windupTicks: 0,
        movement: 'free',
        effects: [
          { type: 'teleport', range: 8, fixed: false },
          { type: 'meleeArc', radius: 2, cosHalfAngle: -1, effects: [{ type: 'damage', amount: 16 }] },
        ],
      },
      // The ultimate: a stunning shockwave around the caster.
      F: {
        cooldownTicks: 600,
        windupTicks: 30,
        movement: 'locked',
        effects: [
          {
            type: 'area',
            placement: { type: 'self' },
            radius: 4,
            durationTicks: 1,
            intervalTicks: 1,
            targets: 'enemies',
            effects: [
              { type: 'damage', amount: 30 },
              { type: 'applyStatus', status: { type: 'stun', ticks: 60 } },
              { type: 'knockback', distance: 3, ticks: 10, direction: 'away' },
            ],
          },
        ],
      },
    },
  };
}

/** The mender: heals allies, `support: true`, 120 health. */
export function testMender(): KitDef {
  return {
    id: MENDER_ID,
    maxHealth: 120,
    moveSpeed: 5.5,
    support: true,
    ex: ['M1', 'E'],
    slots: {
      // A heal at the aim, up to 7 m away. The EX variant heals more and does not slow the caster.
      M1: {
        cooldownTicks: 24,
        windupTicks: 6,
        movement: 'free',
        effects: [
          {
            type: 'area',
            placement: { type: 'aim', range: 7 },
            radius: 1.5,
            durationTicks: 1,
            intervalTicks: 1,
            targets: 'allies',
            effects: [{ type: 'heal', amount: 8 }],
          },
        ],
        ex: {
          windupTicks: 6,
          movement: 'free',
          effects: [
            {
              type: 'area',
              placement: { type: 'aim', range: 7 },
              radius: 2,
              durationTicks: 1,
              intervalTicks: 1,
              targets: 'allies',
              effects: [{ type: 'heal', amount: 16 }],
            },
          ],
        },
      },
      // A silencing dart.
      M2: {
        cooldownTicks: 60,
        windupTicks: 0,
        movement: 'free',
        effects: [
          {
            type: 'projectile',
            speed: 18,
            radius: 0.3,
            lifetimeTicks: 40,
            pierce: false,
            effects: [
              { type: 'damage', amount: 12 },
              { type: 'applyStatus', status: { type: 'silence', ticks: 60 } },
            ],
          },
        ],
      },
      // A fixed 5 m blink toward the aim.
      SPACE: {
        cooldownTicks: 150,
        windupTicks: 0,
        movement: 'free',
        effects: [{ type: 'teleport', range: 5, fixed: true }],
      },
      // A healing burst around the caster with a heal over time and haste.
      Q: {
        cooldownTicks: 180,
        windupTicks: 12,
        movement: 'slowed',
        effects: [
          {
            type: 'area',
            placement: { type: 'self' },
            radius: 4,
            durationTicks: 1,
            intervalTicks: 1,
            targets: 'allies',
            effects: [
              { type: 'heal', amount: 10 },
              { type: 'applyStatus', status: { type: 'hot', perPulse: 4, ticks: 120 } },
              { type: 'applyStatus', status: { type: 'haste', percent: 20, ticks: 60 } },
            ],
          },
        ],
      },
      // A slow piercing bolt that damages and pulls. The EX variant has no windup.
      E: {
        cooldownTicks: 120,
        windupTicks: 15,
        movement: 'slowed',
        effects: [
          {
            type: 'projectile',
            speed: 14,
            radius: 0.5,
            lifetimeTicks: 60,
            pierce: true,
            effects: [
              { type: 'damage', amount: 14 },
              { type: 'knockback', distance: 1.5, ticks: 6, direction: 'toward' },
            ],
          },
        ],
        ex: {
          windupTicks: 0,
          movement: 'free',
          effects: [
            {
              type: 'projectile',
              speed: 14,
              radius: 0.5,
              lifetimeTicks: 60,
              pierce: true,
              effects: [{ type: 'damage', amount: 20 }],
            },
          ],
        },
      },
      // A ward: shield and brief invulnerability for the allies around the caster.
      R: {
        cooldownTicks: 240,
        windupTicks: 0,
        movement: 'free',
        effects: [
          {
            type: 'area',
            placement: { type: 'self' },
            radius: 3,
            durationTicks: 1,
            intervalTicks: 1,
            targets: 'allies',
            effects: [
              { type: 'shield', absorb: 30, ticks: 240 },
              { type: 'applyStatus', status: { type: 'invulnerable', ticks: 30 } },
            ],
          },
          { type: 'shield', absorb: 20, ticks: 180 },
          { type: 'heal', amount: 10 },
        ],
      },
      // The ultimate: heals the allies around the caster over a second and stuns enemies near it.
      F: {
        cooldownTicks: 600,
        windupTicks: 24,
        movement: 'free',
        effects: [
          {
            type: 'area',
            placement: { type: 'self' },
            radius: 5,
            durationTicks: 60,
            intervalTicks: 30,
            targets: 'allies',
            effects: [{ type: 'heal', amount: 15 }],
          },
          {
            type: 'area',
            placement: { type: 'self' },
            radius: 5,
            durationTicks: 1,
            intervalTicks: 1,
            targets: 'enemies',
            effects: [
              { type: 'damage', amount: 20 },
              { type: 'applyStatus', status: { type: 'stun', ticks: 30 } },
            ],
          },
        ],
      },
    },
  };
}

/** A harmless instant ability: a heal of 1 on a caster at full health changes nothing. */
export function quiet(overrides: Partial<SlotSpec> = {}): SlotSpec {
  return {
    cooldownTicks: 30,
    windupTicks: 0,
    movement: 'free',
    effects: [{ type: 'heal', amount: 1 }],
    ...overrides,
  };
}

/** The same, as an EX variant. */
export function quietEx(overrides: Partial<AbilitySpec> = {}): AbilitySpec {
  return { windupTicks: 0, movement: 'free', effects: [{ type: 'heal', amount: 1 }], ...overrides };
}

const SLOT_ORDER: Slot[] = ['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'];

/**
 * A valid kit whose every slot is `quiet()` unless overridden, for unit tests that need one ability
 * to behave in a particular way. The EX slots are M2 and Q by default; give each a variant with
 * `quietEx()` or override `ex` together with the slots.
 */
export function kitWith(
  id: string,
  slots: Partial<Record<Slot, SlotSpec>> = {},
  options: Partial<Pick<KitDef, 'support' | 'maxHealth' | 'moveSpeed' | 'ex'>> = {},
): KitDef {
  const ex = options.ex ?? ['M2', 'Q'];
  const built = Object.fromEntries(
    SLOT_ORDER.map((slot) => {
      const given = slots[slot];
      const spec = given ?? quiet();
      const withEx = ex.includes(slot) && spec.ex === undefined ? { ...spec, ex: quietEx() } : spec;
      return [slot, withEx];
    }),
  ) as Record<Slot, SlotSpec>;
  return {
    id,
    maxHealth: options.maxHealth ?? 120,
    moveSpeed: options.moveSpeed ?? 5.5,
    support: options.support ?? false,
    ex,
    slots: built,
  };
}
