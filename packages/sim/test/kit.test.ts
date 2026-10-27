import { describe, expect, it } from 'vitest';
import { checksum, createMatch, step } from '../src/index';
import type { AbilityEffect, KitDef, MatchConfig, Slot } from '../src/index';
import { validateKit } from '../src/kit';
import { arena01, champion, input, openArena } from './helpers';
import { MENDER_ID, STRIKER_ID, kitWith, quiet, quietEx, testMender, testStriker } from './kits';

type Mutate = (kit: KitDef) => void;
const first = <T>(items: T[]): T => items[0] as T;

/** Edits a deep copy of the striker; the paths below are into `slots.M1` and friends. */
function broken(mutate: Mutate): unknown {
  const kit = testStriker();
  mutate(kit);
  return kit;
}

type Kind = AbilityEffect['type'];
const effect = <T extends Kind>(kit: KitDef, slot: Slot): Extract<AbilityEffect, { type: T }> =>
  first(kit.slots[slot].effects) as Extract<AbilityEffect, { type: T }>;
/** The striker's M1 arc, M2 slam, SPACE dash, Q bolt and R teleport. */
const arc = (kit: KitDef) => effect<'meleeArc'>(kit, 'M1');
const slam = (kit: KitDef) => effect<'area'>(kit, 'M2');
const dash = (kit: KitDef) => effect<'dash'>(kit, 'SPACE');
const bolt = (kit: KitDef) => effect<'projectile'>(kit, 'Q');
const blink = (kit: KitDef) => effect<'teleport'>(kit, 'R');

describe('validateKit accepts', () => {
  it('both test kits and returns a separate deep copy', () => {
    for (const make of [testStriker, testMender]) {
      const kit = make();
      const copy = validateKit(kit);
      expect(copy).toStrictEqual(kit);
      expect(copy).not.toBe(kit);
      expect(copy.slots.M1).not.toBe(kit.slots.M1);
      expect(copy.slots.M1.effects).not.toBe(kit.slots.M1.effects);
      expect(copy.ex).not.toBe(kit.ex);
      expect(JSON.parse(JSON.stringify(copy))).toStrictEqual(copy);
    }
  });

  it('holds both test kits to the shape the plan lists', () => {
    const striker = testStriker();
    const mender = testMender();
    expect([striker.support, mender.support]).toEqual([false, true]);
    expect([striker.ex, mender.ex]).toEqual([['M2', 'SPACE'], ['M1', 'E']]);
    expect(Object.keys(striker.slots)).toEqual(['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F']);
  });

  it('keeps the spec fields in place and drops nothing it knows', () => {
    const kit = kitWith('plain', { M1: quiet({ cooldownTicks: 7 }) });
    expect(validateKit(kit)).toStrictEqual(kit);
  });

  it('a wound status with and without stacks, copied exactly', () => {
    for (const status of [
      { type: 'wound', ticks: 120 },
      { type: 'wound', ticks: 300, stacks: 3 },
    ] as const) {
      const kit = broken((k) => void (k.slots.M1.effects = [{ type: 'applyStatus', status }]));
      expect(validateKit(kit as KitDef)).toStrictEqual(kit);
    }
  });

  it('takes the numbers exactly at each bound', () => {
    const edges: [string, Mutate][] = [
      ['cooldown 1', (k) => void (k.slots.M1.cooldownTicks = 1)],
      ['cooldown 36000', (k) => void (k.slots.M1.cooldownTicks = 36000)],
      ['windup 0', (k) => void (k.slots.Q.windupTicks = 0)],
      ['windup 36000', (k) => void (k.slots.Q.windupTicks = 36000)],
      ['maxHealth 1e6', (k) => void (k.maxHealth = 1e6)],
      ['moveSpeed 1e6', (k) => void (k.moveSpeed = 1e6)],
      ['maxHealth tiny', (k) => void (k.maxHealth = 5e-324)],
      ['projectile speed 1e6', (k) => void (bolt(k).speed = 1e6)],
      ['projectile radius 1e6', (k) => void (bolt(k).radius = 1e6)],
      ['projectile lifetime 36000', (k) => void (bolt(k).lifetimeTicks = 36000)],
      ['projectile lifetime 1', (k) => void (bolt(k).lifetimeTicks = 1)],
      ['area radius 1e6', (k) => void (slam(k).radius = 1e6)],
      ['area duration 36000', (k) => void (slam(k).durationTicks = 36000)],
      ['area interval 36000', (k) => void (slam(k).intervalTicks = 36000)],
      ['area ahead distance 1e6', (k) => void (slam(k).placement = { type: 'ahead', distance: 1e6 })],
      ['area aim range 1e6', (k) => void (slam(k).placement = { type: 'aim', range: 1e6 })],
      ['arc radius 1e6', (k) => void (arc(k).radius = 1e6)],
      ['arc cosine 1', (k) => void (arc(k).cosHalfAngle = 1)],
      ['arc cosine -1', (k) => void (arc(k).cosHalfAngle = -1)],
      ['dash distance 1e-6', (k) => void (dash(k).distance = 1e-6)],
      ['dash distance 1000', (k) => void (dash(k).distance = 1000)],
      ['dash ticks 1', (k) => void (dash(k).ticks = 1)],
      ['dash ticks 36000', (k) => void (dash(k).ticks = 36000)],
      ['teleport range 1e6', (k) => void (blink(k).range = 1e6)],
      ['energyGain 1', (k) => void (k.slots.E.effects = [{ ...bolt(k), effects: [{ type: 'energyGain', amount: 1 }] }])],
      ['energyGain 100', (k) => void (k.slots.E.effects = [{ ...bolt(k), effects: [{ type: 'energyGain', amount: 100 }] }])],
    ];
    for (const [name, mutate] of edges) {
      expect(() => validateKit(broken(mutate)), name).not.toThrow();
    }
  });
});

describe('validateKit rejects, with the whole message', () => {
  it('a value that is not an object, or has a bad id or flag', () => {
    expect(() => validateKit(null)).toThrow('Invalid kit: (root): expected an object');
    expect(() => validateKit([])).toThrow('Invalid kit: (root): expected an object');
    expect(() => validateKit(broken((k) => void (k.id = '')))).toThrow(
      'Invalid kit: id: expected a non-empty string',
    );
    expect(() => validateKit(broken((k) => void ((k as unknown as { support: unknown }).support = 'yes')))).toThrow(
      'Invalid kit: test-striker.support: expected a boolean',
    );
  });

  it('a missing slot', () => {
    const kit = testStriker() as unknown as { slots: Record<string, unknown> };
    delete kit.slots['F'];
    expect(() => validateKit(kit)).toThrow('Invalid kit: test-striker.slots.F: missing');
  });

  it('a tick count outside its range', () => {
    expect(() => validateKit(broken((k) => void (k.slots.M1.cooldownTicks = 0)))).toThrow(
      'Invalid kit: test-striker.slots.M1.cooldownTicks: 0 is not an integer from 1 to 36000',
    );
    expect(() => validateKit(broken((k) => void (k.slots.M1.windupTicks = -1)))).toThrow(
      'Invalid kit: test-striker.slots.M1.windupTicks: -1 is not an integer from 0 to 36000',
    );
    expect(() => validateKit(broken((k) => void (dash(k).ticks = 36001)))).toThrow(
      'Invalid kit: test-striker.slots.SPACE.effects[0].ticks: 36001 is not an integer from 1 to 36000',
    );
  });

  it('a number outside what its primitive accepts', () => {
    expect(() => validateKit(broken((k) => void (bolt(k).speed = 0)))).toThrow(
      'Invalid kit: test-striker.slots.Q.effects[0].speed: 0 is not a number above 0 and at most 1000000',
    );
    expect(() => validateKit(broken((k) => void (dash(k).distance = 1001)))).toThrow(
      'Invalid kit: test-striker.slots.SPACE.effects[0].distance: 1001 is not a number from 0.000001 to 1000',
    );
    expect(() => validateKit(broken((k) => void (arc(k).cosHalfAngle = 1.5)))).toThrow(
      'Invalid kit: test-striker.slots.M1.effects[0].cosHalfAngle: 1.5 is not a number from -1 to 1',
    );
    expect(() => validateKit(broken((k) => void (k.maxHealth = 0)))).toThrow(
      'Invalid kit: test-striker.maxHealth: 0 is not a number above 0 and at most 1000000',
    );
  });

  it('a teleport range at the primitive limit rather than the kit limit', () => {
    expect(() => validateKit(broken((k) => void (blink(k).range = 1e9)))).toThrow(
      'Invalid kit: test-striker.slots.R.effects[0].range: 1000000000 is not a number above 0 and at most 1000000',
    );
  });

  it('an unknown movement rule, effect type or placement', () => {
    expect(() =>
      validateKit(broken((k) => void ((k.slots.M1 as unknown as { movement: string }).movement = 'fast'))),
    ).toThrow('Invalid kit: test-striker.slots.M1.movement: unknown movement rule fast');
    expect(() =>
      validateKit(broken((k) => void (k.slots.M1.effects = [{ type: 'zap' } as never]))),
    ).toThrow('Invalid kit: test-striker.slots.M1.effects[0]: unknown effect type zap');
    expect(() =>
      validateKit(broken((k) => void (slam(k).placement = { type: 'behind' } as never))),
    ).toThrow('Invalid kit: test-striker.slots.M2.effects[0].placement: unknown placement type behind');
  });

  it('an empty effect list, and a dash inside then', () => {
    expect(() => validateKit(broken((k) => void (k.slots.M1.effects = [])))).toThrow(
      'Invalid kit: test-striker.slots.M1.effects: must not be empty',
    );
    expect(() => validateKit(broken((k) => void (arc(k).effects = [])))).toThrow(
      'Invalid kit: test-striker.slots.M1.effects[0].effects: must not be empty',
    );
    expect(() =>
      validateKit(broken((k) => void (dash(k).then = [{ ...dash(k), then: [] }] as never))),
    ).toThrow('Invalid kit: test-striker.slots.SPACE.effects[0].then[0]: a dash cannot be inside then');
  });

  it('a hit effect or status spec that the primitive would refuse', () => {
    expect(() =>
      validateKit(broken((k) => void (arc(k).effects = [{ type: 'damage', amount: 0 }]))),
    ).toThrow(
      'Invalid kit: test-striker.slots.M1.effects[0].effects: effect amount 0 is not a number above 0',
    );
    expect(() =>
      validateKit(broken((k) => void (arc(k).effects = [{ type: 'energyGain', amount: 0 }]))),
    ).toThrow(
      'Invalid kit: test-striker.slots.M1.effects[0].effects: effect energyGain amount 0 is not an integer from 1 to 100',
    );
    expect(() =>
      validateKit(broken((k) => void (arc(k).effects = [{ type: 'energyGain', amount: 101 }]))),
    ).toThrow(/energyGain amount 101 is not an integer from 1 to 100/);
    expect(() =>
      validateKit(
        broken((k) => void (k.slots.M1.effects = [{ type: 'applyStatus', status: { type: 'stun', ticks: 0 } }])),
      ),
    ).toThrow(
      'Invalid kit: test-striker.slots.M1.effects[0].status: ticks 0 is not an integer from 1 to 36000',
    );
    expect(() =>
      validateKit(broken((k) => void (k.slots.M1.effects = [{ type: 'shield', absorb: 0, ticks: 5 }]))),
    ).toThrow('Invalid kit: test-striker.slots.M1.effects[0].absorb: 0 is not a number above 0 and at most 1000000');
    expect(() =>
      validateKit(broken((k) => void (k.slots.M1.effects = [{ type: 'heal', amount: 1e7 }]))),
    ).toThrow('Invalid kit: test-striker.slots.M1.effects[0].amount: 10000000 is not a number above 0 and at most 1000000');
  });

  it('a wound with stacks outside 1 to 3, naming the path', () => {
    expect(() =>
      validateKit(
        broken(
          (k) =>
            void (k.slots.M1.effects = [
              { type: 'applyStatus', status: { type: 'wound', ticks: 120, stacks: 4 } },
            ]),
        ),
      ),
    ).toThrow('Invalid kit: test-striker.slots.M1.effects[0].status: stacks 4 is not an integer from 1 to 3');
  });

  it('the wrong EX slots', () => {
    expect(() => validateKit(broken((k) => void (k.ex = ['M2', 'M2'])))).toThrow(
      'Invalid kit: test-striker.ex: must hold two different slots',
    );
    expect(() => validateKit(broken((k) => void (k.ex = ['M2', 'F'])))).toThrow(
      'Invalid kit: test-striker.ex: the ultimate F has no EX variant',
    );
    expect(() => validateKit(broken((k) => void (k.ex = ['M2', 'Z' as never])))).toThrow(
      'Invalid kit: test-striker.ex: unknown slot Z',
    );
    expect(() => validateKit(broken((k) => void (k.ex = ['M2'] as never)))).toThrow(
      'Invalid kit: test-striker.ex: must hold two different slots',
    );
  });

  it('EX variants that do not match the ex list', () => {
    expect(() => validateKit(broken((k) => void (k.slots.Q.ex = quietEx())))).toThrow(
      'Invalid kit: test-striker.slots.Q.ex: Q has an EX variant but is not in ex',
    );
    expect(() => validateKit(broken((k) => void delete k.slots.M2.ex))).toThrow(
      'Invalid kit: test-striker.slots.M2.ex: missing, but ex lists M2',
    );
    expect(() =>
      validateKit(broken((k) => void ((k.slots.F as unknown as { ex: unknown }).ex = quietEx()))),
    ).toThrow('Invalid kit: test-striker.slots.F.ex: F has an EX variant but is not in ex');
  });

  it('a bad EX variant the same way as a bad ability', () => {
    expect(() =>
      validateKit(
        broken((k) => {
          const ex = k.slots.M2.ex;
          if (ex) ex.windupTicks = 36001;
        }),
      ),
    ).toThrow(
      'Invalid kit: test-striker.slots.M2.ex.windupTicks: 36001 is not an integer from 0 to 36000',
    );
  });

  it('every number that is not a number', () => {
    const bad = [NaN, Infinity, -Infinity, '5', null, undefined, 1.5];
    for (const value of bad) {
      expect(() => validateKit(broken((k) => void (k.slots.M1.cooldownTicks = value as never))), String(value)).toThrow(/^Invalid kit: /);
      expect(() => validateKit(broken((k) => void (k.slots.M1.windupTicks = value as never))), String(value)).toThrow(/^Invalid kit: /);
    }
    for (const value of [NaN, Infinity, -Infinity, '5', null, undefined, 0, -1, 1e6 + 1]) {
      expect(() => validateKit(broken((k) => void (bolt(k).speed = value as never))), String(value)).toThrow(/^Invalid kit: /);
      expect(() => validateKit(broken((k) => void (k.moveSpeed = value as never))), String(value)).toThrow(/^Invalid kit: /);
    }
    for (const value of [NaN, Infinity, '1', null, 1 + 1e-12, -1 - 1e-12]) {
      expect(() => validateKit(broken((k) => void (arc(k).cosHalfAngle = value as never))), String(value)).toThrow(/^Invalid kit: /);
    }
    for (const value of [0, 1e-7, 1000.5, NaN, '5']) {
      expect(() => validateKit(broken((k) => void (dash(k).distance = value as never))), String(value)).toThrow(/^Invalid kit: /);
    }
  });
});

describe('createMatch with kits', () => {
  const players: MatchConfig['players'] = [
    { championId: STRIKER_ID, team: 'A' },
    { championId: MENDER_ID, team: 'A' },
    { championId: STRIKER_ID, team: 'B' },
    { championId: 'no-kit', team: 'B' },
  ];
  const config: MatchConfig = { teamSize: 2, players };

  it('gives a kit champion its health and starts it with no cooldown, cast or energy', () => {
    const state = createMatch(config, arena01, 1, [testStriker(), testMender()]);
    expect(state.champions.map((c) => [c.health, c.maxHealth])).toEqual([
      [160, 160],
      [120, 120],
      [160, 160],
      [120, 120],
    ]);
    for (const c of state.champions) {
      expect(c.cooldowns).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(c.cast).toBeNull();
      expect(c.energy).toBe(0);
    }
  });

  it('gives a champion without a kit 120 health and speed 5.5', () => {
    const state = createMatch(config, openArena(), 1, [testStriker()]);
    expect(champion(state, 1).maxHealth).toBe(120);
    step(state, [undefined, input(1, 0), undefined, undefined]);
    expect(champion(state, 1).vx).toBe(5.5);
    const bare = createMatch(config, openArena(), 1);
    expect(bare.champions.every((c) => c.maxHealth === 120)).toBe(true);
    expect(bare.kits).toEqual([]);
    expect(bare.casts).toEqual([]);
  });

  it('gives a kit champion the kit move speed', () => {
    const fast = kitWith('fast', {}, { moveSpeed: 6, maxHealth: 130 });
    const state = createMatch(config, openArena(), 1, [fast]);
    expect(state.champions.map((c) => c.maxHealth)).toEqual([120, 120, 120, 120]);
    const withFast = createMatch(
      { teamSize: 2, players: players.map((p, i) => (i === 0 ? { ...p, championId: 'fast' } : p)) },
      openArena(),
      1,
      [fast],
    );
    expect(champion(withFast, 0).maxHealth).toBe(130);
    expect(champion(withFast, 0).health).toBe(130);
    step(withFast, [input(1, 0), input(1, 0)]);
    expect(champion(withFast, 0).vx).toBe(6);
    expect(champion(withFast, 1).vx).toBe(5.5);
  });

  it('stores a deep copy of the used kits only, in the order given', () => {
    const striker = testStriker();
    const mender = testMender();
    const unused = kitWith('unused');
    const state = createMatch(config, arena01, 1, [mender, unused, striker]);
    expect(state.kits).toStrictEqual([testMender(), testStriker()]);
    expect(state.kits[0]).not.toBe(mender);
    mender.slots.M1.cooldownTicks = 99;
    striker.maxHealth = 1;
    expect(state.kits[0]?.slots.M1.cooldownTicks).toBe(24);
    expect(state.kits[1]?.maxHealth).toBe(160);
  });

  it('survives a JSON round trip and changes the checksum with the kits', () => {
    const state = createMatch(config, arena01, 1, [testStriker(), testMender()]);
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
    expect(checksum(state)).not.toBe(checksum(createMatch(config, arena01, 1)));
  });

  it('rejects a duplicate kit id, even an unused one', () => {
    expect(() => createMatch(config, arena01, 1, [testStriker(), testStriker()])).toThrow(
      'Invalid match: duplicate kit id "test-striker"',
    );
    expect(() => createMatch(config, arena01, 1, [kitWith('x'), kitWith('x')])).toThrow(
      'Invalid match: duplicate kit id "x"',
    );
  });

  it('rejects an invalid kit, even an unused one', () => {
    const bad = kitWith('unused');
    bad.slots.M1.cooldownTicks = 0;
    expect(() => createMatch(config, arena01, 1, [bad])).toThrow(
      'Invalid kit: unused.slots.M1.cooldownTicks: 0 is not an integer from 1 to 36000',
    );
  });
});

/** Gives an effect the projectile-only key, which the types leave out. */
function carry(e: object): void {
  (e as { allyEffects?: unknown }).allyEffects = [{ type: 'heal', amount: 1 }];
}

describe('validateKit and a projectile with allyEffects', () => {
  const healBolt: AbilityEffect = {
    type: 'projectile',
    speed: 20,
    radius: 0.5,
    lifetimeTicks: 40,
    pierce: false,
    effects: [{ type: 'damage', amount: 10 }],
    allyEffects: [
      { type: 'heal', amount: 12 },
      { type: 'applyStatus', status: { type: 'haste', percent: 20, ticks: 30 } },
    ],
  };
  const allyOnly: AbilityEffect = { ...healBolt, effects: [] };

  it('accepts a two-list bolt and an ally-only bolt, copies both and omits the key elsewhere (K1)', () => {
    const kit = kitWith('lumeth-ish', { M1: quiet({ effects: [healBolt] }), M2: quiet({ effects: [allyOnly] }) });
    const copy = validateKit(kit);
    expect(copy).toStrictEqual(kit);
    const [shot] = copy.slots.M1.effects;
    const [orig] = kit.slots.M1.effects;
    if (shot?.type !== 'projectile' || orig?.type !== 'projectile') throw new Error('not a projectile');
    expect(shot.allyEffects).not.toBe(orig.allyEffects);
    expect(shot.allyEffects?.[0]).not.toBe(orig.allyEffects?.[0]);
    expect(copy.slots.M2.effects[0]).toMatchObject({ type: 'projectile', effects: [] });

    const plain = validateKit(testStriker());
    expect('allyEffects' in bolt(plain)).toBe(false);
    expect(validateKit(plain)).toStrictEqual(testStriker());
  });

  it.each([
    ['an area', (k: KitDef) => carry(slam(k)), 'slots.M2.effects[0]'],
    ['a meleeArc', (k: KitDef) => carry(arc(k)), 'slots.M1.effects[0]'],
    ['a dash', (k: KitDef) => carry(dash(k)), 'slots.SPACE.effects[0]'],
    ['a teleport', (k: KitDef) => carry(blink(k)), 'slots.R.effects[0]'],
    [
      'a top-level heal',
      (k: KitDef) => void (k.slots.M1.effects = [{ type: 'heal', amount: 1, allyEffects: [{ type: 'heal', amount: 1 }] } as never]),
      'slots.M1.effects[0]',
    ],
    [
      'an effect inside then',
      (k: KitDef) => void (dash(k).then = [{ type: 'heal', amount: 1, allyEffects: [{ type: 'heal', amount: 1 }] } as never]),
      'slots.SPACE.effects[0].then[0]',
    ],
  ])('rejects allyEffects on %s (K2)', (_name, mutate, path) => {
    expect(() => validateKit(broken(mutate as Mutate))).toThrow(
      `Invalid kit: test-striker.${path}.allyEffects: only a projectile carries allyEffects`,
    );
  });

  it('rejects an empty allyEffects, two empty lists and a bad effect, with the path (K3)', () => {
    const at = 'Invalid kit: k.slots.M1.effects[0]';
    expect(() => validateKit(kitWith('k', { M1: quiet({ effects: [{ ...healBolt, allyEffects: [] }] }) }))).toThrow(
      `${at}.allyEffects: must not be empty`,
    );
    expect(() =>
      validateKit(kitWith('k', { M1: quiet({ effects: [{ ...healBolt, effects: [], allyEffects: [] }] }) })),
    ).toThrow(`${at}.allyEffects: must not be empty`);
    expect(() =>
      validateKit(
        kitWith('k', { M1: quiet({ effects: [{ ...healBolt, allyEffects: [{ type: 'heal', amount: 0 }] }] }) }),
      ),
    ).toThrow(`${at}.allyEffects: effect amount 0 is not a number above 0`);
  });

  it('still needs a non-empty effects without allyEffects and an array with it (K3)', () => {
    const bare: AbilityEffect = { type: 'projectile', speed: 20, radius: 0.5, lifetimeTicks: 40, pierce: false, effects: [] };
    expect(() => validateKit(kitWith('k', { M1: quiet({ effects: [bare] }) }))).toThrow(
      'Invalid kit: k.slots.M1.effects[0].effects: must not be empty',
    );
    expect(() =>
      validateKit(kitWith('k', { M1: quiet({ effects: [{ ...healBolt, effects: 'damage' as never }] }) })),
    ).toThrow('Invalid kit: k.slots.M1.effects[0].effects: effects must be an array');
  });
});
