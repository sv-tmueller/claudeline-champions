import { describe, expect, it } from 'vitest';
import { Button, SLOTS, checksum, hasLineOfSight, step } from '@claudeline/sim';
import type { ChampionState, GameState, MatchConfig, PlayerInput, SimEvent, Slot } from '@claudeline/sim';
import type { AbilitySpec, KitDef } from '@claudeline/sim';
import { WITHIN, oracleCornered, oracleLanding, triggerProblems } from './escape-oracle';
import type { EscapeRow, OracleLanding } from './escape-oracle';
import type { MatchRun } from './helpers';
import {
  checkInvariants,
  clearShotOracle,
  configMirror,
  configLumeth,
  configSkerrow,
  createRun,
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

const TICKS = 3600;
// The death this run asserts depends on these seeds: seeds 301 to 304 give none. A miss
// after a change to the bots, the sim or the Node version is governed by batch #53 decision 8.3.
const SEEDS = [101, 102, 103, 104];
const TIERS = ['easy', 'normal', 'hard', 'normal'] as const;
// The 3v3 that must start an ultimate: seeds and tiers pinned for that alone (see its test).
const ULTIMATE_SEEDS = [101, 102, 103, 104, 105, 106];
const ULTIMATE_TIERS = ['hard', 'hard', 'hard', 'hard', 'hard', 'hard'] as const;

/** Hargrim and two Quillons on each team. */
function config3v3(): MatchConfig {
  return {
    teamSize: 3,
    players: [
      { championId: 'hargrim', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'hargrim', team: 'B' },
      { championId: 'quillon', team: 'B' },
      { championId: 'quillon', team: 'B' },
    ],
  };
}

/**
 * A band of centre distances. A row without `margin` is a kit band, tested with the 1 m range
 * margin off its top; an opener row (see bots.md, Openers and escapes) is the literal band with
 * `margin: 0`. `motion` is the condition of an opener: the target walks away from the champion or
 * toward it, by the sign of (target - champion) . target velocity. `needs` is the other one.
 */
interface Band {
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
interface KitSet {
  name: string;
  kits: () => KitDef[];
  bands: Record<string, Band>;
  clearances: Record<string, number>;
}

/**
 * The escape rows, the same for both kit sets (Skip is a 4 m teleport in each; it is fixed in the
 * shipped kit and not in the test kit, which the oracle does not need: it reads the landing from
 * the sim). An escape press has no band and no shot test: it needs the trigger (a retreat with the
 * target within 6 m, or a kite inside rangeMin), and for a teleport a landing that the oracle finds
 * by its own first-of-five search. Hush Ward is pressed only when Skip is not ready or has none.
 */
const ESCAPES: Record<string, EscapeRow> = {
  'hargrim:R': { slot: 'R', teleport: null, after: null },
  'quillon:SPACE': { slot: 'SPACE', teleport: 4, after: null },
  'quillon:R': { slot: 'R', teleport: null, after: { slot: 'SPACE', teleport: 4 } },
  // Vanish Step: a 5 m teleport that is not fixed (the shipped Skerrow kit only).
  'skerrow:R': { slot: 'R', teleport: 5, after: null },
  // Lantern Burst: the trigger is Lumeth's own (3 m, any intent but idle), and it costs nothing.
  'lumeth:E': { slot: 'E', teleport: null, after: null },
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
const HELD: Record<string, number> = { 'skerrow:F': 40 };

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

// data/kits/lumeth.json, in the shipped set only: Soothing Bolt is a bolt of 20 m/s for 36 ticks
// (12 m); Binding Sigil is an area at the aim, range 9 plus radius 1.5 plus 0.5, an opener at a
// target beside an ally; Lantern Burst is an area around her, radius 3 plus 0.5, which she presses
// as an escape (the row in `ESCAPES`; the band is the kit's and is never what presses it, because
// her trigger reaches farther than its top); Dawnbloom is read from its second area, the slow on
// enemies (radius 5 plus 0.5). Her ally presses (M2, R, and Dawnbloom and the bolt at an ally) have
// no row yet: none of them is pressed, and one that is fails the run.
const LUMETH_BANDS: Record<string, Band> = {
  'lumeth:M1': { min: 0, max: (20 * 36) / 60 },
  'lumeth:Q': { min: 0, max: 11, needs: 'nearAlly' },
  'lumeth:E': { min: 0, max: 3.5 },
  'lumeth:F': { min: 0, max: 5.5 },
};
const LUMETH_CLEARANCES: Record<string, number> = {
  'lumeth:M1': 0.35,
  'lumeth:Q': 0.5,
  'lumeth:E': 0.5,
  'lumeth:F': 0.5,
};

const KIT_SETS: KitSet[] = [
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
  },
];

/** The shipped set with Lumeth's kit: `jsonKits()` has no Lumeth, so the plain runs stay as they were. */
const LUMETH_SET: KitSet = { ...(KIT_SETS[1] as KitSet), name: 'the four shipped kits', kits: rosterKits };
/** The pressed abilities that start with a dash, which a root skips and an escape think holds. */
const DASHES = new Set([
  'hargrim:SPACE',
  'hargrim:SPACE:ex',
  'hargrim:F',
  'skerrow:SPACE',
  'skerrow:SPACE:ex',
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
  /** Where the oracle says an escape teleport lands, for the check after the step. */
  landing: OracleLanding | null;
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
  const held = pressed.ex ? undefined : HELD[key];
  if (
    held !== undefined &&
    target !== undefined &&
    !(target.health <= held || oracleCornered(state, target, c))
  ) {
    problems.push(`${key} pressed at a target with ${target.health} health that is not cornered`);
  }
  if (band === undefined && escape === undefined) {
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
    if (escape.after !== null) {
      const { slot: firstSlot, teleport } = escape.after;
      const ready = (c.cooldowns[SLOTS.indexOf(firstSlot)] ?? Infinity) <= 1;
      if (ready && oracleLanding(state, c, target, firstSlot, teleport) !== null) {
        problems.push(`${key} pressed with ${firstSlot} ready and a landing`);
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
  if (target !== undefined && DASHES.has(key) && triggerProblems(c, target, acted.intent).length === 0) {
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
interface Played {
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
function play(set: KitSet, run: MatchRun): Played {
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
      pending.push({ id, slot: pressed.slot, ex: pressed.ex, key, gates, landing });
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
    const escapes = pending.filter((press) => press.landing !== null);
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

  const summary = `first death tick ${firstDeath}; casts ${started.join(',')}; ex ${exStarted.join(',')}; F ${ultimates.join(',')}; escape teleports ${tally.escapes} (${tally.blockedEscapes} blocked), others ${tally.others} (${tally.blockedOthers} blocked); eliminated ${eliminatedAt}; first Lunge ${firstLunge}; slots ${JSON.stringify(slots)}; presses ${presses.join(',')}; health ${state.champions.map((c) => `${c.health}/${c.maxHealth}`).join(',')}`;
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
    firstLunge,
    summary,
  };
}

function expectNoStall(played: Played): void {
  const { worst } = played;
  expect(
    worst.length,
    `champion ${worst.id} stalled from tick ${worst.from} for ${worst.length} ticks in ${worst.intent}`,
  ).toBeLessThanOrEqual(120);
}

describe.each(KIT_SETS)('headless matches of bots with $name', (set) => {
  it('a 2v2 of four bots on two kits ends with a death from a cast within 3600 ticks', () => {
    const run = createRun(SEEDS, TIERS, 7, { config: configMirror(), kits: set.kits() });
    const played = play(set, run);
    expect(played.killed, played.summary).toBe(true);
    played.state.champions.forEach((c, id) => {
      expect(played.started[id], `champion ${id} started no cast: ${played.summary}`).toBeGreaterThan(0);
    });
    expect(
      played.exStarted.some((n) => n > 0),
      `no EX cast: ${played.summary}`,
    ).toBe(true);
    expect(played.state.tick).toBe(TICKS);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expectNoStall(played);
  }, 30_000);

  // The 2v2 above ends its fights by tick 700 with the energy bar at 75 at most (the energy of a
  // champion comes from damage, and four champions die quickly), so the ultimate never fires in it:
  // 9000 matches of that mirror on the shipped kits (seeds 4 to 12003 in groups of four, three tier
  // sets, each stopped when one champion was left) gave no F cast. A 3v3 (Hargrim and two Quillons
  // a side) lasts longer and its bar reaches 100. These seeds and tiers are pinned for this
  // criterion alone; the death run above keeps its seeds.
  it('a 3v3 of six bots on two kits starts an ultimate within 3600 ticks', () => {
    const config = config3v3();
    const run = createRun(ULTIMATE_SEEDS, ULTIMATE_TIERS, 7, { config, kits: set.kits() });
    const played = play(set, run);
    expect(
      played.ultimates.some((n) => n > 0),
      `no F cast: ${played.summary}`,
    ).toBe(true);
    expect(played.state.tick).toBe(TICKS);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expectNoStall(played);
  }, 30_000);
});

describe('a headless match with Skerrow on the shipped kits', () => {
  const set = KIT_SETS[1] as KitSet;
  const NORMAL = ['normal', 'normal', 'normal', 'normal'] as const;

  // Free play with no match flow: one team has no champion left by tick 3600 (a round is 5400 ticks
  // in match flow, which would decide the same way). Pinned seeds: a miss after a change to the
  // bots, the sim or the Node version is governed by batch #53 decision 8.3.
  it('Skerrow and Quillon against Hargrim and Quillon: a team is eliminated by tick 3600', () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configSkerrow(), kits: set.kits() });
    const played = play(set, run);
    expect(played.eliminatedAt, played.summary).toBeGreaterThan(0);
    expect(played.eliminatedAt, played.summary).toBeLessThanOrEqual(TICKS);
    expect(played.firstLunge, `Skerrow started no Lunge: ${played.summary}`).toBeGreaterThanOrEqual(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);

  // The same match with a start edit that makes Reaper's Dance reachable: Skerrow at 100 energy and
  // both enemies at 40 health, the damage F does, so the hold lets it go. It runs the whole play
  // loop, so the oracle's Skerrow F row (the hold, the band, the clear shot, the gates) runs on a
  // real press. One run: a miss after a change to the bots, the sim or the Node version is governed
  // by batch #53 decision 8.3; the fallback is Skerrow against a Quillon at 40 health, the other
  // two champions dead, 9 m apart.
  it("Skerrow starts Reaper's Dance at a target at 40 health, and no escape teleport is blocked", () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configSkerrow(), kits: set.kits() });
    const skerrow = run.state.champions[0] as ChampionState;
    skerrow.energy = 100;
    for (const id of [2, 3]) (run.state.champions[id] as ChampionState).health = 40;
    const played = play(set, run);
    expect(played.ultimates[0], played.summary).toBeGreaterThan(0);
    // The teleport counted apart is Skerrow's own (champion 0): Reaper's Dance, not another's.
    expect(played.tally.others, played.summary).toBeGreaterThan(0);
    expect(played.otherTeleporters, played.summary).toEqual(Array(played.tally.others).fill(0));
    expect(played.tally.escapes, played.summary).toBe(2);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);
});

describe('a headless match with Lumeth on the four shipped kits', () => {
  const NORMAL = ['normal', 'normal', 'normal', 'normal'] as const;

  // Free play, 3600 ticks, pinned seeds: a miss after a change to the bots, the sim or the Node
  // version is governed by batch #53 decision 8.3. Her ally presses are not in this package, so the
  // oracle has no row for them and a run that presses one fails.
  it('Hargrim and Lumeth against Hargrim and Quillon: every press passes the oracle', () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configLumeth(), kits: LUMETH_SET.kits() });
    const played = play(LUMETH_SET, run);
    expect(played.eliminatedAt, played.summary).toBeGreaterThan(0);
    expect(played.slots['lumeth:M1'], `Lumeth started no M1: ${played.summary}`).toBeGreaterThan(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);

  // The same match with a declared start edit: the enemy Hargrim stands 2 m east of Lumeth on tick
  // 0, so her trigger (3 m) holds at once and Lantern Burst is pressed through the oracle's escape
  // row. In the unedited run above she is never that close to anyone with E ready.
  it('Lumeth presses Lantern Burst at a Hargrim 2 m away on tick 0', () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configLumeth(), kits: LUMETH_SET.kits() });
    const lumeth = run.state.champions[1] as ChampionState;
    const hargrim = run.state.champions[2] as ChampionState;
    hargrim.x = lumeth.x + 2;
    hargrim.y = lumeth.y;
    const played = play(LUMETH_SET, run);
    expect(played.slots['lumeth:E'], `Lumeth started no Lantern Burst: ${played.summary}`).toBeGreaterThan(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);
});

// The run presses only some slots, so a wrong row of a table could go unseen. This reads the
// kit files and works every row out again, by the rule of docs/architecture/bots.md (the end of
// the first effect that reaches an enemy) written here by hand for the shapes these kits use.
describe('the band and clearance tables of the shipped kits', () => {
  const set = KIT_SETS[1] as KitSet;
  const kits = rosterKits();
  const slotOf = (id: string, key: string): AbilitySpec => {
    const kit = kits.find((k) => k.id === id) as KitDef;
    const [slot, variant] = key.split(':') as [Slot, string | undefined];
    const base = kit.slots[slot];
    return variant === 'ex' ? (base.ex as AbilitySpec) : base;
  };
  const projectile = (spec: AbilitySpec) => {
    const effect = spec.effects[0];
    if (effect === undefined || effect.type !== 'projectile') throw new Error('not a projectile');
    return effect;
  };

  it('has the reach and the shot width of every Quillon bolt', () => {
    for (const key of ['M1', 'M2', 'M2:ex', 'Q', 'E', 'E:ex', 'F']) {
      const bolt = projectile(slotOf('quillon', key));
      // The speed is multiplied by the lifetime first: 22 x 38 / 60, not 22 x (38 / 60).
      const reach = { min: 0, max: (bolt.speed * bolt.lifetimeTicks) / 60 };
      // Snare Orb is an opener: the kit band less the margin, and a target walking toward her.
      expect(set.bands[`quillon:${key}`], key).toEqual(
        key === 'Q' ? { ...reach, motion: 'closing' } : reach,
      );
      expect(set.clearances[`quillon:${key}`], key).toBe(bolt.radius);
    }
  });

  it('has the reach and the shot width of every Hargrim ability that is pressed', () => {
    const arc = slotOf('hargrim', 'M1').effects[0];
    if (arc === undefined || arc.type !== 'meleeArc') throw new Error('no arc');
    expect(set.bands['hargrim:M1']).toEqual({ min: 0, max: arc.radius + 0.5 });
    for (const key of ['M2', 'M2:ex']) {
      const area = slotOf('hargrim', key).effects[0];
      if (area === undefined || area.type !== 'area' || area.placement.type !== 'ahead') {
        throw new Error('no area ahead');
      }
      expect(set.bands[`hargrim:${key}`], key).toEqual({
        min: 0,
        max: area.placement.distance + area.radius + 0.5,
      });
    }
    const dash = slotOf('hargrim', 'SPACE:ex').effects[0];
    if (dash === undefined || dash.type !== 'dash') throw new Error('no dash');
    const burst = dash.then[0];
    if (burst === undefined || burst.type !== 'area') throw new Error('no burst');
    const burstReach = dash.distance + burst.radius + 0.5;
    expect(set.bands['hargrim:SPACE:ex']).toEqual({ min: 0, max: burstReach });
    const hook = projectile(slotOf('hargrim', 'E'));
    // Chain Hook is an opener: the roster's literal 4 to 7 m, with no margin, at a target walking
    // away. It lies inside the kit band less the margin, so it only restricts the press.
    expect(set.bands['hargrim:E']).toEqual({ min: 4, max: 7, margin: 0, motion: 'away' });
    expect(7).toBeLessThanOrEqual((hook.speed * hook.lifetimeTicks) / 60 - 1);
    expect(set.clearances['hargrim:E']).toBe(hook.radius);
    // Rush is the base dash: [D - 1, D] with no margin, a dash that a root skips.
    const rush = slotOf('hargrim', 'SPACE').effects[0];
    if (rush === undefined || rush.type !== 'dash') throw new Error('no dash');
    expect(set.bands['hargrim:SPACE']).toEqual({ min: rush.distance - 1, max: rush.distance, margin: 0 });
    expect(set.clearances['hargrim:SPACE']).toBe(0.5);
    const ultimate = slotOf('hargrim', 'F').effects[0];
    if (ultimate === undefined || ultimate.type !== 'dash') throw new Error('no dash');
    const slam = ultimate.then[0];
    if (slam === undefined || slam.type !== 'area') throw new Error('no slam');
    expect(set.bands['hargrim:F']).toEqual({ min: 0, max: ultimate.distance + slam.radius + 0.5 });
  });

  it('has the reach, the width, the Lunge band and the hold of every Skerrow ability', () => {
    const shipped = KIT_SETS[1] as KitSet;
    const arcOf = (spec: AbilitySpec) => {
      const effect = spec.effects[0];
      if (effect === undefined || effect.type !== 'meleeArc') throw new Error('no arc');
      return effect;
    };
    expect(shipped.bands['skerrow:M1']).toEqual({ min: 0, max: arcOf(slotOf('skerrow', 'M1')).radius + 0.5 });
    for (const key of ['E', 'E:ex']) {
      expect(shipped.bands[`skerrow:${key}`], key).toEqual({
        min: 0,
        max: arcOf(slotOf('skerrow', key)).radius + 0.5,
      });
    }
    for (const key of ['M2', 'Q']) {
      const bolt = projectile(slotOf('skerrow', key));
      // Quiet Dart is an opener: the kit band less the margin, at a target with an escape ready.
      const reach = { min: 0, max: (bolt.speed * bolt.lifetimeTicks) / 60 };
      expect(shipped.bands[`skerrow:${key}`], key).toEqual(
        key === 'Q' ? { ...reach, needs: 'escapeReady' } : reach,
      );
      expect(shipped.clearances[`skerrow:${key}`], key).toBe(bolt.radius);
    }
    // Lunge: the base dash gives [D - 1, D] with no margin; the EX dash its distance plus its arc.
    const lunge = slotOf('skerrow', 'SPACE').effects[0];
    if (lunge === undefined || lunge.type !== 'dash') throw new Error('no dash');
    expect(shipped.bands['skerrow:SPACE']).toEqual({ min: lunge.distance - 1, max: lunge.distance, margin: 0 });
    const exLunge = slotOf('skerrow', 'SPACE:ex').effects[0];
    if (exLunge === undefined || exLunge.type !== 'dash') throw new Error('no dash');
    const exArc = exLunge.then[0];
    if (exArc === undefined || exArc.type !== 'meleeArc') throw new Error('no arc');
    expect(shipped.bands['skerrow:SPACE:ex']).toEqual({ min: 0, max: exLunge.distance + exArc.radius + 0.5 });
    // Reaper's Dance: the teleport plus its arc; held for a target at or below the damage it does.
    const [jump, reap] = slotOf('skerrow', 'F').effects;
    if (jump === undefined || jump.type !== 'teleport') throw new Error('no teleport');
    if (reap === undefined || reap.type !== 'meleeArc') throw new Error('no arc');
    expect(shipped.bands['skerrow:F']).toEqual({ min: 0, max: jump.range + reap.radius + 0.5 });
    const damage = reap.effects.find((e) => e.type === 'damage');
    expect(damage?.type === 'damage' && damage.amount).toBe(HELD['skerrow:F']);
    // Vanish Step: a teleport the oracle finds a landing for.
    const vanish = slotOf('skerrow', 'R').effects[0];
    if (vanish === undefined || vanish.type !== 'teleport') throw new Error('no teleport');
    expect(ESCAPES['skerrow:R']?.teleport).toBe(vanish.range);
    expect(vanish.fixed).toBe(false);
    const skip = slotOf('quillon', 'SPACE').effects[0];
    if (skip === undefined || skip.type !== 'teleport') throw new Error('no teleport');
    expect(ESCAPES['quillon:SPACE']?.teleport).toBe(skip.range);
    expect(ESCAPES['quillon:R']?.after?.teleport).toBe(skip.range);
  });
  it('has the reach, the width, the opener condition and the escape of every Lumeth ability that is pressed', () => {
    const shipped = KIT_SETS[1] as KitSet;
    const bolt = projectile(slotOf('lumeth', 'M1'));
    expect(shipped.bands['lumeth:M1']).toEqual({ min: 0, max: (bolt.speed * bolt.lifetimeTicks) / 60 });
    expect(shipped.clearances['lumeth:M1']).toBe(bolt.radius);
    // Binding Sigil: the area at the aim, range plus radius plus 0.5, at a target beside an ally.
    const sigil = slotOf('lumeth', 'Q').effects[0];
    if (sigil === undefined || sigil.type !== 'area' || sigil.placement.type !== 'aim') {
      throw new Error('no area at the aim');
    }
    expect(shipped.bands['lumeth:Q']).toEqual({
      min: 0,
      max: sigil.placement.range + sigil.radius + 0.5,
      needs: 'nearAlly',
    });
    expect(shipped.clearances['lumeth:Q']).toBe(0.5);
    // Lantern Burst: an area around her; the trigger of the oracle is her 3 m.
    const burst = slotOf('lumeth', 'E').effects[0];
    if (burst === undefined || burst.type !== 'area') throw new Error('no area');
    expect(shipped.bands['lumeth:E']).toEqual({ min: 0, max: burst.radius + 0.5 });
    expect(ESCAPES['lumeth:E']).toEqual({ slot: 'E', teleport: null, after: null });
    expect(WITHIN['lumeth']).toBe(3);
    // Dawnbloom, read from its slow on enemies, the second area.
    const slow = slotOf('lumeth', 'F').effects[1];
    if (slow === undefined || slow.type !== 'area' || slow.targets !== 'enemies') {
      throw new Error('no area on enemies');
    }
    expect(shipped.bands['lumeth:F']).toEqual({ min: 0, max: slow.radius + 0.5 });
    // Soothing Surge has no enemy effect and so no band row.
    expect(shipped.bands['lumeth:M2']).toBeUndefined();
  });
});
