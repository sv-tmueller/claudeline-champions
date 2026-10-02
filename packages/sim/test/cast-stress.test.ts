// A seeded random run of both test kits on arena01: random walking, aim, buttons and Shift for all
// four champions, and now and then a test-only write of energy, so that EX variants, ultimates,
// every rejection and every interrupt come up. After every step the ability watcher checks the
// cast, cooldown, windup, energy and movement rules against the state before it, plus the
// collision, status, JSON and checksum oracles. No step may throw.
import { describe, expect, it } from 'vitest';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, MatchConfig, PlayerInput, SimEvent } from '../src/index';
import { nextRandom } from '../src/rng';
import { AbilityWatcher, Coverage } from './ability-watch';
import { arena01 } from './helpers';
import { MENDER_ID, STRIKER_ID, testMender, testStriker } from './kits';

const TICKS = 4000;
const CONFIG: MatchConfig = {
  teamSize: 2,
  players: [
    { championId: STRIKER_ID, team: 'A' },
    { championId: MENDER_ID, team: 'A' },
    { championId: STRIKER_ID, team: 'B' },
    { championId: MENDER_ID, team: 'B' },
  ],
};
const ABILITY_EVENTS: SimEvent['type'][] = [
  'statusApplied', 'statusExpired', 'shieldAbsorbed', 'meleeArc', 'teleport', 'dashStarted',
  'dashEnded', 'castStarted', 'castFired', 'castInterrupted', 'energyGained',
];

interface Run {
  state: GameState;
  problems: string[];
  coverage: Coverage;
}

function between(state: GameState, lo: number, hi: number): number {
  return lo + Math.floor(nextRandom(state) * (hi - lo + 1));
}

/** Each champion picks a fresh walk, aim and buttons every few ticks and keeps them in between. */
function randomInputs(state: GameState, held: PlayerInput[]): PlayerInput[] {
  return state.champions.map((c, i) => {
    const old = held[i];
    if (old && nextRandom(state) < 0.85) return old;
    let buttons = 0;
    for (let bit = 0; bit < 7; bit++) if (nextRandom(state) < 0.3) buttons |= 1 << bit;
    if (nextRandom(state) < 0.3) buttons |= 128;
    const foe = state.champions.find((o) => o.team !== c.team && o.alive);
    const toFoe = nextRandom(state) < 0.6 && foe;
    return {
      moveX: between(state, -1, 1) as -1 | 0 | 1,
      moveY: between(state, -1, 1) as -1 | 0 | 1,
      aimX: toFoe ? Math.round(foe.x * 100) : between(state, -1500, 1500),
      aimY: toFoe ? Math.round(foe.y * 100) : between(state, -1000, 1000),
      buttons,
    };
  });
}

function play(seed: number): Run {
  const state = createMatch(CONFIG, arena01, seed, [testStriker(), testMender()]);
  // Enough health that the champions live long enough for casts to interleave, but still die.
  for (const c of state.champions) c.health = c.maxHealth = 150;
  const watcher = new AbilityWatcher(state, cloneState);
  const coverage = new Coverage();
  let held: PlayerInput[] = [];
  for (let t = 0; t < TICKS; t++) {
    if (nextRandom(state) < 0.03) {
      const id = between(state, 0, 3);
      const champion = state.champions[id];
      if (champion) champion.energy = [0, 24, 25, 60, 98, 100][between(state, 0, 5)] as number;
      watcher.afterEnergySet(state);
      coverage.energyWasSet(id);
    }
    held = randomInputs(state, held);
    const before = cloneState(state);
    watcher.beforeStep(state);
    step(state, held);
    watcher.afterStep(state, held);
    coverage.note(state, before, held);
  }
  return { state, problems: watcher.problems, coverage };
}

describe('cast stress run', () => {
  const run = play(20251003);

  it('keeps every oracle after every step', () => {
    expect(run.problems).toEqual([]);
  });

  it('casts every slot and EX variant, interrupts both ways and rejects casts for most reasons', () => {
    // Three items need a particular moment that the ability fixture scripts: a root on a champion
    // holding a dash, a gain cut by the cap, and an arc that hits two champions.
    const fixtureOnly = ['rejection rooted', 'flag trimmedGain', 'flag arcMany'];
    const missing = run.coverage.missing([testStriker(), testMender()], ABILITY_EVENTS);
    expect(missing.filter((item) => !fixtureOnly.includes(item))).toEqual([]);
    expect(run.coverage.casts.size).toBe(18);
  });

  it('gives the same checksum when run twice', () => {
    expect(checksum(play(20251003).state)).toBe(checksum(run.state));
  });

  it('continues identically from a clone', () => {
    const state = createMatch(CONFIG, arena01, 7, [testStriker(), testMender()]);
    let held: PlayerInput[] = [];
    for (let t = 0; t < 300; t++) {
      held = randomInputs(state, held);
      step(state, held);
    }
    const copy = cloneState(state);
    let heldCopy = held.map((h) => ({ ...h }));
    for (let t = 0; t < 300; t++) {
      // Both draw from the same rng state with the same held inputs, so they stay in step.
      held = randomInputs(state, held);
      step(state, held);
      heldCopy = randomInputs(copy, heldCopy);
      step(copy, heldCopy);
    }
    expect(checksum(copy)).toBe(checksum(state));
  });
});
