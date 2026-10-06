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
  ['skerrow', 0],
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
 * What else must hold of the target for an opener: `'escapeReady'`, the target has a way out
 * (one of the escapes of its own rule is ready, and it is neither stunned nor silenced; see
 * `targetEscapeReady` in casting.ts).
 */
export type Condition = 'escapeReady';

/**
 * An opener: a slot the bot presses on a condition narrower than its kit band. `band` is the
 * distance band in metres, inclusive and with no range margin: a literal pair, `'dash'` for the
 * band derived from the base ability's leading dash (see `dashBand` in casting.ts), or null for
 * the kit band less the margin. `motion` is what the target must be doing, or null. `when` is
 * what the target must have, or null.
 */
export interface OpenerRule {
  readonly slot: Slot;
  readonly band: 'dash' | readonly [number, number] | null;
  readonly motion: Motion | null;
  readonly when: Condition | null;
}

/** The rules of a champion that its kit does not carry (kits carry no bot fields). */
export interface ChampionRules {
  readonly openers: readonly OpenerRule[];
  /**
   * The slots pressed to get out of reach, in priority order: the first one that passes its gates
   * (and, for a teleport, has a landing) is pressed on an escape think; it is a priority order, not
   * a sequence. See `chooseEscape` in escape.ts.
   */
  readonly escapes: readonly Slot[];
  /**
   * The ultimate is held for a target it can finish or one with no way out: its run counts only
   * while the target's health is at most the damage F does (read from the kit) or the target is
   * cornered, and the energy reserve needs the same condition (see `computeCues`). No champion of
   * the 2026-10 roster but Skerrow holds it.
   */
  readonly holdF: boolean;
}

/** No rule: every slot is pressed on its kit band alone. */
const NO_RULES: ChampionRules = Object.freeze({
  openers: Object.freeze([]),
  escapes: Object.freeze([]),
  holdF: false,
});

/**
 * Keyed by champion id, like `PROFILES`. The roster's bot sketches (docs/design/roster-v1.md) are
 * the source of the numbers. Rush is the base dash with the band of `dashBand`; Chain Hook is the
 * roster's 4 to 7 m, inside the kit band less the margin (0 to 8 m), and only at a target that
 * walks away; Snare Orb keeps its kit band and needs a target that walks toward the champion.
 * Iron Hide, Skip and Hush Ward are the escapes of the roster sketches: Skip first, then Hush Ward.
 * Skerrow's Lunge is the base dash with its derived band (5 to 6 m, where she waits to strike is
 * not built); Quiet Dart keeps its kit band and needs a target with an escape ready (the roster:
 * "Q first if the target has an escape ready"); Vanish Step is her escape on the common trigger
 * (decision 6 of batch #80, not the roster's 50 percent health: that would send her back in at
 * once); Reaper's Dance is held.
 */
const RULES = new Map<string, ChampionRules>([
  [
    'hargrim',
    rule(
      [
        { slot: 'SPACE', band: 'dash', motion: null, when: null },
        { slot: 'E', band: [4, 7], motion: 'away', when: null },
      ],
      ['R'],
      false,
    ),
  ],
  [
    'quillon',
    rule([{ slot: 'Q', band: null, motion: 'closing', when: null }], ['SPACE', 'R'], false),
  ],
  [
    'skerrow',
    rule(
      [
        { slot: 'SPACE', band: 'dash', motion: null, when: null },
        { slot: 'Q', band: null, motion: null, when: 'escapeReady' },
      ],
      ['R'],
      true,
    ),
  ],
]);

/** A frozen row: the row, its two lists, each opener and each literal band. */
function rule(openers: OpenerRule[], escapes: Slot[], holdF: boolean): ChampionRules {
  const frozen = openers.map((opener) =>
    Object.freeze({
      ...opener,
      band:
        typeof opener.band === 'object' && opener.band !== null
          ? Object.freeze([opener.band[0], opener.band[1]] as const)
          : opener.band,
    }),
  );
  return Object.freeze({
    openers: Object.freeze(frozen),
    escapes: Object.freeze([...escapes]),
    holdF,
  });
}

/**
 * The rules of a champion (openers, escapes and the hold of F). Like `KIT_RULES`, a rule applies
 * only with a kit whose id equals the champion id; otherwise there is none.
 */
export function rulesFor(championId: string, kit?: KitDef): ChampionRules {
  if (kit === undefined || kit.id !== championId) return NO_RULES;
  return RULES.get(championId) ?? NO_RULES;
}
