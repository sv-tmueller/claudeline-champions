export interface BotProfile {
  /** Closer than this, a ranged champion backs away. 0 means the champion never kites. */
  rangeMin: number;
  /** Farther than this, the champion walks toward its target. Always above 1 m. */
  rangeMax: number;
}

const DEFAULT_PROFILE: BotProfile = { rangeMin: 4, rangeMax: 8 };

// Keyed by champion id until kits exist; the roster-kit package decides whether these move
// into the kit modules. A Map, so an id such as 'constructor' cannot reach the prototype.
const PROFILES = new Map<string, BotProfile>([
  ['hargrim', { rangeMin: 0, rangeMax: 3 }],
  ['quillon', { rangeMin: 6, rangeMax: 13 }],
  ['lumeth', { rangeMin: 6, rangeMax: 10 }],
  ['skerrow', { rangeMin: 0, rangeMax: 2.5 }],
]);

export function profileFor(championId: string): BotProfile {
  const profile = PROFILES.get(championId) ?? DEFAULT_PROFILE;
  return { rangeMin: profile.rangeMin, rangeMax: profile.rangeMax };
}
