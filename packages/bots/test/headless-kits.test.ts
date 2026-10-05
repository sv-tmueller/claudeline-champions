import { describe, expect, it } from 'vitest';
import { Button, SLOTS, checksum, hasLineOfSight, step } from '@claudeline/sim';
import type { ChampionState, GameState, MatchConfig, PlayerInput, SimEvent, Slot } from '@claudeline/sim';
import type { AbilitySpec, KitDef } from '@claudeline/sim';
import type { MatchRun } from './helpers';
import {
  checkInvariants,
  clearShotOracle,
  configMirror,
  createRun,
  createStallTracker,
  jsonKits,
  kitOf,
  validInput,
} from './helpers';
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

interface Band {
  min: number;
  max: number;
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

const HARGRIM_BANDS: Record<string, Band> = {
  'hargrim:M1': { min: 0, max: 3 },
  'hargrim:M2': { min: 0, max: 5 },
  'hargrim:M2:ex': { min: 0, max: 5.75 },
  'hargrim:SPACE:ex': { min: 0, max: 9 },
  'hargrim:E': { min: 0, max: 9 },
  'hargrim:F': { min: 0, max: 10 },
};
const HARGRIM_CLEARANCES: Record<string, number> = {
  'hargrim:M1': 0.5,
  'hargrim:M2': 0.5,
  'hargrim:M2:ex': 0.5,
  'hargrim:SPACE:ex': 0.5,
  'hargrim:E': 0.4,
  'hargrim:F': 0.5,
};

const KIT_SETS: KitSet[] = [
  {
    // packages/bots/test/kits.ts: Quillon with speeds and lifetimes that give exact decimal reaches.
    name: 'the test kits',
    kits: () => [hargrimKit(), quillonKit()],
    bands: {
      ...HARGRIM_BANDS,
      'quillon:M1': { min: 0, max: 14 },
      'quillon:M2': { min: 0, max: 12 },
      'quillon:M2:ex': { min: 0, max: 12 },
      'quillon:Q': { min: 0, max: 10 },
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
      'quillon:Q': { min: 0, max: 10 },
      'quillon:E': { min: 0, max: (25 * 43) / 60 },
      'quillon:E:ex': { min: 0, max: (25 * 43) / 60 },
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
];
/** The pressed abilities that hold a dash, which a root skips. */
const DASHES = new Set(['hargrim:SPACE:ex', 'hargrim:F']);
const MARGIN = 1;
const EX_COST = 25;
const ULTIMATE_COST = 100;

interface Press {
  id: number;
  slot: Slot;
  ex: boolean;
  key: string;
  gates: string;
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
  targetId: number,
  set: KitSet,
): { problems: string[]; key: string; gates: string } {
  const key = `${c.championId}:${pressed.slot}${pressed.ex ? ':ex' : ''}`;
  const target = state.champions[targetId];
  const problems: string[] = [];
  const d = target === undefined ? NaN : Math.hypot(c.x - target.x, c.y - target.y);
  const cooldown = c.cooldowns[SLOTS.indexOf(pressed.slot)] ?? Infinity;
  const gates =
    `d ${d}, cooldown ${cooldown}, energy ${c.energy}, windupLeft ${c.cast?.windupLeft ?? 'none'}, ` +
    `statuses ${c.statuses.map((s) => s.type).join(',') || 'none'}`;
  const band = set.bands[key];
  if (band === undefined) problems.push(`${key} has no reach band in the oracle table`);
  if (target === undefined || !target.alive || target.team === c.team) {
    problems.push(`target ${targetId} is not an alive enemy`);
  } else {
    if (!hasLineOfSight(state, c, target)) problems.push('no line of sight');
    const clearance = set.clearances[key];
    if (clearance !== undefined && !clearShotOracle(state, c, target, clearance)) {
      problems.push(`no clear shot of width ${clearance}`);
    }
    if (band !== undefined && !(band.min <= d && d <= band.max - MARGIN)) {
      problems.push(`distance ${d} outside [${band.min}, ${band.max - MARGIN}]`);
    }
  }
  if (cooldown > 1) problems.push(`cooldown ${cooldown} above 1`);
  const cost = pressed.slot === 'F' ? ULTIMATE_COST : pressed.ex ? EX_COST : 0;
  if (c.energy < cost) problems.push(`energy ${c.energy} below ${cost}`);
  if (hasStatus(c, 'stun') || hasStatus(c, 'silence')) problems.push('stunned or silenced');
  if (hasStatus(c, 'root') && DASHES.has(key)) problems.push('rooted and the ability holds a dash');
  if (c.cast !== null && c.cast.windupLeft !== 1) problems.push(`windupLeft ${c.cast.windupLeft}`);
  return { problems, key, gates };
}

/** Whether the sim may have refused this press in the step, for a reason other than the bot's gates. */
function explained(events: readonly SimEvent[], press: Press): boolean {
  for (const e of events) {
    if (e.type === 'castStarted' && e.championId === press.id && e.slot === press.slot && e.ex === press.ex) {
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
  exStarted: number[];
  ultimates: number[];
  /** A champion that had a cast fire killed an enemy. */
  killed: boolean;
  summary: string;
}

/**
 * Plays `TICKS` ticks of a match of bots and checks every tick: the bots leave the state alone, every
 * input is valid, every press passes the oracle of `set` on the state the bot thought on and the sim
 * starts it (or something explains why not), the invariants hold, and the stall tracker is fed.
 */
function play(set: KitSet, run: MatchRun): Played {
  const { state, bots } = run;
  const tracker = createStallTracker(state, bots);
  const started = state.champions.map(() => 0);
  const exStarted = state.champions.map(() => 0);
  const ultimates = state.champions.map(() => 0);
  const fired = new Set<number>();
  let killed = false;
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
      const { problems, key, gates } = pressProblems(state, c, pressed, acted.targetId, set);
      expect(problems, `tick ${t} champion ${id} pressed ${key}: ${gates}`).toEqual([]);
      pending.push({ id, slot: pressed.slot, ex: pressed.ex, key, gates });
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
    for (const e of state.events) {
      if (e.type === 'castStarted') {
        started[e.championId] = (started[e.championId] ?? 0) + 1;
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
    expect(checkInvariants(state)).toEqual([]);
    expect(Number.isFinite(checksum(state))).toBe(true);
  }

  const summary = `first death tick ${firstDeath}; casts ${started.join(',')}; ex ${exStarted.join(',')}; F ${ultimates.join(',')}; presses ${presses.join(',')}; health ${state.champions.map((c) => `${c.health}/${c.maxHealth}`).join(',')}`;
  return { state, worst: tracker.worst(), started, exStarted, ultimates, killed, summary };
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
    expectNoStall(played);
  }, 30_000);

  // The 2v2 above ends its fights by tick 700 with the energy bar at 75 at most (the energy of a
  // champion comes from damage, and four champions die quickly), so the ultimate never fires in it:
  // 9000 matches of that mirror on the shipped kits (seeds 4 to 12003 in groups of four, three tier
  // sets, each stopped when one champion was left) gave no F cast. A 3v3 (Hargrim and two Quillons a side) lasts longer and its bar reaches 100. These
  // seeds and tiers are pinned for this criterion alone; the death run above keeps its seeds.
  it('a 3v3 of six bots on two kits starts an ultimate within 3600 ticks', () => {
    const run = createRun(ULTIMATE_SEEDS, ULTIMATE_TIERS, 7, { config: config3v3(), kits: set.kits() });
    const played = play(set, run);
    expect(
      played.ultimates.some((n) => n > 0),
      `no F cast: ${played.summary}`,
    ).toBe(true);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);
});

// The run presses only some slots, so a wrong row of a table could go unseen. This reads the
// kit files and works every row out again, by the rule of docs/architecture/bots.md (the end of
// the first effect that reaches an enemy) written here by hand for the shapes these kits use.
describe('the band and clearance tables of the shipped kits', () => {
  const set = KIT_SETS[1] as KitSet;
  const kits = jsonKits();
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
      expect(set.bands[`quillon:${key}`], key).toEqual({
        min: 0,
        max: (bolt.speed * bolt.lifetimeTicks) / 60,
      });
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
    expect(set.bands['hargrim:SPACE:ex']).toEqual({ min: 0, max: dash.distance + burst.radius + 0.5 });
    const hook = projectile(slotOf('hargrim', 'E'));
    expect(set.bands['hargrim:E']).toEqual({ min: 0, max: (hook.speed * hook.lifetimeTicks) / 60 });
    expect(set.clearances['hargrim:E']).toBe(hook.radius);
    const ultimate = slotOf('hargrim', 'F').effects[0];
    if (ultimate === undefined || ultimate.type !== 'dash') throw new Error('no dash');
    const slam = ultimate.then[0];
    if (slam === undefined || slam.type !== 'area') throw new Error('no slam');
    expect(set.bands['hargrim:F']).toEqual({ min: 0, max: ultimate.distance + slam.radius + 0.5 });
  });
});
