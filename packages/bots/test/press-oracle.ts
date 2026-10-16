import { expect } from 'vitest';
import { Button, SLOTS, checksum, hasLineOfSight, step } from '@claudeline/sim';
import type { ChampionState, GameState, PlayerInput, SimEvent, Slot } from '@claudeline/sim';
import type { KitDef } from '@claudeline/sim';
import {
  oracleCornered,
  oracleDashLanding,
  oracleLanding,
  triggerProblems,
} from './escape-oracle';
import type { EscapeRow, OracleLanding } from './escape-oracle';
import type { MatchRun } from './helpers';
import {
  checkInvariants,
  clearShotOracle,
  createStallTracker,
  createTeleportTally,
  jsonKits,
  kitOf,
  rosterKits,
  tallyTeleports,
  validInput,
} from './helpers';
import type { TeleportTally } from './helpers';
import { hargrimKit, quillonKit } from './kits';

export const TICKS = 3600;

/**
 * A band of centre distances. A row without `margin` is a kit band, tested with the 1 m range
 * margin off its top; an opener row (see bots.md, Openers and escapes) is the literal band with
 * `margin: 0`. `motion` is the condition of an opener: the target walks away from the champion or
 * toward it, by the sign of (target - champion) . target velocity. `needs` is the other one.
 */
export interface Band {
  min: number;
  max: number;
  margin?: number;
  motion?: 'away' | 'closing';
  /**
   * Quiet Dart: the target has an escape ready, see `escapeReady`. Binding Sigil: the target is
   * within 6 m of an alive ally of the champion, itself not counted, see `nearAlly`.
   */
  needs?: 'escapeReady' | 'nearAlly';
}

// The oracle's own band and clearance tables, one per kit set, written out from the kit files
// and not from src: they must not import the code under test. Keys are `champion:SLOT` and
// `champion:SLOT:ex`. A pressed slot that is not in a table fails the test, so a slot with no band
// is never pressed. The clearance is the width of the shot of each pressed ability: the first
// projectile radius, or the champion radius 0.5 for an ability with no projectile.
export interface KitSet {
  name: string;
  kits: () => KitDef[];
  bands: Record<string, Band>;
  clearances: Record<string, number>;
  /** The ally rows: the slots a champion presses at an ally, see `AllyRow`. */
  allies: Record<string, AllyRow>;
}

/**
 * An ally slot, written from the kit file (docs/architecture/bots.md, Allies): the slot is pressed
 * at an alive ally of the champion that is missing at least `need` health (no overheal), within
 * `reach` less the 1 m margin of it, and for a bolt with a clear shot of `clearance`. A bolt never
 * hits its owner (the champion is not an ally of itself) and is aimed at the ally; an area on
 * allies is placed on the champion and counts the champion itself. Of several allies the one with
 * the lowest health fraction is the one, a tie going to the lower id.
 */
export interface AllyRow {
  bolt: boolean;
  /** Speed times lifetime over 60 for a bolt; the radius plus 0.5 for an area. */
  reach: number;
  need: number;
  /** The width of the shot of a bolt; unused for an area. */
  clearance: number;
  /** The speed of a bolt, which the aim leads with. */
  speed: number;
}

/**
 * The escape rows, the same for both kit sets (Skip is a 4 m teleport in each; it is fixed in the
 * shipped kit and not in the test kit, which the oracle does not need: it reads the landing from
 * the sim). An escape press has no band and no shot test: it needs the trigger (a retreat with the
 * target within 6 m, or a kite inside rangeMin), and for a teleport a landing that the oracle finds
 * by its own first-of-five search. Hush Ward is pressed only when Skip is not ready or has none.
 */
export const ESCAPES: Record<string, EscapeRow> = {
  'hargrim:R': { slot: 'R', teleport: null, after: null },
  'quillon:SPACE': { slot: 'SPACE', teleport: 4, after: null },
  'quillon:R': { slot: 'R', teleport: null, after: { slot: 'SPACE', teleport: 4 } },
  // Vanish Step: a 5 m teleport that is not fixed (the shipped Skerrow kit only).
  'skerrow:R': { slot: 'R', teleport: 5, after: null },
  // Lantern Burst: the trigger is Lumeth's own (3 m, any intent but idle), and it costs nothing.
  'lumeth:E': { slot: 'E', teleport: null, after: null },
  // Glide: a 4 m dash with a landing of its own, pressed only with Lantern Burst not ready.
  'lumeth:SPACE': { slot: 'SPACE', teleport: null, dash: 4, after: { slot: 'E', teleport: null } },
};

/**
 * Whether the target has a way out, by the escape rows above: one of its escape slots has a
 * cooldown of at most 1 and it is neither stunned nor silenced. Written here from the rows, not
 * from the rules of src.
 */
function escapeReady(target: ChampionState): boolean {
  if (target.statuses.some((st) => st.type === 'stun' || st.type === 'silence')) return false;
  return Object.entries(ESCAPES).some(
    ([key, row]) =>
      key.startsWith(`${target.championId}:`) &&
      (target.cooldowns[SLOTS.indexOf(row.slot)] ?? Infinity) <= 1,
  );
}

/**
 * Whether the target is within 6 m of an alive ally of `c`, `c` itself not counted. Written here
 * from the rule of bots.md (Openers and escapes), not from the code of the bot.
 */
function nearAlly(state: GameState, c: ChampionState, target: ChampionState): boolean {
  return state.champions.some(
    (o) =>
      o.alive &&
      o.team === c.team &&
      o.id !== c.id &&
      Math.hypot(o.x - target.x, o.y - target.y) <= 6,
  );
}

/**
 * The ultimates the bot holds for a low or cornered target: the key and the health at or below
 * which a target is low, the damage F does (written from the kit file: 40). A press passes only
 * when the target is that low or the oracle finds it cornered.
 */
export const HELD: Record<string, number> = { 'skerrow:F': 40 };

const HARGRIM_BANDS: Record<string, Band> = {
  'hargrim:M1': { min: 0, max: 3 },
  'hargrim:M2': { min: 0, max: 5 },
  'hargrim:M2:ex': { min: 0, max: 5.75 },
  'hargrim:SPACE': { min: 4, max: 5, margin: 0 },
  'hargrim:SPACE:ex': { min: 0, max: 9 },
  'hargrim:E': { min: 4, max: 7, margin: 0, motion: 'away' },
  'hargrim:F': { min: 0, max: 10 },
};
const HARGRIM_CLEARANCES: Record<string, number> = {
  'hargrim:M1': 0.5,
  'hargrim:M2': 0.5,
  'hargrim:M2:ex': 0.5,
  'hargrim:SPACE': 0.5,
  'hargrim:SPACE:ex': 0.5,
  'hargrim:E': 0.4,
  'hargrim:F': 0.5,
};

// data/kits/skerrow.json, in the shipped set only (the test kits have no Skerrow): a melee arc is
// its radius plus 0.5; the bolts are speed times lifetime in ticks over 60; Lunge is the opener
// band [5, 6] with no margin; the EX Lunge is the dash 8 plus its arc 2 plus 0.5; the ultimate is
// the teleport 8 plus its arc 2.5 plus 0.5.
const SKERROW_BANDS: Record<string, Band> = {
  'skerrow:M1': { min: 0, max: 2.5 },
  'skerrow:M2': { min: 0, max: (24 * 25) / 60 },
  'skerrow:SPACE': { min: 5, max: 6, margin: 0 },
  'skerrow:SPACE:ex': { min: 0, max: 10.5 },
  'skerrow:Q': { min: 0, max: (20 * 33) / 60, needs: 'escapeReady' },
  'skerrow:E': { min: 0, max: 3 },
  'skerrow:E:ex': { min: 0, max: 3 },
  'skerrow:F': { min: 0, max: 11 },
};
const SKERROW_CLEARANCES: Record<string, number> = {
  'skerrow:M1': 0.5,
  'skerrow:M2': 0.2,
  'skerrow:SPACE': 0.5,
  'skerrow:SPACE:ex': 0.5,
  'skerrow:Q': 0.3,
  'skerrow:E': 0.5,
  'skerrow:E:ex': 0.5,
  'skerrow:F': 0.5,
};

// data/kits/lumeth.json, in the shipped set only. The enemy bands: Mend Bolt is a bolt of 20 m/s for
// 36 ticks (12 m), which she also presses at an enemy when no ally needs it; Binding Sigil is an area
// at the aim, range 9 plus radius 1.5 plus 0.5, an opener at a target beside an ally; Lantern Burst
// is an area around her, radius 3 plus 0.5, which she presses as an escape (the row in `ESCAPES`;
// the band is the kit's and is never what presses it, because her trigger reaches farther than its
// top). Soothing Surge, Aegis Veil and Dawnbloom reach allies only (Dawnbloom's slow on enemies is
// no reason to press it), so they have no band: they are pressed through the ally rows below, and
// without an ally that qualifies a press of them fails the run.
const LUMETH_BANDS: Record<string, Band> = {
  'lumeth:M1': { min: 0, max: (20 * 36) / 60 },
  'lumeth:Q': { min: 0, max: 11, needs: 'nearAlly' },
  'lumeth:E': { min: 0, max: 3.5 },
};
const LUMETH_CLEARANCES: Record<string, number> = {
  'lumeth:M1': 0.35,
  'lumeth:Q': 0.5,
  'lumeth:E': 0.5,
};
// Her ally rows: Mend Bolt heals 10 (20 m/s, 36 ticks, 0.35 m); Soothing Surge 14 (16 m/s, 38 ticks,
// 0.5 m); Aegis Veil shields 30 and Dawnbloom heals 30, both on allies within 5 m of her plus 0.5.
// The EX variants of M2 and R have no row: they have no enemy band and are never pressed.
const LUMETH_ALLIES: Record<string, AllyRow> = {
  'lumeth:M1': { bolt: true, reach: (20 * 36) / 60, need: 10, clearance: 0.35, speed: 20 },
  'lumeth:M2': { bolt: true, reach: (16 * 38) / 60, need: 14, clearance: 0.5, speed: 16 },
  'lumeth:R': { bolt: false, reach: 5.5, need: 30, clearance: 0, speed: 0 },
  'lumeth:F': { bolt: false, reach: 5.5, need: 30, clearance: 0, speed: 0 },
};

export const KIT_SETS: KitSet[] = [
  {
    // packages/bots/test/kits.ts: Quillon with speeds and lifetimes that give exact decimal
    // reaches.
    name: 'the test kits',
    kits: () => [hargrimKit(), quillonKit()],
    bands: {
      ...HARGRIM_BANDS,
      'quillon:M1': { min: 0, max: 14 },
      'quillon:M2': { min: 0, max: 12 },
      'quillon:M2:ex': { min: 0, max: 12 },
      'quillon:Q': { min: 0, max: 10, motion: 'closing' },
      'quillon:E': { min: 0, max: 18 },
      'quillon:E:ex': { min: 0, max: 18 },
      'quillon:F': { min: 0, max: 20 },
    },
    clearances: {
      ...HARGRIM_CLEARANCES,
      'quillon:M1': 0.25,
      'quillon:M2': 0.4,
      'quillon:M2:ex': 0.6,
      'quillon:Q': 0.6,
      'quillon:E': 0.2,
      'quillon:E:ex': 0.2,
      'quillon:F': 0.6,
    },
    allies: {},
  },
  {
    // data/kits/hargrim.json and quillon.json: speed times lifetime in ticks over 60 for each bolt.
    name: 'the shipped kits',
    kits: jsonKits,
    bands: {
      ...HARGRIM_BANDS,
      'quillon:M1': { min: 0, max: (22 * 38) / 60 },
      'quillon:M2': { min: 0, max: (14 * 51) / 60 },
      'quillon:M2:ex': { min: 0, max: (14 * 51) / 60 },
      'quillon:Q': { min: 0, max: 10, motion: 'closing' },
      'quillon:E': { min: 0, max: (25 * 43) / 60 },
      'quillon:E:ex': { min: 0, max: (25 * 43) / 60 },
      'quillon:F': { min: 0, max: 20 },
      ...SKERROW_BANDS,
      ...LUMETH_BANDS,
    },
    clearances: {
      ...HARGRIM_CLEARANCES,
      'quillon:M1': 0.25,
      'quillon:M2': 0.4,
      'quillon:M2:ex': 0.6,
      'quillon:Q': 0.6,
      'quillon:E': 0.2,
      'quillon:E:ex': 0.2,
      'quillon:F': 0.6,
      ...SKERROW_CLEARANCES,
      ...LUMETH_CLEARANCES,
    },
    allies: LUMETH_ALLIES,
  },
];

/** The shipped set with Lumeth's kit: `jsonKits()` has no Lumeth, so the plain runs stay as they were. */
export const LUMETH_SET: KitSet = { ...(KIT_SETS[1] as KitSet), name: 'the four shipped kits', kits: rosterKits };
/** The pressed abilities that start with a dash, which a root skips and an escape think holds. */
const DASHES = new Set([
  'hargrim:SPACE',
  'hargrim:SPACE:ex',
  'hargrim:F',
  'skerrow:SPACE',
  'skerrow:SPACE:ex',
  'lumeth:SPACE',
]);
const MARGIN = 1;
const EX_COST = 25;
const ULTIMATE_COST = 100;

interface Press {
  id: number;
  slot: Slot;
  ex: boolean;
  key: string;
  gates: string;
  /** Where the oracle says an escape teleport or dash lands, for the check after the step. */
  landing: OracleLanding | null;
  /** The distance of a dash escape (Glide): no teleport event follows, a `dashStarted` does. Else null. */
  dash: number | null;
  /** Where the champion stood when it pressed, which the direction of the dash is read from. */
  from: { x: number; y: number };
}

function hasStatus(c: ChampionState, type: string): boolean {
  return c.statuses.some((s) => s.type === type);
}

/** The slot and EX flag a valid input presses; null when it presses nothing. */
function pressedSlot(input: PlayerInput): { slot: Slot; ex: boolean } | null {
  if (input.buttons === 0) return null;
  const slot = SLOTS.find((s) => (input.buttons & Button[s]) !== 0);
  return slot === undefined ? null : { slot, ex: (input.buttons & Button.SHIFT) !== 0 };
}

/**
 * The ally a press of an ally row is at, written from the definition and not from src: of the alive
 * champions of the team of `c` (not `c` itself for a bolt) that are missing at least `need` health,
 * within `reach` less the margin and, for a bolt, in a clear shot, the one with the lowest health
 * fraction, the lower id on a tie. Null when none.
 */
function oracleAlly(state: GameState, c: ChampionState, row: AllyRow): ChampionState | null {
  let best: ChampionState | null = null;
  for (const o of state.champions) {
    if (!o.alive || o.team !== c.team) continue;
    if (row.bolt && o.id === c.id) continue;
    if (o.maxHealth - o.health < row.need) continue;
    if (Math.hypot(o.x - c.x, o.y - c.y) > row.reach - MARGIN) continue;
    if (row.bolt && !clearShotOracle(state, c, o, row.clearance)) continue;
    if (best === null || o.health / o.maxHealth < best.health / best.maxHealth) best = o;
  }
  return best;
}

/**
 * Where a bolt of `speed` aimed from `from` meets `to` walking at its velocity: the positive root
 * of (v.v - s^2) t^2 + 2 (d.v) t + d.d = 0, and the target's own point when there is none.
 */
function oracleLead(from: ChampionState, to: ChampionState, speed: number): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = to.vx * to.vx + to.vy * to.vy - speed * speed;
  const b = 2 * (dx * to.vx + dy * to.vy);
  const c = dx * dx + dy * dy;
  if (c === 0 || !(a < 0)) return { x: to.x, y: to.y };
  const root = Math.sqrt(b * b - 4 * a * c);
  const t = b >= 0 ? (b + root) / (-2 * a) : (2 * c) / (root - b);
  return t > 0 && Number.isFinite(t) ? { x: to.x + to.vx * t, y: to.y + to.vy * t } : { x: to.x, y: to.y };
}

/** The widest aim error of any tier, in degrees (easy: 12), and a little for the whole centimetres. */
const AIM_TOLERANCE = 12.1;

/** The reasons a press of this input on this state breaks a documented gate; empty when none. */
function pressProblems(
  state: GameState,
  c: ChampionState,
  pressed: { slot: Slot; ex: boolean },
  acted: { intent: string; targetId: number },
  input: PlayerInput,
  set: KitSet,
): { problems: string[]; key: string; gates: string; landing: OracleLanding | null } {
  const key = `${c.championId}:${pressed.slot}${pressed.ex ? ':ex' : ''}`;
  const targetId = acted.targetId;
  const target = state.champions[targetId];
  const problems: string[] = [];
  const escape = pressed.ex ? undefined : ESCAPES[key];
  let landing: OracleLanding | null = null;
  const d = target === undefined ? NaN : Math.hypot(c.x - target.x, c.y - target.y);
  const cooldown = c.cooldowns[SLOTS.indexOf(pressed.slot)] ?? Infinity;
  const gates =
    `d ${d}, cooldown ${cooldown}, energy ${c.energy}, windupLeft ${c.cast?.windupLeft ?? 'none'}, ` +
    `statuses ${c.statuses.map((s) => s.type).join(',') || 'none'}`;
  const band = set.bands[key];
  const allyRow = pressed.ex ? undefined : set.allies[key];
  const ally = allyRow === undefined ? null : oracleAlly(state, c, allyRow);
  const held = pressed.ex ? undefined : HELD[key];
  if (
    held !== undefined &&
    target !== undefined &&
    !(target.health <= held || oracleCornered(state, target, c))
  ) {
    problems.push(`${key} pressed at a target with ${target.health} health that is not cornered`);
  }
  if (band === undefined && escape === undefined && allyRow === undefined) {
    problems.push(`${key} has no reach band in the oracle table`);
  }
  if (target === undefined || !target.alive || target.team === c.team) {
    problems.push(`target ${targetId} is not an alive enemy`);
  } else if (escape !== undefined) {
    problems.push(...triggerProblems(c, target, acted.intent));
    if (escape.teleport !== null) {
      landing = oracleLanding(state, c, target, escape.slot, escape.teleport);
      if (landing === null) problems.push('a teleport escape was pressed with no landing');
      else if (input.aimX !== landing.aimX || input.aimY !== landing.aimY) {
        problems.push(
          `aim ${input.aimX},${input.aimY} is not the first landing's ${landing.aimX},${landing.aimY} (direction ${landing.k})`,
        );
      }
    }
    if (escape.dash !== undefined) {
      landing = oracleDashLanding(state, c, target, escape.dash);
      if (landing === null) problems.push('a dash escape was pressed with no landing');
      else if (input.aimX !== landing.aimX || input.aimY !== landing.aimY) {
        problems.push(
          `aim ${input.aimX},${input.aimY} is not the first dash landing's ${landing.aimX},${landing.aimY} (direction ${landing.k})`,
        );
      }
    }
    if (escape.after !== null) {
      const { slot: firstSlot, teleport } = escape.after;
      const ready = (c.cooldowns[SLOTS.indexOf(firstSlot)] ?? Infinity) <= 1;
      if (
        ready &&
        (teleport === null || oracleLanding(state, c, target, firstSlot, teleport) !== null)
      ) {
        problems.push(`${key} pressed with ${firstSlot} ready${teleport === null ? '' : ' and a landing'}`);
      }
    }
  } else if (allyRow !== undefined && (band === undefined || ally !== null)) {
    // An ally press: some ally qualifies (a bolt with a band, Mend Bolt, is also pressed at an enemy
    // when none does, which the branch below tests). The enemy is the acted target all the same: she
    // never heals on an idle think, which the first branch above tests.
    if (ally === null) problems.push(`${key} pressed with no ally that qualifies`);
    // A bolt is aimed at the ally, led with its speed, within the widest aim error; a press that
    // fires a cast on this very tick (a cast in progress) aims for that cast instead.
    else if (allyRow.bolt && c.cast === null) {
      const lead = oracleLead(c, ally, allyRow.speed);
      const ax = input.aimX / 100 - c.x;
      const ay = input.aimY / 100 - c.y;
      const px = lead.x - c.x;
      const py = lead.y - c.y;
      const off = (Math.abs(Math.atan2(ax * py - ay * px, ax * px + ay * py)) * 180) / Math.PI;
      if (!(off <= AIM_TOLERANCE)) {
        problems.push(`aim ${input.aimX},${input.aimY} is ${off} degrees off ally ${ally.id}`);
      }
    }
  } else if (band !== undefined) {
    if (!hasLineOfSight(state, c, target)) problems.push('no line of sight');
    const clearance = set.clearances[key];
    if (clearance !== undefined && !clearShotOracle(state, c, target, clearance)) {
      problems.push(`no clear shot of width ${clearance}`);
    }
    if (band !== undefined) {
      const top = band.max - (band.margin ?? MARGIN);
      if (!(band.min <= d && d <= top)) problems.push(`distance ${d} outside [${band.min}, ${top}]`);
      const dot = (target.x - c.x) * target.vx + (target.y - c.y) * target.vy;
      if (band.motion === 'away' && !(dot > 0)) problems.push(`target not moving away: dot ${dot}`);
      if (band.motion === 'closing' && !(dot < 0)) problems.push(`target not closing: dot ${dot}`);
      if (band.needs === 'escapeReady' && !escapeReady(target)) {
        problems.push(`${key} pressed at a target with no escape ready`);
      }
      if (band.needs === 'nearAlly' && !nearAlly(state, c, target)) {
        problems.push(`${key} pressed at a target that is not within 6 m of an ally`);
      }
    }
  }
  if (cooldown > 1) problems.push(`cooldown ${cooldown} above 1`);
  const cost = pressed.slot === 'F' ? ULTIMATE_COST : pressed.ex ? EX_COST : 0;
  if (c.energy < cost) problems.push(`energy ${c.energy} below ${cost}`);
  if (hasStatus(c, 'stun') || hasStatus(c, 'silence')) problems.push('stunned or silenced');
  if (hasStatus(c, 'root') && DASHES.has(key)) problems.push('rooted and the ability holds a dash');
  // The dash hold: on an escape think (the trigger of the escape rows) no dash is pressed.
  if (
    target !== undefined &&
    escape === undefined &&
    DASHES.has(key) &&
    triggerProblems(c, target, acted.intent).length === 0
  ) {
    problems.push(`${key} is a dash pressed on an escape think (${acted.intent})`);
  }
  if (c.cast !== null && c.cast.windupLeft !== 1) problems.push(`windupLeft ${c.cast.windupLeft}`);
  return { problems, key, gates, landing };
}

/**
 * Whether the sim may have refused this press in the step, for a reason other than the bot's gates.
 */
function explained(events: readonly SimEvent[], press: Press): boolean {
  for (const e of events) {
    const sameCast = e.type === 'castStarted' && e.championId === press.id && e.slot === press.slot;
    if (sameCast && e.ex === press.ex) {
      return true;
    }
    // A champion before this one in the step turn order can kill it, stun it or silence it, or
    // root it when the ability holds a dash, ahead of its own step 3d.
    if (e.type === 'death' && e.targetId === press.id) return true;
    if (e.type === 'statusApplied' && e.targetId === press.id) {
      if (e.status === 'stun' || e.status === 'silence') return true;
      if (e.status === 'root' && DASHES.has(press.key)) return true;
    }
  }
  return false;
}

/** What a played match leaves for the tests to assert on. */
export interface Played {
  state: GameState;
  worst: { id: number; from: number; length: number; intent: string };
  started: number[];
  /** Casts started per `champion:SLOT` (an EX variant counts under its slot). */
  slots: Record<string, number>;
  exStarted: number[];
  ultimates: number[];
  /** A champion that had a cast fire killed an enemy. */
  killed: boolean;
  /**
   * The teleports of the run: the escape teleports (pressed with a landing) and every other one
   * (Reaper's Dance), each with how many the sim blocked.
   */
  tally: TeleportTally;
  /** The champion of each teleport the tally counted apart, in order: who cast Reaper's Dance. */
  otherTeleporters: number[];
  /** Dash escapes (Glide) the sim started, each checked against the oracle's landing. */
  glides: number;
  /** The tick on which a team had no champion alive, or -1. */
  eliminatedAt: number;
  /** The tick on which a Skerrow first started a SPACE (a Lunge, EX or not), or -1. */
  firstLunge: number;
  summary: string;
}

/**
  * Plays `TICKS` ticks of a match of bots and checks every tick: the bots leave the state alone,
  * every input is valid, every press passes the oracle of `set` on the state the bot thought on and
  * the sim starts it (or something explains why not), the invariants hold, and the stall tracker is
  * fed.
 */
export function play(set: KitSet, run: MatchRun): Played {
  const { state, bots } = run;
  const tracker = createStallTracker(state, bots);
  const started = state.champions.map(() => 0);
  const slots: Record<string, number> = {};
  const exStarted = state.champions.map(() => 0);
  const ultimates = state.champions.map(() => 0);
  const fired = new Set<number>();
  let killed = false;
  const tally = createTeleportTally();
  const otherTeleporters: number[] = [];
  let eliminatedAt = -1;
  let glides = 0;
  let firstLunge = -1;
  let firstDeath = -1;
  const presses = state.champions.map(() => 0);

  for (let t = 0; t < TICKS; t++) {
    const before = checksum(state);
    const inputs = bots.map((bot) => {
      const input = bot.think(state);
      expect(checksum(state), `tick ${t}`).toBe(before);
      return input;
    });
    const pending: Press[] = [];
    state.champions.forEach((c, id) => {
      const input = inputs[id];
      if (input === undefined) throw new Error(`no input ${id}`);
      expect(validInput(input, kitOf(state, c)), `tick ${t} champion ${id}`).toBe(true);
      const pressed = pressedSlot(input);
      const acted = bots[id]?.inspect();
      if (pressed === null || acted === undefined) return;
      presses[id] = (presses[id] ?? 0) + 1;
      const { problems, key, gates, landing } = pressProblems(state, c, pressed, acted, input, set);
      expect(problems, `tick ${t} champion ${id} pressed ${key}: ${gates}`).toEqual([]);
      const dash = pressed.ex ? null : (ESCAPES[key]?.dash ?? null);
      pending.push({
        id,
        slot: pressed.slot,
        ex: pressed.ex,
        key,
        gates,
        landing,
        dash,
        from: { x: c.x, y: c.y },
      });
    });
    tracker.observe(inputs);
    const tick = state.tick;
    // The inputs are the bots' own records; step reads them and keeps no reference.
    step(state, inputs);

    for (const press of pending) {
      expect(
        explained(state.events, press),
        `tick ${tick} champion ${press.id} pressed ${press.slot}${press.ex ? ' with SHIFT' : ''} and the sim started nothing: ${press.gates}`,
      ).toBe(true);
    }
    // Only the escape teleports are pinned to a landing and to never being blocked: Reaper's Dance
    // teleports after an 18 tick windup, aimed at where the target is when it fires, and may be
    // blocked legitimately, so the tally counts it apart.
    const escapes = pending.filter((press) => press.landing !== null && press.dash === null);
    const found = tallyTeleports(
      tally,
      state.events,
      escapes.map((press) => press.id),
    );
    for (const e of state.events) {
      if (e.type === 'teleport' && !found.includes(e)) otherTeleporters.push(e.championId);
    }
    escapes.forEach((press, n) => {
      const event = found[n];
      if (event === undefined || press.landing === null) return;
      // The sim puts the champion where the oracle found the first landing.
      expect([event.toX, event.toY], `tick ${tick} champion ${press.id} teleport`).toEqual([
        press.landing.x,
        press.landing.y,
      ]);
    });
    // A dash escape: the sim starts a dash from the press, along the direction of the aim the oracle
    // found, which leaves the target (the landing is on the far side of the champion).
    let dashEscapes = 0;
    for (const press of pending) {
      if (press.dash === null || press.landing === null) continue;
      const dashEvent = state.events.find(
        (e) => e.type === 'dashStarted' && e.championId === press.id,
      );
      if (dashEvent === undefined || dashEvent.type !== 'dashStarted') continue;
      dashEscapes++;
      const vx = press.landing.aimX / 100 - press.from.x;
      const vy = press.landing.aimY / 100 - press.from.y;
      const length = Math.hypot(vx, vy);
      expect(Math.abs(dashEvent.dirX - vx / length), `tick ${tick} dash direction x`).toBeLessThan(1e-9);
      expect(Math.abs(dashEvent.dirY - vy / length), `tick ${tick} dash direction y`).toBeLessThan(1e-9);
      expect(dashEvent.distance).toBe(press.dash);
    }
    glides += dashEscapes;
    for (const e of state.events) {
      if (e.type === 'castStarted') {
        if (e.slot === 'SPACE' && state.champions[e.championId]?.championId === 'skerrow') {
          if (firstLunge < 0) firstLunge = tick;
        }
        started[e.championId] = (started[e.championId] ?? 0) + 1;
        const slotKey = `${state.champions[e.championId]?.championId}:${e.slot}`;
        slots[slotKey] = (slots[slotKey] ?? 0) + 1;
        if (e.ex) exStarted[e.championId] = (exStarted[e.championId] ?? 0) + 1;
        if (e.slot === 'F') ultimates[e.championId] = (ultimates[e.championId] ?? 0) + 1;
      } else if (e.type === 'castFired') {
        fired.add(e.championId);
      } else if (e.type === 'death') {
        if (firstDeath < 0) firstDeath = tick;
        const victim = state.champions[e.targetId];
        const killer = state.champions[e.sourceId];
        if (victim && killer && victim.team !== killer.team && fired.has(e.sourceId)) killed = true;
      }
    }
    if (eliminatedAt < 0) {
      const alive = (team: string) => state.champions.some((c) => c.alive && c.team === team);
      if (!alive('A') || !alive('B')) eliminatedAt = state.tick;
    }
    expect(checkInvariants(state)).toEqual([]);
    expect(Number.isFinite(checksum(state))).toBe(true);
  }

  const summary = `first death tick ${firstDeath}; casts ${started.join(',')}; ex ${exStarted.join(',')}; F ${ultimates.join(',')}; escape teleports ${tally.escapes} (${tally.blockedEscapes} blocked), others ${tally.others} (${tally.blockedOthers} blocked); eliminated ${eliminatedAt}; first Lunge ${firstLunge}; dash escapes ${glides}; slots ${JSON.stringify(slots)}; presses ${presses.join(',')}; health ${state.champions.map((c) => `${c.health}/${c.maxHealth}`).join(',')}`;
  return {
    state,
    worst: tracker.worst(),
    started,
    slots,
    exStarted,
    ultimates,
    killed,
    tally,
    otherTeleporters,
    eliminatedAt,
    glides,
    firstLunge,
    summary,
  };
}

export function expectNoStall(played: Played): void {
  const { worst } = played;
  expect(
    worst.length,
    `champion ${worst.id} stalled from tick ${worst.from} for ${worst.length} ticks in ${worst.intent}`,
  ).toBeLessThanOrEqual(120);
}
