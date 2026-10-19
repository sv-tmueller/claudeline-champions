// The roster kits as data: `data/kits/hargrim.json`, `quillon.json`, `skerrow.json`, `lumeth.json`,
// `ondrel.json` and `brimwick.json`, whose numbers come from docs/design/roster-v1.md and
// docs/design/roster-v2.md (ticks = seconds x 60, one hit = durationTicks 1 / intervalTicks 1, and
// the lingering areas of Ondrel carry the three rules of roster-v2 section 0).
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
import { Button, SLOTS, createMatch, step } from '../src/index';
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
];

const hargrim = validateKit(hargrimJson);
const quillon = validateKit(quillonJson);
const skerrow = validateKit(skerrowJson);
const lumeth = validateKit(lumethJson);
const ondrel = validateKit(ondrelJson);
const brimwick = validateKit(brimwickJson);

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
}

function visitAbility(prefix: string, slot: Slot, ability: AbilitySpec, out: Visit[]): void {
  const visit = (effect: AbilityEffect, path: string) => {
    out.push({ path, slot, effect });
    if (effect.type === 'projectile' || effect.type === 'area' || effect.type === 'meleeArc') {
      effect.effects.forEach((hit, i) => out.push({ path: `${path}.effects[${i}]`, slot, effect: hit }));
    }
    if (effect.type === 'projectile') {
      effect.allyEffects?.forEach((hit, i) => out.push({ path: `${path}.allyEffects[${i}]`, slot, effect: hit }));
    }
    if (effect.type === 'dash') effect.then.forEach((t, i) => visit(t, `${path}.then[${i}]`));
  };
  ability.effects.forEach((effect, i) => visit(effect, `${prefix}.effects[${i}]`));
}

function visitKit(kit: KitDef): Visit[] {
  const out: Visit[] = [];
  for (const slot of SLOTS) {
    const spec = kit.slots[slot];
    visitAbility(`${kit.id}.slots.${slot}`, slot, spec, out);
    if (spec.ex) visitAbility(`${kit.id}.slots.${slot}.ex`, slot, spec.ex, out);
  }
  return out;
}

/** Every number the kit has outside the ranges of rules.md section 4.1 and spec section 10. */
function catalogProblems(kit: KitDef): string[] {
  const problems: string[] = [];
  const within = (value: number, low: number, high: number) => value >= low && value <= high;
  const bad = (path: string, what: string) => problems.push(`${path}: ${what}`);

  if (!within(kit.maxHealth, 120, 160) || kit.maxHealth % 10 !== 0) {
    bad(`${kit.id}.maxHealth`, `${kit.maxHealth} is not 120 to 160 in steps of 10`);
  }
  if (kit.moveSpeed !== 5.5) bad(`${kit.id}.moveSpeed`, `${kit.moveSpeed} is not 5.5`);
  if (kit.slots.F.cooldownTicks !== 600) bad(`${kit.id}.slots.F.cooldownTicks`, 'the ultimate cooldown is not 600');

  for (const { path, slot, effect } of visitKit(kit)) {
    switch (effect.type) {
      case 'damage':
      case 'heal': {
        const top = slot === 'F' ? 60 : 30;
        if (!within(effect.amount, 8, top)) bad(`${path}.amount`, `${effect.type} ${effect.amount} is not 8 to ${top}`);
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
      case 'area': {
        // The three lingering-area rules of roster-v2 section 0; a one-hit area is outside them.
        if (effect.durationTicks <= 1) break;
        // An area acts in the step it spawns and then every intervalTicks: ceil(D / I) pulses (area.ts).
        const pulses = Math.ceil(effect.durationTicks / effect.intervalTicks);
        const top = slot === 'F' ? 60 : 30;
        for (const type of ['damage', 'heal']) {
          const hits = effect.effects.filter((hit): hit is Extract<Effect, { amount: number }> => hit.type === type);
          if (hits.length === 0) continue;
          const total = hits.reduce((sum, hit) => sum + hit.amount, 0) * pulses;
          if (!within(total, 8, top)) bad(path, `${type} total ${total} over ${pulses} pulses is not 8 to ${top}`);
        }
        if (pulses > 1) {
          effect.effects.forEach((hit, k) => {
            if (hit.type !== 'applyStatus') return;
            const lock = hit.status.type;
            if (lock === 'stun' || lock === 'root' || lock === 'silence') {
              bad(`${path}.effects[${k}].status`, `a pulsing area carries ${lock}`);
            }
          });
        }
        // The EX variant shares the cooldown of its slot (SlotSpec), so one lookup serves both.
        const cooldown = kit.slots[slot].cooldownTicks;
        if (effect.durationTicks >= cooldown) {
          bad(`${path}.durationTicks`, `${effect.durationTicks} ticks is not under the ${slot} cooldown of ${cooldown}`);
        }
        break;
      }
      case 'projectile':
        if (!within(effect.speed, 12, 25)) bad(`${path}.speed`, `projectile speed ${effect.speed} is not 12 to 25`);
        if (!within(effect.radius, 0.2, 0.6)) bad(`${path}.radius`, `projectile radius ${effect.radius} is not 0.2 to 0.6`);
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

  it('keep the Hargrim M1 cosine the 10-decimal literal of cos 50 degrees', () => {
    const arc = hargrim.slots.M1.effects[0];
    if (arc?.type !== 'meleeArc') throw new Error('Hargrim M1 is not a meleeArc');
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

describe('every slot of the six kits', () => {
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
