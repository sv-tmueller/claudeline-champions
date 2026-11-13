// The roster kits as data: `data/kits/hargrim.json`, `quillon.json`, `skerrow.json`, `lumeth.json`,
// `ondrel.json`, `brimwick.json`, `durnhal.json` and `wrenna.json`, whose numbers come from docs/design/roster-v1.md,
// docs/design/roster-v2.md and docs/design/roster-v3.md (ticks = seconds x 60, one hit =
// durationTicks 1 / intervalTicks 1, and the lingering areas of Ondrel carry the three rules of
// roster-v2 section 0).
//
// Every number the doc fixes is written out again here as a literal, so a kit file that drifts from
// the doc fails a named test. The catalog ranges that `validateKit` leaves to roster tests (rules.md
// section 4.1, spec section 10) are checked by a walker over every effect. `validateKit` comes from
// `../src/kit` by relative path: it is not exported from the index (batch #47 decision 7).
import { describe, expect, it } from 'vitest';
import hargrimJson from '../../../data/kits/hargrim.json';
import quillonJson from '../../../data/kits/quillon.json';
import skerrowJson from '../../../data/kits/skerrow.json';
import lumethJson from '../../../data/kits/lumeth.json';
import ondrelJson from '../../../data/kits/ondrel.json';
import brimwickJson from '../../../data/kits/brimwick.json';
import durnhalJson from '../../../data/kits/durnhal.json';
import wrennaJson from '../../../data/kits/wrenna.json';
import { Button, SLOTS, createMatch, debug, step } from '../src/index';
import type { AbilityEffect, AbilitySpec, Effect, GameState, KitDef, PlayerInput, SimEvent, Slot } from '../src/index';
import { validateKit } from '../src/kit';
import { applyStatus } from '../src/status';
import { AbilityWatcher } from './ability-watch';
import { champion, findNegativeZero, input, openArena, place } from './helpers';

const KITS = [
  { stem: 'hargrim', json: hargrimJson },
  { stem: 'quillon', json: quillonJson },
  { stem: 'skerrow', json: skerrowJson },
  { stem: 'lumeth', json: lumethJson },
  { stem: 'ondrel', json: ondrelJson },
  { stem: 'brimwick', json: brimwickJson },
  { stem: 'durnhal', json: durnhalJson },
  { stem: 'wrenna', json: wrennaJson },
];

const hargrim = validateKit(hargrimJson);
const quillon = validateKit(quillonJson);
const skerrow = validateKit(skerrowJson);
const lumeth = validateKit(lumethJson);
const ondrel = validateKit(ondrelJson);
const brimwick = validateKit(brimwickJson);
const durnhal = validateKit(durnhalJson);
const wrenna = validateKit(wrennaJson);

function mirror(id: string) {
  return {
    teamSize: 2 as const,
    players: [
      { championId: id, team: 'A' as const },
      { championId: id, team: 'A' as const },
      { championId: id, team: 'B' as const },
      { championId: id, team: 'B' as const },
    ],
  };
}

function copyOf(kit: KitDef): KitDef {
  return JSON.parse(JSON.stringify(kit)) as KitDef;
}

describe.each(KITS)('the $stem kit file', ({ stem, json }) => {
  it('holds exactly the kit contract and passes validateKit', () => {
    // validateKit builds its result field by field, so equality means no key outside the contract.
    expect(validateKit(json)).toStrictEqual(json);
  });

  it('is named after its id', () => {
    expect(json.id).toBe(stem);
  });

  it('holds no -0', () => {
    expect(findNegativeZero(json, stem)).toEqual([]);
  });

  it('loads through createMatch as plain data, which is what bots and the client do', () => {
    const state = createMatch(mirror(stem), openArena(), 1, [json as unknown as KitDef]);
    expect(state.kits).toStrictEqual([json]);
    for (const c of state.champions) {
      expect(c.health).toBe(json.maxHealth);
      expect(c.maxHealth).toBe(json.maxHealth);
    }
    step(state, [input(1, 0)]);
    expect(champion(state, 0).vx).toBe(5.5);
  });
});

describe('the kit stats', () => {
  it('match the doc', () => {
    const stats = (kit: KitDef) => ({
      id: kit.id,
      maxHealth: kit.maxHealth,
      moveSpeed: kit.moveSpeed,
      support: kit.support,
      ex: kit.ex,
    });
    expect(stats(hargrim)).toEqual({ id: 'hargrim', maxHealth: 160, moveSpeed: 5.5, support: false, ex: ['M2', 'SPACE'] });
    expect(stats(quillon)).toEqual({ id: 'quillon', maxHealth: 120, moveSpeed: 5.5, support: false, ex: ['M2', 'E'] });
    expect(stats(skerrow)).toEqual({ id: 'skerrow', maxHealth: 130, moveSpeed: 5.5, support: false, ex: ['SPACE', 'E'] });
    expect(stats(lumeth)).toEqual({ id: 'lumeth', maxHealth: 120, moveSpeed: 5.5, support: true, ex: ['M2', 'R'] });
    expect(stats(ondrel)).toEqual({ id: 'ondrel', maxHealth: 130, moveSpeed: 5.5, support: false, ex: ['M2', 'E'] });
    expect(stats(brimwick)).toEqual({ id: 'brimwick', maxHealth: 120, moveSpeed: 5.5, support: false, ex: ['M2', 'E'] });
    expect(stats(durnhal)).toEqual({ id: 'durnhal', maxHealth: 160, moveSpeed: 5.5, support: false, ex: ['M2', 'E'] });
    expect(stats(wrenna)).toEqual({ id: 'wrenna', maxHealth: 120, moveSpeed: 5.5, support: false, ex: ['M2', 'E'] });
  });

  it('gives a path-precise message for a number outside the contract', () => {
    const copy = copyOf(hargrim);
    const arc = copy.slots.M1.effects[0];
    if (arc?.type !== 'meleeArc') throw new Error('Hargrim M1 is not a meleeArc');
    arc.cosHalfAngle = 1.2;
    expect(() => createMatch(mirror('hargrim'), openArena(), 1, [copy])).toThrow(
      new Error('Invalid kit: hargrim.slots.M1.effects[0].cosHalfAngle: 1.2 is not a number from -1 to 1'),
    );
  });
});

/** Walks every effect of a kit, as (path, slot, effect) of the leaves the catalog has ranges for. */
interface Visit {
  path: string;
  slot: Slot;
  effect: Effect | AbilityEffect;
  /**
   * What the spend verb adds to a damage of this ability at the counter cap: `bonusDamagePerStack`
   * times the cap when the ability carries that verb (rules 2.6), else 0.
   */
  bonus: number;
}

/** The most a damage verb of this ability gains from the spend: the bonus per stack times the cap. */
function spendBonus(kit: KitDef, ability: AbilitySpec): number {
  let bonus = 0;
  for (const effect of ability.effects) {
    if (effect.type === 'consumeCounter' && 'bonusDamagePerStack' in effect) {
      bonus = effect.bonusDamagePerStack * (kit.counter?.cap ?? 0);
    }
  }
  return bonus;
}

function visitAbility(prefix: string, slot: Slot, ability: AbilitySpec, bonus: number, out: Visit[]): void {
  const visit = (effect: AbilityEffect, path: string) => {
    out.push({ path, slot, effect, bonus });
    if (effect.type === 'projectile' || effect.type === 'area' || effect.type === 'meleeArc') {
      effect.effects.forEach((hit, i) => out.push({ path: `${path}.effects[${i}]`, slot, effect: hit, bonus }));
    }
    if (effect.type === 'projectile') {
      effect.allyEffects?.forEach((hit, i) => out.push({ path: `${path}.allyEffects[${i}]`, slot, effect: hit, bonus }));
      // Spec 4.3 and rules 2.8: the endArea obeys every area rule, so its leaves are held to the
      // same catalogue ranges as a plain `area` leaf at the same path (finding 2 of the round-2
      // report: they were never visited).
      effect.endArea?.effects.forEach((hit, i) =>
        out.push({ path: `${path}.endArea.effects[${i}]`, slot, effect: hit, bonus }),
      );
    }
    if (effect.type === 'dash') effect.then.forEach((t, i) => visit(t, `${path}.then[${i}]`));
  };
  ability.effects.forEach((effect, i) => visit(effect, `${prefix}.effects[${i}]`));
}

function visitKit(kit: KitDef): Visit[] {
  const out: Visit[] = [];
  for (const slot of SLOTS) {
    const spec = kit.slots[slot];
    visitAbility(`${kit.id}.slots.${slot}`, slot, spec, spendBonus(kit, spec), out);
    if (spec.ex) visitAbility(`${kit.id}.slots.${slot}.ex`, slot, spec.ex, spendBonus(kit, spec.ex), out);
  }
  return out;
}

/**
 * Every number the kit has outside the ranges of rules.md section 4.1 and spec section 10, and
 * every lingering area that breaks one of the three rules of roster-v2.md section 0 (the damage or
 * heal total over its pulses, no stun, root or silence on a pulse, a duration under the slot cooldown),
 * and every fused area outside the fuse range of 15 to 120 ticks or whose fuse plus duration reaches the cooldown.
 *
 * Spec 4.3: a projectile `endArea` counts as an area of its slot, so the same linger rules apply to
 * it, with the projectile's flight (its lifetime) joining the duration under the slot cooldown: the
 * area spawns where the projectile ends, not on the cast tick, so a static duration-under-cooldown
 * proxy cannot hold the one-live-area rule.
 */
function catalogProblems(kit: KitDef): string[] {
  const problems: string[] = [];
  const within = (value: number, low: number, high: number) => value >= low && value <= high;
  const bad = (path: string, what: string) => problems.push(`${path}: ${what}`);

  /**
   * The three lingering-area rules of roster-v2 section 0, over an `area` payload at `base`.
   * `flight` is the ticks before the area appears: 0 for an `area` (spawned on the cast tick),
   * the projectile's lifetime for an `endArea`. An unfused one-hit area is outside all of them.
   */
  const lingerRules = (
    base: string,
    slot: Slot,
    area: { durationTicks: number; intervalTicks: number; effects: readonly Effect[]; fuseTicks?: number },
    flight: number,
    bonus: number,
  ): void => {
    const { fuseTicks } = area;
    if (fuseTicks === undefined && area.durationTicks <= 1) return;
    if (fuseTicks !== undefined && !within(fuseTicks, 15, 120)) {
      bad(`${base}.fuseTicks`, `fuse of ${fuseTicks} ticks is not 15 to 120`);
    }
    // The first pulse comes `fuseTicks` after the spawn (0 without a fuse), then every intervalTicks:
    // ceil(D / I) pulses (area.ts).
    const pulses = Math.ceil(area.durationTicks / area.intervalTicks);
    const top = slot === 'F' ? 60 : 30;
    for (const type of ['damage', 'heal']) {
      const hits = area.effects.filter((hit): hit is Extract<Effect, { amount: number }> => hit.type === type);
      if (hits.length === 0) continue;
      // The spend bonus rides on every damage effect of every pulse (rules 2.6): it is added per effect.
      const total = hits.reduce((sum, hit) => sum + hit.amount + (type === 'damage' ? bonus : 0), 0) * pulses;
      if (!within(total, 8, top)) bad(base, `${type} total ${total} over ${pulses} pulses is not 8 to ${top}`);
    }
    if (pulses > 1) {
      area.effects.forEach((hit, k) => {
        if (hit.type !== 'applyStatus') return;
        const lock = hit.status.type;
        if (lock === 'stun' || lock === 'root' || lock === 'silence') {
          bad(`${base}.effects[${k}].status`, `a pulsing area carries ${lock}`);
        }
      });
    }
    // The EX variant shares the cooldown of its slot (SlotSpec), so one lookup serves both.
    const cooldown = kit.slots[slot].cooldownTicks;
    if (flight + (fuseTicks ?? 0) + area.durationTicks >= cooldown) {
      const parts: string[] = [];
      if (fuseTicks !== undefined) parts.push(`fuse of ${fuseTicks}`);
      if (flight > 0) parts.push(`flight of ${flight}`);
      parts.push(`${area.durationTicks} ticks`);
      bad(`${base}.durationTicks`, `${parts.join(' + ')} is not under the ${slot} cooldown of ${cooldown}`);
    }
  };

  if (!within(kit.maxHealth, 120, 160) || kit.maxHealth % 10 !== 0) {
    bad(`${kit.id}.maxHealth`, `${kit.maxHealth} is not 120 to 160 in steps of 10`);
  }
  if (kit.moveSpeed !== 5.5) bad(`${kit.id}.moveSpeed`, `${kit.moveSpeed} is not 5.5`);
  if (kit.slots.F.cooldownTicks !== 600) bad(`${kit.id}.slots.F.cooldownTicks`, 'the ultimate cooldown is not 600');

  // The one-live-area rule is per slot, not per effect (finding 1 of the round-2 report). Each
  // area-producing effect of a slot keeps an area of that slot live for its own area-lifetime:
  // `duration + fuse` for an `area`, `lifetime + duration + fuse` for a projectile `endArea`. A slot
  // may carry more than one such effect (a plain `area` beside an `endArea`, or two `endArea`s), and
  // the per-effect bound below only holds each one under the cooldown on its own, so two of them can
  // still hold two live areas of the slot at once.
  //
  // The fix is per slot: at most one area-producing effect of an ability may leave a *lingering*
  // area, and the base and its EX must not overlap either. Two non-lingering (one-hit, unfused)
  // areas are gone by the step's end and never counted twice, which is why the shipped Lumeth F may
  // carry two of them. A lone lingering effect stays under the cooldown (the per-effect bound
  // below), so one lingering effect per ability is the one-live-area rule within that ability
  // (roster-v2 section 0, rules 2.8). A sum of the lifetimes under the cooldown is not enough: two
  // bolts that each fly 100 ticks and leave a 79-tick area sum to 358 against the 360 cooldown yet
  // their areas appear on the same tick and overlap, holding two live areas of the slot.
  //
  // Finding 1 of the round-3 report: the count above is per *ability*, so a slot whose base and EX
  // each carry exactly one lingering area passed the walker while the slot held two live areas of
  // itself. The two abilities share the slot cooldown, so the second is cast `cooldownTicks` after
  // the first, and the windup is the lever: with a later windup on the first ability its area is
  // still live when the recharge fires the second. The shipped Ondrel M2 carries one lingering area
  // on each of its base and EX (both windup 24), so the bound is not a flat count across the slot:
  // it compares the two abilities' live windows, cast `cooldownTicks` apart, and rejects only a real
  // overlap.
  const flightTicks = (effect: AbilityEffect): number => {
    if (effect.type === 'area') return 0;
    // The projectile ends `lifetimeTicks` after it spawns, so the area appears on the last of them.
    if (effect.type === 'projectile' && effect.endArea !== undefined) return effect.lifetimeTicks - 1;
    return 0;
  };
  const areaLifetime = (effect: AbilityEffect): number => {
    if (effect.type === 'area') return (effect.fuseTicks ?? 0) + effect.durationTicks;
    if (effect.type === 'projectile' && effect.endArea !== undefined) {
      // The area spawns where the projectile ends: its flight, then the area's own fuse + duration.
      return effect.lifetimeTicks + (effect.endArea.fuseTicks ?? 0) + effect.endArea.durationTicks;
    }
    return 0;
  };
  /** The ticks from an area's first live step to its last: `expireAreas` takes one off on the spawn step. */
  const liveSpan = (effect: AbilityEffect): number => {
    if (effect.type === 'area') return (effect.fuseTicks ?? 0) + effect.durationTicks - 1;
    if (effect.type === 'projectile' && effect.endArea !== undefined) {
      return (effect.endArea.fuseTicks ?? 0) + effect.endArea.durationTicks - 1;
    }
    return 0;
  };
  const lingers = (effect: AbilityEffect): boolean => {
    if (effect.type === 'area') return effect.fuseTicks !== undefined || effect.durationTicks > 1;
    if (effect.type === 'projectile' && effect.endArea !== undefined) {
      return effect.endArea.fuseTicks !== undefined || effect.endArea.durationTicks > 1;
    }
    return false;
  };
  /**
   * One lingering area of an ability, as the tick of the slot's cooldown clock on which it is first
   * live (`first`, counted from the cast) and the first tick it is gone (`until`, exclusive):
   * `expireAreas` takes one off on the spawn step, so it is present on `[first, until)`.
   */
  interface LiveArea {
    lifetime: number;
    first: number;
    until: number;
  }
  const liveAreas = (ability: AbilitySpec): LiveArea[] => {
    const out: LiveArea[] = [];
    const walk = (effects: readonly AbilityEffect[]): void => {
      for (const effect of effects) {
        if (areaLifetime(effect) > 0 && lingers(effect)) {
          const first = ability.windupTicks + flightTicks(effect);
          out.push({ lifetime: areaLifetime(effect), first, until: first + liveSpan(effect) });
        }
        if (effect.type === 'dash') walk(effect.then);
      }
    };
    walk(ability.effects);
    return out;
  };
  /** The problem when the ability cast first has an area still live as the other ability fires. */
  const overlap = (
    first: LiveArea,
    firstName: string,
    second: LiveArea,
    secondName: string,
    cooldownTicks: number,
  ): string | undefined => {
    // The second area's first live step is `cooldownTicks + second.first` on the first cast's clock;
    // the first area is still present on `first.until - 1`, so they overlap iff `until > cooldown + first`.
    if (first.until <= cooldownTicks + second.first) return undefined;
    return (
      `a slot keeps one live area of its own, but the ${firstName} area is still live ` +
      `${cooldownTicks + second.first} ticks after the ${firstName} cast, when the ${secondName} area appears`
    );
  };
  for (const slot of SLOTS) {
    const spec = kit.slots[slot];
    const abilities: { ability: AbilitySpec; name: string; base: string }[] = [
      { ability: spec, name: 'base', base: `${kit.id}.slots.${slot}` },
    ];
    if (spec.ex) abilities.push({ ability: spec.ex, name: 'EX', base: `${kit.id}.slots.${slot}.ex` });
    const perAbility = abilities.map(({ ability, name, base }) => ({ name, base, areas: liveAreas(ability) }));
    for (const { base, areas } of perAbility) {
      if (areas.length < 2) continue;
      const lifetimes = areas.map((area) => area.lifetime);
      bad(
        `${base}.effects`,
        `a slot keeps one live area of its own, but ${lifetimes.length} of its area-producing effects linger (${lifetimes.join(' + ')} ticks)`,
      );
    }
    // The base and its EX share the slot's cooldown, so the second is cast `cooldownTicks` after the
    // first; either may be cast first. With exactly one lingering area each, the slot holds two live
    // areas exactly when one ability's area is still present on the step the other's appears.
    const [a, b] = perAbility;
    if (perAbility.length === 2 && a?.areas.length === 1 && b?.areas.length === 1) {
      const areaA = a.areas[0];
      const areaB = b.areas[0];
      if (areaA && areaB) {
        const problem =
          overlap(areaA, a.name, areaB, b.name, spec.cooldownTicks) ??
          overlap(areaB, b.name, areaA, a.name, spec.cooldownTicks);
        if (problem !== undefined) bad(`${kit.id}.slots.${slot}`, problem);
      }
    }
  }

  for (const { path, slot, effect, bonus } of visitKit(kit)) {
    switch (effect.type) {
      case 'damage':
      case 'heal': {
        const top = slot === 'F' ? 60 : 30;
        // The damage total after the spend bonus at the counter cap; a heal takes none.
        const total = effect.amount + (effect.type === 'damage' ? bonus : 0);
        if (!within(total, 8, top)) bad(`${path}.amount`, `${effect.type} ${total} is not 8 to ${top}`);
        break;
      }
      case 'applyStatus': {
        const { status } = effect;
        const ticks = (low: number, high: number) => {
          if (!within(status.ticks, low, high)) bad(`${path}.status.ticks`, `${status.type} of ${status.ticks} ticks is outside ${low} to ${high}`);
        };
        const percent = (low: number, high: number) => {
          if (!('percent' in status) || !within(status.percent, low, high)) bad(`${path}.status.percent`, `${status.type} percent is outside ${low} to ${high}`);
        };
        switch (status.type) {
          case 'stun': ticks(30, 120); break;
          case 'root': ticks(60, 150); break;
          case 'silence': ticks(60, 180); break;
          case 'invulnerable': ticks(30, 120); break;
          case 'slow': ticks(60, 180); percent(20, 60); break;
          case 'haste': ticks(60, 240); percent(20, 50); break;
          case 'wound': ticks(120, 300); break;
          case 'dot':
          case 'hot': {
            if (status.type === 'dot') ticks(60, 240);
            else ticks(120, 300);
            // One pulse every 30 ticks: only the whole pulses count (the floor ban is for sim source).
            const total = status.perPulse * Math.floor(status.ticks / 30);
            if (!within(total, 8, 30)) bad(`${path}.status`, `${status.type} total ${total} is not 8 to 30`);
            break;
          }
        }
        break;
      }
      case 'shield':
        if (!within(effect.absorb, 20, 60)) bad(`${path}.absorb`, `shield absorb ${effect.absorb} is not 20 to 60`);
        if (!within(effect.ticks, 180, 360)) bad(`${path}.ticks`, `shield of ${effect.ticks} ticks is outside 180 to 360`);
        break;
      case 'knockback':
        if (!within(effect.distance, 1, 4)) bad(`${path}.distance`, `knockback ${effect.distance} m is not 1 to 4`);
        if (!within(effect.ticks, 6, 15)) bad(`${path}.ticks`, `knockback of ${effect.ticks} ticks is outside 6 to 15`);
        break;
      case 'energyGain':
        bad(path, 'no v1 kit lists energyGain');
        break;
      case 'area':
        // The three lingering-area rules of roster-v2 section 0 and the fuse rules of rules 2.7. An
        // unfused one-hit area is outside all of them; a fused one-hit area is held to the fuse range,
        // the damage total and the cooldown, and keeps the one-hit exception for stun, root and silence.
        lingerRules(path, slot, effect, 0, bonus);
        break;
      case 'projectile':
        if (!within(effect.speed, 12, 25)) bad(`${path}.speed`, `projectile speed ${effect.speed} is not 12 to 25`);
        if (!within(effect.radius, 0.2, 0.6)) bad(`${path}.radius`, `projectile radius ${effect.radius} is not 0.2 to 0.6`);
        // Spec 4.3: an endArea counts as an area of the projectile's slot and obeys the same linger
        // rules, with the projectile's flight added to the duration-under-cooldown bound because the
        // area spawns where the projectile ends (rules 2.7, roster-v2 0, finding 1).
        if (effect.endArea !== undefined) {
          lingerRules(`${path}.endArea`, slot, effect.endArea, effect.lifetimeTicks, bonus);
        }
        break;
      default:
        break;
    }
  }
  return problems;
}

describe('the catalog ranges', () => {
  it('hold for the Hargrim kit', () => {
    expect(catalogProblems(hargrim)).toEqual([]);
  });

  it('hold for the Quillon kit', () => {
    expect(catalogProblems(quillon)).toEqual([]);
  });

  it('hold for the Skerrow kit', () => {
    expect(catalogProblems(skerrow)).toEqual([]);
  });

  it('hold for the Lumeth kit', () => {
    expect(catalogProblems(lumeth)).toEqual([]);
  });

  it('hold for the Ondrel kit', () => {
    expect(catalogProblems(ondrel)).toEqual([]);
  });

  it('hold for the Brimwick kit', () => {
    expect(catalogProblems(brimwick)).toEqual([]);
  });

  it('hold for the Durnhal kit', () => {
    expect(catalogProblems(durnhal)).toEqual([]);
  });

  it('hold for the Wrenna kit', () => {
    expect(catalogProblems(wrenna)).toEqual([]);
  });

  it('name the Heartseeker when a bonus of 5 per stack lifts its 16 to 31 at the cap', () => {
    const copy = copyOf(wrenna);
    const spend = copy.slots.E.effects[1];
    if (spend?.type !== 'consumeCounter' || !('bonusDamagePerStack' in spend)) throw new Error('Wrenna E has no damage spend');
    spend.bonusDamagePerStack = 5;
    expect(catalogProblems(copy)).toEqual(['wrenna.slots.E.effects[0].effects[0].amount: damage 31 is not 8 to 30']);
  });

  it('name Arrow Storm when it carries the spend: 12 + 12 on each of four pulses is 96 over the 60 of an ultimate', () => {
    const copy = copyOf(wrenna);
    copy.slots.F.effects.push({ type: 'consumeCounter', bonusDamagePerStack: 4 });
    expect(catalogProblems(copy)).toEqual(['wrenna.slots.F.effects[0]: damage total 96 over 4 pulses is not 8 to 60']);
  });

  it('name the path of a number outside them', () => {
    const copy = copyOf(hargrim);
    const dash = copy.slots.F.effects[0];
    if (dash?.type !== 'dash') throw new Error('Hargrim F does not start with a dash');
    const area = dash.then[0];
    if (area?.type !== 'area') throw new Error('Hargrim F does not end in an area');
    const stun = area.effects[1];
    if (stun?.type !== 'applyStatus' || stun.status.type !== 'stun') throw new Error('Hargrim F area has no stun');
    stun.status.ticks = 121;
    expect(catalogProblems(copy)).toEqual([
      'hargrim.slots.F.effects[0].then[0].effects[1].status.ticks: stun of 121 ticks is outside 30 to 120',
    ]);
  });

  it('add the spend bonus at the counter cap to every damage of the ability that spends', () => {
    const copy = copyOf(hargrim);
    copy.counter = { from: 'M1', cap: 3, windowTicks: 360 };
    // 12 + 7 x 3 = 33 on the cast that spends; the other slots are not priced with the bonus.
    copy.slots.M1.effects.push({ type: 'consumeCounter', bonusDamagePerStack: 7 });
    expect(catalogProblems(copy)).toEqual(['hargrim.slots.M1.effects[0].effects[0].amount: damage 33 is not 8 to 30']);
    // At 6 per stack the total is 12 + 18 = 30, which is inside the range.
    copy.slots.M1.effects[1] = { type: 'consumeCounter', bonusDamagePerStack: 6 };
    expect(catalogProblems(copy)).toEqual([]);
  });

  it('add the spend bonus to every pulse of a lingering area of the ability that spends', () => {
    const copy = copyOf(ondrel);
    copy.counter = { from: 'M1', cap: 3, windowTicks: 360 };
    // Three pulses of 8 are 24; with 1 x 3 on each they are 33, over the 30 of a skill.
    copy.slots.M2.effects.push({ type: 'consumeCounter', bonusDamagePerStack: 1 });
    expect(catalogProblems(copy)).toEqual([
      'ondrel.slots.M2.effects[0]: damage total 33 over 3 pulses is not 8 to 30',
    ]);
  });

  it('name the path of a wound outside 120 to 300 ticks', () => {
    const copy = copyOf(quillon);
    const bolt = copy.slots.M1.effects[0];
    if (bolt?.type !== 'projectile') throw new Error('Quillon M1 is not a projectile');
    bolt.effects.push({ type: 'applyStatus', status: { type: 'wound', ticks: 119 } });
    bolt.effects.push({ type: 'applyStatus', status: { type: 'wound', ticks: 300, stacks: 2 } });
    bolt.effects.push({ type: 'applyStatus', status: { type: 'wound', ticks: 301 } });
    expect(catalogProblems(copy)).toEqual([
      'quillon.slots.M1.effects[0].effects[1].status.ticks: wound of 119 ticks is outside 120 to 300',
      'quillon.slots.M1.effects[0].effects[3].status.ticks: wound of 301 ticks is outside 120 to 300',
    ]);
  });

  it('visit the allyEffects of a projectile too', () => {
    const copy = copyOf(quillon);
    const bolt = copy.slots.M1.effects[0];
    if (bolt?.type !== 'projectile') throw new Error('Quillon M1 is not a projectile');
    bolt.allyEffects = [{ type: 'heal', amount: 31 }];
    expect(catalogProblems(copy)).toEqual([
      'quillon.slots.M1.effects[0].allyEffects[0].amount: heal 31 is not 8 to 30',
    ]);
  });

  it('count only the whole pulses of a dot that does not end on a pulse', () => {
    // 89 ticks hold two pulses of 30 ticks, so a dot of 3 per pulse does 6, not 8.9.
    const copy = copyOf(quillon);
    const bolt = copy.slots.M1.effects[0];
    if (bolt?.type !== 'projectile') throw new Error('Quillon M1 is not a projectile');
    bolt.effects.push({ type: 'applyStatus', status: { type: 'dot', perPulse: 3, ticks: 89 } });
    expect(catalogProblems(copy)).toEqual([
      'quillon.slots.M1.effects[0].effects[1].status: dot total 6 is not 8 to 30',
    ]);
  });

  it('keep the Skerrow arc cosines the 10-decimal literal of cos 45 degrees, and the Reaper arc a full circle', () => {
    const arc = (effect: AbilityEffect | undefined, where: string) => {
      if (effect?.type !== 'meleeArc') throw new Error(`${where} is not a meleeArc`);
      return effect;
    };
    const lunge = skerrow.slots.SPACE.ex?.effects[0];
    if (lunge?.type !== 'dash') throw new Error('Skerrow SPACE EX does not start with a dash');
    const quarter = [
      arc(skerrow.slots.M1.effects[0], 'Skerrow M1'),
      arc(skerrow.slots.E.effects[0], 'Skerrow E'),
      arc(lunge.then[0], 'Skerrow SPACE EX then'),
    ];
    for (const { cosHalfAngle } of quarter) {
      expect(cosHalfAngle).toBe(0.7071067812);
      expect(String(cosHalfAngle).split('.')[1]).toHaveLength(10);
      // Math.cos is an accuracy reference here only: no kit value is computed with it.
      expect(Math.abs(cosHalfAngle - Math.cos((45 * Math.PI) / 180))).toBeLessThan(1e-10);
    }
    expect(arc(skerrow.slots.F.effects[1], 'Skerrow F').cosHalfAngle).toBe(-1);
  });

  it.each([
    ['Hargrim', hargrim],
    ['Durnhal', durnhal],
  ])('keep the %s M1 cosine the 10-decimal literal of cos 50 degrees', (name, kit) => {
    const arc = kit.slots.M1.effects[0];
    if (arc?.type !== 'meleeArc') throw new Error(`${name} M1 is not a meleeArc`);
    expect(arc.cosHalfAngle).toBe(0.6427876097);
    expect(String(arc.cosHalfAngle).split('.')[1]).toHaveLength(10);
    // Math.cos is an accuracy reference here only: no kit value is computed with it.
    expect(Math.abs(arc.cosHalfAngle - Math.cos((50 * Math.PI) / 180))).toBeLessThan(1e-10);
  });
});

/** The paths at which two values differ; an element only one array has counts as one path. */
function diff(a: unknown, b: unknown, path: string): string[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) out.push(`${path}[${i}]`);
      else out.push(...diff(a[i], b[i], `${path}[${i}]`));
    }
    return out;
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    return keys.flatMap((key) => diff(left[key], right[key], path === '' ? key : `${path}.${key}`));
  }
  return Object.is(a, b) ? [] : [path];
}

function exDiff(kit: KitDef, slot: Slot): string[] {
  const { cooldownTicks, ex, ...base } = kit.slots[slot];
  void cooldownTicks;
  if (!ex) throw new Error(`${slot} has no EX`);
  return diff(base, ex, '').sort();
}

describe('the EX variants', () => {
  it('differ from their slot only in what the doc lists', () => {
    expect(exDiff(hargrim, 'M2')).toEqual(
      ['effects[0].radius', 'effects[0].effects[0].amount', 'effects[0].effects[1].status.percent', 'effects[0].effects[1].status.ticks'].sort(),
    );
    expect(exDiff(hargrim, 'SPACE')).toEqual(
      ['effects[0].distance', 'effects[0].then[0]', 'effects[1].status.percent', 'effects[1].status.ticks'].sort(),
    );
    expect(exDiff(quillon, 'M2')).toEqual(
      ['effects[0].radius', 'effects[0].effects[0].amount', 'effects[0].effects[1].status.percent', 'effects[0].effects[1].status.ticks'].sort(),
    );
    expect(exDiff(quillon, 'E')).toEqual(['windupTicks', 'effects[0].pierce', 'effects[0].effects[0].amount'].sort());
    expect(exDiff(skerrow, 'SPACE')).toEqual(
      ['effects[0].distance', 'effects[0].then[0]', 'effects[1].status.percent', 'effects[1].status.ticks'].sort(),
    );
    expect(exDiff(skerrow, 'E')).toEqual(['effects[0].effects[0].amount', 'effects[0].effects[1].status.perPulse'].sort());
    expect(exDiff(lumeth, 'M2')).toEqual(
      ['effects[0].allyEffects[0].amount', 'effects[0].allyEffects[1].status.perPulse', 'effects[0].allyEffects[1].status.ticks'].sort(),
    );
    expect(exDiff(lumeth, 'R')).toEqual(['effects[0].effects[0].absorb', 'effects[0].effects[0].ticks', 'effects[0].effects[1]'].sort());
    expect(exDiff(ondrel, 'M2')).toEqual(
      ['effects[0].radius', 'effects[0].effects[0].amount', 'effects[0].effects[1].status.percent', 'effects[0].effects[1].status.ticks'].sort(),
    );
    expect(exDiff(ondrel, 'E')).toEqual(
      ['effects[0].pierce', 'effects[0].effects[0].amount', 'effects[0].effects[2].status.percent', 'effects[0].effects[2].status.ticks'].sort(),
    );
    expect(exDiff(brimwick, 'M2')).toEqual(['effects[0].radius', 'effects[0].effects[0].amount', 'effects[0].effects[1]'].sort());
    expect(exDiff(brimwick, 'E')).toEqual(['windupTicks', 'effects[0].effects[0].amount', 'effects[0].effects[1].distance'].sort());
    expect(exDiff(durnhal, 'M2')).toEqual(['effects[0].effects[0].amount', 'effects[0].effects[1].status.stacks'].sort());
    expect(exDiff(durnhal, 'E')).toEqual(['effects[0].effects[0].amount', 'effects[0].effects[1].status.stacks'].sort());
    expect(exDiff(wrenna, 'M2')).toEqual(['effects[0].effects[2]']);
    expect(exDiff(wrenna, 'E')).toEqual(['effects[0].pierce', 'effects[0].effects[0].amount', 'effects[1]'].sort());
  });
});

describe('the on-hit counter of the roster', () => {
  it('is Wrenna Focus on M1, and no other kit declares one', () => {
    expect(wrenna.counter).toEqual({ from: 'M1', cap: 3, windowTicks: 360 });
    for (const { stem, json } of KITS) {
      if (stem !== 'wrenna') expect('counter' in json, stem).toBe(false);
    }
  });

  it('is spent by Heartseeker and Fade Step only, as the marker at these paths', () => {
    const spends = (kit: KitDef) => visitKit(kit).filter(({ effect }) => effect.type === 'consumeCounter').map(({ path }) => path);
    expect(spends(wrenna)).toEqual(['wrenna.slots.E.effects[1]', 'wrenna.slots.R.effects[0]']);
    for (const kit of [hargrim, quillon, skerrow, lumeth, ondrel, brimwick, durnhal]) expect(spends(kit), kit.id).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Scripted sequences. Every step runs under the AbilityWatcher, so each row also keeps the
// collision, status, cast, energy and JSON oracles. Every match is made by `Rig`: a mirror 2v2 on an
// open arena with the caster (champion 0, team A) at (-6, 0) and the others parked away from the
// line of fire unless a row places them.
// ---------------------------------------------------------------------------------------------
type Spot = [number, number];
const PARKED: Spot[] = [[-6, 0], [-14, 8], [14, 8], [14, -8]];
const X0 = -6;
/** An aim point ahead of the caster on its line. */
const AHEAD: Spot = [4, 0];

class Rig {
  readonly state: GameState;
  readonly watcher: AbilityWatcher;
  readonly log: SimEvent[][] = [];

  constructor(
    kit: KitDef,
    spots: Partial<Record<number, Spot>> = {},
    energy = 0,
    private readonly watched = true,
    health: Partial<Record<number, number>> = {},
  ) {
    this.state = createMatch(mirror(kit.id), openArena(), 7, [validateKit(kit)]);
    PARKED.forEach((parked, id) => {
      const [x, y] = spots[id] ?? parked;
      place(this.state, id, x, y);
    });
    champion(this.state, 0).energy = energy;
    for (const [id, value] of Object.entries(health)) {
      if (value !== undefined) champion(this.state, Number(id)).health = value;
    }
    this.watcher = new AbilityWatcher(this.state);
  }

  /** One step: `first` is the caster's input, everyone else has none. */
  step(first?: PlayerInput): void {
    const inputs = first ? [first] : [];
    if (this.watched) this.watcher.beforeStep(this.state);
    step(this.state, inputs);
    this.log.push([...this.state.events]);
    if (this.watched) this.watcher.afterStep(this.state, inputs);
  }

  /** `count` steps, the first with the caster's input. */
  run(count: number, first?: PlayerInput): void {
    for (let i = 0; i < count; i++) this.step(i === 0 ? first : undefined);
  }

  events<T extends SimEvent['type']>(type: T): { step: number; e: Extract<SimEvent, { type: T }> }[] {
    const out: { step: number; e: Extract<SimEvent, { type: T }> }[] = [];
    this.log.forEach((events, at) => {
      for (const e of events) if (e.type === type) out.push({ step: at, e: e as Extract<SimEvent, { type: T }> });
    });
    return out;
  }

  /** The statuses applied as [targetId, status, remainingTicks], in event order. */
  applied(): [number, string, number][] {
    return this.events('statusApplied').map(({ e }) => [e.targetId, e.status, e.remainingTicks]);
  }

  health(id: number): number {
    return champion(this.state, id).health;
  }

  /** What the statuses of a champion hold, without sources and timers. */
  statuses(id: number): Record<string, unknown>[] {
    return champion(this.state, id).statuses.map((s) => {
      switch (s.type) {
        case 'slow':
        case 'haste':
          return { type: s.type, percent: s.percent };
        case 'shield':
          return { type: s.type, absorb: s.absorb };
        case 'wound':
          return { type: s.type, stacks: s.stacks };
        case 'knockback':
          return { type: s.type, distance: s.distance, totalTicks: s.totalTicks, dirX: s.dirX, dirY: s.dirY };
        default:
          return { type: s.type };
      }
    });
  }

  clean(): void {
    expect(this.watcher.problems).toEqual([]);
  }
}

/** A "one hit" area expires in the step it spawns (area.ts), so `durationTicks` 1 shows in the steps. */
function expectOneHit(rig: Rig): void {
  const spawned = rig.events('areaSpawned').map(({ step }) => step);
  expect(spawned).not.toEqual([]);
  expect(rig.events('areaExpired').map(({ step }) => step)).toEqual(spawned);
}

/** A single-target projectile ends on its first hit: every end reason is `hit`, so it does not pierce. */
function expectStopsOnHit(rig: Rig): void {
  expect(rig.events('projectileExpired').map(({ e }) => e.reason)).toEqual(['hit']);
}

function press(slot: Slot, options: { ex?: boolean; aim?: Spot; moveY?: -1 | 0 | 1 } = {}): PlayerInput {
  const [aimX, aimY] = options.aim ?? AHEAD;
  const buttons = Button[slot] | (options.ex ? Button.SHIFT : 0);
  return input(0, options.moveY ?? 0, Math.round(aimX * 100), Math.round(aimY * 100), buttons);
}

/** The paths of the areas of a kit that last more than one step: the ones the three lingering rules bind. */
function lingeringPaths(kit: KitDef): string[] {
  return visitKit(kit)
    .filter(({ effect }) => effect.type === 'area' && effect.durationTicks > 1)
    .map(({ path }) => path);
}

/** The wound applications of a kit: where each is, and the ticks and stacks it writes. */
function woundPaths(kit: KitDef): { path: string; ticks: number; stacks: number | undefined }[] {
  const out: { path: string; ticks: number; stacks: number | undefined }[] = [];
  for (const { path, effect } of visitKit(kit)) {
    if (effect.type === 'applyStatus' && effect.status.type === 'wound') {
      out.push({ path, ticks: effect.status.ticks, stacks: effect.status.stacks });
    }
  }
  return out;
}

/** The area at `effects[index]` of a slot, or of its EX variant; `then` reaches into a leading dash. */
function areaOf(kit: KitDef, slot: Slot, options: { ex?: boolean; index?: number; then?: boolean } = {}) {
  const ability = options.ex ? kit.slots[slot].ex : kit.slots[slot];
  let effect: AbilityEffect | undefined = ability?.effects[options.index ?? 0];
  if (options.then) {
    if (effect?.type !== 'dash') throw new Error(`${kit.id} ${slot} does not start with a dash`);
    effect = effect.then[0];
  }
  if (effect?.type !== 'area') throw new Error(`${kit.id} ${slot} has no area there`);
  return effect;
}

describe('the lingering area rules', () => {
  // The three rules of roster-v2 section 0, folded into catalogProblems. The v1 kits have no
  // lingering area, so each row makes one on a copy of a v1 kit.
  const lingering = (damage: number, durationTicks: number, intervalTicks: number): KitDef => {
    const copy = copyOf(hargrim);
    const area = areaOf(copy, 'M2');
    area.durationTicks = durationTicks;
    area.intervalTicks = intervalTicks;
    const hit = area.effects[0];
    if (hit?.type !== 'damage') throw new Error('Hargrim M2 does not start with a damage');
    hit.amount = damage;
    return copy;
  };
  const M2 = 'hargrim.slots.M2.effects[0]';

  it('T1 sums the damage over every pulse: 18 over 180 ticks every 60 is 54 and out of range', () => {
    expect(catalogProblems(lingering(18, 180, 60))).toEqual([`${M2}: damage total 54 over 3 pulses is not 8 to 30`]);
  });

  it('T2 counts ceil(duration / interval) pulses, as area.ts does: 11 over 121 ticks every 60 is 33', () => {
    const copy = lingering(11, 121, 60);
    expect(catalogProblems(copy)).toEqual([`${M2}: damage total 33 over 3 pulses is not 8 to 30`]);
    // The same copy in the sim: three areaTick events, so the formula is the engine's and not a guess.
    const rig = new Rig(copy, { 2: [X0 + 4.5, 0] });
    rig.run(24 + 130, press('M2'));
    expect(rig.events('areaTick').map(({ step }) => step)).toEqual([24, 84, 144]);
    expect(rig.events('damage').map(({ e }) => e.amount)).toEqual([11, 11, 11]);
    rig.clean();
  });

  it('T3 passes a total of exactly 30, and on F exactly 60 but not 65', () => {
    expect(catalogProblems(lingering(10, 180, 60))).toEqual([]);
    // Hargrim F fires its area in a `then`: no stun here, since a pulsing area carries none.
    const finale = (damage: number): KitDef => {
      const copy = copyOf(hargrim);
      const area = areaOf(copy, 'F', { then: true });
      area.durationTicks = 300;
      area.intervalTicks = 60;
      area.effects.splice(1, 1);
      const hit = area.effects[0];
      if (hit?.type !== 'damage') throw new Error('Hargrim F does not start with a damage');
      hit.amount = damage;
      return copy;
    };
    expect(catalogProblems(finale(12))).toEqual([]);
    expect(catalogProblems(finale(13))).toEqual([
      'hargrim.slots.F.effects[0].then[0]: damage total 65 over 5 pulses is not 8 to 60',
    ]);
  });

  it('T3 sums a heal on its own, apart from the damage', () => {
    const copy = lingering(10, 180, 60);
    areaOf(copy, 'M2').effects.push({ type: 'heal', amount: 11 });
    expect(catalogProblems(copy)).toEqual([`${M2}: heal total 33 over 3 pulses is not 8 to 30`]);
  });

  it.each(['stun', 'root', 'silence'] as const)('T4 refuses %s on a pulsing area, and allows it on a one-hit area', (type) => {
    const copy = lingering(8, 180, 60);
    areaOf(copy, 'M2').effects.push({ type: 'applyStatus', status: { type, ticks: 60 } });
    expect(catalogProblems(copy)).toEqual([`${M2}.effects[2].status: a pulsing area carries ${type}`]);
    const oneHit = copyOf(hargrim);
    areaOf(oneHit, 'M2').effects.push({ type: 'applyStatus', status: { type, ticks: 60 } });
    expect(catalogProblems(oneHit)).toEqual([]);
  });

  it('T4 allows a slow and a knockback on a pulse, and one pulse of an area that lasts as long as it ticks', () => {
    const copy = lingering(8, 180, 60);
    areaOf(copy, 'M2').effects.push({ type: 'knockback', distance: 1, ticks: 6, direction: 'away' });
    expect(catalogProblems(copy)).toEqual([]);
    // One pulse (60 ticks every 60): a stun is a single application, not a chain.
    const single = lingering(8, 60, 60);
    areaOf(single, 'M2').effects.push({ type: 'applyStatus', status: { type: 'stun', ticks: 60 } });
    expect(catalogProblems(single)).toEqual([]);
  });

  it('T5 wants the duration under the cooldown: Rally Cry at 840 ticks against 840 is red and 839 is not', () => {
    const rally = (durationTicks: number): KitDef => {
      const copy = copyOf(hargrim);
      const area = areaOf(copy, 'Q');
      area.durationTicks = durationTicks;
      area.intervalTicks = 60;
      return copy;
    };
    expect(catalogProblems(rally(839))).toEqual([]);
    expect(catalogProblems(rally(840))).toEqual([
      'hargrim.slots.Q.effects[0].durationTicks: 840 ticks is not under the Q cooldown of 840',
    ]);
  });

  it('T5 holds the EX variant to the cooldown it shares: Ground Slam EX at 360 against 360 names M2', () => {
    const copy = copyOf(hargrim);
    const area = areaOf(copy, 'M2', { ex: true });
    area.durationTicks = 360;
    area.intervalTicks = 360;
    expect(catalogProblems(copy)).toEqual([
      'hargrim.slots.M2.ex.effects[0].durationTicks: 360 ticks is not under the M2 cooldown of 360',
    ]);
    area.durationTicks = 359;
    expect(catalogProblems(copy)).toEqual([]);
  });

  it('keeps the four v1 kits free of lingering areas', () => {
    for (const kit of [hargrim, quillon, skerrow, lumeth]) expect(lingeringPaths(kit)).toEqual([]);
  });
});

describe('the fuse rules', () => {
  // Rules 2.7 and roster-v2 section 0: no shipped kit has a fuse, so each row fuses an area of a
  // copy of Hargrim, whose M2 is a one-hit area with a slow and whose cooldown is 360 ticks.
  const M2 = 'hargrim.slots.M2.effects[0]';
  const fused = (fuseTicks: number, durationTicks = 1, intervalTicks = 1): KitDef => {
    const copy = copyOf(hargrim);
    const area = areaOf(copy, 'M2');
    area.fuseTicks = fuseTicks;
    area.durationTicks = durationTicks;
    area.intervalTicks = intervalTicks;
    // One slow and a damage that fits the total of 8 to 30 over three pulses.
    const hit = area.effects[0];
    if (hit?.type !== 'damage') throw new Error('Hargrim M2 does not start with a damage');
    hit.amount = durationTicks > 1 ? 10 : hit.amount;
    return copy;
  };

  it.each([14, 121, 0])('F1 refuses a fuse of %i ticks, a one-hit area included', (fuseTicks) => {
    expect(catalogProblems(fused(fuseTicks))).toEqual([`${M2}.fuseTicks: fuse of ${fuseTicks} ticks is not 15 to 120`]);
  });

  it.each([15, 16, 119, 120])('F1 accepts a fuse of %i ticks', (fuseTicks) => {
    expect(catalogProblems(fused(fuseTicks))).toEqual([]);
  });

  it('F1 holds a fused pulsing area to the range too', () => {
    const copy = fused(121, 90, 30);
    areaOf(copy, 'M2').effects.splice(1);
    expect(catalogProblems(copy)).toEqual([`${M2}.fuseTicks: fuse of 121 ticks is not 15 to 120`]);
  });

  it.each(['stun', 'root', 'silence'] as const)('F2 allows %s on a fused one-hit area and refuses it on a fused pulsing one', (type) => {
    const oneHit = fused(60);
    areaOf(oneHit, 'M2').effects.push({ type: 'applyStatus', status: { type, ticks: 90 } });
    expect(catalogProblems(oneHit)).toEqual([]);

    const pulsing = fused(60, 90, 30);
    areaOf(pulsing, 'M2').effects.splice(1);
    areaOf(pulsing, 'M2').effects.push({ type: 'applyStatus', status: { type, ticks: 90 } });
    expect(catalogProblems(pulsing)).toEqual([`${M2}.effects[1].status: a pulsing area carries ${type}`]);
  });

  it('F3 sums the damage of a fused area over its pulses, and of a fused one-hit area once', () => {
    const copy = fused(60);
    const hit = areaOf(copy, 'M2').effects[0];
    if (hit?.type !== 'damage') throw new Error('Hargrim M2 does not start with a damage');
    hit.amount = 16;
    areaOf(copy, 'M2').effects.push({ type: 'damage', amount: 16 });
    expect(catalogProblems(copy)).toEqual([`${M2}: damage total 32 over 1 pulses is not 8 to 30`]);
    const pulsing = fused(60, 90, 30);
    areaOf(pulsing, 'M2').effects.splice(1);
    const each = areaOf(pulsing, 'M2').effects[0];
    if (each?.type !== 'damage') throw new Error('Hargrim M2 does not start with a damage');
    each.amount = 11;
    expect(catalogProblems(pulsing)).toEqual([`${M2}: damage total 33 over 3 pulses is not 8 to 30`]);
  });

  it('F4 wants the fuse plus the duration under the cooldown, a one-hit area included', () => {
    const copy = fused(120);
    copy.slots.M2.cooldownTicks = 121;
    expect(catalogProblems(copy)).toEqual([
      `${M2}.durationTicks: fuse of 120 + 1 ticks is not under the M2 cooldown of 121`,
    ]);
    copy.slots.M2.cooldownTicks = 122;
    expect(catalogProblems(copy)).toEqual([]);
  });

  it('F4 holds the EX variant of a slot to the cooldown it shares', () => {
    const copy = copyOf(hargrim);
    const ex = areaOf(copy, 'M2', { ex: true });
    ex.fuseTicks = 100;
    ex.durationTicks = 260;
    ex.intervalTicks = 260;
    ex.effects.splice(1);
    const hit = ex.effects[0];
    if (hit?.type !== 'damage') throw new Error('Hargrim M2 EX does not start with a damage');
    hit.amount = 10;
    expect(catalogProblems(copy)).toEqual([
      'hargrim.slots.M2.ex.effects[0].durationTicks: fuse of 100 + 260 ticks is not under the M2 cooldown of 360',
    ]);
  });

  it('F5 fires the first pulse of a cast area `fuseTicks` steps after the cast step, and never has two areas of a slot', () => {
    const copy = fused(40);
    const rig = new Rig(copy, { 2: [X0 + 4, 0] });
    let live = 0;
    // Three cooldowns of M2 (360 ticks) and a fourth cast, the key held down all the time.
    for (let n = 0; n < 1200; n++) {
      rig.step(press('M2'));
      live = Math.max(live, rig.state.areas.filter((a) => a.ownerId === 0).length);
    }
    expect(live).toBe(1);
    const spawned = rig.events('areaSpawned').map(({ step }) => step);
    const ticks = rig.events('areaTick').map(({ step }) => step);
    expect(spawned).toHaveLength(4);
    expect(ticks).toEqual(spawned.map((at) => at + 40));
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual(ticks);
    expect(rig.events('damage').map(({ e }) => e.targetId)).toEqual([2, 2, 2, 2]);
    rig.clean();
  });

  it('F5 keeps a fused pulsing area of the longest legal life to one live area of the slot, over several cooldowns', () => {
    // 60 + 299 = 359 under the cooldown of 360: three pulses of 10, 60, 160 and 260 steps after the spawn step, and the area is gone 358 steps after it.
    const copy = fused(60, 299, 100);
    areaOf(copy, 'M2').effects.splice(1);
    expect(catalogProblems(copy)).toEqual([]);
    const rig = new Rig(copy, { 2: [X0 + 4, 0] });
    let live = 0;
    // The key held down for four casts, until the fourth area has expired.
    for (let n = 0; n < 1464; n++) {
      rig.step(press('M2'));
      live = Math.max(live, rig.state.areas.filter((a) => a.ownerId === 0).length);
    }
    expect(live).toBe(1);
    const spawned = rig.events('areaSpawned').map(({ step }) => step);
    expect(spawned).toHaveLength(4);
    expect(rig.events('areaTick').map(({ step }) => step)).toEqual(spawned.flatMap((at) => [at + 60, at + 160, at + 260]));
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual(spawned.map((at) => at + 358));
    expect(rig.events('damage').map(({ e }) => e.targetId)).toEqual(Array<number>(12).fill(2));
    rig.clean();
  });

  it('F6 places a fused area where the aim is on the fire step, and leaves it there while the aim moves', () => {
    const copy = fused(40);
    areaOf(copy, 'M2').placement = { type: 'aim', range: 8 };
    // Enemy 2 stands at the aim of the fire step (6 m ahead), enemy 3 where the aim goes during the fuse (6 m to the side).
    const there: Spot = [X0 + 6, 0];
    const later: Spot = [X0, 6];
    const rig = new Rig(copy, { 2: there, 3: later });
    // Windup 24: the aim wanders during it, rests on `there` for the fire step, and then moves to `later` for the fuse.
    rig.step(press('M2', { aim: later }));
    rig.run(23, press('M2', { aim: [X0 + 3, 3] }));
    expect(rig.events('areaSpawned')).toEqual([]);
    rig.step(press('M2', { aim: there }));
    const spawned = rig.events('areaSpawned');
    expect(spawned).toHaveLength(1);
    const fireStep = spawned[0]?.step ?? -1;
    expect(spawned[0]?.e).toMatchObject({ x: there[0], y: there[1] });
    const [area] = rig.state.areas;
    for (let n = 0; n < 40; n++) {
      rig.step(press('M2', { aim: later }));
      // The area never moves, and never pulses before the fuse is out.
      expect(rig.state.areas).toHaveLength(n < 39 ? 1 : 0);
      if (n < 39) expect(rig.state.areas[0]).toMatchObject({ x: there[0], y: there[1] });
      expect(rig.events('areaTick')).toHaveLength(n < 39 ? 0 : 1);
    }
    expect(area).toMatchObject({ x: there[0], y: there[1] });
    expect(rig.events('areaTick').map(({ step }) => step)).toEqual([fireStep + 40]);
    // The pulse hit the champion at the fire-step aim, and not the one at the later aim.
    expect(rig.events('damage').map(({ e }) => e.targetId)).toEqual([2]);
    rig.clean();
  });
});

describe('the endArea rules', () => {
  // Spec 4.3: no shipped kit has an endArea yet, so each row puts one on a projectile of a copy of
  // Quillon, whose M2 projectile slot is a 360-tick cooldown. The endArea counts as an area of that
  // slot, so its duration (plus a fuse) stays under the cooldown.
  const M2 = 'quillon.slots.M2.effects[0]';
  const shot = (copy: KitDef): Extract<AbilityEffect, { type: 'projectile' }> => {
    const effect = copy.slots.M2.effects[0];
    if (effect?.type !== 'projectile') throw new Error('Quillon M2 does not start with a projectile');
    return effect;
  };
  const endArea = (durationTicks: number, fuseTicks?: number) => ({
    radius: 2,
    durationTicks,
    intervalTicks: durationTicks,
    targets: 'enemies' as const,
    effects: [{ type: 'damage' as const, amount: 10 }],
    ...(fuseTicks === undefined ? {} : { fuseTicks }),
  });
  const ending = (durationTicks: number, fuseTicks?: number, lifetimeTicks?: number): KitDef => {
    const copy = copyOf(quillon);
    shot(copy).endArea = endArea(durationTicks, fuseTicks);
    if (lifetimeTicks !== undefined) shot(copy).lifetimeTicks = lifetimeTicks;
    return copy;
  };

  it('E1 adds the flight of the projectile to the duration under the slot cooldown', () => {
    // The area spawns where the projectile ends, so the flight time joins the bound: a static
    // `duration < cooldown` proxy holds the one-live rule only for an `area` (which spawns on the
    // cast tick), not for an `endArea` (finding 1 of the round-1 report). The tester's kit (lifetime
    // 24, duration 359) summed to 383 against a 360 cooldown and let two areas of one slot go live.
    expect(catalogProblems(ending(335, undefined, 24))).toEqual([]);
    expect(catalogProblems(ending(336, undefined, 24))).toEqual([
      `${M2}.endArea.durationTicks: flight of 24 + 336 ticks is not under the M2 cooldown of 360`,
    ]);
    expect(catalogProblems(ending(359, undefined, 24))).toEqual([
      `${M2}.endArea.durationTicks: flight of 24 + 359 ticks is not under the M2 cooldown of 360`,
    ]);
  });

  it('E2 counts the fuse of an endArea with its flight and duration, and a one-hit area of any flight is fine', () => {
    // 100 + 24 + 235 = 359 stays under 360; one more tick reaches it.
    expect(catalogProblems(ending(235, 100, 24))).toEqual([]);
    expect(catalogProblems(ending(236, 100, 24))).toEqual([
      `${M2}.endArea.durationTicks: fuse of 100 + flight of 24 + 236 ticks is not under the M2 cooldown of 360`,
    ]);
    expect(catalogProblems(ending(1, 120))).toEqual([]);
  });

  it('E3 applies the linger rules of roster-v2 section 0 to the endArea, as to an area', () => {
    const copy = copyOf(quillon);
    shot(copy).endArea = {
      radius: 2,
      durationTicks: 180,
      intervalTicks: 60,
      targets: 'enemies',
      effects: [
        { type: 'damage', amount: 30 },
        { type: 'applyStatus', status: { type: 'stun', ticks: 60 } },
      ],
    };
    expect(catalogProblems(copy)).toEqual([
      `${M2}.endArea: damage total 90 over 3 pulses is not 8 to 30`,
      `${M2}.endArea.effects[1].status: a pulsing area carries stun`,
    ]);
  });

  it("E4 keeps the tester's scenario to one live area: the second flight ends sooner", () => {
    // The tester's repro, at a duration the walker now admits: both bolts fly for 24 ticks and carry
    // an endArea of 335, so 24 + 335 = 359 stays under the 360 cooldown. The first flies its whole
    // lifetime; the second is fired at the cooldown, a step from the wall, so its area appears at
    // once. The first area has expired by then, so never two are live (with the tester's 359 the
    // walker is now red, pinned by E1, and this same setup peaks at two live areas).
    const durationTicks = 335;
    const kit = validateKit(ending(durationTicks, undefined, 24));
    expect(catalogProblems(kit)).toEqual([]);
    const area = endArea(durationTicks);
    const state = createMatch(mirror('quillon'), openArena(), 7, [kit]);
    const bolt = { ownerId: 0, x: -5, y: 8, dirX: 1, dirY: 0, speed: 25, radius: 0.2, lifetimeTicks: 24, pierce: false, effects: [], endArea: area };
    debug.spawnProjectile(state, bolt);
    let live = 0;
    for (let i = 0; i < 360; i++) {
      step(state, []);
      live = Math.max(live, state.areas.filter((a) => a.ownerId === 0).length);
    }
    // The second stops on the boundary the tick it is fired: the earliest its area can appear.
    debug.spawnProjectile(state, { ...bolt, x: -14.5, dirX: -1 });
    for (let i = 0; i < durationTicks + 5; i++) {
      step(state, []);
      live = Math.max(live, state.areas.filter((a) => a.ownerId === 0).length);
    }
    expect(live).toBe(1);
  });

  it('E5 keeps one live area per slot when a slot carries two area-producing effects', () => {
    // Finding 1 of the round-2 report: the one-live-area rule is per slot, not per effect. A slot
    // that carries an `area` beside a projectile `endArea` (rules 2.8's named case), or two `endArea`
    // projectiles, can hold two live areas of that slot even when each effect's own area-lifetime is
    // under the cooldown. The per-effect bound the walker already had is not enough, and a sum of
    // the lifetimes under the cooldown is not enough either (see the third shape below), so a slot
    // may carry at most one area-producing effect that leaves a *lingering* area.
    const shape = (effects: unknown[]): KitDef => {
      const copy = copyOf(quillon);
      (copy.slots.M2 as unknown as { effects: unknown[] }).effects = effects;
      return copy;
    };
    const plain = { type: 'area', radius: 2, durationTicks: 340, intervalTicks: 340, targets: 'enemies', placement: { type: 'self' }, effects: [{ type: 'damage', amount: 20 }] };
    const shot = (lifetimeTicks: number, area: ReturnType<typeof endArea>) => ({
      type: 'projectile', speed: 25, radius: 0.2, lifetimeTicks, pierce: false, effects: [{ type: 'damage', amount: 10 }], endArea: area,
    });
    const message = (lifetimes: number[]) =>
      `quillon.slots.M2.effects: a slot keeps one live area of its own, but ${lifetimes.length} of its area-producing effects linger (${lifetimes.join(' + ')} ticks)`;

    // An `area` (340) beside a projectile `endArea` (flight 20 + 320): ids 5 and 7 in the tester's
    // repro, two live areas of the slot.
    expect(catalogProblems(shape([plain, shot(20, endArea(320))]))).toEqual([message([340, 340])]);
    // Two `endArea` projectiles (flight 20 + 338, and flight 1 + 358).
    expect(catalogProblems(shape([shot(20, endArea(338)), shot(1, endArea(358))]))).toEqual([message([358, 359])]);
    // The sum-defeating shape the tester's lesson predicts: two bolts that each fly 100 ticks and
    // leave a 79-tick area sum to 358 against the 360 cooldown, yet both areas appear on the same
    // tick and the slot holds two live areas (probed in the sim). A sum-only bound admits it.
    const twoBolts = shape([shot(100, endArea(79)), shot(100, endArea(79))]);
    expect(catalogProblems(twoBolts)).toEqual([message([179, 179])]);

    // A lingering area beside a one-hit area is fine: the one-hit area is gone in the step it
    // spawns (shipped Lumeth F carries two one-hit areas), so only one area of the slot lingers.
    const oneHit = { type: 'area', radius: 2, durationTicks: 1, intervalTicks: 1, targets: 'enemies', placement: { type: 'self' }, effects: [{ type: 'damage', amount: 20 }] };
    expect(catalogProblems(shape([plain, oneHit]))).toEqual([]);
    // Two one-hit areas, the shipped Lumeth F shape, linger neither.
    expect(catalogProblems(shape([oneHit, oneHit]))).toEqual([]);
    // A lingering area beside a bolt whose endArea is a one-hit area: only the plain area lingers.
    expect(catalogProblems(shape([plain, shot(300, endArea(1))]))).toEqual([]);

    // The admitted shape keeps max live = 1 in the sim, over three cooldowns: one lingering area
    // (100 ticks) whose effect is a plain area, and a bolt whose 300-tick flight ends in a one-hit
    // area long after the slot's own area has gone.
    const fits = shape([
      { type: 'area', radius: 2, durationTicks: 100, intervalTicks: 100, targets: 'enemies', placement: { type: 'self' }, effects: [{ type: 'damage', amount: 10 }] },
      shot(300, endArea(1)),
    ]);
    expect(catalogProblems(fits)).toEqual([]);
    const state = createMatch(mirror('quillon'), openArena(), 7, [validateKit(fits)]);
    let live = 0;
    for (let i = 0; i < 1080; i++) {
      step(state, [input(0, 0, 0, 0, Button.M2)]);
      live = Math.max(live, state.areas.filter((a) => a.ownerId === 0).length);
    }
    expect(live).toBe(1);
  });

  it('E6 holds an endArea inner effect leaf to the same catalogue ranges as a plain area leaf', () => {
    // Finding 2 of the round-2 report: the walker never descended into `endArea.effects`, so a leaf
    // escaped the catalogue ranges a plain `area` leaf at the same path is held to. The stun, shield
    // and one-hit damage values are the tester's round-2 repro.
    const stun = copyOf(quillon);
    shot(stun).endArea = { ...endArea(30), effects: [{ type: 'applyStatus', status: { type: 'stun', ticks: 500 } }] };
    expect(catalogProblems(stun)).toEqual([
      `${M2}.endArea.effects[0].status.ticks: stun of 500 ticks is outside 30 to 120`,
    ]);

    const shield = copyOf(quillon);
    shot(shield).endArea = { ...endArea(30), effects: [{ type: 'shield', absorb: 999, ticks: 240 }] };
    expect(catalogProblems(shield)).toEqual([
      `${M2}.endArea.effects[0].absorb: shield absorb 999 is not 20 to 60`,
    ]);

    const oneHit = copyOf(quillon);
    shot(oneHit).endArea = { ...endArea(1), effects: [{ type: 'damage', amount: 999 }] };
    expect(catalogProblems(oneHit)).toEqual([
      `${M2}.endArea.effects[0].amount: damage 999 is not 8 to 30`,
    ]);

    // The same three values on a plain `area` at the same path are flagged the same way: the ranges
    // are the catalogue's, not the endArea's own.
    const plainStun = copyOf(quillon);
    plainStun.slots.M2.effects = [
      { type: 'area', radius: 2, durationTicks: 30, intervalTicks: 30, targets: 'enemies', placement: { type: 'self' }, effects: [{ type: 'applyStatus', status: { type: 'stun', ticks: 500 } }] },
    ];
    expect(catalogProblems(plainStun)).toEqual([
      'quillon.slots.M2.effects[0].effects[0].status.ticks: stun of 500 ticks is outside 30 to 120',
    ]);
  });

  it('E7 keeps one live area across a slot’s base ability and its EX, whatever their windups', () => {
    // Round-3 finding: the per-slot count bound was enforced per *ability*, so a slot whose base
    // and EX each carried exactly one lingering area passed the walker while the slot held two live
    // areas of itself. The windup is the lever: both variants share the slot's cooldown, so casts
    // are `cooldownTicks` apart, and a later windup on one ability keeps its area alive when the
    // recharge fires the other. The area of a cast is live from `windup + flight` after it for
    // `fuse + duration` ticks, so the two overlap when the first's live end passes the second's
    // live start. E5 never sets `spec.ex`, so this is the first pin of the base-versus-EX case.
    const swapped = (
      base: { windupTicks: number; effects: unknown[] },
      ex: { windupTicks: number; effects: unknown[] },
    ): KitDef => {
      const copy = copyOf(quillon);
      (copy.slots as unknown as Record<string, unknown>)['M2'] = {
        cooldownTicks: 360,
        movement: 'free',
        ...base,
        ex: { movement: 'free', ...ex },
      };
      return copy;
    };
    const plain = (windup: number, durationTicks: number) => ({
      windupTicks: windup,
      effects: [
        { type: 'area', radius: 2, durationTicks, intervalTicks: durationTicks, targets: 'enemies', placement: { type: 'self' }, effects: [{ type: 'damage', amount: 10 }] },
      ],
    });
    const shotAbility = (windup: number, area: ReturnType<typeof endArea>) => ({
      windupTicks: windup,
      effects: [
        { type: 'projectile', speed: 25, radius: 0.2, lifetimeTicks: 1, pierce: false, effects: [{ type: 'damage', amount: 10 }], endArea: area },
      ],
    });
    // Both abilities share the slot's cooldown, so the second is cast `cooldownTicks` after the
    // first. An area is present from its first live step up to (not including) `until`, and
    // `expireAreas` takes a tick off on the spawn step, so an area of `windup + flight` and
    // `fuse + duration` is present on `[windup + flight, windup + flight + fuse + duration)`. The
    // pair overlaps when the first area is still present on the step the second appears. The message
    // names the first ability's area and the tick (from the first cast) the second area appears.
    const message = (first: string, second: string) =>
      `quillon.slots.M2: a slot keeps one live area of its own, but the ${first} area is still live 360 ticks after the ${first} cast, when the ${second} area appears`;
    /** The most areas of slot M2 that are ever live at once, over three recharges. */
    const maxLive = (kit: KitDef): number => {
      const state = createMatch(mirror('quillon'), openArena(), 7, [validateKit(kit)]);
      let live = 0;
      for (let i = 0; i < 800; i++) {
        champion(state, 0).energy = 100;
        step(state, [input(0, 0, 0, 0, i < 360 ? Button.M2 : Button.M2 | Button.SHIFT)]);
        live = Math.max(live, state.areas.filter((a) => a.ownerId === 0).length);
      }
      return live;
    };
    /** The same, with the EX cast first and the base at its recharge. */
    const maxLiveExFirst = (kit: KitDef): number => {
      const state = createMatch(mirror('quillon'), openArena(), 7, [validateKit(kit)]);
      let live = 0;
      for (let i = 0; i < 800; i++) {
        champion(state, 0).energy = 100;
        step(state, [input(0, 0, 0, 0, i < 360 ? Button.M2 | Button.SHIFT : Button.M2)]);
        live = Math.max(live, state.areas.filter((a) => a.ownerId === 0).length);
      }
      return live;
    };

    // The tester's canonical repro: the base area (windup 100, duration 359) spawns at t=100 and is
    // still alive when the EX area (windup 0) spawns on the t=360 recharge; the slot holds two.
    const canonical = swapped(plain(100, 359), plain(0, 359));
    expect(catalogProblems(canonical)).toEqual([message('base', 'EX')]);
    expect(maxLive(canonical)).toBe(2);

    // The same shape on the #160 subject: base and EX each one endArea shot (lifetime 1 + duration
    // 358), windups 100 and 0. The flight of the projectile joins the live window.
    const ending = swapped(shotAbility(100, endArea(358)), shotAbility(0, endArea(358)));
    expect(catalogProblems(ending)).toEqual([message('base', 'EX')]);
    expect(maxLive(ending)).toBe(2);

    // The reverse order, the EX cast first with the longer windup: the walker must reject either
    // ordering, so the aggregation is per slot, not per base-then-EX.
    const reversed = swapped(plain(0, 359), plain(100, 359));
    expect(catalogProblems(reversed)).toEqual([`quillon.slots.M2: a slot keeps one live area of its own, but the EX area is still live 360 ticks after the EX cast, when the base area appears`]);
    expect(maxLiveExFirst(reversed)).toBe(2);

    // The equal-windup control, the shipped-shape case: both areas appear on the recharge after the
    // first has expired, so the slot never holds two.
    const control = swapped(plain(0, 359), plain(0, 359));
    expect(catalogProblems(control)).toEqual([]);
    expect(maxLive(control)).toBe(1);

    // The shipped Ondrel M2 shape: two lingering areas, windups equal (24), so the first is gone by
    // the recharge. It stays accepted.
    const ondrelCopy = copyOf(ondrel);
    expect(catalogProblems(ondrelCopy)).toEqual([]);

    // The tie is not an overlap: a base area (windup 10, duration 351) is last present 359 ticks
    // after its cast, one before the t=360 recharge appears the EX area, so the slot holds one. One
    // tick longer and the two overlap. (Both stay under the per-effect cooldown bound.)
    const tie = swapped(plain(10, 351), plain(0, 351));
    expect(catalogProblems(tie)).toEqual([]);
    expect(maxLive(tie)).toBe(1);
    expect(catalogProblems(swapped(plain(10, 352), plain(0, 352)))).toEqual([message('base', 'EX')]);
  });
});

describe('every slot of the shipped kits', () => {
  interface Row {
    kit: KitDef;
    slot: Slot;
    ex: boolean;
    cooldown: number;
    windup: number;
    /** The caster's vy at the start step with moveY 1: 5.5 free, 2.75 slowed, 0 locked. Left out when the windup is 0. */
    walk?: number;
    cost: number;
  }
  const rows: Row[] = [
    { kit: hargrim, slot: 'M1', ex: false, cooldown: 36, windup: 9, walk: 2.75, cost: 0 },
    { kit: hargrim, slot: 'M2', ex: false, cooldown: 360, windup: 24, walk: 2.75, cost: 0 },
    { kit: hargrim, slot: 'M2', ex: true, cooldown: 360, windup: 24, walk: 2.75, cost: 25 },
    { kit: hargrim, slot: 'SPACE', ex: false, cooldown: 420, windup: 0, cost: 0 },
    { kit: hargrim, slot: 'SPACE', ex: true, cooldown: 420, windup: 0, cost: 25 },
    { kit: hargrim, slot: 'Q', ex: false, cooldown: 840, windup: 12, walk: 2.75, cost: 0 },
    { kit: hargrim, slot: 'E', ex: false, cooldown: 540, windup: 18, walk: 0, cost: 0 },
    { kit: hargrim, slot: 'R', ex: false, cooldown: 720, windup: 0, cost: 0 },
    { kit: hargrim, slot: 'F', ex: false, cooldown: 600, windup: 30, walk: 0, cost: 100 },
    { kit: quillon, slot: 'M1', ex: false, cooldown: 30, windup: 6, walk: 5.5, cost: 0 },
    { kit: quillon, slot: 'M2', ex: false, cooldown: 360, windup: 18, walk: 2.75, cost: 0 },
    { kit: quillon, slot: 'M2', ex: true, cooldown: 360, windup: 18, walk: 2.75, cost: 25 },
    { kit: quillon, slot: 'SPACE', ex: false, cooldown: 540, windup: 0, cost: 0 },
    { kit: quillon, slot: 'Q', ex: false, cooldown: 720, windup: 24, walk: 0, cost: 0 },
    { kit: quillon, slot: 'E', ex: false, cooldown: 480, windup: 36, walk: 0, cost: 0 },
    { kit: quillon, slot: 'E', ex: true, cooldown: 480, windup: 18, walk: 0, cost: 25 },
    { kit: quillon, slot: 'R', ex: false, cooldown: 840, windup: 0, cost: 0 },
    { kit: quillon, slot: 'F', ex: false, cooldown: 600, windup: 48, walk: 0, cost: 100 },
    { kit: skerrow, slot: 'M1', ex: false, cooldown: 24, windup: 6, walk: 5.5, cost: 0 },
    { kit: skerrow, slot: 'M2', ex: false, cooldown: 180, windup: 6, walk: 5.5, cost: 0 },
    { kit: skerrow, slot: 'SPACE', ex: false, cooldown: 360, windup: 0, cost: 0 },
    { kit: skerrow, slot: 'SPACE', ex: true, cooldown: 360, windup: 0, cost: 25 },
    { kit: skerrow, slot: 'Q', ex: false, cooldown: 720, windup: 12, walk: 5.5, cost: 0 },
    { kit: skerrow, slot: 'E', ex: false, cooldown: 420, windup: 15, walk: 2.75, cost: 0 },
    { kit: skerrow, slot: 'E', ex: true, cooldown: 420, windup: 15, walk: 2.75, cost: 25 },
    { kit: skerrow, slot: 'R', ex: false, cooldown: 960, windup: 0, cost: 0 },
    { kit: skerrow, slot: 'F', ex: false, cooldown: 600, windup: 18, walk: 0, cost: 100 },
    { kit: lumeth, slot: 'M1', ex: false, cooldown: 36, windup: 6, walk: 5.5, cost: 0 },
    { kit: lumeth, slot: 'M2', ex: false, cooldown: 300, windup: 18, walk: 2.75, cost: 0 },
    { kit: lumeth, slot: 'M2', ex: true, cooldown: 300, windup: 18, walk: 2.75, cost: 25 },
    { kit: lumeth, slot: 'SPACE', ex: false, cooldown: 480, windup: 0, cost: 0 },
    { kit: lumeth, slot: 'Q', ex: false, cooldown: 780, windup: 30, walk: 2.75, cost: 0 },
    { kit: lumeth, slot: 'E', ex: false, cooldown: 540, windup: 12, walk: 2.75, cost: 0 },
    { kit: lumeth, slot: 'R', ex: false, cooldown: 720, windup: 0, cost: 0 },
    { kit: lumeth, slot: 'R', ex: true, cooldown: 720, windup: 0, cost: 25 },
    { kit: lumeth, slot: 'F', ex: false, cooldown: 600, windup: 36, walk: 2.75, cost: 100 },
    { kit: ondrel, slot: 'M1', ex: false, cooldown: 36, windup: 9, walk: 5.5, cost: 0 },
    { kit: ondrel, slot: 'M2', ex: false, cooldown: 360, windup: 24, walk: 2.75, cost: 0 },
    { kit: ondrel, slot: 'M2', ex: true, cooldown: 360, windup: 24, walk: 2.75, cost: 25 },
    { kit: ondrel, slot: 'SPACE', ex: false, cooldown: 480, windup: 0, cost: 0 },
    { kit: ondrel, slot: 'Q', ex: false, cooldown: 720, windup: 18, walk: 2.75, cost: 0 },
    { kit: ondrel, slot: 'E', ex: false, cooldown: 480, windup: 24, walk: 2.75, cost: 0 },
    { kit: ondrel, slot: 'E', ex: true, cooldown: 480, windup: 24, walk: 2.75, cost: 25 },
    { kit: ondrel, slot: 'R', ex: false, cooldown: 840, windup: 0, cost: 0 },
    { kit: ondrel, slot: 'F', ex: false, cooldown: 600, windup: 42, walk: 0, cost: 100 },
    { kit: brimwick, slot: 'M1', ex: false, cooldown: 36, windup: 9, walk: 5.5, cost: 0 },
    { kit: brimwick, slot: 'M2', ex: false, cooldown: 300, windup: 24, walk: 2.75, cost: 0 },
    { kit: brimwick, slot: 'M2', ex: true, cooldown: 300, windup: 24, walk: 2.75, cost: 25 },
    { kit: brimwick, slot: 'SPACE', ex: false, cooldown: 600, windup: 0, cost: 0 },
    { kit: brimwick, slot: 'Q', ex: false, cooldown: 660, windup: 6, walk: 5.5, cost: 0 },
    { kit: brimwick, slot: 'E', ex: false, cooldown: 540, windup: 42, walk: 0, cost: 0 },
    { kit: brimwick, slot: 'E', ex: true, cooldown: 540, windup: 24, walk: 0, cost: 25 },
    { kit: brimwick, slot: 'R', ex: false, cooldown: 780, windup: 0, cost: 0 },
    { kit: brimwick, slot: 'F', ex: false, cooldown: 600, windup: 60, walk: 0, cost: 100 },
    { kit: durnhal, slot: 'M1', ex: false, cooldown: 36, windup: 9, walk: 2.75, cost: 0 },
    { kit: durnhal, slot: 'M2', ex: false, cooldown: 300, windup: 24, walk: 2.75, cost: 0 },
    { kit: durnhal, slot: 'M2', ex: true, cooldown: 300, windup: 24, walk: 2.75, cost: 25 },
    { kit: durnhal, slot: 'SPACE', ex: false, cooldown: 480, windup: 0, cost: 0 },
    { kit: durnhal, slot: 'Q', ex: false, cooldown: 600, windup: 18, walk: 2.75, cost: 0 },
    { kit: durnhal, slot: 'E', ex: false, cooldown: 420, windup: 18, walk: 2.75, cost: 0 },
    { kit: durnhal, slot: 'E', ex: true, cooldown: 420, windup: 18, walk: 2.75, cost: 25 },
    { kit: durnhal, slot: 'R', ex: false, cooldown: 840, windup: 0, cost: 0 },
    { kit: durnhal, slot: 'F', ex: false, cooldown: 600, windup: 30, walk: 0, cost: 100 },
    { kit: wrenna, slot: 'M1', ex: false, cooldown: 42, windup: 6, walk: 5.5, cost: 0 },
    { kit: wrenna, slot: 'M2', ex: false, cooldown: 360, windup: 18, walk: 2.75, cost: 0 },
    { kit: wrenna, slot: 'M2', ex: true, cooldown: 360, windup: 18, walk: 2.75, cost: 25 },
    { kit: wrenna, slot: 'SPACE', ex: false, cooldown: 540, windup: 0, cost: 0 },
    { kit: wrenna, slot: 'Q', ex: false, cooldown: 660, windup: 18, walk: 2.75, cost: 0 },
    { kit: wrenna, slot: 'E', ex: false, cooldown: 480, windup: 30, walk: 2.75, cost: 0 },
    { kit: wrenna, slot: 'E', ex: true, cooldown: 480, windup: 30, walk: 2.75, cost: 25 },
    { kit: wrenna, slot: 'R', ex: false, cooldown: 780, windup: 0, cost: 0 },
    { kit: wrenna, slot: 'F', ex: false, cooldown: 600, windup: 36, walk: 0, cost: 100 },
  ];

  it.each(rows)('$kit.id $slot ex=$ex casts with its cooldown, windup, cost and walk rule', (row) => {
    const rig = new Rig(row.kit, {}, row.cost);
    rig.step(press(row.slot, { ex: row.ex, moveY: 1 }));
    expect(rig.events('castStarted').map(({ step, e }) => ({ step, slot: e.slot, ex: e.ex, windupTicks: e.windupTicks, cost: e.cost }))).toEqual([
      { step: 0, slot: row.slot, ex: row.ex, windupTicks: row.windup, cost: row.cost },
    ]);
    expect(champion(rig.state, 0).cooldowns[SLOTS.indexOf(row.slot)]).toBe(row.cooldown);
    expect(champion(rig.state, 0).energy).toBe(0);
    expect(row.walk === undefined).toBe(row.windup === 0);
    if (row.walk !== undefined) expect(champion(rig.state, 0).vy).toBe(row.walk);
    rig.run(row.windup);
    expect(rig.events('castFired').map(({ step, e }) => ({ step, slot: e.slot, ex: e.ex }))).toEqual([
      { step: row.windup, slot: row.slot, ex: row.ex },
    ]);
    rig.clean();
  });
});

describe('Hargrim', () => {
  it('M1 Maul Swing hits the enemy inside the 100 degree arc and not the one outside it', () => {
    const rig = new Rig(hargrim, { 2: [X0 + 1.5, 1.7], 3: [X0 + 1.5, -1.9] });
    rig.run(10, press('M1'));
    expect(rig.events('meleeArc').map(({ step, e }) => ({ step, radius: e.radius, cos: e.cosHalfAngle, targets: e.targetIds }))).toEqual([
      { step: 9, radius: 2.5, cos: 0.6427876097, targets: [2] },
    ]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 12, 148]]);
    expect(rig.health(3)).toBe(160);
    rig.clean();
  });

  it('M2 Ground Slam lands 2.5 m ahead in a circle of radius 2 and slows', () => {
    const rig = new Rig(hargrim, { 2: [X0 + 4.5, 0], 3: [X0 + 2.5, 2.9] });
    rig.run(25, press('M2'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(24);
    expect(spawned?.e.x).toBeCloseTo(X0 + 2.5, 9);
    expect(spawned?.e.radius).toBe(2);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 18, 142]]);
    expect(rig.applied()).toEqual([[2, 'slow', 90]]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 30 }]);
    expect(rig.health(3)).toBe(160);
    expectOneHit(rig);
    rig.clean();
  });

  it('M2 EX Ground Slam reaches 0.75 m further, hits harder and slows more', () => {
    const rig = new Rig(hargrim, { 2: [X0 + 4.5, 0], 3: [X0 + 2.5, 2.9] }, 25);
    rig.run(25, press('M2', { ex: true }));
    expect(rig.events('areaSpawned')[0]?.e.radius).toBe(2.75);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2, 3]]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 26, 134], [3, 26, 134]]);
    expect(rig.applied()).toEqual([[2, 'slow', 120], [3, 'slow', 120]]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 50 }]);
    expectOneHit(rig);
    rig.clean();
  });

  it('SPACE Rush dashes 5 m in 15 ticks with haste on self and fires nothing at the end', () => {
    const rig = new Rig(hargrim);
    rig.step(press('SPACE'));
    expect(rig.applied()).toEqual([[0, 'haste', 90]]);
    expect(rig.statuses(0)).toEqual([{ type: 'haste', percent: 20 }]);
    rig.run(14);
    expect(rig.events('dashStarted').map(({ step, e }) => [step, e.distance, e.ticks])).toEqual([[0, 5, 15]]);
    const ended = rig.events('dashEnded');
    expect(ended.map(({ step, e }) => [step, e.reason])).toEqual([[14, 'complete']]);
    expect(ended[0]?.e.x).toBeCloseTo(X0 + 5, 9);
    expect(rig.events('areaSpawned')).toEqual([]);
    rig.clean();
  });

  it('SPACE EX Rush dashes 7 m and stuns what stands at the end', () => {
    const rig = new Rig(hargrim, { 2: [X0 + 7, 1.5] }, 25);
    rig.step(press('SPACE', { ex: true }));
    expect(rig.applied()).toEqual([[0, 'haste', 120]]);
    expect(rig.statuses(0)).toEqual([{ type: 'haste', percent: 30 }]);
    rig.run(14);
    expect(rig.events('dashStarted').map(({ e }) => [e.distance, e.ticks])).toEqual([[7, 15]]);
    expect(rig.events('dashEnded').map(({ step, e }) => [step, e.reason])).toEqual([[14, 'complete']]);
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(14);
    expect(spawned?.e.x).toBeCloseTo(X0 + 7, 9);
    expect(spawned?.e.radius).toBe(1.5);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 12, 148]]);
    expect(rig.applied()).toEqual([[0, 'haste', 120], [2, 'stun', 30]]);
    expectOneHit(rig);
    rig.clean();
  });

  it('Q Rally Cry hastes the caster and the ally within 4 m and nobody else', () => {
    const rig = new Rig(hargrim, { 1: [X0 + 4.4, 0], 2: [X0, 3] });
    rig.run(13, press('Q'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(12);
    expect(spawned?.e.radius).toBe(4);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[0, 1]]);
    expect(rig.applied()).toEqual([[0, 'haste', 120], [1, 'haste', 120]]);
    expect(rig.statuses(1)).toEqual([{ type: 'haste', percent: 30 }]);
    expect(rig.statuses(2)).toEqual([]);
    expect(rig.events('damage')).toEqual([]);
    expectOneHit(rig);
    rig.clean();
  });

  it('E Chain Hook flies 9 m in 27 sweeps', () => {
    const rig = new Rig(hargrim);
    rig.run(18 + 27, press('E'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(18);
    expect(spawned?.e.radius).toBe(0.4);
    expect(spawned?.e.vx).toBe(20);
    expect(spawned?.e.vy).toBe(0);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 18 + 1).toBe(27);
    expect(expired?.e.x).toBeCloseTo(X0 + 9, 9);
    rig.clean();
  });

  it('E Chain Hook hurts, slows and pulls an enemy 4 m toward the caster in 12 ticks', () => {
    const rig = new Rig(hargrim, { 2: [X0 + 6, 0] });
    rig.run(18 + 16, press('E'));
    const [hit] = rig.events('projectileHit');
    expect(hit?.step).toBe(33);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 14, 146]]);
    expect(rig.applied()).toEqual([[2, 'knockback', 12], [2, 'slow', 60]]);
    expect(rig.statuses(2)).toEqual([
      { type: 'knockback', distance: 4, totalTicks: 12, dirX: -1, dirY: 0 },
      { type: 'slow', percent: 30 },
    ]);
    rig.run(12);
    expect(champion(rig.state, 2).x).toBeCloseTo(X0 + 2, 9);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('R Iron Hide shields and hastes the caster', () => {
    const rig = new Rig(hargrim);
    rig.step(press('R'));
    expect(rig.applied()).toEqual([[0, 'shield', 240], [0, 'haste', 90]]);
    expect(rig.statuses(0)).toEqual([{ type: 'shield', absorb: 40 }, { type: 'haste', percent: 20 }]);
    rig.clean();
  });

  it('F Quarry Break dashes 6 m, then stuns and throws what stands within 3.5 m of the end', () => {
    const rig = new Rig(hargrim, { 2: [X0 + 9, 0] }, 100);
    rig.run(30 + 18, press('F'));
    expect(rig.events('dashStarted').map(({ step, e }) => [step, e.distance, e.ticks])).toEqual([[30, 6, 18]]);
    expect(rig.events('dashEnded').map(({ step, e }) => [step, e.reason])).toEqual([[47, 'complete']]);
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(47);
    expect(spawned?.e.x).toBeCloseTo(X0 + 6, 9);
    expect(spawned?.e.radius).toBe(3.5);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 40, 120]]);
    expect(rig.applied()).toEqual([[2, 'stun', 60], [2, 'knockback', 10]]);
    expect(rig.statuses(2)).toEqual([
      { type: 'stun' },
      { type: 'knockback', distance: 3, totalTicks: 10, dirX: 1, dirY: 0 },
    ]);
    expectOneHit(rig);
    rig.clean();
  });

  it('F Quarry Break fires its area at the caster when a root takes the dash away', () => {
    // A root is applied between steps, which the watcher cannot see, so this row runs unwatched.
    const rig = new Rig(hargrim, {}, 100, false);
    rig.run(10, press('F'));
    expect(rig.events('dashStarted')).toEqual([]);
    expect(applyRoot(rig.state)).toBe(true);
    rig.run(21);
    expect(rig.events('castFired').map(({ step }) => step)).toEqual([30]);
    expect(rig.events('dashStarted')).toEqual([]);
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(30);
    expect(spawned?.e.x).toBe(X0);
    expect(spawned?.e.radius).toBe(3.5);
  });
});

function applyRoot(state: GameState): boolean {
  return applyStatus(state, 0, { type: 'root', ticks: 60 }, { sourceId: 2, slot: null });
}

describe('Quillon', () => {
  it('M1 Rod Bolt flies 13.93 m in 38 sweeps', () => {
    const rig = new Rig(quillon);
    rig.run(6 + 38, press('M1'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(6);
    expect(spawned?.e.radius).toBe(0.25);
    expect(spawned?.e.vx).toBe(22);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 6 + 1).toBe(38);
    expect(expired?.e.x).toBeCloseTo(X0 + 836 / 60, 9);
    rig.clean();
  });

  it('M1 Rod Bolt does 11 damage at 8 m', () => {
    const rig = new Rig(quillon, { 2: [X0 + 8, 0] });
    rig.run(6 + 20, press('M1'));
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 11, 109]]);
    expect(rig.applied()).toEqual([]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('M2 Bind Shot flies 11.9 m in 51 sweeps', () => {
    const rig = new Rig(quillon);
    rig.run(18 + 51, press('M2'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(18);
    expect(spawned?.e.radius).toBe(0.4);
    expect(spawned?.e.vx).toBe(14);
    const [expired] = rig.events('projectileExpired');
    expect((expired?.step ?? 0) - 18 + 1).toBe(51);
    expect(expired?.e.x).toBeCloseTo(X0 + 714 / 60, 9);
    rig.clean();
  });

  it('M2 Bind Shot does 14 damage and slows 40 percent', () => {
    const rig = new Rig(quillon, { 2: [X0 + 8, 0] });
    rig.run(18 + 40, press('M2'));
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 14, 106]]);
    expect(rig.applied()).toEqual([[2, 'slow', 90]]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 40 }]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('M2 EX Bind Shot is wider, does 20 damage and slows 60 percent', () => {
    const rig = new Rig(quillon, { 2: [X0 + 8, 0] }, 25);
    rig.run(18 + 40, press('M2', { ex: true }));
    expect(rig.events('projectileSpawned')[0]?.e.radius).toBe(0.6);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 20, 100]]);
    expect(rig.applied()).toEqual([[2, 'slow', 120]]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 60 }]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('SPACE Skip goes exactly 4 m toward the aim, whether the aim is 10 m or 2 m away', () => {
    for (const aim of [AHEAD, [X0 + 2, 0] as Spot]) {
      const rig = new Rig(quillon);
      rig.step(press('SPACE', { aim }));
      const [teleport] = rig.events('teleport');
      expect(teleport?.e.blocked).toBe(false);
      expect(teleport?.e.fromX).toBe(X0);
      expect(teleport?.e.toX).toBeCloseTo(X0 + 4, 9);
      expect(champion(rig.state, 0).x).toBeCloseTo(X0 + 4, 9);
      rig.clean();
    }
  });

  it('Q Snare Orb flies 10 m in 50 sweeps', () => {
    const rig = new Rig(quillon);
    rig.run(24 + 50, press('Q'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(24);
    expect(spawned?.e.radius).toBe(0.6);
    expect(spawned?.e.vx).toBe(12);
    const [expired] = rig.events('projectileExpired');
    expect((expired?.step ?? 0) - 24 + 1).toBe(50);
    expect(expired?.e.x).toBeCloseTo(X0 + 10, 9);
    rig.clean();
  });

  it('Q Snare Orb does 8 damage and roots for 60 ticks', () => {
    const rig = new Rig(quillon, { 2: [X0 + 8, 0] });
    rig.run(24 + 50, press('Q'));
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 8, 112]]);
    expect(rig.applied()).toEqual([[2, 'root', 60]]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('E Lance flies 17.92 m in 43 sweeps', () => {
    const rig = new Rig(quillon);
    rig.run(36 + 43, press('E'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(36);
    expect(spawned?.e.radius).toBe(0.2);
    expect(spawned?.e.vx).toBe(25);
    const [expired] = rig.events('projectileExpired');
    expect((expired?.step ?? 0) - 36 + 1).toBe(43);
    expect(expired?.e.x).toBeCloseTo(X0 + 1075 / 60, 9);
    rig.clean();
  });

  it('E Lance stops at the first of two enemies in line and does 28 damage', () => {
    const rig = new Rig(quillon, { 2: [X0 + 5, 0], 3: [X0 + 8, 0] });
    rig.run(36 + 20, press('E'));
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 28, 92]]);
    expect(rig.events('projectileExpired').map(({ e }) => e.reason)).toEqual(['hit']);
    expect(rig.health(3)).toBe(120);
    rig.clean();
  });

  it('E EX Lance winds up in 18 ticks and pierces both enemies in line for 30 each', () => {
    const rig = new Rig(quillon, { 2: [X0 + 5, 0], 3: [X0 + 8, 0] }, 25);
    rig.run(18 + 43, press('E', { ex: true }));
    expect(rig.events('projectileSpawned')[0]?.step).toBe(18);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 30, 90], [3, 30, 90]]);
    expect(rig.events('projectileExpired').map(({ e }) => e.reason)).toEqual(['lifetime']);
    rig.clean();
  });

  it('R Hush Ward shields and hastes the caster', () => {
    const rig = new Rig(quillon);
    rig.step(press('R'));
    expect(rig.applied()).toEqual([[0, 'shield', 180], [0, 'haste', 90]]);
    expect(rig.statuses(0)).toEqual([{ type: 'shield', absorb: 30 }, { type: 'haste', percent: 30 }]);
    rig.clean();
  });

  it('F Sunspear pierces both enemies in line for 45 damage and a 40 percent slow, over 20 m', () => {
    const rig = new Rig(quillon, { 2: [X0 + 5, 0], 3: [X0 + 8, 0] }, 100);
    rig.run(48 + 48, press('F'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(48);
    expect(spawned?.e.radius).toBe(0.6);
    expect(spawned?.e.vx).toBe(25);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 45, 75], [3, 45, 75]]);
    expect(rig.applied()).toEqual([[2, 'slow', 120], [3, 'slow', 120]]);
    expect(rig.statuses(3)).toEqual([{ type: 'slow', percent: 40 }]);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 48 + 1).toBe(48);
    expect(expired?.e.x).toBeCloseTo(X0 + 20, 9);
    rig.clean();
  });
});

describe('Skerrow', () => {
  it('M1 Twin Cut hits the enemy 40 degrees off the line at 1.8 m and not the one 50 degrees off', () => {
    const rig = new Rig(skerrow, { 2: [X0 + 1.38, 1.16], 3: [X0 + 1.16, 1.38] });
    rig.run(7, press('M1'));
    expect(rig.events('meleeArc').map(({ step, e }) => ({ step, radius: e.radius, cos: e.cosHalfAngle, targets: e.targetIds }))).toEqual([
      { step: 6, radius: 2, cos: 0.7071067812, targets: [2] },
    ]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 9, 121]]);
    expect(rig.health(3)).toBe(130);
    expect(rig.applied()).toEqual([]);
    rig.clean();
  });

  it('M2 Throwing Knife flies 10 m in 25 sweeps', () => {
    const rig = new Rig(skerrow);
    rig.run(6 + 25, press('M2'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(6);
    expect(spawned?.e.radius).toBe(0.2);
    expect(spawned?.e.vx).toBe(24);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 6 + 1).toBe(25);
    expect(expired?.e.x).toBeCloseTo(X0 + 10, 9);
    rig.clean();
  });

  it('M2 Throwing Knife does 12 damage and slows 20 percent for 60 ticks', () => {
    const rig = new Rig(skerrow, { 2: [X0 + 8, 0] });
    rig.run(6 + 25, press('M2'));
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 12, 118]]);
    expect(rig.applied()).toEqual([[2, 'slow', 60]]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 20 }]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('SPACE Lunge dashes 6 m in 12 ticks with haste on self and fires nothing at the end', () => {
    const rig = new Rig(skerrow);
    rig.step(press('SPACE'));
    expect(rig.applied()).toEqual([[0, 'haste', 90]]);
    expect(rig.statuses(0)).toEqual([{ type: 'haste', percent: 20 }]);
    rig.run(11);
    expect(rig.events('dashStarted').map(({ step, e }) => [step, e.distance, e.ticks])).toEqual([[0, 6, 12]]);
    const ended = rig.events('dashEnded');
    expect(ended.map(({ step, e }) => [step, e.reason])).toEqual([[11, 'complete']]);
    expect(ended[0]?.e.x).toBeCloseTo(X0 + 6, 9);
    expect(rig.events('meleeArc')).toEqual([]);
    expect(rig.events('areaSpawned')).toEqual([]);
    rig.clean();
  });

  it('SPACE EX Lunge dashes 8 m, then cuts the enemy inside the arc at the end for 14', () => {
    const rig = new Rig(skerrow, { 2: [X0 + 9.5, 0.6], 3: [X0 + 8, 1.8] }, 25);
    rig.step(press('SPACE', { ex: true }));
    expect(rig.applied()).toEqual([[0, 'haste', 120]]);
    expect(rig.statuses(0)).toEqual([{ type: 'haste', percent: 30 }]);
    rig.run(11);
    expect(rig.events('dashStarted').map(({ e }) => [e.distance, e.ticks])).toEqual([[8, 12]]);
    expect(rig.events('dashEnded').map(({ step, e }) => [step, e.reason])).toEqual([[11, 'complete']]);
    const [arc] = rig.events('meleeArc');
    expect(arc?.step).toBe(11);
    expect(arc?.e.x).toBeCloseTo(X0 + 8, 9);
    expect(arc?.e.radius).toBe(2);
    expect(arc?.e.cosHalfAngle).toBe(0.7071067812);
    expect(arc?.e.targetIds).toEqual([2]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 14, 116]]);
    expect(rig.health(3)).toBe(130);
    rig.clean();
  });

  it('Q Quiet Dart flies 11 m in 33 sweeps', () => {
    const rig = new Rig(skerrow);
    rig.run(12 + 33, press('Q'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(12);
    expect(spawned?.e.radius).toBe(0.3);
    expect(spawned?.e.vx).toBe(20);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 12 + 1).toBe(33);
    expect(expired?.e.x).toBeCloseTo(X0 + 11, 9);
    rig.clean();
  });

  it('Q Quiet Dart does 8 damage and silences for 90 ticks', () => {
    const rig = new Rig(skerrow, { 2: [X0 + 8, 0] });
    rig.run(12 + 33, press('Q'));
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 8, 122]]);
    expect(rig.applied()).toEqual([[2, 'silence', 90]]);
    expect(rig.statuses(2)).toEqual([{ type: 'silence' }]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('E Rend does 14 damage, then four pulses of 4 over 120 ticks', () => {
    const rig = new Rig(skerrow, { 2: [X0 + 2, 0] });
    rig.run(15 + 125, press('E'));
    expect(rig.events('meleeArc').map(({ step, e }) => [step, e.radius, e.cosHalfAngle, e.targetIds])).toEqual([[15, 2.5, 0.7071067812, [2]]]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([
      [2, 14, 116],
      [2, 4, 112],
      [2, 4, 108],
      [2, 4, 104],
      [2, 4, 100],
    ]);
    expect(rig.applied()).toEqual([[2, 'dot', 120]]);
    expect(rig.statuses(2)).toEqual([]);
    rig.clean();
  });

  it('E EX Rend does 28 damage, then four pulses of 6', () => {
    const rig = new Rig(skerrow, { 2: [X0 + 2, 0] }, 25);
    rig.run(15 + 125, press('E', { ex: true }));
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([
      [2, 28, 102],
      [2, 6, 96],
      [2, 6, 90],
      [2, 6, 84],
      [2, 6, 78],
    ]);
    expect(rig.applied()).toEqual([[2, 'dot', 120]]);
    rig.clean();
  });

  it('R Vanish Step goes as far as the aim up to 5 m and makes the caster invulnerable for 30 ticks', () => {
    for (const [aim, to] of [[[X0 + 3, 0], X0 + 3], [AHEAD, X0 + 5]] as [Spot, number][]) {
      const rig = new Rig(skerrow);
      rig.step(press('R', { aim }));
      const [teleport] = rig.events('teleport');
      expect(teleport?.e.blocked).toBe(false);
      expect(teleport?.e.fromX).toBe(X0);
      expect(teleport?.e.toX).toBeCloseTo(to, 9);
      expect(champion(rig.state, 0).x).toBeCloseTo(to, 9);
      expect(rig.applied()).toEqual([[0, 'invulnerable', 30]]);
      rig.clean();
    }
  });

  it("F Reaper's Dance swings where the teleport lands: 40 damage, stun 30, then silence 120, at 2 m ahead and 1.5 m behind", () => {
    const rig = new Rig(skerrow, { 2: [X0 + 9, 0], 3: [X0 + 5.5, 0] }, 100);
    rig.run(18 + 1, press('F', { aim: [X0 + 7, 0] }));
    const [teleport] = rig.events('teleport');
    expect(teleport?.step).toBe(18);
    expect(teleport?.e.toX).toBeCloseTo(X0 + 7, 9);
    const [arc] = rig.events('meleeArc');
    expect(arc?.step).toBe(18);
    expect(arc?.e.x).toBeCloseTo(X0 + 7, 9);
    expect(arc?.e.radius).toBe(2.5);
    expect(arc?.e.cosHalfAngle).toBe(-1);
    expect(arc?.e.targetIds).toEqual([2, 3]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 40, 90], [3, 40, 90]]);
    expect(rig.applied()).toEqual([
      [2, 'stun', 30],
      [2, 'silence', 120],
      [3, 'stun', 30],
      [3, 'silence', 120],
    ]);
    expect(rig.statuses(2)).toEqual([{ type: 'stun' }, { type: 'silence' }]);
    rig.clean();
  });

  it("F Reaper's Dance misses an enemy 3.5 m from where it lands and one near where it started", () => {
    const rig = new Rig(skerrow, { 2: [X0 + 10.5, 0], 3: [X0 + 1.5, 0] }, 100);
    rig.run(18 + 1, press('F', { aim: [X0 + 7, 0] }));
    expect(rig.events('meleeArc').map(({ e }) => e.targetIds)).toEqual([[]]);
    expect(rig.health(2)).toBe(130);
    expect(rig.health(3)).toBe(130);
    expect(rig.applied()).toEqual([]);
    rig.clean();
  });

  it("F Reaper's Dance teleports at most 8 m, however far the aim is", () => {
    const rig = new Rig(skerrow, {}, 100);
    rig.run(18 + 1, press('F', { aim: [X0 + 12, 0] }));
    const [teleport] = rig.events('teleport');
    expect(teleport?.e.blocked).toBe(false);
    expect(teleport?.e.toX).toBeCloseTo(X0 + 8, 9);
    rig.clean();
  });
});

describe('Lumeth', () => {
  // A hurt ally is what makes a heal row show: a heal that restores nothing has no event and earns
  // nothing. The caster is champion 0, the ally champion 1, the enemies champions 2 and 3.
  const heals = (rig: Rig) => rig.events('heal').map(({ e }) => [e.targetId, e.amount, e.health]);
  const gains = (rig: Rig) => rig.events('energyGained').map(({ e }) => [e.championId, e.targetId, e.amount]);

  it('M1 Mend Bolt flies 12 m in 36 sweeps', () => {
    const rig = new Rig(lumeth);
    rig.run(6 + 36, press('M1'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(6);
    expect(spawned?.e.radius).toBe(0.35);
    expect(spawned?.e.vx).toBe(20);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 6 + 1).toBe(36);
    expect(expired?.e.x).toBeCloseTo(X0 + 12, 9);
    rig.clean();
  });

  it('M1 Mend Bolt heals the ally in line for 10, never the caster, and earns 5', () => {
    const rig = new Rig(lumeth, { 1: [X0 + 6, 0] }, 0, true, { 0: 100, 1: 100 });
    rig.run(6 + 20, press('M1'));
    expect(rig.events('projectileHit').map(({ e }) => e.targetId)).toEqual([1]);
    expect(heals(rig)).toEqual([[1, 10, 110]]);
    expect(gains(rig)).toEqual([[0, 1, 5]]);
    expect(rig.health(0)).toBe(100);
    expect(rig.events('damage')).toEqual([]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('M1 Mend Bolt does 10 damage to an enemy, earns 5 and heals nobody', () => {
    const rig = new Rig(lumeth, { 2: [X0 + 8, 0] });
    rig.run(6 + 25, press('M1'));
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 10, 110]]);
    expect(gains(rig)).toEqual([[0, 2, 5]]);
    expect(rig.events('heal')).toEqual([]);
    expect(rig.applied()).toEqual([]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('M2 Soothing Surge flies 10.13 m in 38 sweeps', () => {
    const rig = new Rig(lumeth);
    rig.run(18 + 38, press('M2'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(18);
    expect(spawned?.e.radius).toBe(0.5);
    expect(spawned?.e.vx).toBe(16);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 18 + 1).toBe(38);
    expect(expired?.e.x).toBeCloseTo(X0 + 608 / 60, 9);
    rig.clean();
  });

  it('M2 Soothing Surge passes the enemy in line and heals the ally behind it: 14, then six pulses of 2', () => {
    const rig = new Rig(lumeth, { 1: [X0 + 7, 0], 2: [X0 + 3, 0] }, 0, true, { 1: 90 });
    rig.run(18 + 30 + 185, press('M2'));
    expect(rig.events('projectileHit').map(({ e }) => e.targetId)).toEqual([1]);
    expect(heals(rig)).toEqual([
      [1, 14, 104],
      [1, 2, 106],
      [1, 2, 108],
      [1, 2, 110],
      [1, 2, 112],
      [1, 2, 114],
      [1, 2, 116],
    ]);
    expect(rig.applied()).toEqual([[1, 'hot', 180]]);
    expect(gains(rig)).toEqual([[0, 1, 10]]);
    expect(rig.health(2)).toBe(120);
    expect(rig.events('damage')).toEqual([]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('M2 Soothing Surge stops at an ally at full health: no heal, no energy, the hot still lands', () => {
    // The heal over time landing on a full-health ally is the sim's current behaviour.
    const rig = new Rig(lumeth, { 1: [X0 + 6, 0], 2: [X0 + 9, 0] });
    rig.run(18 + 30 + 185, press('M2'));
    expect(rig.events('projectileHit').map(({ e }) => e.targetId)).toEqual([1]);
    expect(rig.events('heal')).toEqual([]);
    expect(rig.applied()).toEqual([[1, 'hot', 180]]);
    expect(rig.events('energyGained')).toEqual([]);
    expect(rig.events('damage')).toEqual([]);
    expect(rig.health(2)).toBe(120);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('M2 EX Soothing Surge heals 22, then eight pulses of 3 over 240 ticks', () => {
    const rig = new Rig(lumeth, { 1: [X0 + 7, 0] }, 25, true, { 1: 70 });
    rig.run(18 + 30 + 245, press('M2', { ex: true }));
    expect(heals(rig)).toEqual([
      [1, 22, 92],
      [1, 3, 95],
      [1, 3, 98],
      [1, 3, 101],
      [1, 3, 104],
      [1, 3, 107],
      [1, 3, 110],
      [1, 3, 113],
      [1, 3, 116],
    ]);
    expect(rig.applied()).toEqual([[1, 'hot', 240]]);
    expect(gains(rig)).toEqual([[0, 1, 10]]);
    rig.clean();
  });

  it('SPACE Glide dashes 4 m in 12 ticks with haste on self and fires nothing at the end', () => {
    const rig = new Rig(lumeth);
    rig.step(press('SPACE'));
    expect(rig.applied()).toEqual([[0, 'haste', 60]]);
    expect(rig.statuses(0)).toEqual([{ type: 'haste', percent: 30 }]);
    rig.run(11);
    expect(rig.events('dashStarted').map(({ step, e }) => [step, e.distance, e.ticks])).toEqual([[0, 4, 12]]);
    const ended = rig.events('dashEnded');
    expect(ended.map(({ step, e }) => [step, e.reason])).toEqual([[11, 'complete']]);
    expect(ended[0]?.e.x).toBeCloseTo(X0 + 4, 9);
    expect(rig.events('meleeArc')).toEqual([]);
    expect(rig.events('areaSpawned')).toEqual([]);
    rig.clean();
  });

  it('Q Binding Sigil lands where it is aimed, 8 damage and a 90 tick root, and misses what is 2.6 m off', () => {
    const rig = new Rig(lumeth, { 2: [X0 + 6, 0], 3: [X0 + 6, 2.6] });
    rig.run(30 + 1, press('Q', { aim: [X0 + 6, 0] }));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(30);
    expect(spawned?.e.x).toBeCloseTo(X0 + 6, 9);
    expect(spawned?.e.radius).toBe(2);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 8, 112]]);
    expect(rig.applied()).toEqual([[2, 'root', 90]]);
    expect(rig.statuses(2)).toEqual([{ type: 'root' }]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expect(rig.health(3)).toBe(120);
    expectOneHit(rig);
    rig.clean();
  });

  it('Q Binding Sigil aimed far ahead lands 9 m away', () => {
    const rig = new Rig(lumeth);
    rig.run(30 + 1, press('Q'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(30);
    expect(spawned?.e.x).toBeCloseTo(X0 + 9, 9);
    expectOneHit(rig);
    rig.clean();
  });

  it('E Lantern Burst hits the enemy at 3.4 m for 12 and throws it 2 m away in 8 ticks, and misses the one at 3.6 m', () => {
    const rig = new Rig(lumeth, { 2: [X0 + 3.4, 0], 3: [X0, 3.6] });
    rig.run(12 + 1, press('E'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(12);
    expect(spawned?.e.x).toBe(X0);
    expect(spawned?.e.radius).toBe(3);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health])).toEqual([[2, 12, 108]]);
    expect(rig.applied()).toEqual([[2, 'knockback', 8]]);
    expect(rig.statuses(2)).toEqual([{ type: 'knockback', distance: 2, totalTicks: 8, dirX: 1, dirY: 0 }]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expect(rig.health(3)).toBe(120);
    rig.run(8);
    expect(champion(rig.state, 2).x).toBeCloseTo(X0 + 5.4, 9);
    expectOneHit(rig);
    rig.clean();
  });

  it('R Aegis Veil shields the caster and the ally at 5.4 m, not the enemy, and earns nothing', () => {
    const rig = new Rig(lumeth, { 1: [X0 + 5.4, 0], 2: [X0, 3] });
    rig.step(press('R'));
    expect(rig.events('areaSpawned')[0]?.e.radius).toBe(5);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[0, 1]]);
    expect(rig.applied()).toEqual([[0, 'shield', 240], [1, 'shield', 240]]);
    expect(rig.statuses(0)).toEqual([{ type: 'shield', absorb: 30 }]);
    expect(rig.statuses(1)).toEqual([{ type: 'shield', absorb: 30 }]);
    expect(rig.statuses(2)).toEqual([]);
    expect(rig.events('energyGained')).toEqual([]);
    expectOneHit(rig);
    rig.clean();
  });

  it('R Aegis Veil does not reach an ally at 5.6 m', () => {
    const rig = new Rig(lumeth, { 1: [X0 + 5.6, 0] });
    rig.step(press('R'));
    expect(rig.applied()).toEqual([[0, 'shield', 240]]);
    expect(rig.statuses(1)).toEqual([]);
    rig.clean();
  });

  it('R EX Aegis Veil gives the caster and the ally a shield of 45 for 300 ticks and haste for 120', () => {
    const rig = new Rig(lumeth, { 1: [X0 + 4, 0] }, 25);
    rig.step(press('R', { ex: true }));
    expect(rig.applied()).toEqual([
      [0, 'shield', 300],
      [0, 'haste', 120],
      [1, 'shield', 300],
      [1, 'haste', 120],
    ]);
    expect(rig.statuses(1)).toEqual([{ type: 'shield', absorb: 45 }, { type: 'haste', percent: 20 }]);
    rig.clean();
  });

  it('F Dawnbloom heals and renews the hurt ally, slows the enemy in reach and earns 15 for the one ally', () => {
    const rig = new Rig(lumeth, { 1: [X0 + 5.4, 0], 2: [X0, 5.4], 3: [X0, -5.6] }, 100, true, { 1: 50, 2: 100 });
    rig.run(37, press('F'));
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 30 }]);
    rig.run(36 + 190 - 37);
    const spawned = rig.events('areaSpawned');
    expect(spawned.map(({ step }) => step)).toEqual([36, 36]);
    const [first, second] = spawned;
    expect([second?.e.x, second?.e.y, second?.e.radius]).toEqual([first?.e.x, first?.e.y, first?.e.radius]);
    expect(first?.e.radius).toBe(5);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[0, 1], [2]]);
    expect(heals(rig)).toEqual([
      [1, 30, 80],
      [1, 5, 85],
      [1, 5, 90],
      [1, 5, 95],
      [1, 5, 100],
      [1, 5, 105],
      [1, 5, 110],
    ]);
    expect(rig.applied()).toEqual([[0, 'hot', 180], [1, 'hot', 180], [2, 'slow', 120]]);
    expect(gains(rig)).toEqual([[0, 1, 15]]);
    // Enemy 2 is hurt too, so a heal in the enemy area would show: the heals name the ally only.
    expect(new Set(heals(rig).map(([target]) => target))).toEqual(new Set([1]));
    expect(rig.health(2)).toBe(100);
    expect(rig.health(3)).toBe(120);
    expectOneHit(rig);
    rig.clean();
  });
});

describe('Ondrel', () => {
  const gains = (rig: Rig) => rig.events('energyGained').map(({ e }) => [e.championId, e.targetId, e.amount]);
  const damages = (rig: Rig) => rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health]);
  /** The champion ids an area hit, per pulse, for the area with this index of its spawn order. */
  const ticksOf = (rig: Rig, which: number) => {
    const id = rig.events('areaSpawned')[which]?.e.areaId;
    return rig.events('areaTick').filter(({ e }) => e.areaId === id);
  };

  it('M1 Clod Toss flies 10 m in 30 sweeps', () => {
    const rig = new Rig(ondrel);
    rig.run(9 + 30, press('M1'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(9);
    expect(spawned?.e.radius).toBe(0.3);
    expect(spawned?.e.vx).toBe(20);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 9 + 1).toBe(30);
    expect(expired?.e.x).toBeCloseTo(X0 + 10, 9);
    rig.clean();
  });

  it('M1 Clod Toss does 9 damage at 8 m', () => {
    const rig = new Rig(ondrel, { 2: [X0 + 8, 0] });
    rig.run(9 + 25, press('M1'));
    expect(damages(rig)).toEqual([[2, 9, 121]]);
    expect(rig.applied()).toEqual([]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('M2 Mire lands where it is aimed and pulses on steps 24, 84 and 144: 8 damage and a slow each, 10 energy once', () => {
    const rig = new Rig(ondrel, { 2: [X0 + 6, 0], 3: [X0 + 6, 2.6] });
    rig.run(24 + 180, press('M2', { aim: [X0 + 6, 0] }));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(24);
    expect(spawned?.e.x).toBeCloseTo(X0 + 6, 9);
    expect(spawned?.e.radius).toBe(2);
    expect(rig.events('areaTick').map(({ step, e }) => [step, e.targetIds])).toEqual([
      [24, [2]],
      [84, [2]],
      [144, [2]],
    ]);
    expect(damages(rig)).toEqual([[2, 8, 122], [2, 8, 114], [2, 8, 106]]);
    expect(rig.applied()).toEqual([[2, 'slow', 90], [2, 'slow', 90], [2, 'slow', 90]]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 30 }]);
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual([203]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expect(rig.health(3)).toBe(130);
    expect(rig.state.areas).toEqual([]);
    rig.clean();
  });

  it('M2 Mire aimed far ahead lands 8 m away', () => {
    const rig = new Rig(ondrel);
    rig.run(24 + 1, press('M2'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(24);
    expect(spawned?.e.x).toBeCloseTo(X0 + 8, 9);
    rig.clean();
  });

  it('M2 EX Mire is 2.5 m wide, does 10 per pulse and slows 40 percent for 120 ticks', () => {
    const rig = new Rig(ondrel, { 2: [X0 + 6, 0], 3: [X0 + 6, 2.9], 1: [X0 + 6, -2.9] }, 25);
    rig.run(24 + 180, press('M2', { ex: true, aim: [X0 + 6, 0] }));
    expect(rig.events('areaSpawned')[0]?.e.radius).toBe(2.5);
    expect(rig.events('areaTick').map(({ step, e }) => [step, e.targetIds])).toEqual([
      [24, [2, 3]],
      [84, [2, 3]],
      [144, [2, 3]],
    ]);
    expect(damages(rig)).toEqual([
      [2, 10, 120],
      [3, 10, 120],
      [2, 10, 110],
      [3, 10, 110],
      [2, 10, 100],
      [3, 10, 100],
    ]);
    expect(rig.applied()).toEqual([
      [2, 'slow', 120],
      [3, 'slow', 120],
      [2, 'slow', 120],
      [3, 'slow', 120],
      [2, 'slow', 120],
      [3, 'slow', 120],
    ]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 40 }]);
    expect(rig.statuses(1)).toEqual([]);
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual([203]);
    rig.clean();
  });

  it('SPACE Reed Step leaves its patch at the start point: radius 1.5, two pulses that slow 40 percent for 60 ticks and hurt nobody', () => {
    const rig = new Rig(ondrel, { 2: [X0, 1.2], 3: [X0, 2.1] });
    rig.run(120, press('SPACE'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(0);
    expect(spawned?.e.x).toBe(X0);
    expect(spawned?.e.radius).toBe(1.5);
    expect(rig.events('areaTick').map(({ step, e }) => [step, e.targetIds])).toEqual([
      [0, [2]],
      [60, [2]],
    ]);
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual([119]);
    expect(rig.events('dashStarted').map(({ step, e }) => [step, e.distance, e.ticks])).toEqual([[0, 4.5, 15]]);
    const ended = rig.events('dashEnded');
    expect(ended.map(({ step, e }) => [step, e.reason])).toEqual([[14, 'complete']]);
    expect(ended[0]?.e.x).toBeCloseTo(X0 + 4.5, 9);
    expect(rig.applied()).toEqual([[2, 'slow', 60], [2, 'slow', 60]]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 40 }]);
    expect(rig.events('damage')).toEqual([]);
    expect(rig.events('energyGained')).toEqual([]);
    expect(rig.health(3)).toBe(130);
    expect(rig.state.areas).toEqual([]);
    rig.clean();
  });

  it('Q Reed Fence hits once for 10 and earns 10, then pushes 1 m away on pulses every 20 ticks', () => {
    const rig = new Rig(ondrel, { 2: [X0 + 1.2, 0], 3: [X0 + 3.2, 0] });
    rig.run(18 + 120, press('Q'));
    const spawned = rig.events('areaSpawned');
    expect(spawned.map(({ step }) => step)).toEqual([18, 18]);
    const [first, second] = spawned;
    expect([second?.e.x, second?.e.y, second?.e.radius]).toEqual([first?.e.x, first?.e.y, first?.e.radius]);
    expect(first?.e.x).toBe(X0);
    expect(first?.e.radius).toBe(2.5);
    // The one-hit area (the damage) comes first and ends in its own step; the push lasts 120 ticks.
    expect(ticksOf(rig, 0).map(({ step }) => step)).toEqual([18]);
    expect(ticksOf(rig, 1).map(({ step }) => step)).toEqual([18, 38, 58, 78, 98, 118]);
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual([18, 137]);
    expect(damages(rig)).toEqual([[2, 10, 120]]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expect(rig.applied()[0]).toEqual([2, 'knockback', 6]);
    expect(rig.health(3)).toBe(130);
    rig.clean();
  });

  it('Q Reed Fence pushes the enemy it holds in reach out of the circle: dirX 1, 1 m in 6 ticks per pulse', () => {
    const rig = new Rig(ondrel, { 2: [X0 + 1.2, 0] });
    rig.step(press('Q'));
    rig.run(18);
    expect(rig.statuses(2)).toEqual([{ type: 'knockback', distance: 1, totalTicks: 6, dirX: 1, dirY: 0 }]);
    rig.run(6);
    expect(champion(rig.state, 2).x).toBeCloseTo(X0 + 2.2, 9);
    rig.clean();
  });

  it('E Undertow flies 8 m in 30 sweeps', () => {
    const rig = new Rig(ondrel);
    rig.run(24 + 30, press('E'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(24);
    expect(spawned?.e.radius).toBe(0.5);
    expect(spawned?.e.vx).toBe(16);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 24 + 1).toBe(30);
    expect(expired?.e.x).toBeCloseTo(X0 + 8, 9);
    rig.clean();
  });

  it('E Undertow hurts, pulls the enemy 3 m toward the caster in 15 ticks and slows it, and stops on the hit', () => {
    const rig = new Rig(ondrel, { 2: [X0 + 6, 0] });
    rig.run(24 + 22, press('E'));
    expect(damages(rig)).toEqual([[2, 10, 120]]);
    expect(rig.applied()).toEqual([[2, 'knockback', 15], [2, 'slow', 90]]);
    expect(rig.statuses(2)).toEqual([
      { type: 'knockback', distance: 3, totalTicks: 15, dirX: -1, dirY: 0 },
      { type: 'slow', percent: 40 },
    ]);
    rig.run(15);
    expect(champion(rig.state, 2).x).toBeCloseTo(X0 + 3, 9);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('E EX Undertow pierces both enemies in line: each takes 12, is pulled and slowed 50 percent for 120 ticks once', () => {
    const rig = new Rig(ondrel, { 2: [X0 + 5, 0], 3: [X0 + 7.5, 0] }, 25);
    rig.run(24 + 30, press('E', { ex: true }));
    expect(rig.events('projectileHit').map(({ e }) => e.targetId)).toEqual([2, 3]);
    expect(damages(rig)).toEqual([[2, 12, 118], [3, 12, 118]]);
    expect(rig.applied()).toEqual([
      [2, 'knockback', 15],
      [2, 'slow', 120],
      [3, 'knockback', 15],
      [3, 'slow', 120],
    ]);
    expect(rig.statuses(3)).toEqual([
      { type: 'knockback', distance: 3, totalTicks: 15, dirX: -1, dirY: 0 },
      { type: 'slow', percent: 50 },
    ]);
    expect(rig.events('projectileExpired').map(({ e }) => e.reason)).toEqual(['lifetime']);
    rig.clean();
  });

  it('R Reed Screen shields the caster for 40 and slows the enemies in reach on steps 0, 60 and 120, never the caster or an ally, and earns nothing', () => {
    const rig = new Rig(ondrel, { 1: [X0 - 2, 1], 2: [X0 + 2.5, 0] });
    rig.run(180, press('R'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(0);
    expect(spawned?.e.radius).toBe(3);
    expect(rig.events('areaTick').map(({ step, e }) => [step, e.targetIds])).toEqual([
      [0, [2]],
      [60, [2]],
      [120, [2]],
    ]);
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual([179]);
    expect(rig.applied()).toEqual([[0, 'shield', 240], [2, 'slow', 60], [2, 'slow', 60], [2, 'slow', 60]]);
    expect(rig.statuses(0)).toEqual([{ type: 'shield', absorb: 40 }]);
    expect(rig.statuses(1)).toEqual([]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 30 }]);
    expect(rig.events('damage')).toEqual([]);
    expect(rig.events('energyGained')).toEqual([]);
    rig.clean();
  });

  it('F Drowned Ground pulses 5 times from step 42: 50 damage in all, a slow each, 15 energy once, never an ally', () => {
    const rig = new Rig(ondrel, { 1: [X0 + 6, 1], 2: [X0 + 6, 0] }, 100);
    rig.run(42 + 300, press('F', { aim: [X0 + 6, 0] }));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(42);
    expect(spawned?.e.x).toBeCloseTo(X0 + 6, 9);
    expect(spawned?.e.radius).toBe(4);
    expect(rig.events('areaTick').map(({ step, e }) => [step, e.targetIds])).toEqual([
      [42, [2]],
      [102, [2]],
      [162, [2]],
      [222, [2]],
      [282, [2]],
    ]);
    expect(damages(rig)).toEqual([[2, 10, 120], [2, 10, 110], [2, 10, 100], [2, 10, 90], [2, 10, 80]]);
    expect(rig.applied()).toEqual([
      [2, 'slow', 90],
      [2, 'slow', 90],
      [2, 'slow', 90],
      [2, 'slow', 90],
      [2, 'slow', 90],
    ]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 40 }]);
    expect(gains(rig)).toEqual([[0, 2, 15]]);
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual([341]);
    expect(rig.health(1)).toBe(130);
    expect(rig.statuses(1)).toEqual([]);
    rig.clean();
  });

  it('keeps six lingering areas over five slots, the paths the three rules bind', () => {
    expect(lingeringPaths(ondrel)).toEqual([
      'ondrel.slots.M2.effects[0]',
      'ondrel.slots.M2.ex.effects[0]',
      'ondrel.slots.SPACE.effects[1]',
      'ondrel.slots.Q.effects[1]',
      'ondrel.slots.R.effects[1]',
      'ondrel.slots.F.effects[0]',
    ]);
  });
});

describe('Brimwick', () => {
  const damages = (rig: Rig) => rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health]);

  it('M1 Spark flies 11 m in 33 sweeps', () => {
    const rig = new Rig(brimwick);
    rig.run(9 + 33, press('M1'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(9);
    expect(spawned?.e.radius).toBe(0.3);
    expect(spawned?.e.vx).toBe(20);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 9 + 1).toBe(33);
    expect(expired?.e.x).toBeCloseTo(X0 + 11, 9);
    rig.clean();
  });

  it('M1 Spark does 10 damage at 8 m', () => {
    const rig = new Rig(brimwick, { 2: [X0 + 8, 0] });
    rig.run(9 + 25, press('M1'));
    expect(damages(rig)).toEqual([[2, 10, 110]]);
    expect(rig.applied()).toEqual([]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('M2 Firecracker lands where it is aimed for 12 in one hit, and misses the enemy 2.1 m off', () => {
    const rig = new Rig(brimwick, { 2: [X0 + 6, 0], 3: [X0 + 6, 2.1] });
    rig.run(24 + 1, press('M2', { aim: [X0 + 6, 0] }));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(24);
    expect(spawned?.e.x).toBeCloseTo(X0 + 6, 9);
    expect(spawned?.e.radius).toBe(1.5);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(damages(rig)).toEqual([[2, 12, 108]]);
    expect(rig.applied()).toEqual([]);
    expect(rig.health(3)).toBe(120);
    expectOneHit(rig);
    rig.clean();
  });

  it('M2 Firecracker aimed far ahead lands 9 m away', () => {
    const rig = new Rig(brimwick);
    rig.run(24 + 1, press('M2'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(24);
    expect(spawned?.e.x).toBeCloseTo(X0 + 9, 9);
    expectOneHit(rig);
    rig.clean();
  });

  it('M2 EX Firecracker is 2 m wide, does 20 and slows 30 percent for 90 ticks: the enemy 2.4 m off is hit now', () => {
    const rig = new Rig(brimwick, { 2: [X0 + 6, 0], 3: [X0 + 6, 2.4] }, 25);
    rig.run(24 + 1, press('M2', { ex: true, aim: [X0 + 6, 0] }));
    expect(rig.events('areaSpawned')[0]?.e.radius).toBe(2);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2, 3]]);
    expect(damages(rig)).toEqual([[2, 20, 100], [3, 20, 100]]);
    expect(rig.applied()).toEqual([[2, 'slow', 90], [3, 'slow', 90]]);
    expect(rig.statuses(3)).toEqual([{ type: 'slow', percent: 30 }]);
    expectOneHit(rig);
    rig.clean();
  });

  it('SPACE Flare Step goes as far as the aim up to 6 m', () => {
    for (const [aim, to] of [[[X0 + 3, 0], X0 + 3], [AHEAD, X0 + 6]] as [Spot, number][]) {
      const rig = new Rig(brimwick);
      rig.step(press('SPACE', { aim }));
      const [teleport] = rig.events('teleport');
      expect(teleport?.e.blocked).toBe(false);
      expect(teleport?.e.fromX).toBe(X0);
      expect(teleport?.e.toX).toBeCloseTo(to, 9);
      expect(champion(rig.state, 0).x).toBeCloseTo(to, 9);
      expect(rig.applied()).toEqual([]);
      rig.clean();
    }
  });

  it('Q Flash Powder flies 10 m in 25 sweeps', () => {
    const rig = new Rig(brimwick);
    rig.run(6 + 25, press('Q'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(6);
    expect(spawned?.e.radius).toBe(0.35);
    expect(spawned?.e.vx).toBe(24);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 6 + 1).toBe(25);
    expect(expired?.e.x).toBeCloseTo(X0 + 10, 9);
    rig.clean();
  });

  it('Q Flash Powder does 10 damage and stuns for 45 ticks, and an enemy 7 m away is hit on step 21 (the doc says 0.36 s)', () => {
    const rig = new Rig(brimwick, { 2: [X0 + 7, 0] });
    rig.run(6 + 25, press('Q'));
    expect(damages(rig)).toEqual([[2, 10, 110]]);
    expect(rig.applied()).toEqual([[2, 'stun', 45]]);
    expect(rig.statuses(2)).toEqual([{ type: 'stun' }]);
    // Step 21 is the 22nd tick, 0.367 s after the press: the doc's 0.36 s, to the tick.
    expect(rig.events('projectileHit').map(({ step }) => step)).toEqual([21]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('E Starshell flies 10 m in 50 sweeps', () => {
    const rig = new Rig(brimwick);
    rig.run(42 + 50, press('E'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(42);
    expect(spawned?.e.radius).toBe(0.6);
    expect(spawned?.e.vx).toBe(12);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 42 + 1).toBe(50);
    expect(expired?.e.x).toBeCloseTo(X0 + 10, 9);
    rig.clean();
  });

  it('E Starshell does 26 damage and pushes the enemy 2 m away in 10 ticks', () => {
    const rig = new Rig(brimwick, { 2: [X0 + 6, 0] });
    rig.run(42 + 26, press('E'));
    expect(damages(rig)).toEqual([[2, 26, 94]]);
    expect(rig.applied()).toEqual([[2, 'knockback', 10]]);
    expect(rig.statuses(2)).toEqual([{ type: 'knockback', distance: 2, totalTicks: 10, dirX: 1, dirY: 0 }]);
    rig.run(10);
    expect(champion(rig.state, 2).x).toBeCloseTo(X0 + 8, 9);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('E EX Starshell winds up in 24 ticks, does 30 damage and pushes 3 m', () => {
    const rig = new Rig(brimwick, { 2: [X0 + 6, 0] }, 25);
    rig.run(24 + 26, press('E', { ex: true }));
    expect(rig.events('projectileSpawned')[0]?.step).toBe(24);
    expect(damages(rig)).toEqual([[2, 30, 90]]);
    expect(rig.statuses(2)).toEqual([{ type: 'knockback', distance: 3, totalTicks: 10, dirX: 1, dirY: 0 }]);
    rig.run(10);
    expect(champion(rig.state, 2).x).toBeCloseTo(X0 + 9, 9);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('R Smoke Pot slows the enemy within 4.0 m for 90 ticks and not the one at 4.1 m, hastes the caster and earns nothing', () => {
    const rig = new Rig(brimwick, { 2: [X0 + 4, 0], 3: [X0, 4.1] });
    rig.step(press('R'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.e.x).toBe(X0);
    expect(spawned?.e.radius).toBe(3.5);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(rig.applied()).toEqual([[0, 'haste', 90], [2, 'slow', 90]]);
    expect(rig.statuses(0)).toEqual([{ type: 'haste', percent: 40 }]);
    expect(rig.statuses(2)).toEqual([{ type: 'slow', percent: 40 }]);
    expect(rig.statuses(3)).toEqual([]);
    expect(rig.events('damage')).toEqual([]);
    expect(rig.events('energyGained')).toEqual([]);
    expectOneHit(rig);
    rig.clean();
  });

  it('F Grand Finale winds up 60 ticks locked, then does 55 damage and stuns for 60 ticks, flying 12 m in 36 sweeps', () => {
    const flight = new Rig(brimwick, {}, 100);
    flight.run(60 + 36, press('F'));
    const [spawned] = flight.events('projectileSpawned');
    expect(spawned?.step).toBe(60);
    expect(spawned?.e.radius).toBe(0.5);
    expect(spawned?.e.vx).toBe(20);
    const [expired] = flight.events('projectileExpired');
    expect((expired?.step ?? 0) - 60 + 1).toBe(36);
    expect(expired?.e.x).toBeCloseTo(X0 + 12, 9);
    flight.clean();
    const rig = new Rig(brimwick, { 2: [X0 + 8, 0] }, 100);
    rig.run(60 + 25, press('F'));
    expect(damages(rig)).toEqual([[2, 55, 65]]);
    expect(rig.applied()).toEqual([[2, 'stun', 60]]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('keeps no lingering area: every area is one hit', () => {
    expect(lingeringPaths(brimwick)).toEqual([]);
  });
});

describe('Durnhal', () => {
  const damages = (rig: Rig) => rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health]);
  const gains = (rig: Rig) => rig.events('energyGained').map(({ e }) => [e.championId, e.targetId, e.amount]);

  it('M1 Warhammer hits the enemy at 3.9 m for 10 and a one-stack wound, and not the one at 4.1 m', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 3.9, 0], 3: [X0 + 4.1, 0] });
    rig.run(10, press('M1'));
    expect(rig.events('meleeArc').map(({ step, e }) => ({ step, radius: e.radius, cos: e.cosHalfAngle, targets: e.targetIds }))).toEqual([
      { step: 9, radius: 3.5, cos: 0.6427876097, targets: [2] },
    ]);
    expect(damages(rig)).toEqual([[2, 10, 150]]);
    expect(rig.applied()).toEqual([[2, 'wound', 240]]);
    expect(rig.statuses(2)).toEqual([{ type: 'wound', stacks: 1 }]);
    expect(gains(rig)).toEqual([[0, 2, 5]]);
    expect(rig.health(3)).toBe(160);
    expect(rig.statuses(3)).toEqual([]);
    rig.clean();
  });

  it('M2 Sundering Blow lands 2 m ahead in a circle of radius 2: 16 damage and a one-stack wound at 4.4 m, nothing at 4.6 m', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 4.4, 0], 3: [X0 + 4.6, 0] });
    rig.run(25, press('M2'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(24);
    expect(spawned?.e.x).toBeCloseTo(X0 + 2, 9);
    expect(spawned?.e.radius).toBe(2);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(damages(rig)).toEqual([[2, 16, 144]]);
    expect(rig.applied()).toEqual([[2, 'wound', 240]]);
    expect(rig.statuses(2)).toEqual([{ type: 'wound', stacks: 1 }]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expect(rig.health(3)).toBe(160);
    expectOneHit(rig);
    rig.clean();
  });

  it('M2 EX Sundering Blow does 22 and a two-stack wound, in the same circle', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 4.4, 0], 3: [X0 + 4.6, 0] }, 25);
    rig.run(25, press('M2', { ex: true }));
    expect(rig.events('areaSpawned')[0]?.e.radius).toBe(2);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(damages(rig)).toEqual([[2, 22, 138]]);
    expect(rig.applied()).toEqual([[2, 'wound', 240]]);
    expect(rig.statuses(2)).toEqual([{ type: 'wound', stacks: 2 }]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expect(rig.health(3)).toBe(160);
    expectOneHit(rig);
    rig.clean();
  });

  it('SPACE Bulwark Charge dashes 5 m in 15 ticks, then pushes the enemy at 1.9 m 2 m away in 8 ticks and leaves the one at 2.1 m', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 6.9, 0], 3: [X0 + 5, 2.1] });
    rig.run(15, press('SPACE'));
    expect(rig.events('dashStarted').map(({ step, e }) => [step, e.distance, e.ticks])).toEqual([[0, 5, 15]]);
    const ended = rig.events('dashEnded');
    expect(ended.map(({ step, e }) => [step, e.reason])).toEqual([[14, 'complete']]);
    expect(ended[0]?.e.x).toBeCloseTo(X0 + 5, 9);
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(14);
    expect(spawned?.e.x).toBeCloseTo(X0 + 5, 9);
    expect(spawned?.e.radius).toBe(1.5);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(rig.applied()).toEqual([[2, 'knockback', 8]]);
    expect(rig.statuses(2)).toEqual([{ type: 'knockback', distance: 2, totalTicks: 8, dirX: 1, dirY: 0 }]);
    expect(rig.statuses(3)).toEqual([]);
    expect(rig.events('damage')).toEqual([]);
    expect(rig.events('energyGained')).toEqual([]);
    rig.run(8);
    expect(champion(rig.state, 2).x).toBeCloseTo(X0 + 8.9, 9);
    expectOneHit(rig);
    rig.clean();
  });

  it('SPACE Bulwark Charge into an enemy 4 m ahead ends blocked and still pushes it', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 4, 0] });
    rig.run(15, press('SPACE'));
    expect(rig.events('dashEnded').map(({ e }) => e.reason)).toEqual(['blocked']);
    expect(rig.events('areaSpawned')).toHaveLength(1);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(rig.applied()).toEqual([[2, 'knockback', 8]]);
    expect(rig.events('damage')).toEqual([]);
    expectOneHit(rig);
    rig.clean();
  });

  it('Q Grounding Slam hits the enemy at 2.9 m for 10 and a 60 tick root, earns 10, and misses the one at 3.1 m', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 2.9, 0], 3: [X0, 3.1] });
    rig.run(18 + 1, press('Q'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(18);
    expect(spawned?.e.x).toBe(X0);
    expect(spawned?.e.radius).toBe(2.5);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2]]);
    expect(damages(rig)).toEqual([[2, 10, 150]]);
    expect(rig.applied()).toEqual([[2, 'root', 60]]);
    expect(rig.statuses(2)).toEqual([{ type: 'root' }]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expect(rig.health(3)).toBe(160);
    expectOneHit(rig);
    rig.clean();
  });

  it('E Breaker Throw flies 9 m in 30 sweeps', () => {
    const rig = new Rig(durnhal);
    rig.run(18 + 30, press('E'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(18);
    expect(spawned?.e.radius).toBe(0.4);
    expect(spawned?.e.vx).toBe(18);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 18 + 1).toBe(30);
    expect(expired?.e.x).toBeCloseTo(X0 + 9, 9);
    rig.clean();
  });

  it('E Breaker Throw does 16 damage, a one-stack wound for 240 ticks and a 30 percent slow for 90, and stops on the hit', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 6, 0] });
    rig.run(18 + 20, press('E'));
    expect(damages(rig)).toEqual([[2, 16, 144]]);
    expect(rig.applied()).toEqual([[2, 'wound', 240], [2, 'slow', 90]]);
    expect(rig.statuses(2)).toEqual([{ type: 'wound', stacks: 1 }, { type: 'slow', percent: 30 }]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('E EX Breaker Throw does 22 damage and a two-stack wound, with the same slow', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 6, 0] }, 25);
    rig.run(18 + 20, press('E', { ex: true }));
    expect(damages(rig)).toEqual([[2, 22, 138]]);
    expect(rig.applied()).toEqual([[2, 'wound', 240], [2, 'slow', 90]]);
    expect(rig.statuses(2)).toEqual([{ type: 'wound', stacks: 2 }, { type: 'slow', percent: 30 }]);
    expect(gains(rig)).toEqual([[0, 2, 10]]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('R Aegis Line shields the caster and the ally at 4.4 m for 25 over 240 ticks, not the enemy, and earns nothing', () => {
    const rig = new Rig(durnhal, { 1: [X0 + 4.4, 0], 2: [X0, 3] });
    rig.step(press('R'));
    expect(rig.events('areaSpawned')[0]?.e.radius).toBe(4);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[0, 1]]);
    expect(rig.applied()).toEqual([[0, 'shield', 240], [1, 'shield', 240]]);
    expect(rig.statuses(0)).toEqual([{ type: 'shield', absorb: 25 }]);
    expect(rig.statuses(1)).toEqual([{ type: 'shield', absorb: 25 }]);
    expect(rig.statuses(2)).toEqual([]);
    expect(rig.events('energyGained')).toEqual([]);
    expectOneHit(rig);
    rig.clean();
  });

  it('R Aegis Line does not reach an ally at 4.6 m', () => {
    const rig = new Rig(durnhal, { 1: [X0 + 4.6, 0] });
    rig.step(press('R'));
    expect(rig.applied()).toEqual([[0, 'shield', 240]]);
    expect(rig.statuses(1)).toEqual([]);
    rig.clean();
  });

  it('F Last Bastion winds up 30 ticks locked, then hits both enemies within 5.0 m for 30, a three-stack wound for 300 ticks and a 50 percent slow, and shields the caster', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 5, 0], 3: [X0, 4.9] }, 100);
    rig.run(30 + 1, press('F'));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(30);
    expect(spawned?.e.x).toBe(X0);
    expect(spawned?.e.radius).toBe(4.5);
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[2, 3]]);
    expect(damages(rig)).toEqual([[2, 30, 130], [3, 30, 130]]);
    // The shield is a step effect of the cast and lands before the area acts.
    expect(rig.applied()).toEqual([
      [0, 'shield', 240],
      [2, 'wound', 300],
      [2, 'slow', 120],
      [3, 'wound', 300],
      [3, 'slow', 120],
    ]);
    for (const id of [2, 3]) expect(rig.statuses(id)).toEqual([{ type: 'wound', stacks: 3 }, { type: 'slow', percent: 50 }]);
    expect(rig.statuses(0)).toEqual([{ type: 'shield', absorb: 50 }]);
    expect(gains(rig)).toEqual([[0, 2, 15], [0, 3, 15]]);
    expectOneHit(rig);
    rig.clean();
  });

  it('F Last Bastion misses an enemy at 5.1 m', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 5.1, 0] }, 100);
    rig.run(30 + 1, press('F'));
    expect(rig.events('areaTick').map(({ e }) => e.targetIds)).toEqual([[]]);
    expect(rig.health(2)).toBe(160);
    expect(rig.statuses(2)).toEqual([]);
    expect(rig.applied()).toEqual([[0, 'shield', 240]]);
    rig.clean();
  });

  it('F Last Bastion after an M1 wound merges to three stacks on the 300 tick timer', () => {
    const rig = new Rig(durnhal, { 2: [X0 + 3.9, 0] }, 100);
    rig.run(10, press('M1'));
    expect(rig.statuses(2)).toEqual([{ type: 'wound', stacks: 1 }]);
    rig.run(31, press('F'));
    expect(rig.applied()).toEqual([[2, 'wound', 240], [0, 'shield', 240], [2, 'wound', 300], [2, 'slow', 120]]);
    expect(rig.statuses(2)).toEqual([{ type: 'wound', stacks: 3 }, { type: 'slow', percent: 50 }]);
    const wound = champion(rig.state, 2).statuses.find((status) => status.type === 'wound');
    // The merge keeps the longer timer, so the F application's 300 ticks, not what M1's had left.
    expect(wound?.remainingTicks).toBe(300);
    rig.clean();
  });

  it('keeps six wound applications over four slots: 240 ticks from every skill hit, 300 from the ultimate', () => {
    const at = (path: string, ticks: number, stacks: number) => ({ path: `durnhal.slots.${path}`, ticks, stacks });
    expect(woundPaths(durnhal)).toEqual([
      at('M1.effects[0].effects[1]', 240, 1),
      at('M2.effects[0].effects[1]', 240, 1),
      at('M2.ex.effects[0].effects[1]', 240, 2),
      at('E.effects[0].effects[1]', 240, 1),
      at('E.ex.effects[0].effects[1]', 240, 2),
      at('F.effects[0].effects[1]', 300, 3),
    ]);
    for (const kit of [hargrim, quillon, skerrow, lumeth, ondrel, brimwick]) expect(woundPaths(kit)).toEqual([]);
  });

  it('keeps no lingering area: every area is one hit', () => {
    expect(lingeringPaths(durnhal)).toEqual([]);
  });
});

describe('Wrenna', () => {
  const damages = (rig: Rig) => rig.events('damage').map(({ e }) => [e.targetId, e.amount, e.health]);
  const focus = (rig: Rig) => champion(rig.state, 0).counter;
  const SPACE = SLOTS.indexOf('SPACE');
  const FOE: Spot = [X0 + 8, 0];

  /** Holds Longbow on the enemy 8 m ahead until the count reads `n`, and stops on the step of that hit. */
  function buildFocus(rig: Rig, n: number): void {
    for (let i = 0; i < 400 && (focus(rig)?.count ?? 0) < n; i++) rig.step(press('M1'));
    expect(focus(rig)?.count).toBe(n);
  }

  it('M1 Longbow flies 14 m in 35 sweeps', () => {
    const rig = new Rig(wrenna);
    rig.run(6 + 35, press('M1'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(6);
    expect(spawned?.e.radius).toBe(0.25);
    expect(spawned?.e.vx).toBe(24);
    const [expired] = rig.events('projectileExpired');
    expect(expired?.e.reason).toBe('lifetime');
    expect((expired?.step ?? 0) - 6 + 1).toBe(35);
    expect(expired?.e.x).toBeCloseTo(X0 + 840 / 60, 9);
    rig.clean();
  });

  it('M1 Longbow does 11 damage at 8 m and builds one Focus on the tick of the hit', () => {
    const rig = new Rig(wrenna, { 2: FOE });
    rig.run(6 + 25, press('M1'));
    expect(damages(rig)).toEqual([[2, 11, 109]]);
    expect(rig.applied()).toEqual([]);
    expectStopsOnHit(rig);
    expect(focus(rig)).toEqual({ count: 1, lastHitTick: rig.events('damage')[0]?.step });
    rig.clean();
  });

  it('builds Focus one per Longbow hit up to 3, and a fourth hit keeps 3 and moves the window', () => {
    const rig = new Rig(wrenna, { 2: FOE });
    const stamps: number[] = [];
    for (const n of [1, 2, 3]) {
      buildFocus(rig, n);
      stamps.push(focus(rig)?.lastHitTick ?? 0);
    }
    expect(stamps[0]).toBeLessThan(stamps[1] as number);
    expect(stamps[1]).toBeLessThan(stamps[2] as number);
    const hits = rig.events('damage').length;
    for (let i = 0; i < 400 && rig.events('damage').length === hits; i++) rig.step(press('M1'));
    expect(rig.events('damage').length).toBe(hits + 1);
    expect(focus(rig)?.count).toBe(3);
    expect(focus(rig)?.lastHitTick).toBeGreaterThan(stamps[2] as number);
    rig.clean();
  });

  it('builds no Focus from Barbed Arrow, Pinning Shot, Heartseeker or Arrow Storm, though each hits', () => {
    const casts: [Slot, number, number][] = [['M2', 18 + 30, 0], ['Q', 18 + 30, 0], ['E', 30 + 25, 0], ['F', 36 + 1, 100]];
    for (const [slot, steps, energy] of casts) {
      const rig = new Rig(wrenna, { 2: FOE }, energy);
      rig.run(steps, press(slot, { aim: FOE }));
      expect(rig.events('damage').map(({ e }) => e.targetId), slot).toEqual([2]);
      expect(focus(rig), slot).toEqual({ count: 0, lastHitTick: 0 });
      rig.clean();
    }
  });

  it('loses all Focus 360 steps after the last hit and not one step sooner', () => {
    const rig = new Rig(wrenna, { 2: FOE });
    buildFocus(rig, 3);
    const last = focus(rig)?.lastHitTick;
    rig.run(359);
    expect(focus(rig)).toEqual({ count: 3, lastHitTick: last });
    rig.step();
    expect(focus(rig)).toEqual({ count: 0, lastHitTick: 0 });
    rig.clean();
  });

  it('M2 Barbed Arrow flies 12.83 m in 35 sweeps', () => {
    const rig = new Rig(wrenna);
    rig.run(18 + 35, press('M2'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(18);
    expect(spawned?.e.radius).toBe(0.35);
    expect(spawned?.e.vx).toBe(22);
    const [expired] = rig.events('projectileExpired');
    expect((expired?.step ?? 0) - 18 + 1).toBe(35);
    expect(expired?.e.x).toBeCloseTo(X0 + 770 / 60, 9);
    rig.clean();
  });

  it('M2 Barbed Arrow does 12 damage, then six pulses of 2 over 180 ticks', () => {
    const rig = new Rig(wrenna, { 2: FOE });
    rig.run(18 + 22 + 190, press('M2'));
    expect(damages(rig)).toEqual([[2, 12, 108], [2, 2, 106], [2, 2, 104], [2, 2, 102], [2, 2, 100], [2, 2, 98], [2, 2, 96]]);
    expect(rig.applied()).toEqual([[2, 'dot', 180]]);
    rig.clean();
  });

  it('M2 EX Barbed Arrow adds a slow of 30 percent for 120 ticks to the same shot', () => {
    const rig = new Rig(wrenna, { 2: FOE }, 25);
    rig.run(18 + 22 + 190, press('M2', { ex: true }));
    expect(damages(rig)).toEqual([[2, 12, 108], [2, 2, 106], [2, 2, 104], [2, 2, 102], [2, 2, 100], [2, 2, 98], [2, 2, 96]]);
    expect(rig.applied()).toEqual([[2, 'dot', 180], [2, 'slow', 120]]);
    rig.clean();
  });

  it('SPACE Tumble dashes 5 m in 15 ticks with haste of 25 percent on self and fires nothing at the end', () => {
    const rig = new Rig(wrenna);
    rig.step(press('SPACE'));
    expect(rig.applied()).toEqual([[0, 'haste', 90]]);
    expect(rig.statuses(0)).toEqual([{ type: 'haste', percent: 25 }]);
    rig.run(14);
    expect(rig.events('dashStarted').map(({ step, e }) => [step, e.distance, e.ticks])).toEqual([[0, 5, 15]]);
    expect(rig.events('dashEnded').map(({ step, e }) => [step, e.reason])).toEqual([[14, 'complete']]);
    expect(rig.events('areaSpawned')).toEqual([]);
    rig.clean();
  });

  it('Q Pinning Shot flies 12 m in 36 sweeps', () => {
    const rig = new Rig(wrenna);
    rig.run(18 + 36, press('Q'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(18);
    expect(spawned?.e.radius).toBe(0.4);
    expect(spawned?.e.vx).toBe(20);
    const [expired] = rig.events('projectileExpired');
    expect((expired?.step ?? 0) - 18 + 1).toBe(36);
    expect(expired?.e.x).toBeCloseTo(X0 + 720 / 60, 9);
    rig.clean();
  });

  it('Q Pinning Shot does 9 damage and roots for 60 ticks', () => {
    const rig = new Rig(wrenna, { 2: FOE });
    rig.run(18 + 30, press('Q'));
    expect(damages(rig)).toEqual([[2, 9, 111]]);
    expect(rig.applied()).toEqual([[2, 'root', 60]]);
    expect(rig.statuses(2)).toEqual([{ type: 'root' }]);
    expectStopsOnHit(rig);
    rig.clean();
  });

  it('E Heartseeker flies 15.83 m in 38 sweeps', () => {
    const rig = new Rig(wrenna);
    rig.run(30 + 38, press('E'));
    const [spawned] = rig.events('projectileSpawned');
    expect(spawned?.step).toBe(30);
    expect(spawned?.e.radius).toBe(0.25);
    expect(spawned?.e.vx).toBe(25);
    const [expired] = rig.events('projectileExpired');
    expect((expired?.step ?? 0) - 30 + 1).toBe(38);
    expect(expired?.e.x).toBeCloseTo(X0 + 950 / 60, 9);
    rig.clean();
  });

  describe('Heartseeker spends the Focus', () => {
    it.each([
      [0, 16],
      [1, 20],
      [2, 24],
      [3, 28],
    ])('with %i Focus it hits for %i, and the count is still held through the windup', (stacks, amount) => {
      const rig = new Rig(wrenna, { 2: FOE });
      buildFocus(rig, stacks);
      const hurt = 120 - 11 * stacks;
      rig.step(press('E'));
      rig.run(29);
      expect(focus(rig)?.count).toBe(stacks);
      rig.step();
      expect(rig.events('castFired').map(({ e }) => [e.slot, e.ex]).at(-1)).toEqual(['E', false]);
      expect(focus(rig)).toEqual({ count: 0, lastHitTick: 0 });
      rig.run(25);
      expect(rig.events('damage').at(-1)?.e).toMatchObject({ targetId: 2, amount, health: hurt - amount });
      rig.clean();
    });

    it('EX with 3 Focus pierces for 20, costs 25 and leaves the Focus for Fade Step', () => {
      const rig = new Rig(wrenna, { 2: [X0 + 5, 0], 3: FOE }, 25);
      buildFocus(rig, 3);
      const energy = champion(rig.state, 0).energy;
      expect(energy).toBeGreaterThanOrEqual(25);
      rig.step(press('E', { ex: true }));
      expect(rig.events('castStarted').at(-1)?.e).toMatchObject({ slot: 'E', ex: true, cost: 25 });
      expect(champion(rig.state, 0).energy).toBe(energy - 25);
      rig.run(30 + 40);
      expect(focus(rig)?.count).toBe(3);
      const hits = rig.events('damage').slice(-2).map(({ e }) => [e.targetId, e.amount]);
      expect(hits).toEqual([[2, 20], [3, 20]]);
      expect(rig.events('projectileExpired').at(-1)?.e.reason).toBe('lifetime');
      rig.clean();
    });
  });

  describe('Fade Step spends the Focus', () => {
    it('with 3 Focus cuts 360 ticks from Tumble on top of its tick, shields 25 for 180 and clears the count', () => {
      const rig = new Rig(wrenna, { 2: FOE });
      buildFocus(rig, 3);
      champion(rig.state, 0).cooldowns[SPACE] = 540;
      rig.step(press('R'));
      expect(champion(rig.state, 0).cooldowns[SPACE]).toBe(540 - 1 - 360);
      expect(rig.applied().at(-1)).toEqual([0, 'shield', 180]);
      expect(rig.statuses(0)).toEqual([{ type: 'shield', absorb: 25 }]);
      expect(focus(rig)).toEqual({ count: 0, lastHitTick: 0 });
      expect(champion(rig.state, 0).cooldowns[SLOTS.indexOf('R')]).toBe(780);
      rig.clean();
    });

    it('with 2 Focus cuts 240 ticks', () => {
      const rig = new Rig(wrenna, { 2: FOE });
      buildFocus(rig, 2);
      champion(rig.state, 0).cooldowns[SPACE] = 540;
      rig.step(press('R'));
      expect(champion(rig.state, 0).cooldowns[SPACE]).toBe(540 - 1 - 240);
      expect(focus(rig)).toEqual({ count: 0, lastHitTick: 0 });
      rig.clean();
    });

    it('cuts on the step that another cast finishes its windup too: the oracle reads every cast fired', () => {
      const rig = new Rig(wrenna, { 2: FOE });
      buildFocus(rig, 2);
      champion(rig.state, 0).cooldowns[SPACE] = 540;
      rig.step(press('M2'));
      rig.run(17);
      expect(rig.events('castFired').at(-1)?.e.slot).toBe('M1');
      rig.step(press('R'));
      expect(rig.events('castFired').slice(-2).map(({ e }) => e.slot)).toEqual(['M2', 'R']);
      expect(champion(rig.state, 0).cooldowns[SPACE]).toBe(540 - 19 - 240);
      expect(focus(rig)).toEqual({ count: 0, lastHitTick: 0 });
      rig.clean();
    });

    it('brings a Tumble under 360 ticks to 0 and never below', () => {
      const rig = new Rig(wrenna, { 2: FOE });
      buildFocus(rig, 3);
      champion(rig.state, 0).cooldowns[SPACE] = 200;
      rig.step(press('R'));
      expect(champion(rig.state, 0).cooldowns[SPACE]).toBe(0);
      rig.clean();
    });

    it('with no Focus is a plain shield and Tumble only ticks down', () => {
      const rig = new Rig(wrenna);
      champion(rig.state, 0).cooldowns[SPACE] = 300;
      rig.step(press('R'));
      expect(champion(rig.state, 0).cooldowns[SPACE]).toBe(299);
      expect(rig.statuses(0)).toEqual([{ type: 'shield', absorb: 25 }]);
      expect(focus(rig)).toEqual({ count: 0, lastHitTick: 0 });
      rig.clean();
    });
  });

  it('F Arrow Storm lands where it is aimed and pulses on steps 36, 66, 96 and 126: 12 damage and a slow each', () => {
    const rig = new Rig(wrenna, { 2: FOE, 3: [X0 + 8, 3.6] }, 100);
    rig.run(36 + 120, press('F', { aim: FOE }));
    const [spawned] = rig.events('areaSpawned');
    expect(spawned?.step).toBe(36);
    expect(spawned?.e.x).toBeCloseTo(X0 + 8, 9);
    expect(spawned?.e.radius).toBe(3);
    expect(rig.events('areaTick').map(({ step, e }) => [step, e.targetIds])).toEqual([
      [36, [2]],
      [66, [2]],
      [96, [2]],
      [126, [2]],
    ]);
    expect(damages(rig)).toEqual([[2, 12, 108], [2, 12, 96], [2, 12, 84], [2, 12, 72]]);
    expect(rig.applied().filter(([, status]) => status === 'slow')).toEqual([[2, 'slow', 60], [2, 'slow', 60], [2, 'slow', 60], [2, 'slow', 60]]);
    expect(rig.events('areaExpired').map(({ step }) => step)).toEqual([155]);
    expect(rig.health(3)).toBe(120);
    rig.clean();
  });

  it('F Arrow Storm aimed far ahead lands 13 m away', () => {
    const rig = new Rig(wrenna, {}, 100);
    rig.run(36 + 1, press('F', { aim: [X0 + 20, 0] }));
    expect(rig.events('areaSpawned')[0]?.e.x).toBeCloseTo(X0 + 13, 9);
    rig.clean();
  });

  it('keeps one lingering area, Arrow Storm, and no wound', () => {
    expect(lingeringPaths(wrenna)).toEqual(['wrenna.slots.F.effects[0]']);
    expect(woundPaths(wrenna)).toEqual([]);
  });
});
