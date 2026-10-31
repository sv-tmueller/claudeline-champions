import type { KitDef, Slot } from '@claudeline/sim';
import { RANGE_MARGIN, abilityReach } from './reach';

export interface BotProfile {
  /** Closer than this, a ranged champion backs away. 0 means the champion never kites. */
  rangeMin: number;
  /** Farther than this, the champion walks toward its target. Always above 1 m. */
  rangeMax: number;
  /**
   * An engaging champion stands once its target is within this and has a clear shot, and walks in
   * while it is not. Never above `rangeMax`: it is `rangeMax` for a champion that keeps its range,
   * and `STAND_FRACTION` of it for one that never kites (rangeMin 0), so a melee champion stops a
   * step inside its reach, not on the edge of it. The finisher, the deadlock rule and the sight
   * logic keep `rangeMax`.
   */
  standReach: number;
}

/**
 * The share of `rangeMax` at which a champion with rangeMin 0 stands to engage (#213). Below 1 the
 * stand has slack: a target that steps back a little is still in reach and the champion does not
 * walk in again from outside it. Above 1 m for both melee kits (1.6 and 1.2 m) so that the walk
 * ends before the bodies touch.
 */
export const STAND_FRACTION = 0.8;

/** A profile: the stand reach follows from the range. */
function profileOf(rangeMin: number, rangeMax: number): BotProfile {
  return { rangeMin, rangeMax, standReach: rangeMin === 0 ? rangeMax * STAND_FRACTION : rangeMax };
}

const DEFAULT_PROFILE: BotProfile = profileOf(4, 8);

// Keyed by champion id. A Map, so an id such as 'constructor' cannot reach the prototype.
const PROFILES = new Map<string, BotProfile>([
  ['hargrim', profileOf(0, 3)],
  ['quillon', profileOf(6, 13)],
  ['lumeth', profileOf(6, 10)],
  ['skerrow', profileOf(0, 2.5)],
  ['ondrel', profileOf(5, 9)],
  ['brimwick', profileOf(7, 10)],
]);

/**
 * The champions whose rangeMax is read from their kit, with the rangeMin that goes with it. No
 * kit field holds the minimum: roster-v1 words it as backing away from an enemy inside 6 m.
 */
const KIT_RULES = new Map<string, number>([
  ['hargrim', 0],
  ['quillon', 6],
  ['lumeth', 6],
  ['skerrow', 0],
  ['ondrel', 5],
  ['brimwick', 7],
]);

/**
 * The preferred range of a champion. With a kit of the same id, a champion that has a rule gets
 * rangeMax = the top of its base M1 band minus `RANGE_MARGIN` (Lumeth's M1 reaches 12 m, so 11).
 * The table applies instead when there is no rule, no kit or another kit, M1 has no band, or the
 * derived maximum is at most 1 m or at most rangeMin.
 */
export function profileFor(championId: string, kit?: KitDef): BotProfile {
  const table = PROFILES.get(championId) ?? DEFAULT_PROFILE;
  const rangeMin = KIT_RULES.get(championId);
  if (kit !== undefined && rangeMin !== undefined && kit.id === championId) {
    const band = abilityReach(kit.slots.M1);
    if (band !== null) {
      const rangeMax = band.max - RANGE_MARGIN;
      if (rangeMax > 1 && rangeMax > rangeMin) return profileOf(rangeMin, rangeMax);
    }
  }
  return { rangeMin: table.rangeMin, rangeMax: table.rangeMax, standReach: table.standReach };
}

/** What a target must be doing for an opener: walking away from the bot, or toward it. */
export type Motion = 'away' | 'closing';

/**
 * What else must hold of the target for an opener: `'escapeReady'`, the target has a way out
 * (one of the escapes of its own rule is ready, and it is neither stunned nor silenced; see
 * `targetEscapeReady` in casting.ts); `'nearAlly'`, the target is within `NEAR_ALLY` metres of an
 * alive ally of the bot, the bot itself not counted (see `nearAllyOf` in casting.ts).
 */
export type Condition = 'escapeReady' | 'nearAlly';

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

/**
 * A bounded wait: an engaging bot stands, instead of walking in, while the target is within `band`
 * metres (inclusive, with a clear shot) and the cooldown of `slot` is above the ready cooldown and
 * at most `maxTicks`. The bound keeps the stand inside the stall bound of 120 ticks.
 */
export interface WaitRule {
  readonly slot: Slot;
  readonly band: readonly [number, number];
  readonly maxTicks: number;
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
   * cornered, and the energy reserve needs the same condition (see `computeCues`). Skerrow (40,
   * Reaper's Dance) and Brimwick (55, Grand Finale) hold it. Ondrel does not: the damage read from
   * Drowned Ground is one pulse (10), not the 50 of the five it does in all, so the reading would
   * hold the zone for a target it never finishes (docs/design/roster-v2.md, section 2).
   */
  readonly holdF: boolean;
  /** Where the champion stands to wait for an opener to come off cooldown, or null. */
  readonly wait: WaitRule | null;
  /**
   * The escape trigger of the champion, or null for the common one. A number is a distance in
   * metres, inclusive: any acted intent but idle with the acted target that close is an escape
   * think (see `computeCues` in casting.ts). With null the common trigger holds, for Hargrim,
   * Quillon and Skerrow: a retreat with the target within `ESCAPE_RANGE`, or a kite inside
   * rangeMin.
   */
  readonly escapeWithin: number | null;
  /**
   * The slots pressed at an ally, listed by champion: only these get the ally arrays of the kit
   * cache (see `allyKind` in casting.ts), so a kit's area on allies that the champion places on
   * itself (Hargrim's Rally Cry) is no ally slot. Empty for Hargrim, Quillon and Skerrow.
   */
  readonly allies: readonly Slot[];
}

/** No rule: every slot is pressed on its kit band alone. */
const NO_RULES: ChampionRules = Object.freeze({
  openers: Object.freeze([]),
  escapes: Object.freeze([]),
  holdF: false,
  wait: null,
  escapeWithin: null,
  allies: Object.freeze([]),
});

/**
 * Keyed by champion id, like `PROFILES`. The roster's bot sketches (docs/design/roster-v1.md) are
 * the source of the numbers. Rush is the base dash with the band of `dashBand`; Chain Hook is the
 * roster's 4 to 7 m, inside the kit band less the margin (0 to 8 m), and only at a target that
 * walks away; Snare Orb keeps its kit band and needs a target that walks toward the champion.
 * Iron Hide, Skip and Hush Ward are the escapes of the roster sketches: Skip first, then Hush Ward.
 * Skerrow's Lunge is the base dash with its derived band (5 to 6 m); Quiet Dart keeps its kit
 * band and needs a target with an escape ready (the roster: "Q first if the target has an escape
 * ready"); Vanish Step is her escape on the common trigger (decision 6 of batch #80, not the
 * roster's 50 percent health: that would send her back in at once); Reaper's Dance is held.
 * Skerrow waits for Lunge: she stands from 6 to 8 m with a clear shot while Lunge has 2 to 90
 * ticks left, bounded so a long cooldown is no stall (the roster: "waits at 6 to 8 m for the
 * opening"; decision 3 of batch #91 fixes the bound).
 * Lumeth's Binding Sigil keeps its kit band and needs a target within 6 m of an ally (the roster:
 * "Q on a target inside 6 m of an ally"). Lantern Burst, then Glide, are her escapes on a trigger
 * of her own: any acted intent but idle with the target within 3 m (the roster: "an enemy inside
 * 3 m"; decision 1 of batch #105). Glide is a dash: its landing is a dash end, see `findLanding`
 * in escape.ts. She presses Dawnbloom, Aegis Veil, Soothing Surge and Mend Bolt at an ally that
 * needs them: the `allies` list (the roster: "M1 on the lowest-health ally"; see `allyKind` in
 * casting.ts).
 * Ondrel and Brimwick (docs/design/roster-v2.md, sections 2 and 3, the bot profile sketches).
 * Undertow keeps its kit band and needs a target walking away (it drags the target back into her
 * ground); Flash Powder keeps its kit band and needs a target walking toward her (it stuns the
 * one that walks in). Ondrel's escapes are Reed Step, a dash with a landing found like Glide's
 * (a clear path), then Reed Screen; Brimwick's are Flare Step, a teleport whose landing is found
 * like Skip's, then Smoke Pot, whose haste is the way out. Both use the common trigger, a kite
 * inside rangeMin (5 and 7). Brimwick holds Grand Finale (55); Ondrel does not, see `holdF`.
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
      { slot: 'SPACE', band: [6, 8], maxTicks: 90 },
    ),
  ],
  ['ondrel', rule([{ slot: 'E', band: null, motion: 'away', when: null }], ['SPACE', 'R'], false)],
  [
    'brimwick',
    rule([{ slot: 'Q', band: null, motion: 'closing', when: null }], ['SPACE', 'R'], true),
  ],
  [
    'lumeth',
    rule(
      [{ slot: 'Q', band: null, motion: null, when: 'nearAlly' }],
      ['E', 'SPACE'],
      false,
      null,
      3,
      ['F', 'R', 'M2', 'M1'],
    ),
  ],
]);

/** A frozen row: the row, its two lists, each opener and each literal band, and the wait. */
function rule(
  openers: OpenerRule[],
  escapes: Slot[],
  holdF: boolean,
  wait: WaitRule | null = null,
  escapeWithin: number | null = null,
  allies: Slot[] = [],
): ChampionRules {
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
    wait:
      wait === null
        ? null
        : Object.freeze({ ...wait, band: Object.freeze([wait.band[0], wait.band[1]] as const) }),
    escapeWithin,
    allies: Object.freeze([...allies]),
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
