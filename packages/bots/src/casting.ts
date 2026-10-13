import { Button, CHAMPION_RADIUS, EX_ENERGY_COST, SLOTS, ULTIMATE_ENERGY_COST } from '@claudeline/sim';
import type { AbilitySpec, ChampionState, GameState, KitDef, Slot, StatusType } from '@claudeline/sim';
import type { NavGrid } from './grid';
import { distanceInto } from './hypot';
import type { Measure } from './hypot';
import { kiteStepInto } from './kite';
import type { KiteScratch } from './kite';
import { profileFor, rulesFor } from './profile';
import type { BotProfile } from './profile';
import { RANGE_MARGIN, abilityReach } from './reach';
import { SIGHT_CLEARANCE, clearShotWith } from './sight';
import type { SightScratch } from './sight';
import type { MoveCommand } from './steer';

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
  /**
   * 1 when the opener of the slot needs a target with an escape ready (`OpenerRule.when`); an EX
   * press has no such condition. `anyEscapeCondition` is true when some slot has one, so a think
   * works the cue out only for a champion that reads it.
   */
  needsEscape: Uint8Array;
  anyEscapeCondition: boolean;
  /**
   * 1 when the opener of the slot needs the target within `NEAR_ALLY` of an ally of the bot
   * (`OpenerRule.when`); an EX press has no such condition. `anyNearAlly` is true when some slot
   * has one, so a think scans the allies only for a champion that reads the cue.
   */
  needsNearAlly: Uint8Array;
  anyNearAlly: boolean;
  /**
   * The escape trigger of the champion (see `ChampionRules.escapeWithin`): the distance in metres
   * in `escapeWithin[0]`, or -1 for the common trigger. A typed array, so a double is read without
   * boxing.
   */
  escapeWithin: Float64Array;
  /**
   * The wait of the champion (see `WaitRule`): the slot index in `waitSlot[0]`, -1 for none, and
   * in `waitBand` the band's two ends and the most ticks of cooldown. Typed arrays, so a double
   * is read without boxing.
   */
  waitSlot: Int8Array;
  waitBand: Float64Array;
  /**
   * 1 when the base ability of the slot starts with a dash (its first effect), and the same for the
   * EX variant of an EX slot of the kit (listed in `kit.ex`, has a variant, is not F), whether or
   * not the variant has a reach band. An escape think presses neither (see `chooseCast`).
   */
  baseDash: Uint8Array;
  exDash: Uint8Array;
  /** The slots of the escape rule in priority order, as indices into SLOTS, ended by -1. */
  escapeOrder: Int8Array;
  /** 1 when the slot is in `escapeOrder`. */
  isEscape: Uint8Array;
  /**
   * The teleport or dash an escape slot starts with, when its first effect is one: its range (a
   * dash's distance) in metres, 0 when the slot has neither, and whether the range is fixed (it
   * goes the full range whatever the aim distance: always for a dash).
   */
  escapeRange: Float64Array;
  escapeFixed: Uint8Array;
  /**
   * 1 when the escape slot starts with a dash (Glide) and not a teleport: its landing needs a clear
   * straight path, not only a line of sight (see `findLanding` in escape.ts).
   */
  escapeDash: Uint8Array;
  /**
   * True when F is held for a low or cornered target (see `ChampionRules.holdF`), and the health
   * at or below which a target is low: the sum of the `damage` amounts of F's effects. A double
   * field that starts as a double.
   */
  holdF: boolean;
  lowHealth: number;
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
  /** True while F holds the energy back from the EX variants, see `computeCues`. */
  reserve: boolean;
  /**
   * Whether F's own condition holds for the acted target: always true unless the kit's F is held
   * (`KitCache.holdF`), then the target is low or cornered. The run of F and the reserve read it.
   */
  fOk: boolean;
  /** Scratch for the cornered test: the kite points and the move it writes and nobody reads. */
  kite: KiteScratch;
  corner: MoveCommand;
  /**
   * True on an escape think: the acted intent is retreat with the target within `ESCAPE_RANGE`,
   * or kite with the target inside rangeMin (see `ESCAPE_RANGE` below), or for a champion with an
   * `escapeWithin` any intent but idle with the target that close. Set by `computeCues` before
   * `updateRuns`. Not the cornered kiter's latch `escaping` of bot.ts.
   */
  escapeThink: boolean;
  /**
   * Whether the acted target has a way out (see `targetEscapeReady`). Only worked out when the
   * champion has an opener that reads it (`KitCache.anyEscapeCondition`), else false.
   */
  escapeReady: boolean;
  /**
   * Whether the acted target is within `NEAR_ALLY` of an alive ally of the bot (`nearAllyOf`). Only
   * worked out when the champion has an opener that reads it (`KitCache.anyNearAlly`), else false.
   */
  nearAlly: boolean;
}

export function createCastCues(kite: KiteScratch): CastCues {
  return {
    dot: 0.5,
    reserve: false,
    fOk: true,
    kite,
    corner: { moveX: 0, moveY: 0 },
    escapeThink: false,
    escapeReady: false,
    nearAlly: false,
  };
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
    needsEscape: new Uint8Array(SLOTS.length),
    anyEscapeCondition: false,
    needsNearAlly: new Uint8Array(SLOTS.length),
    anyNearAlly: false,
    escapeWithin: new Float64Array(1).fill(-1),
    waitSlot: new Int8Array(1).fill(-1),
    waitBand: new Float64Array(3),
    baseDash: new Uint8Array(SLOTS.length),
    exDash: new Uint8Array(SLOTS.length),
    escapeOrder: new Int8Array(SLOTS.length).fill(-1),
    isEscape: new Uint8Array(SLOTS.length),
    escapeRange: new Float64Array(SLOTS.length),
    escapeFixed: new Uint8Array(SLOTS.length),
    escapeDash: new Uint8Array(SLOTS.length),
    holdF: false,
    lowHealth: 0.5,
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
    cache.needsEscape[i] = 0;
    cache.needsNearAlly[i] = 0;
    cache.baseDash[i] = 0;
    cache.exDash[i] = 0;
    cache.isEscape[i] = 0;
    cache.escapeRange[i] = 0;
    cache.escapeFixed[i] = 0;
    cache.escapeDash[i] = 0;
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
    cache.baseDash[i] = startsWithDash(spec) ? 1 : 0;
    const variant = spec.ex;
    if (variant !== undefined && slot !== 'F' && kit.ex.includes(slot)) {
      cache.exDash[i] = startsWithDash(variant) ? 1 : 0;
      const band = abilityReach(variant);
      if (band !== null) {
        cache.hasEx[i] = 1;
        cache.exMin[i] = band.min;
        cache.exMax[i] = band.max;
      }
      cache.exClearance[i] = clearanceOf(variant);
    }
  }
  cache.anyEscapeCondition = false;
  cache.anyNearAlly = false;
  for (const opener of rules.openers) {
    if (kit === undefined) break;
    const i = SLOTS.indexOf(opener.slot);
    cache.motion[i] = opener.motion === 'away' ? 1 : opener.motion === 'closing' ? -1 : 0;
    if (opener.when === 'escapeReady') {
      cache.needsEscape[i] = 1;
      cache.anyEscapeCondition = true;
    }
    if (opener.when === 'nearAlly') {
      cache.needsNearAlly[i] = 1;
      cache.anyNearAlly = true;
    }
    const band = opener.band === 'dash' ? dashBand(kit.slots[opener.slot]) : opener.band;
    if (band === null) continue;
    cache.hasOpen[i] = 1;
    cache.openMin[i] = band[0];
    cache.openMax[i] = band[1];
  }
  cache.waitSlot[0] = -1;
  if (kit !== undefined && rules.wait !== null) {
    cache.waitSlot[0] = SLOTS.indexOf(rules.wait.slot);
    cache.waitBand[0] = rules.wait.band[0];
    cache.waitBand[1] = rules.wait.band[1];
    cache.waitBand[2] = rules.wait.maxTicks;
  }
  cache.escapeWithin[0] = kit !== undefined && rules.escapeWithin !== null ? rules.escapeWithin : -1;
  cache.holdF = kit !== undefined && rules.holdF;
  cache.lowHealth = kit !== undefined && rules.holdF ? damageIn(kit.slots.F.effects) : 0;
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
    } else if (first !== undefined && first.type === 'dash') {
      // A dash goes its whole distance along the aim, so its end is a fixed landing.
      cache.escapeRange[i] = first.distance;
      cache.escapeFixed[i] = 1;
      cache.escapeDash[i] = 1;
    }
  }
}

/**
 * The sum of the `damage` amounts in a list of effects, looking into the effects an area, a
 * projectile or a melee arc carries and into what a dash does where it ends. Statuses and
 * knockbacks add nothing. Run on a rebuild only, so it may allocate.
 */
function damageIn(effects: readonly { type: string }[]): number {
  let sum = 0;
  for (const effect of effects) {
    const node = effect as {
      type: string;
      amount?: number;
      effects?: readonly { type: string }[];
      then?: readonly { type: string }[];
    };
    if (node.type === 'damage' && typeof node.amount === 'number') sum += node.amount;
    if (node.effects !== undefined) sum += damageIn(node.effects);
    if (node.then !== undefined) sum += damageIn(node.then);
  }
  return sum;
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

/** Whether the first effect of an ability is a dash: the champion is carried along its aim. */
function startsWithDash(spec: AbilitySpec): boolean {
  const first = spec.effects[0];
  return first !== undefined && first.type === 'dash';
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

/**
 * Whether the bot waits for its opener: the target is `dist.metres` away (a measure, not a number:
 * a double passed to a call that V8 does not inline is boxed), inside the band of the wait rule,
 * and the cooldown of the rule's slot is at least 2 (at 1 or 0 the slot casts) and at most the
 * rule's `maxTicks`. Always false for a champion with no wait. The caller adds the clear shot.
 */
export function waitsFor(cache: KitCache, me: ChampionState, dist: Measure): boolean {
  const slot = cache.waitSlot[0] as number;
  if (slot < 0) return false;
  const d = dist.metres;
  const cooldown = me.cooldowns[slot] as number;
  return (
    (cache.waitBand[0] as number) <= d &&
    d <= (cache.waitBand[1] as number) &&
    cooldown >= 2 &&
    cooldown <= (cache.waitBand[2] as number)
  );
}

/**
 * Whether the target has a way out: one of the escapes of its own rule (`rulesFor` with the kit of
 * its champion id, none for a champion without a rule) has a cooldown of at most 1, as the cast
 * gate reads it, and the target is neither stunned nor silenced. A rooted target can still blink or
 * shield. Allocates nothing: the escape list of a rule is shared and frozen.
 */
function targetEscapeReady(state: GameState, target: ChampionState): boolean {
  if (hasStatus(target, 'stun') || hasStatus(target, 'silence')) return false;
  const { escapes } = rulesFor(target.championId, findKit(state, target.championId));
  for (let n = 0; n < escapes.length; n++) {
    const i = SLOTS.indexOf(escapes[n] as Slot);
    if ((target.cooldowns[i] as number) <= 1) return true;
  }
  return false;
}

/**
 * An escape think is a retreat with the acted target within this many metres, inclusive, or a
 * kite with the acted target inside rangeMin. Six metres is the roster's "inside 6 m" for the
 * ranged champion's back-off, applied to a retreat of any champion.
 */
export const ESCAPE_RANGE = 6;

/**
 * The distance, in metres and inclusive, within which the acted target counts as near an ally of
 * the bot (`OpenerRule.when` `'nearAlly'`): the roster's "inside 6 m" of Binding Sigil.
 */
export const NEAR_ALLY = 6;

/**
 * Whether the target is within `NEAR_ALLY` of an alive ally of `me`, `me` itself not counted.
 * Overwrites `dist`; allocates nothing.
 */
function nearAllyOf(state: GameState, me: ChampionState, target: ChampionState, dist: Measure): boolean {
  const { champions } = state;
  for (let i = 0; i < champions.length; i++) {
    const c = champions[i] as ChampionState;
    if (!c.alive || c.team !== me.team || c.id === me.id) continue;
    distanceInto(dist, c, target);
    if (dist.metres <= NEAR_ALLY) return true;
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
 * the energy, and F is not holding the energy back (`cues.reserve`, see `computeCues`). F never
 * has an EX variant.
 */
function exFor(cache: KitCache, index: number, me: ChampionState, cues: CastCues): boolean {
  if (cache.hasEx[index] !== 1 || me.energy < EX_ENERGY_COST) return false;
  return !cues.reserve;
}

/**
 * Works the cues of a think out, from the acted target: the motion of the target, whether this is
 * an escape think, whether the target has an escape ready, the energy reserve, and the clearance
 * a stand needs. Run once per think, before the move (the stand reads `sight.standClearance`) and
 * before `updateRuns`.
 *
 * The reserve: F holds the energy back, so the EX variants are not cast, while F is ready (its
 * cooldown is at most 1, as the cast gate reads it), its base ability has a reach band (a support
 * ultimate that reaches allies only must not freeze every EX variant for good), the energy is at
 * least `EX_RESERVE_ENERGY` (what F costs less one EX press, so the bar can reach the cost of F
 * instead of falling back by an EX cast first) and the target is within F's reach, the band less
 * the margin. Without the reach clause a bot at 75 energy or more did without its EX variants for
 * as long as any ultimate was ready, whether or not an enemy was ever in reach of it.
 *
 * The stand clearance: a bot that could press F now (the reserve and the full cost) stands where
 * a shot of F's width fits, not only a champion's 0.5 m: a wide ultimate (Quillon's 0.6 m) can
 * wait behind cover that a 0.5 m shot clears. Any other think keeps 0.5.
 */
export function computeCues(
  cues: CastCues,
  cache: KitCache,
  profile: BotProfile,
  intent: string,
  state: GameState,
  me: ChampionState,
  target: ChampionState,
  sight: SightScratch,
  dist: Measure,
  grid: NavGrid,
): void {
  distanceInto(dist, me, target);
  const d = dist.metres;
  cues.dot = (target.x - me.x) * target.vx + (target.y - me.y) * target.vy;
  // A champion with a trigger of its own (`escapeWithin`) has it instead of the common one.
  const within = cache.escapeWithin[0] as number;
  cues.escapeThink =
    within >= 0
      ? intent !== 'idle' && d <= within
      : (intent === 'retreat' && d <= ESCAPE_RANGE) || (intent === 'kite' && d < profile.rangeMin);
  cues.escapeReady = cache.anyEscapeCondition && targetEscapeReady(state, target);
  cues.nearAlly = cache.anyNearAlly && nearAllyOf(state, me, target, dist);
  // The scan measured the allies: leave `dist` as the distance to the target.
  if (cache.anyNearAlly) distanceInto(dist, me, target);
  // F's condition. Cornered: none of the five 1 m points away from the bot is free, the kite step
  // of the target seen from the bot's side. Only worked out for a healthy target of a held F.
  cues.fOk =
    !cache.holdF ||
    target.health <= cache.lowHealth ||
    !kiteStepInto(cues.corner, cues.kite, grid, target, me, dist);
  cues.reserve =
    cache.hasBase[F_INDEX] === 1 &&
    (me.cooldowns[F_INDEX] as number) <= 1 &&
    me.energy >= EX_RESERVE_ENERGY &&
    (cache.baseMin[F_INDEX] as number) <= d &&
    d <= (cache.baseMax[F_INDEX] as number) - RANGE_MARGIN &&
    cues.fOk;
  sight.standClearance = SIGHT_CLEARANCE;
  if (cues.reserve && me.energy >= ULTIMATE_ENERGY_COST) {
    const wide = cache.baseClearance[F_INDEX] as number;
    if (wide > SIGHT_CLEARANCE) sight.standClearance = wide;
  }
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
  for (let i = 0; i < SLOTS.length; i++) {
    // An escape slot on an escape think counts the trigger: no band, no shot test.
    if (cues.escapeThink && cache.isEscape[i] === 1) {
      runs[i] = (runs[i] as number) + 1;
      continue;
    }
    const ex = exFor(cache, i, me, cues);
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
      // The target must have an escape ready (Quiet Dart).
      if (cache.needsEscape[i] === 1 && !cues.escapeReady) inBand = false;
      // The target must be beside an ally of the bot (Binding Sigil).
      if (cache.needsNearAlly[i] === 1 && !cues.nearAlly) inBand = false;
      if (i === F_INDEX && !cues.fOk) inBand = false;
    }
    runs[i] = inBand && clearShotWith(state, me, target, scratch) ? (runs[i] as number) + 1 : 0;
  }
}

/**
 * Writes the slot to press into `choice` and returns true, or returns false. The first of F, R, E,
 * Q, SPACE, M2, M1 (the sim's own order) whose run is over `castDelay` and that passes the sim's
 * gates: no windup in progress unless it fires on this tick (windupLeft 1), the cooldown at most 1
 * (it counts down first), the energy for the cost (100 for F, 25 for an EX variant), no stun or
 * silence, no root for a dash, and on an escape think no dash at all (the ability of the press,
 * its EX variant when it would be cast, starts with one). Run `updateRuns` first. `skip` is a bit
 * mask of slot indices the walk leaves out: the escape slots `chooseEscape` already tried (0 for
 * none).
 */
export function chooseCast(
  choice: CastChoice,
  runs: readonly number[],
  castDelay: number,
  kit: KitDef,
  cache: KitCache,
  me: ChampionState,
  cues: CastCues,
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
    const ex = exFor(cache, i, me, cues);
    const cost = slot === 'F' ? ULTIMATE_ENERGY_COST : ex ? EX_ENERGY_COST : 0;
    if (me.energy < cost) continue;
    if (rooted && hasDash(abilityFor(kit, slot, ex))) continue;
    // The dash hold: an escape think leaves the target, and a dash would carry the champion to it.
    if (cues.escapeThink && (ex ? cache.exDash[i] : cache.baseDash[i]) === 1) continue;
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
