import {
  COUNTER_MAX_CAP,
  COUNTER_MAX_WINDOW_TICKS,
  COUNTER_MIN_WINDOW_TICKS,
  MAX_DASH_DISTANCE,
  MAX_STATUS_TICKS,
  MIN_DASH_DISTANCE,
} from './constants';
import { copyEffects } from './health';
import { SLOTS } from './input';
import type { Slot } from './input';
import { MAGNITUDE_PROBLEM, TICKS_PROBLEM, copyStatusSpec, isMagnitude, isStatusTicks } from './status';
import type { AreaTargets, Effect, StatusSpec } from './state';

/** How a champion may walk while an ability winds up. */
export type MovementRule = 'free' | 'slowed' | 'locked';

/** Where an `area` effect is centred, measured from the caster's position at the time it fires. */
export type AreaPlacement =
  | { type: 'self' }
  /** `distance` meters along the fire direction. */
  | { type: 'ahead'; distance: number }
  /** At the aim point, or `range` meters toward it when the aim is farther. */
  | { type: 'aim'; range: number };

/**
 * Spec 4.3: the payload of a projectile's `endArea`, the fields of an `area` but its `placement`.
 * The spawned area obeys every area rule, the fuse (rules 2.7) included.
 */
export interface EndAreaSpec {
  radius: number;
  durationTicks: number;
  intervalTicks: number;
  targets: AreaTargets;
  effects: Effect[];
  /** Rules 2.7: read as on any area. The key is left out when there is none. */
  fuseTicks?: number;
}

/**
 * One step of an ability. A closed union run by a `switch` in `cast.ts`: the toolkit, not a
 * scripting language. Hit effects (`effects` on a projectile, area or arc) land on the champions
 * the entity touches; `applyStatus`, `shield` and `heal` at this level land on the caster.
 */
export type AbilityEffect =
  | {
      type: 'projectile';
      /** Meters per second. */
      speed: number;
      radius: number;
      lifetimeTicks: number;
      pierce: boolean;
      /** Lands on the other team; may be empty when `allyEffects` is given. */
      effects: Effect[];
      /**
       * Lands on the owner's team, never the owner in flight; a self-aimed cast applies them to
       * the caster (cast.ts). When present it is not empty, and an empty `effects` makes the
       * projectile pass enemies. The key is left out when there is none.
       */
      allyEffects?: Effect[];
      /**
       * Spec 4.3: an area (the `area` payload without `placement`) spawned where the projectile
       * ends: at the end of its lifetime, on a blocking obstacle or on the arena edge, never on a
       * champion hit. Rejected together with `pierce`. The key is left out when there is none.
       */
      endArea?: EndAreaSpec;
    }
  | {
      type: 'area';
      placement: AreaPlacement;
      radius: number;
      durationTicks: number;
      intervalTicks: number;
      targets: AreaTargets;
      effects: Effect[];
      /**
       * Rules 2.7: ticks from the cast to the first pulse, an area that is visible and inert until
       * then. `validateKit` takes 1 to 36000; the roster walker holds a kit to 15 to 120. The key
       * is left out when there is none, and on any other effect it is not read.
       */
      fuseTicks?: number;
    }
  | {
      type: 'meleeArc';
      radius: number;
      /** Cosine of the half-angle, a decimal literal in the kit; -1 is a full circle. */
      cosHalfAngle: number;
      effects: Effect[];
    }
  | {
      type: 'dash';
      /** Meters over `ticks`, moving the caster along the fire direction in step 3f. */
      distance: number;
      ticks: number;
      /** Effects fired where the dash ends. A dash cannot appear inside it. */
      then: ThenEffect[];
    }
  | {
      type: 'teleport';
      range: number;
      /** Fixed goes exactly `range` meters; otherwise as far as the aim, up to `range`. */
      fixed: boolean;
    }
  | { type: 'applyStatus'; status: StatusSpec }
  | { type: 'shield'; absorb: number; ticks: number }
  | { type: 'heal'; amount: number };

/** What a dash may fire at its end: everything but another dash. */
export type ThenEffect = Exclude<AbilityEffect, { type: 'dash' }>;

export interface AbilitySpec {
  /** Turns of the caster before the effects fire; 0 fires them in the turn the cast starts. */
  windupTicks: number;
  movement: MovementRule;
  effects: AbilityEffect[];
}

/** An ability slot: its cooldown is shared with its EX variant, which lists what it replaces. */
export type SlotSpec = AbilitySpec & {
  cooldownTicks: number;
  ex?: AbilitySpec;
};

/**
 * The on-hit counter a kit may declare (rules.md section 2.6): a hit by the `from` slot that lands
 * on an enemy adds one, up to `cap` (1 to 5), and the count resets when `windowTicks` (60 to 600)
 * pass with no such hit.
 */
export interface CounterSpec {
  from: Slot;
  cap: number;
  windowTicks: number;
}

export interface KitDef {
  /** Matches `PlayerConfig.championId`. */
  id: string;
  maxHealth: number;
  /** Meters per second before statuses. */
  moveSpeed: number;
  /** Whether healing allies earns energy. */
  support: boolean;
  slots: Record<Slot, SlotSpec>;
  /** The two slots with an EX variant; never F. */
  ex: [Slot, Slot];
  /** The one on-hit counter of the kit; the key is left out when there is none. */
  counter?: CounterSpec;
}

type Json = Record<string, unknown>;

function fail(path: string, problem: string): never {
  throw new Error(`Invalid kit: ${path}: ${problem}`);
}

function readObject(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'expected an object');
  }
  return value as Json;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path, 'expected a boolean');
  return value;
}

/** A number above 0 and at most `MAX_MAGNITUDE`: what every primitive takes for a size or a range. */
function readMagnitude(value: unknown, path: string): number {
  if (!isMagnitude(value)) return fail(path, `${String(value)} ${MAGNITUDE_PROBLEM}`);
  return value;
}

/** An integer from 1 to `MAX_STATUS_TICKS`. */
function readTicks(value: unknown, path: string): number {
  if (!isStatusTicks(value)) return fail(path, `${String(value)} ${TICKS_PROBLEM}`);
  return value;
}

/** An integer from 0 to `MAX_STATUS_TICKS`: a windup. */
function readWindup(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_STATUS_TICKS) {
    return fail(path, `${String(value)} is not an integer from 0 to ${MAX_STATUS_TICKS}`);
  }
  return value;
}

function readSlot(value: unknown, path: string): Slot {
  if (typeof value !== 'string' || !SLOTS.includes(value as Slot)) {
    return fail(path, `unknown slot ${String(value)}`);
  }
  return value as Slot;
}

function readHitEffects(value: unknown, path: string): Effect[] {
  if (Array.isArray(value) && value.length === 0) return fail(path, 'must not be empty');
  return copyEffects(value as Effect[], (problem) => fail(path, problem));
}

/** The `targets` of an area or an `endArea`; one of the three team words. */
function readTargets(value: unknown, path: string): AreaTargets {
  if (value !== 'enemies' && value !== 'allies' && value !== 'all') {
    return fail(path, `unknown targets ${String(value)}`);
  }
  return value;
}

function readEffect(value: unknown, path: string, inThen: boolean): AbilityEffect {
  const effect = readObject(value, path);
  const at = (key: string) => `${path}.${key}`;
  const type: unknown = effect['type'];
  if (type !== 'projectile' && effect['allyEffects'] !== undefined) {
    return fail(at('allyEffects'), 'only a projectile carries allyEffects');
  }
  switch (type) {
    case 'projectile': {
      const pierce = readBoolean(effect['pierce'], at('pierce'));
      const speed = readMagnitude(effect['speed'], at('speed'));
      const radius = readMagnitude(effect['radius'], at('radius'));
      const lifetimeTicks = readTicks(effect['lifetimeTicks'], at('lifetimeTicks'));
      const ally = effect['allyEffects'];
      // With an ally list, `effects` may be empty; the ally list itself never is.
      const effects =
        ally === undefined
          ? readHitEffects(effect['effects'], at('effects'))
          : copyEffects(effect['effects'] as Effect[], (problem) => fail(at('effects'), problem));
      const projectile: Extract<AbilityEffect, { type: 'projectile' }> = {
        type,
        speed,
        radius,
        lifetimeTicks,
        pierce,
        effects,
      };
      if (ally !== undefined) projectile.allyEffects = readHitEffects(ally, at('allyEffects'));
      if (effect['endArea'] !== undefined) {
        // Spec 4.3: the two are disjoint; keep it disjoint here rather than in the sweep.
        if (pierce) return fail(at('endArea'), 'a piercing projectile cannot carry an endArea');
        // The area payload without `placement`; unknown keys, `placement` included, are dropped.
        const area = readObject(effect['endArea'], at('endArea'));
        const areaAt = (key: string) => `${at('endArea')}.${key}`;
        const endArea: EndAreaSpec = {
          radius: readMagnitude(area['radius'], areaAt('radius')),
          durationTicks: readTicks(area['durationTicks'], areaAt('durationTicks')),
          intervalTicks: readTicks(area['intervalTicks'], areaAt('intervalTicks')),
          targets: readTargets(area['targets'], areaAt('targets')),
          effects: readHitEffects(area['effects'], areaAt('effects')),
        };
        if (area['fuseTicks'] !== undefined) {
          endArea.fuseTicks = readTicks(area['fuseTicks'], areaAt('fuseTicks'));
        }
        projectile.endArea = endArea;
      }
      return projectile;
    }
    case 'area': {
      const place = readObject(effect['placement'], at('placement'));
      const kind: unknown = place['type'];
      let placement: AreaPlacement;
      if (kind === 'self') placement = { type: 'self' };
      else if (kind === 'ahead') {
        placement = { type: 'ahead', distance: readMagnitude(place['distance'], at('placement.distance')) };
      } else if (kind === 'aim') {
        placement = { type: 'aim', range: readMagnitude(place['range'], at('placement.range')) };
      } else return fail(at('placement'), `unknown placement type ${String(kind)}`);
      const radius = readMagnitude(effect['radius'], at('radius'));
      const durationTicks = readTicks(effect['durationTicks'], at('durationTicks'));
      const intervalTicks = readTicks(effect['intervalTicks'], at('intervalTicks'));
      const targets = readTargets(effect['targets'], at('targets'));
      const area: Extract<AbilityEffect, { type: 'area' }> = {
        type,
        placement,
        radius,
        durationTicks,
        intervalTicks,
        targets,
        effects: readHitEffects(effect['effects'], at('effects')),
      };
      if (effect['fuseTicks'] !== undefined) area.fuseTicks = readTicks(effect['fuseTicks'], at('fuseTicks'));
      return area;
    }
    case 'meleeArc': {
      const radius = readMagnitude(effect['radius'], at('radius'));
      const cos = effect['cosHalfAngle'];
      if (typeof cos !== 'number' || !(cos >= -1 && cos <= 1)) {
        return fail(at('cosHalfAngle'), `${String(cos)} is not a number from -1 to 1`);
      }
      return {
        type,
        radius,
        cosHalfAngle: cos + 0,
        effects: readHitEffects(effect['effects'], at('effects')),
      };
    }
    case 'dash': {
      if (inThen) return fail(path, 'a dash cannot be inside then');
      const { distance } = effect;
      if (typeof distance !== 'number' || !(distance >= MIN_DASH_DISTANCE && distance <= MAX_DASH_DISTANCE)) {
        return fail(
          at('distance'),
          `${String(distance)} is not a number from ${MIN_DASH_DISTANCE} to ${MAX_DASH_DISTANCE}`,
        );
      }
      const ticks = readTicks(effect['ticks'], at('ticks'));
      const then = effect['then'];
      if (!Array.isArray(then)) return fail(at('then'), 'expected an array');
      return {
        type,
        distance,
        ticks,
        then: then.map((item, i) => readEffect(item, `${at('then')}[${i}]`, true) as ThenEffect),
      };
    }
    case 'teleport':
      return {
        type,
        range: readMagnitude(effect['range'], at('range')),
        fixed: readBoolean(effect['fixed'], at('fixed')),
      };
    case 'applyStatus':
      return {
        type,
        status: copyStatusSpec(effect['status'] as StatusSpec, (problem) => fail(at('status'), problem)),
      };
    case 'shield':
      return {
        type,
        absorb: readMagnitude(effect['absorb'], at('absorb')),
        ticks: readTicks(effect['ticks'], at('ticks')),
      };
    case 'heal':
      return { type, amount: readMagnitude(effect['amount'], at('amount')) };
    default:
      return fail(path, `unknown effect type ${String(type)}`);
  }
}

function readEffects(value: unknown, path: string): AbilityEffect[] {
  if (!Array.isArray(value)) return fail(path, 'expected an array');
  if (value.length === 0) return fail(path, 'must not be empty');
  return value.map((item, i) => readEffect(item, `${path}[${i}]`, false));
}

/** An integer from `min` to `max`, for the counter's cap and window. */
function readCounterInt(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fail(path, `${String(value)} is not an integer from ${min} to ${max}`);
  }
  return value;
}

/** The kit's one on-hit counter, as a copy that holds the three fields and nothing else. */
function readCounter(value: unknown, path: string): CounterSpec {
  if (Array.isArray(value)) return fail(path, 'a kit has one counter, not a list');
  const counter = readObject(value, path);
  return {
    from: readSlot(counter['from'], `${path}.from`),
    cap: readCounterInt(counter['cap'], `${path}.cap`, 1, COUNTER_MAX_CAP),
    windowTicks: readCounterInt(
      counter['windowTicks'],
      `${path}.windowTicks`,
      COUNTER_MIN_WINDOW_TICKS,
      COUNTER_MAX_WINDOW_TICKS,
    ),
  };
}

function readAbility(value: unknown, path: string): AbilitySpec {
  const spec = readObject(value, path);
  const windupTicks = readWindup(spec['windupTicks'], `${path}.windupTicks`);
  const movement: unknown = spec['movement'];
  if (movement !== 'free' && movement !== 'slowed' && movement !== 'locked') {
    return fail(`${path}.movement`, `unknown movement rule ${String(movement)}`);
  }
  return { windupTicks, movement, effects: readEffects(spec['effects'], `${path}.effects`) };
}

/**
 * Checks a kit and returns a deep copy, built field by field so nothing of the caller's object is
 * aliased and no field outside the contract is kept. Throws `Invalid kit: <path>: <problem>`.
 *
 * Every number is held inside what the primitive that receives it accepts, so that no kit can make
 * a toolkit call throw inside `step`: a throw there would leave the tick half applied. Catalog
 * ranges (a stun of 30 to 120 ticks, damage of 8 to 30) are not checked here; roster tests do
 * that. A teleport range stops at `MAX_MAGNITUDE`, well below `MAX_TELEPORT_METERS`: near that
 * limit the rounded `origin + dir * range` can land an ulp past the primitive's per-axis check.
 */
export function validateKit(kit: unknown): KitDef {
  const root = readObject(kit, '(root)');
  const id = root['id'];
  if (typeof id !== 'string' || id === '') return fail('id', 'expected a non-empty string');
  const at = (key: string) => `${id}.${key}`;

  const maxHealth = readMagnitude(root['maxHealth'], at('maxHealth'));
  const moveSpeed = readMagnitude(root['moveSpeed'], at('moveSpeed'));
  const support = readBoolean(root['support'], at('support'));

  const exList = root['ex'];
  if (!Array.isArray(exList) || exList.length !== 2) {
    return fail(at('ex'), 'must hold two different slots');
  }
  const first = readSlot(exList[0], at('ex'));
  const second = readSlot(exList[1], at('ex'));
  if (first === second) return fail(at('ex'), 'must hold two different slots');
  if (first === 'F' || second === 'F') return fail(at('ex'), 'the ultimate F has no EX variant');

  const given = readObject(root['slots'], at('slots'));
  const slots = {} as Record<Slot, SlotSpec>;
  for (const slot of SLOTS) {
    const path = at(`slots.${slot}`);
    const raw = given[slot];
    if (raw === undefined) return fail(path, 'missing');
    const spec = readObject(raw, path);
    const cooldownTicks = readTicks(spec['cooldownTicks'], `${path}.cooldownTicks`);
    const ability = readAbility(spec, path);
    const listed = slot === first || slot === second;
    const exRaw = spec['ex'];
    if (listed && exRaw === undefined) return fail(`${path}.ex`, `missing, but ex lists ${slot}`);
    if (!listed && exRaw !== undefined) {
      return fail(`${path}.ex`, `${slot} has an EX variant but is not in ex`);
    }
    slots[slot] =
      exRaw === undefined
        ? { cooldownTicks, ...ability }
        : { cooldownTicks, ...ability, ex: readAbility(exRaw, `${path}.ex`) };
  }

  const kitDef: KitDef = { id, maxHealth, moveSpeed, support, slots, ex: [first, second] };
  // The key is left out, never undefined: `checksum` throws on an undefined value.
  if (root['counter'] !== undefined) kitDef.counter = readCounter(root['counter'], at('counter'));
  return kitDef;
}
