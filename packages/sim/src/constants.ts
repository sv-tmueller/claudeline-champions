export const TICK_RATE = 60;
export const DT = 1 / 60;

export const CHAMPION_RADIUS = 0.5;
export const BASE_MOVE_SPEED = 5.5;
export const DEFAULT_MAX_HEALTH = 120;

/** Remaining stun never exceeds this, however it is applied (rules.md section 4.1). */
export const STUN_CAP_TICKS = 120;
/** Caps on the summed percents of slow and haste over all sources. */
export const SLOW_CAP_PERCENT = 70;
export const HASTE_CAP_PERCENT = 50;
/** The most push, in meters, that all knockbacks on one champion may hold at once. */
export const KNOCKBACK_CAP_METERS = 6;
/** Ticks between the pulses of damage over time and heal over time. */
export const STATUS_PULSE_TICKS = 30;
/** Forced motion is resolved against collision in steps of at most this many meters. */
export const MOTION_SUBSTEP_METERS = 0.25;
/** Longest status, shield, knockback or dash a spec may ask for: ten minutes of ticks. */
export const MAX_STATUS_TICKS = 36000;
/** Largest absorb, damage or heal per pulse, or knockback distance a spec may ask for. */
export const MAX_MAGNITUDE = 1e6;
/** No dash is longer than this; it keeps the substep loop short for any input. */
export const MAX_DASH_DISTANCE = 1000;
/**
 * No dash is shorter than this. With at most `MAX_STATUS_TICKS` ticks the step length stays far
 * above the subnormal range, so a running dash always moves.
 */
export const MIN_DASH_DISTANCE = 1e-6;
/**
 * A teleport may span at most this many meters along each axis, measured from the champion. The
 * line of sight test squares each span, so the sum of squares is at most 2e18, far below the
 * largest double (about 1.8e308). With every arena dimension and spawn within `MAX_ARENA_METERS`,
 * the squares `sweepCircle` forms from a position stay below overflow as well.
 */
export const MAX_TELEPORT_METERS = 1e9;
/**
 * Largest size, spawn coordinate or obstacle dimension, in meters, that `parseArenaDef` accepts. A
 * champion stands at its spawn until the first step, and a teleport from there feeds the squares in
 * `sweepCircle`, so every position the sim holds stays within a few of these.
 */
export const MAX_ARENA_METERS = 1e6;

/** Energy runs from 0 to this; a gain above it is lost. */
export const MAX_ENERGY = 100;
/** Energy an EX variant costs, paid when the cast starts. */
export const EX_ENERGY_COST = 25;
/** Energy the ultimate on F costs, paid when the cast starts. */
export const ULTIMATE_ENERGY_COST = 100;
/** Multiplies walking speed, after slow and haste, during a `slowed` windup. */
export const SLOWED_WINDUP_FACTOR = 0.5;
/**
 * The share of a heal, and of each heal over time pulse, that a projectile aimed at its own
 * caster restores. Applied as `amount * SELF_CAST_HEAL_PERCENT / 100`.
 */
export const SELF_CAST_HEAL_PERCENT = 60;
/** What a hit on an enemy, or a heal on an ally, gives, by the slot that cast it. */
export const ENERGY_GAIN_M1 = 5;
export const ENERGY_GAIN_SKILL = 10;
export const ENERGY_GAIN_ULTIMATE = 15;

/** Match flow, rules.md section 1: the lengths of the phases, in ticks. */
export const WARMUP_TICKS = 180;
/** The round clock, 90 s; sudden death starts when it is used up. */
export const ROUND_TICKS = 5400;
/** The ring shrinks over this many ticks (30 s), then holds. */
export const SUDDEN_DEATH_TICKS = 1800;
/** The pause after a round is decided. */
export const ROUND_END_TICKS = 180;
/** Round wins a team needs in a standard match; a config passes it as `roundsToWin`. */
export const DEFAULT_ROUNDS_TO_WIN = 3;
/** The `sourceId` of the ring's damage and deaths: no champion has a negative id. */
export const RING_SOURCE_ID = -1;
