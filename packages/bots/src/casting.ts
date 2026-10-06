import { Button, CHAMPION_RADIUS, EX_ENERGY_COST, SLOTS, ULTIMATE_ENERGY_COST } from '@claudeline/sim';
import type { AbilitySpec, ChampionState, GameState, KitDef, Slot, StatusType } from '@claudeline/sim';
import { distanceInto } from './hypot';
import type { Measure } from './hypot';
import { profileFor, rulesFor } from './profile';
import type { BotProfile } from './profile';
import { RANGE_MARGIN, abilityReach } from './reach';
import { clearShotWith } from './sight';
import type { SightScratch } from './sight';

// Casting: which slot a bot presses on a think. The gates copy steps 3b to 3d of the sim's `step`
// (cooldowns count down, then a windup fires at 1, then a new cast may start), read on the state
// the bot thinks on. Not named `cast.ts`: the sim has one.

/** A slot to press and whether to hold SHIFT for its EX variant. A bot owns one and rewrites it. */
export interface CastChoice {
  slot: Slot;
  ex: boolean;
}

/** The kit of a champion, found by its champion id on every think; undefined when it has none. */
export function findKit(state: GameState, championId: string): KitDef | undefined {
  const { kits } = state;
  for (let i = 0; i < kits.length; i++) {
    const kit = kits[i] as KitDef;
    if (kit.id === championId) return kit;
  }
  return undefined;
}

/**
 * What a bot derives from a kit, kept so a think does not derive it again: per slot (in SLOTS
 * order) the reach band of the base ability and of its EX variant, the width of the shot of each,
 * and the profile. It is rebuilt when the kit found is another object or the champion id
 * changes, an identity check like the navigation grid's arena check. A kit mutated in place is
 * not supported.
 *
 * The numbers live in typed arrays and in one profile object whose fields are always doubles. A
 * `{ min, max }` object holds 0 as a small integer in one band and 1.5 as a double in another, and
 * V8 boxes (16 B) a double it loads from some of those fields.
 */
export interface KitCache {
  built: boolean;
  /** The kit the cache was built from, undefined for a champion without one. */
  kit: KitDef | undefined;
  championId: string;
  /** Rewritten in place on a rebuild, so its fields keep one representation. */
  profile: BotProfile;
  /** 1 when the base ability of the slot has a reach band. */
  hasBase: Uint8Array;
  baseMin: Float64Array;
  baseMax: Float64Array;
  /** The width of the shot of the base ability, see `clearanceOf`. */
  baseClearance: Float64Array;
  /**
   * 1 when the slot is an EX slot of the kit (listed in `kit.ex`, has a variant, is not F) and
   * the variant has a reach band.
   */
  hasEx: Uint8Array;
  exMin: Float64Array;
  exMax: Float64Array;
  exClearance: Float64Array;
  /**
   * 1 when the slot has an opener (see `OpenerRule`) with a band of its own: the base ability is
   * tested against [openMin, openMax], inclusive and with no range margin, instead of its kit band.
   */
  hasOpen: Uint8Array;
  openMin: Float64Array;
  openMax: Float64Array;
  /**
   * What the target must be doing for the base ability of the slot: +1 walking away from the bot,
   * -1 walking toward it, 0 anything. An EX press has no such condition.
   */
  motion: Int8Array;
  /** The slots of the escape rule in priority order, as indices into SLOTS, ended by -1. */
  escapeOrder: Int8Array;
  /** 1 when the slot is in `escapeOrder`. */
  isEscape: Uint8Array;
  /**
   * The teleport an escape slot starts with, when its first effect is one: its range in metres
   * (0 when the slot has none) and whether the range is fixed (it teleports the full range
   * whatever the aim distance).
   */
  escapeRange: Float64Array;
  escapeFixed: Uint8Array;
}

/**
 * What a think works out once and the run test and the cast choice read, in fields that start as
 * doubles. A bot owns one.
 */
export interface CastCues {
  /**
   * (target - bot) . target velocity: positive when the target walks away from the bot, negative
   * when it walks toward it, 0 when it stands or walks across.
   */
  dot: number;
  /**
   * True on an escape think: the acted intent is retreat with the target within `ESCAPE_RANGE`,
   * or kite with the target inside rangeMin (see `ESCAPE_RANGE` in escape.ts). Set by the bot
   * before `updateRuns`.
   */
  escape: boolean;
}

export function createCastCues(): CastCues {
  return { dot: 0.5, escape: false };
}

export function createKitCache(): KitCache {
  return {
    built: false,
    kit: undefined,
    championId: '',
    profile: { rangeMin: 0.5, rangeMax: 0.5 },
    hasBase: new Uint8Array(SLOTS.length),
    baseMin: new Float64Array(SLOTS.length),
    baseMax: new Float64Array(SLOTS.length),
    baseClearance: new Float64Array(SLOTS.length),
    hasEx: new Uint8Array(SLOTS.length),
    exMin: new Float64Array(SLOTS.length),
    exMax: new Float64Array(SLOTS.length),
    exClearance: new Float64Array(SLOTS.length),
    hasOpen: new Uint8Array(SLOTS.length),
    openMin: new Float64Array(SLOTS.length),
    openMax: new Float64Array(SLOTS.length),
    motion: new Int8Array(SLOTS.length),
    escapeOrder: new Int8Array(SLOTS.length).fill(-1),
    isEscape: new Uint8Array(SLOTS.length),
    escapeRange: new Float64Array(SLOTS.length),
    escapeFixed: new Uint8Array(SLOTS.length),
  };
}

/** Rebuilds the cache when `kit` or `championId` differs from the one it was built for. */
export function refreshKitCache(
  cache: KitCache,
  kit: KitDef | undefined,
  championId: string,
): void {
  if (cache.built && cache.kit === kit && cache.championId === championId) return;
  cache.built = true;
  cache.kit = kit;
  cache.championId = championId;
  const profile = profileFor(championId, kit);
  cache.profile.rangeMin = profile.rangeMin;
  cache.profile.rangeMax = profile.rangeMax;
  const rules = rulesFor(championId, kit);
  for (let i = 0; i < SLOTS.length; i++) {
    cache.hasBase[i] = 0;
    cache.hasEx[i] = 0;
    cache.hasOpen[i] = 0;
    cache.motion[i] = 0;
    cache.isEscape[i] = 0;
    cache.escapeRange[i] = 0;
    cache.escapeFixed[i] = 0;
    if (kit === undefined) continue;
    const slot = SLOTS[i] as Slot;
    const spec = kit.slots[slot];
    const base = abilityReach(spec);
    if (base !== null) {
      cache.hasBase[i] = 1;
      cache.baseMin[i] = base.min;
      cache.baseMax[i] = base.max;
    }
    cache.baseClearance[i] = clearanceOf(spec);
    const variant = spec.ex;
    if (variant !== undefined && slot !== 'F' && kit.ex.includes(slot)) {
      const band = abilityReach(variant);
      if (band !== null) {
        cache.hasEx[i] = 1;
        cache.exMin[i] = band.min;
        cache.exMax[i] = band.max;
      }
      cache.exClearance[i] = clearanceOf(variant);
    }
  }
  for (const opener of rules.openers) {
    if (kit === undefined) break;
    const i = SLOTS.indexOf(opener.slot);
    cache.motion[i] = opener.motion === 'away' ? 1 : opener.motion === 'closing' ? -1 : 0;
    const band = opener.band === 'dash' ? dashBand(kit.slots[opener.slot]) : opener.band;
    if (band === null) continue;
    cache.hasOpen[i] = 1;
    cache.openMin[i] = band[0];
    cache.openMax[i] = band[1];
  }
  cache.escapeOrder.fill(-1);
  let n = 0;
  for (const slot of rules.escapes) {
    if (kit === undefined) break;
    const i = SLOTS.indexOf(slot);
    cache.escapeOrder[n++] = i;
    cache.isEscape[i] = 1;
    const first = kit.slots[slot].effects[0];
    if (first !== undefined && first.type === 'teleport') {
      cache.escapeRange[i] = first.range;
      cache.escapeFixed[i] = first.fixed ? 1 : 0;
    }
  }
}

/**
 * The opener band of a base ability that starts with a dash of distance D and has no band of its
 * own: [D - 1, D], with no range margin. Its windup is 0, so the target cannot walk out of reach
 * before it fires, and at D the dash ends against the target's body. Null for any other ability.
 */
export function dashBand(spec: AbilitySpec): readonly [number, number] | null {
  const first = spec.effects[0];
  if (first === undefined || first.type !== 'dash' || abilityReach(spec) !== null) return null;
  return [first.distance - 1, first.distance];
}

export function hasStatus(me: ChampionState, type: StatusType): boolean {
  for (let i = 0; i < me.statuses.length; i++) {
    if ((me.statuses[i] as { type: StatusType }).type === type) return true;
  }
  return false;
}

export function hasDash(ability: AbilitySpec): boolean {
  for (let i = 0; i < ability.effects.length; i++) {
    if ((ability.effects[i] as { type: string }).type === 'dash') return true;
  }
  return false;
}

/** The slot index of F. */
const F_INDEX = SLOTS.indexOf('F');

/**
 * The energy from which the EX variants are held while F is ready: what F costs less what one EX
 * press spends, so the bar can reach the cost of F instead of falling back by an EX cast first.
 */
const EX_RESERVE_ENERGY = ULTIMATE_ENERGY_COST - EX_ENERGY_COST;

/**
 * Whether the slot at `index` would cast its EX variant on this think: the slot is listed in
 * `kit.ex`, has a variant with a reach band (the cache holds one only then), the champion has
 * the energy, and F is not holding the energy back. F holds it back while it is ready (its
 * cooldown is at most 1, as the cast gate reads it), its base ability has a reach band and the
 * energy is at least `EX_RESERVE_ENERGY`: a support ultimate that reaches allies only has no band
 * and must not freeze the EX variants for good. F never has an EX variant.
 */
function exFor(cache: KitCache, index: number, me: ChampionState): boolean {
  if (cache.hasEx[index] !== 1 || me.energy < EX_ENERGY_COST) return false;
  const holding =
    cache.hasBase[F_INDEX] === 1 &&
    (me.cooldowns[F_INDEX] as number) <= 1 &&
    me.energy >= EX_RESERVE_ENERGY;
  return !holding;
}

/**
 * The width of the shot of an ability: the radius of its first top-level projectile, or the
 * champion radius when it has none.
 */
export function clearanceOf(spec: AbilitySpec): number {
  for (let i = 0; i < spec.effects.length; i++) {
    const effect = spec.effects[i];
    if (effect !== undefined && effect.type === 'projectile') return effect.radius;
  }
  return CHAMPION_RADIUS;
}

/**
 * Counts, per slot, the consecutive thinks on which the target was inside the band of the ability
 * the slot would cast, with a clear shot of that ability's width, this think included. Anything
 * else puts the count back to 0. It ignores cooldown, energy, status and windup, so a slot that
 * comes off cooldown while the target stays in reach is pressed on the first tick the sim would
 * cast it. Allocates nothing: the bands come from the cache and the shot uses `scratch`.
 */
export function updateRuns(
  runs: number[],
  state: GameState,
  cache: KitCache,
  me: ChampionState,
  target: ChampionState,
  scratch: SightScratch,
  dist: Measure,
  cues: CastCues,
): void {
  distanceInto(dist, me, target);
  const d = dist.metres;
  cues.dot = (target.x - me.x) * target.vx + (target.y - me.y) * target.vy;
  for (let i = 0; i < SLOTS.length; i++) {
    // An escape slot on an escape think counts the trigger: no band, no shot test.
    if (cues.escape && cache.isEscape[i] === 1) {
      runs[i] = (runs[i] as number) + 1;
      continue;
    }
    const ex = exFor(cache, i, me);
    let inBand = false;
    if (ex) {
      // `inReach` of the EX band, written out over the typed arrays.
      inBand = (cache.exMin[i] as number) <= d && d <= (cache.exMax[i] as number) - RANGE_MARGIN;
      scratch.clearance = cache.exClearance[i] as number;
    } else {
      if (cache.hasOpen[i] === 1) {
        inBand = (cache.openMin[i] as number) <= d && d <= (cache.openMax[i] as number);
      } else if (cache.hasBase[i] === 1) {
        const max = (cache.baseMax[i] as number) - RANGE_MARGIN;
        inBand = (cache.baseMin[i] as number) <= d && d <= max;
      }
      scratch.clearance = cache.baseClearance[i] as number;
      // The condition of the slot: a target walking away (+1) or toward the bot (-1).
      const motion = cache.motion[i] as number;
      if (motion > 0 && !(cues.dot > 0)) inBand = false;
      if (motion < 0 && !(cues.dot < 0)) inBand = false;
    }
    runs[i] = inBand && clearShotWith(state, me, target, scratch) ? (runs[i] as number) + 1 : 0;
  }
}

/**
 * Writes the slot to press into `choice` and returns true, or returns false. The first of F, R, E,
 * Q, SPACE, M2, M1 (the sim's own order) whose run is over `castDelay` and that passes the sim's
 * gates: no windup in progress unless it fires on this tick (windupLeft 1), the cooldown at most 1
 * (it counts down first), the energy for the cost (100 for F, 25 for an EX variant), no stun or
 * silence, and no root for a dash. Run `updateRuns` first. `skip` is a bit mask of slot indices
 * the walk leaves out: the escape slots `chooseEscape` already tried (0 for none).
 */
export function chooseCast(
  choice: CastChoice,
  runs: readonly number[],
  castDelay: number,
  kit: KitDef,
  cache: KitCache,
  me: ChampionState,
  skip: number,
): boolean {
  if (me.cast !== null && me.cast.windupLeft !== 1) return false;
  if (hasStatus(me, 'stun') || hasStatus(me, 'silence')) return false;
  const rooted = hasStatus(me, 'root');
  for (let i = SLOTS.length - 1; i >= 0; i--) {
    // A slot the escape choice already tried on this think (a bit of `skip` per slot index).
    if ((skip & (1 << i)) !== 0) continue;
    if ((runs[i] as number) <= castDelay) continue;
    if ((me.cooldowns[i] as number) > 1) continue;
    const slot = SLOTS[i] as Slot;
    const ex = exFor(cache, i, me);
    const cost = slot === 'F' ? ULTIMATE_ENERGY_COST : ex ? EX_ENERGY_COST : 0;
    if (me.energy < cost) continue;
    if (rooted && hasDash(abilityFor(kit, slot, ex))) continue;
    choice.slot = slot;
    choice.ex = ex;
    return true;
  }
  return false;
}

/** The `buttons` of a choice: its slot bit, and SHIFT for an EX variant. */
export function buttonsOf(choice: CastChoice): number {
  return Button[choice.slot] | (choice.ex ? Button.SHIFT : 0);
}

/** The ability a slot casts, with its EX variant when `ex` and the slot has one. */
export function abilityFor(kit: KitDef, slot: Slot, ex: boolean): AbilitySpec {
  const base = kit.slots[slot];
  return ex && base.ex !== undefined ? base.ex : base;
}
