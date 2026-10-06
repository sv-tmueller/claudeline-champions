import type { KitDef, Slot } from '@claudeline/sim';
import { RANGE_MARGIN, abilityReach } from './reach';

export interface BotProfile {
  /** Closer than this, a ranged champion backs away. 0 means the champion never kites. */
  rangeMin: number;
  /** Farther than this, the champion walks toward its target. Always above 1 m. */
  rangeMax: number;
}

const DEFAULT_PROFILE: BotProfile = { rangeMin: 4, rangeMax: 8 };

// Keyed by champion id. A Map, so an id such as 'constructor' cannot reach the prototype.
const PROFILES = new Map<string, BotProfile>([
  ['hargrim', { rangeMin: 0, rangeMax: 3 }],
  ['quillon', { rangeMin: 6, rangeMax: 13 }],
  ['lumeth', { rangeMin: 6, rangeMax: 10 }],
  ['skerrow', { rangeMin: 0, rangeMax: 2.5 }],
]);

/**
 * The champions whose rangeMax is read from their kit, with the rangeMin that goes with it. No
 * kit field holds the minimum: roster-v1 words it as backing away from an enemy inside 6 m.
 */
const KIT_RULES = new Map<string, number>([
  ['hargrim', 0],
  ['quillon', 6],
]);

/**
 * The preferred range of a champion. With a kit of the same id, a champion that has a rule gets
 * rangeMax = the top of its base M1 band minus `RANGE_MARGIN`. The table applies instead when
 * there is no rule, no kit or another kit, M1 has no band, or the derived maximum is at most
 * 1 m or at most rangeMin.
 */
export function profileFor(championId: string, kit?: KitDef): BotProfile {
  const table = PROFILES.get(championId) ?? DEFAULT_PROFILE;
  const rangeMin = KIT_RULES.get(championId);
  if (kit !== undefined && rangeMin !== undefined && kit.id === championId) {
    const band = abilityReach(kit.slots.M1);
    if (band !== null) {
      const rangeMax = band.max - RANGE_MARGIN;
      if (rangeMax > 1 && rangeMax > rangeMin) return { rangeMin, rangeMax };
    }
  }
  return { rangeMin: table.rangeMin, rangeMax: table.rangeMax };
}

/** What a target must be doing for an opener: walking away from the bot, or toward it. */
export type Motion = 'away' | 'closing';

/**
 * An opener: a slot the bot presses on a condition narrower than its kit band. `band` is the
 * distance band in metres, inclusive and with no range margin: a literal pair, `'dash'` for the
 * band derived from the base ability's leading dash (see `dashBand` in casting.ts), or null for
 * the kit band less the margin. `motion` is what the target must be doing, or null.
 */
export interface OpenerRule {
  readonly slot: Slot;
  readonly band: 'dash' | readonly [number, number] | null;
  readonly motion: Motion | null;
}

/** The rules of a champion that its kit does not carry (kits carry no bot fields). */
export interface ChampionRules {
  readonly openers: readonly OpenerRule[];
}

/** No rule: every slot is pressed on its kit band alone. */
const NO_RULES: ChampionRules = Object.freeze({ openers: Object.freeze([]) });

/** Keyed by champion id, like `PROFILES`. No champion has a rule yet. */
const RULES = new Map<string, ChampionRules>();

/**
 * The openers of a champion. Like `KIT_RULES`, a rule applies only with a kit whose id equals
 * the champion id; otherwise there is none.
 */
export function rulesFor(championId: string, kit?: KitDef): ChampionRules {
  if (kit === undefined || kit.id !== championId) return NO_RULES;
  return RULES.get(championId) ?? NO_RULES;
}
