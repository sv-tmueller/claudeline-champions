export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Tier {
  /** Ticks between a change in the world and the bot acting on it. */
  readonly delay: number;
  /** The largest aim error, for documentation and tests. */
  readonly errorDegrees: number;
  /** The aim turns by 2 atan(u) with u in [-maxU, maxU], so maxU = tan(errorDegrees / 2). */
  readonly maxU: number;
}

// The maxU literals are tan(6), tan(3) and tan(1) degrees, written out so the bots need no
// trigonometry at runtime. A test checks them against the tangent. The table and each tier
// are frozen: the bots keep no module-level state, so nothing may change a tier.
export const TIERS: Readonly<Record<Difficulty, Tier>> = Object.freeze({
  easy: Object.freeze({ delay: 30, errorDegrees: 12, maxU: 0.10510423526567646 }),
  normal: Object.freeze({ delay: 15, errorDegrees: 6, maxU: 0.0524077792830412 }),
  hard: Object.freeze({ delay: 6, errorDegrees: 2, maxU: 0.017455064928217585 }),
});
