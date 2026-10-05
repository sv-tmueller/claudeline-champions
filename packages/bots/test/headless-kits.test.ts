import { describe, expect, it } from 'vitest';
import { Button, SLOTS, checksum, hasLineOfSight, step } from '@claudeline/sim';
import type { ChampionState, GameState, PlayerInput, SimEvent, Slot } from '@claudeline/sim';
import {
  checkInvariants,
  clearShotOracle,
  configMirror,
  createRun,
  createStallTracker,
  kitOf,
  validInput,
} from './helpers';
import { hargrimKit, quillonKit } from './kits';

const TICKS = 3600;
// The death this run asserts depends on these seeds: seeds 301 to 304 give none. A miss
// after a change to the bots or the sim is governed by batch #53 decision 8.3.
const SEEDS = [101, 102, 103, 104];
const TIERS = ['easy', 'normal', 'hard', 'normal'] as const;

interface Band {
  min: number;
  max: number;
}

// The oracle's own band table, written out from the test kits in kits.ts: it must not import the
// code under test. Keys are `champion:SLOT` and `champion:SLOT:ex`. A pressed slot that is not
// here fails the test, so a slot with no band is never pressed.
const BANDS: Record<string, Band> = {
  'hargrim:M1': { min: 0, max: 3 },
  'hargrim:M2': { min: 0, max: 5 },
  'hargrim:M2:ex': { min: 0, max: 5.75 },
  'hargrim:SPACE:ex': { min: 0, max: 9 },
  'hargrim:E': { min: 0, max: 9 },
  'hargrim:F': { min: 0, max: 10 },
  'quillon:M1': { min: 0, max: 14 },
  'quillon:M2': { min: 0, max: 12 },
  'quillon:M2:ex': { min: 0, max: 12 },
  'quillon:Q': { min: 0, max: 10 },
  'quillon:E': { min: 0, max: 18 },
  'quillon:E:ex': { min: 0, max: 18 },
  'quillon:F': { min: 0, max: 20 },
};
/**
 * The width of the shot of each pressed ability, from the kits: the first projectile radius, or the
 * champion radius 0.5 for an ability with no projectile.
 */
const CLEARANCES: Record<string, number> = {
  'hargrim:M1': 0.5,
  'hargrim:M2': 0.5,
  'hargrim:M2:ex': 0.5,
  'hargrim:SPACE:ex': 0.5,
  'hargrim:E': 0.4,
  'hargrim:F': 0.5,
  'quillon:M1': 0.25,
  'quillon:M2': 0.4,
  'quillon:M2:ex': 0.6,
  'quillon:Q': 0.6,
  'quillon:E': 0.2,
  'quillon:E:ex': 0.2,
  'quillon:F': 0.6,
};
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
): { problems: string[]; key: string; gates: string } {
  const key = `${c.championId}:${pressed.slot}${pressed.ex ? ':ex' : ''}`;
  const target = state.champions[targetId];
  const problems: string[] = [];
  const d = target === undefined ? NaN : Math.hypot(c.x - target.x, c.y - target.y);
  const cooldown = c.cooldowns[SLOTS.indexOf(pressed.slot)] ?? Infinity;
  const gates =
    `d ${d}, cooldown ${cooldown}, energy ${c.energy}, windupLeft ${c.cast?.windupLeft ?? 'none'}, ` +
    `statuses ${c.statuses.map((s) => s.type).join(',') || 'none'}`;
  const band = BANDS[key];
  if (band === undefined) problems.push(`${key} has no reach band in the oracle table`);
  if (target === undefined || !target.alive || target.team === c.team) {
    problems.push(`target ${targetId} is not an alive enemy`);
  } else {
    if (!hasLineOfSight(state, c, target)) problems.push('no line of sight');
    const clearance = CLEARANCES[key];
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

describe('headless 2v2 match of bots with kits', () => {
  it('a 2v2 of four bots on two kits ends with a death from a cast within 3600 ticks', () => {
    const run = createRun(SEEDS, TIERS, 7, { config: configMirror(), kits: [hargrimKit(), quillonKit()] });
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
        const { problems, key, gates } = pressProblems(state, c, pressed, acted.targetId);
        expect(problems, `tick ${t} champion ${id} pressed ${key}: ${gates}`).toEqual([]);
        pending.push({ id, slot: pressed.slot, ex: pressed.ex, key, gates });
      });
      tracker.observe(inputs);
      const tick = state.tick;
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
    expect(killed, summary).toBe(true);
    state.champions.forEach((c, id) => {
      expect(started[id], `champion ${id} started no cast: ${summary}`).toBeGreaterThan(0);
    });
    expect(
      exStarted.some((n) => n > 0),
      `no EX cast: ${summary}`,
    ).toBe(true);
    expect(state.tick).toBe(TICKS);
    const worst = tracker.worst();
    expect(
      worst.length,
      `champion ${worst.id} stalled from tick ${worst.from} for ${worst.length} ticks in ${worst.intent}`,
    ).toBeLessThanOrEqual(120);
  }, 30_000);
});
