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
/** Longest status, shield or knockback a spec may ask for: ten minutes of ticks. */
export const MAX_STATUS_TICKS = 36000;
/** Largest absorb, damage or heal per pulse, or knockback distance a spec may ask for. */
export const MAX_MAGNITUDE = 1e6;
