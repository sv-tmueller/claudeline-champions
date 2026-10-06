// Bots-local test kits. The bots tests must not reach into sim tests, and `validateKit` is not
// exported, so every kit here is validated when a test hands it to `createMatch`.
//
// Hargrim and Quillon follow docs/design/roster-v1.md with ticks = seconds x 60, except that the
// speeds and lifetimes are chosen so that every reach is an exact decimal. Where they differ from
// the roster: Quillon M1 is 21 m/s (roster 22), M2 is 15 m/s (roster 14) and E is 24 m/s (roster
// 25). The radii are the roster's, EX variants included: Quillon M2 is 0.4 m and its EX 0.6 m, E
// is 0.2 m and its EX 0.2 m. Every cosine is a decimal literal.
import type { AbilityEffect, AbilitySpec, Effect, KitDef, Slot, SlotSpec, ThenEffect } from '@claudeline/sim';

const SLOW = (percent: number, ticks: number): Effect => ({
  type: 'applyStatus',
  status: { type: 'slow', percent, ticks },
});

const HASTE_SELF = (percent: number, ticks: number): AbilityEffect => ({
  type: 'applyStatus',
  status: { type: 'haste', percent, ticks },
});

/** A projectile ability. The reach is `speed * lifetimeTicks / 60` metres. */
export function boltSlot(
  speed: number,
  lifetimeTicks: number,
  options: {
    cooldownTicks?: number;
    windupTicks?: number;
    movement?: AbilitySpec['movement'];
    pierce?: boolean;
    radius?: number;
    damage?: number;
    ex?: AbilitySpec;
  } = {},
): SlotSpec {
  const spec: SlotSpec = {
    cooldownTicks: options.cooldownTicks ?? 60,
    windupTicks: options.windupTicks ?? 0,
    movement: options.movement ?? 'free',
    effects: [
      {
        type: 'projectile',
        speed,
        radius: options.radius ?? 0.25,
        lifetimeTicks,
        pierce: options.pierce ?? false,
        effects: [{ type: 'damage', amount: options.damage ?? 1 }],
      },
    ],
  };
  if (options.ex !== undefined) spec.ex = options.ex;
  return spec;
}

/** The ability a bolt slot gives when used as an EX variant. */
export function boltAbility(
  speed: number,
  lifetimeTicks: number,
  options: {
    windupTicks?: number;
    movement?: AbilitySpec['movement'];
    pierce?: boolean;
    radius?: number;
    damage?: number;
  } = {},
): AbilitySpec {
  const { windupTicks, movement, effects } = boltSlot(speed, lifetimeTicks, options);
  return { windupTicks, movement, effects };
}

const QUIET_EFFECTS: AbilityEffect[] = [{ type: 'heal', amount: 1 }];

/** A self heal of 1, instant and free: no reach band. */
export function quietAbility(): AbilitySpec {
  return { windupTicks: 0, movement: 'free', effects: QUIET_EFFECTS.map((e) => ({ ...e })) };
}

/** A quiet slot: a self heal of 1 on a 60 tick cooldown, with an EX variant when `withEx`. */
export function quietSlot(withEx = false): SlotSpec {
  const spec: SlotSpec = { cooldownTicks: 60, ...quietAbility() };
  if (withEx) spec.ex = quietAbility();
  return spec;
}

const SLOT_NAMES: readonly Slot[] = ['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'];

/**
 * A kit in which every slot is a self heal of 1, so no slot has a reach band. `overrides` replaces
 * whole slots; a replaced slot listed in `ex` that has no `ex` of its own gets a quiet one.
 */
export function quietKit(
  id: string,
  overrides: Partial<Record<Slot, SlotSpec>> = {},
  ex: [Slot, Slot] = ['M2', 'E'],
): KitDef {
  const slots = {} as Record<Slot, SlotSpec>;
  for (const slot of SLOT_NAMES) {
    const given = overrides[slot];
    const listed = ex.includes(slot);
    if (given === undefined) {
      slots[slot] = quietSlot(listed);
    } else {
      slots[slot] = listed && given.ex === undefined ? { ...given, ex: quietAbility() } : given;
    }
  }
  return { id, maxHealth: 120, moveSpeed: 5.5, support: false, slots, ex };
}

function selfBurst(radius: number, effects: Effect[]): ThenEffect {
  return {
    type: 'area',
    placement: { type: 'self' },
    radius,
    durationTicks: 1,
    intervalTicks: 1,
    targets: 'enemies',
    effects,
  };
}

function slamArea(radius: number, damage: number, slowPercent: number, slowTicks: number): AbilityEffect {
  return {
    type: 'area',
    placement: { type: 'ahead', distance: 2.5 },
    radius,
    durationTicks: 1,
    intervalTicks: 1,
    targets: 'enemies',
    effects: [{ type: 'damage', amount: damage }, SLOW(slowPercent, slowTicks)],
  };
}

/** Hargrim, the melee bruiser: 160 health, EX on M2 and SPACE. Bands in the comments. */
export function hargrimKit(): KitDef {
  return {
    id: 'hargrim',
    maxHealth: 160,
    moveSpeed: 5.5,
    support: false,
    ex: ['M2', 'SPACE'],
    slots: {
      // [0, 3]: a 100 degree arc of 2.5 m.
      M1: {
        cooldownTicks: 36,
        windupTicks: 9,
        movement: 'slowed',
        effects: [
          { type: 'meleeArc', radius: 2.5, cosHalfAngle: 0.643, effects: [{ type: 'damage', amount: 12 }] },
        ],
      },
      // [0, 5], EX [0, 5.75]: a slam 2.5 m ahead.
      M2: {
        cooldownTicks: 360,
        windupTicks: 24,
        movement: 'slowed',
        effects: [slamArea(2, 18, 30, 90)],
        ex: { windupTicks: 24, movement: 'slowed', effects: [slamArea(2.75, 26, 50, 120)] },
      },
      // No band: a dash with haste on the caster. The EX [0, 9] ends in a stunning burst.
      SPACE: {
        cooldownTicks: 420,
        windupTicks: 0,
        movement: 'free',
        effects: [{ type: 'dash', distance: 5, ticks: 15, then: [] }, HASTE_SELF(20, 90)],
        ex: {
          windupTicks: 0,
          movement: 'free',
          effects: [
            {
              type: 'dash',
              distance: 7,
              ticks: 15,
              then: [
                selfBurst(1.5, [
                  { type: 'damage', amount: 12 },
                  { type: 'applyStatus', status: { type: 'stun', ticks: 30 } },
                ]),
              ],
            },
            HASTE_SELF(30, 120),
          ],
        },
      },
      // No band: haste for the allies in the area.
      Q: {
        cooldownTicks: 840,
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
            effects: [{ type: 'applyStatus', status: { type: 'haste', percent: 30, ticks: 120 } }],
          },
        ],
      },
      // No band: a shield on self.
      R: {
        cooldownTicks: 720,
        windupTicks: 0,
        movement: 'free',
        effects: [{ type: 'shield', absorb: 40, ticks: 240 }, HASTE_SELF(20, 90)],
      },
      // [0, 9]: a hook, 20 m/s for 27 ticks.
      E: boltSlot(20, 27, { cooldownTicks: 540, windupTicks: 18, movement: 'locked', radius: 0.4, damage: 14 }),
      // [0, 10]: the ultimate, a dash of 6 m ending in a burst of 3.5 m.
      F: {
        cooldownTicks: 600,
        windupTicks: 30,
        movement: 'locked',
        effects: [
          {
            type: 'dash',
            distance: 6,
            ticks: 18,
            then: [
              selfBurst(3.5, [
                { type: 'damage', amount: 40 },
                { type: 'applyStatus', status: { type: 'stun', ticks: 60 } },
              ]),
            ],
          },
        ],
      },
    },
  };
}

/** Quillon, the ranged skillshot: 120 health, EX on M2 and E. Bands in the comments. */
export function quillonKit(): KitDef {
  return {
    id: 'quillon',
    maxHealth: 120,
    moveSpeed: 5.5,
    support: false,
    ex: ['M2', 'E'],
    slots: {
      // [0, 14]
      M1: boltSlot(21, 40, { cooldownTicks: 30, windupTicks: 6, damage: 11 }),
      // [0, 12], EX [0, 12]
      M2: boltSlot(15, 48, {
        cooldownTicks: 360,
        windupTicks: 18,
        movement: 'slowed',
        radius: 0.4,
        damage: 14,
        ex: boltAbility(15, 48, { windupTicks: 18, movement: 'slowed', radius: 0.6, damage: 20 }),
      }),
      // No band: a teleport of 4 m up to the aim.
      SPACE: {
        cooldownTicks: 540,
        windupTicks: 0,
        movement: 'free',
        effects: [{ type: 'teleport', range: 4, fixed: false }],
      },
      // [0, 10]
      Q: boltSlot(12, 50, { cooldownTicks: 720, windupTicks: 24, movement: 'locked', radius: 0.6, damage: 8 }),
      // [0, 18], EX [0, 18] with half the windup, piercing
      E: boltSlot(24, 45, {
        cooldownTicks: 480,
        windupTicks: 36,
        movement: 'locked',
        radius: 0.2,
        damage: 28,
        ex: boltAbility(24, 45, { windupTicks: 18, movement: 'locked', pierce: true, radius: 0.2, damage: 30 }),
      }),
      // No band: a shield on self.
      R: {
        cooldownTicks: 840,
        windupTicks: 0,
        movement: 'free',
        effects: [{ type: 'shield', absorb: 30, ticks: 180 }, HASTE_SELF(30, 90)],
      },
      // [0, 20]: the ultimate, piercing.
      F: boltSlot(25, 48, {
        cooldownTicks: 600,
        windupTicks: 48,
        movement: 'locked',
        radius: 0.6,
        pierce: true,
        damage: 45,
      }),
    },
  };
}

/**
 * Quillon with an M2 whose EX bolt flies faster than the base bolt: base 15 m/s, EX 18 m/s. The
 * shipped kits give base and EX the same speed on every slot, so only a fixture can tell whether
 * the aim leads with the speed of the variant that is winding up.
 */
export function quillonFastExKit(): KitDef {
  const kit = quillonKit();
  kit.slots.M2 = boltSlot(15, 48, {
    cooldownTicks: 360,
    windupTicks: 18,
    movement: 'slowed',
    radius: 0.4,
    damage: 14,
    ex: boltAbility(18, 40, { windupTicks: 18, movement: 'slowed', radius: 0.6, damage: 20 }),
  });
  return kit;
}
