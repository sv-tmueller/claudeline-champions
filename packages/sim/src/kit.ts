import {
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
      effects: Effect[];
    }
  | {
      type: 'area';
      placement: AreaPlacement;
      radius: number;
      durationTicks: number;
      intervalTicks: number;
      targets: AreaTargets;
      effects: Effect[];
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

function readEffect(value: unknown, path: string, inThen: boolean): AbilityEffect {
  const effect = readObject(value, path);
  const at = (key: string) => `${path}.${key}`;
  const type: unknown = effect['type'];
  switch (type) {
    case 'projectile': {
      const pierce = readBoolean(effect['pierce'], at('pierce'));
      return {
        type,
        speed: readMagnitude(effect['speed'], at('speed')),
        radius: readMagnitude(effect['radius'], at('radius')),
        lifetimeTicks: readTicks(effect['lifetimeTicks'], at('lifetimeTicks')),
        pierce,
        effects: readHitEffects(effect['effects'], at('effects')),
      };
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
      const targets: unknown = effect['targets'];
      if (targets !== 'enemies' && targets !== 'allies' && targets !== 'all') {
        return fail(at('targets'), `unknown targets ${String(targets)}`);
      }
      return {
        type,
        placement,
        radius,
        durationTicks,
        intervalTicks,
        targets,
        effects: readHitEffects(effect['effects'], at('effects')),
      };
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

  return { id, maxHealth, moveSpeed, support, slots, ex: [first, second] };
}
