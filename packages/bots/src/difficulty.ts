export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Tier {
  /** Ticks between a change in the world and the bot acting on it. */
  delay: number;
  /** The largest aim error, for documentation and tests. */
  errorDegrees: number;
  /** The aim turns by 2 atan(u) with u in [-maxU, maxU], so maxU = tan(errorDegrees / 2). */
  maxU: number;
}

// The maxU literals are tan(6), tan(3) and tan(1) degrees, written out so the bots need no
// trigonometry at runtime. A test checks them against Math.tan.
export const TIERS: Readonly<Record<Difficulty, Tier>> = {
  easy: { delay: 30, errorDegrees: 12, maxU: 0.10510423526567646 },
  normal: { delay: 15, errorDegrees: 6, maxU: 0.0524077792830412 },
  hard: { delay: 6, errorDegrees: 2, maxU: 0.017455064928217585 },
};
