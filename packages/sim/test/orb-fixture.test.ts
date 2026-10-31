// Scripted energy orb fixture test (#218).
//
// The fixture runs a match with `roundsToWin: 2` and `energyOrb: { x: 0, y: 2.5 }` on arena01 with
// a striker and a mender on each team (`test/kits.ts`, which stays frozen), seed 1. It holds inputs
// only, in the format of the rounds fixture: a segment holds its inputs for `ticks` ticks, and an
// entry is [moveX, moveY, aimX, aimY, buttons], or null for a missing input. `checkpoints` hold the
// checksum of the whole state after the step that makes `state.tick` equal to `tick`; `checksum`
// is the one after the last tick. Round 1 starts at tick 180 and round 2 at tick 2237, so the
// warning comes at ticks 1201 and 3258 and the first collectible step makes ticks 1381 and 3438.
//
// How the committed script was made: a throwaway generator (not committed) ran the match and chose
// each tick's inputs from the live state, then recorded them. Every locked tick (warmup, each
// pause, the match end) holds the same non-zero move, aim and buttons for all four, as in the
// rounds fixture.
// - Round 1: the strikers (ids 0 and 2) walk along y = 2 to (-0.7, 2) and (0.7, 2), each 0.86 m
//   from the orb, and stand there. On the first collectible step both touch it, so the seeded RNG
//   draws once and picks one of them (with seed 1, id 2). The menders stand at their spawns. Then
//   the striker of team A (id 0) kills the enemy striker and the enemy mender with M1 and wins.
// - Round 2: the mender of team A (id 1) walks to (0, 3.4), 0.9 m from the orb, and darts the enemy
//   striker, who stands at (4, 2), with M2 until it has 80 energy (eight hits). Its own striker
//   waits at (-4, 2). On the first collectible step the mender is alone on the orb and takes it:
//   the 25 energy are cut to 20 and it holds 100. Then the enemy striker walks to (0.7, 2), touches
//   the orb and nothing happens, and the striker of team A kills both enemies.
// - After the match end the locked inputs run on for 100 more ticks, up to a multiple of 100.
// The checksums were then set to 0, `npx vitest run --project sim
// packages/sim/test/orb-fixture.test.ts` run, and the actual values copied in. Changing gameplay or
// `test/kits.ts` on purpose means regenerating them the same way in the same change.
//
// The ability ledger of `ability-watch.ts` is not run here: it knows no orb energy. The match
// oracles `RoundWatcher` and `checkEveryStep`, which know the orb, run at every step.
import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/scripted-orb-arena01-2v2.json';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, MatchConfig, PlayerInput, SimEvent } from '../src/index';
import { nextRandom } from '../src/rng';
import { EVENT_FIXTURE, arena01 } from './helpers';
import { testMender, testStriker } from './kits';
import { RoundWatcher, checkEveryStep, checkMatchInvariants } from './round-watch';

type Entry = [number, number, number, number, number] | null;

interface Segment {
  ticks: number;
  inputs: Entry[];
}

interface Checkpoint {
  tick: number;
  checksum: number;
}

interface Fixture {
  format: 1;
  arena: 'arena01';
  seed: number;
  config: MatchConfig;
  ticks: number;
  segments: Segment[];
  checkpoints: Checkpoint[];
  checksum: number;
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function decodeFixture(data: unknown): Fixture {
  const f = data as Fixture;
  if (f.format !== 1) throw new Error('fixture format must be 1');
  if (f.arena !== 'arena01') throw new Error('fixture arena must be arena01');
  if (!isInt(f.seed)) throw new Error('fixture seed must be an integer');
  if (!isInt(f.checksum)) throw new Error('fixture checksum must be an integer');
  if (f.config.roundsToWin !== 2) throw new Error('roundsToWin must be 2');
  if (f.config.energyOrb?.x !== 0 || f.config.energyOrb.y !== 2.5) throw new Error('energyOrb must be (0, 2.5)');
  const ids = f.config.players.map((p) => p.championId);
  if (ids.join() !== 'test-striker,test-mender,test-striker,test-mender') {
    throw new Error('players must be striker A, mender A, striker B, mender B');
  }
  let total = 0;
  f.segments.forEach((segment, s) => {
    if (!isInt(segment.ticks) || segment.ticks <= 0) throw new Error(`segment ${s}: bad ticks`);
    if (segment.inputs.length !== f.config.players.length) {
      throw new Error(`segment ${s}: expected ${f.config.players.length} inputs`);
    }
    for (const entry of segment.inputs) {
      if (entry === null) continue;
      const [moveX, moveY, , , buttons] = entry;
      const ok =
        entry.length === 5 &&
        entry.every(isInt) &&
        Math.abs(moveX) <= 1 &&
        Math.abs(moveY) <= 1 &&
        buttons >= 0 &&
        buttons <= 255;
      if (!ok) throw new Error(`segment ${s}: bad input ${JSON.stringify(entry)}`);
    }
    total += segment.ticks;
  });
  if (total !== f.ticks) throw new Error(`segment ticks sum to ${total}, expected ${f.ticks}`);
  if (f.ticks % 100 !== 0) throw new Error('ticks must be a multiple of 100');
  const expected = Array.from({ length: f.ticks / 100 }, (_, i) => (i + 1) * 100);
  if (f.checkpoints.map((c) => c.tick).join() !== expected.join()) {
    throw new Error('checkpoints must be every 100 ticks');
  }
  return f;
}

function toInput(entry: Entry): PlayerInput | undefined {
  if (entry === null) return undefined;
  const [moveX, moveY, aimX, aimY, buttons] = entry;
  return { moveX: moveX as -1 | 0 | 1, moveY: moveY as -1 | 0 | 1, aimX, aimY, buttons };
}

const fixture = decodeFixture(fixtureJson);

/** The decoded inputs for every tick, so a replay can start at any tick. */
const inputsByTick: (PlayerInput | undefined)[][] = fixture.segments.flatMap((segment) =>
  Array.from({ length: segment.ticks }, () => segment.inputs.map(toInput)),
);

interface Observer {
  /** Before the state runs its next tick. */
  beforeTick?: (state: GameState) => void;
  /** After a step; `inputs` are the ones it ran with. */
  afterStep?: (state: GameState, inputs: (PlayerInput | undefined)[]) => void;
}

/** Plays the fixture from `state` (at tick `from`) to the end. */
function play(state: GameState, from = 0, observer: Observer = {}): GameState {
  for (let tick = from; tick < fixture.ticks; tick++) {
    observer.beforeTick?.(state);
    const inputs = inputsByTick[tick] as (PlayerInput | undefined)[];
    step(state, inputs);
    observer.afterStep?.(state, inputs);
  }
  return state;
}

function start(): GameState {
  return createMatch(fixture.config, arena01, fixture.seed, [testStriker(), testMender()]);
}

interface Logged {
  tick: number;
  event: SimEvent;
}

/** Every event with the `state.tick` the step that emitted it made. */
function events(): Logged[] {
  const log: Logged[] = [];
  play(start(), 0, {
    afterStep: (s) => {
      for (const event of s.events) log.push({ tick: s.tick, event });
    },
  });
  return log;
}

function of<T extends SimEvent['type']>(
  log: Logged[],
  type: T,
): { tick: number; event: Extract<SimEvent, { type: T }> }[] {
  return log.filter((l) => l.event.type === type) as {
    tick: number;
    event: Extract<SimEvent, { type: T }>;
  }[];
}

/** Whether champion `id` touches the orb: centres within 0.5 + 0.5 m. */
function touches(s: GameState, id: number): boolean {
  const orb = s.match?.orb;
  const c = s.champions[id];
  if (!orb || !c || !c.alive) return false;
  return (c.x - orb.x) ** 2 + (c.y - orb.y) ** 2 <= 1;
}

describe('the orb fixture', () => {
  it('decodes to the committed shape', () => {
    expect(fixture.ticks).toBe(4300);
    expect(fixture.checkpoints).toHaveLength(43);
    expect(fixture.config.roundsToWin).toBe(2);
    expect(fixture.config.energyOrb).toEqual({ x: 0, y: 2.5 });
  });

  it('follows the timeline of the script, pinned by literal ticks', () => {
    const log = events();
    expect(of(log, 'roundStarted').map((l) => [l.tick, l.event.round])).toEqual([
      [180, 1],
      [2237, 2],
    ]);
    expect(of(log, 'orbSpawn').map((l) => [l.tick, l.event.round, l.event.x, l.event.y])).toEqual([
      [1201, 1, 0, 2.5],
      [3258, 2, 0, 2.5],
    ]);
    expect(
      of(log, 'orbTaken').map((l) => [l.tick, l.event.round, l.event.championId, l.event.amount, l.event.energy]),
    ).toEqual([
      [1381, 1, 2, 25, 25],
      [3438, 2, 1, 20, 100],
    ]);
    expect(of(log, 'roundEnded').map((l) => [l.tick, l.event.round, l.event.winner, l.event.scoreA, l.event.scoreB])).toEqual([
      [2058, 1, 'A', 1, 0],
      [3971, 2, 'A', 2, 0],
    ]);
    expect(of(log, 'matchEnded').map((l) => [l.tick, l.event.winner, l.event.scoreA, l.event.scoreB])).toEqual([
      [4150, 'A', 2, 0],
    ]);
  });

  it('passes the match, collision, status, ability, -0, JSON and checksum oracles at every step', () => {
    const state = start();
    expect(checkEveryStep(state)).toEqual([]);
    const watcher = new RoundWatcher();
    const problems: string[] = [];
    let steps = 0;
    play(state, 0, {
      beforeTick: (s) => watcher.beforeStep(s),
      afterStep: (s) => {
        steps++;
        watcher.afterStep(s);
        problems.push(...checkEveryStep(s));
      },
    });
    expect(steps).toBe(fixture.ticks);
    expect(watcher.problems).toEqual([]);
    expect(problems).toEqual([]);
  });

  it('exercises everything the plan requires', () => {
    const orbTypes = (Object.keys(EVENT_FIXTURE) as SimEvent['type'][]).filter((t) => EVENT_FIXTURE[t] === 'orb');
    const seen = new Set<string>();
    const flags: string[] = [];
    let before: GameState | undefined;
    play(start(), 0, {
      beforeTick: (s) => {
        before = cloneState(s);
      },
      afterStep: (s) => {
        for (const e of s.events) seen.add(e.type);
        const prev = before;
        if (!prev) return;
        const take = s.events.find((e) => e.type === 'orbTaken');
        if (take?.type === 'orbTaken') {
          const touching = [0, 1, 2, 3].filter((id) => touches(s, id));
          const probe = { rng: prev.rng };
          const r = nextRandom(probe);
          if (touching.length === 2) {
            // Round 1: both strikers on the first collectible step, one draw, the k-th takes it.
            const k = r * 2 >= 1 ? 1 : 0;
            if (touching.join() === '0,2' && s.rng === probe.rng && take.championId === touching[k] && prev.match?.phaseTicks === 1200) {
              flags.push(`tie of ${touching.join()} at phaseTicks ${prev.match.phaseTicks}, draw ${r}, taken by ${take.championId}`);
            }
          } else if (touching.length === 1 && s.rng === prev.rng) {
            const was = prev.champions[take.championId];
            if (was && was.energy >= 80 && take.amount < 25 && take.energy === 100) {
              flags.push(`alone, no draw, capped: ${was.energy} + ${take.amount}`);
            }
          }
        }
        // An enemy of the taker on the orb after the pickup: nothing happens.
        const m = s.match;
        if (m?.orb?.taken && m.round === 2 && !take) {
          if (touches(s, 2) && s.events.every((e) => e.type !== 'orbTaken')) {
            if (!flags.includes('enemy on the taken orb')) flags.push('enemy on the taken orb');
          }
        }
      },
    });
    expect(orbTypes.filter((type) => !seen.has(type))).toEqual([]);
    expect(flags).toHaveLength(3);
    expect(flags[0]).toMatch(/^tie of 0,2 at phaseTicks 1200, draw 0\.\d+, taken by 2$/);
    expect(flags[1]).toBe('alone, no draw, capped: 80 + 20');
    expect(flags[2]).toBe('enemy on the taken orb');
  });

  it('does not leave the orb to the next round: untaken at each round start', () => {
    const starts: boolean[] = [];
    play(start(), 0, {
      afterStep: (s) => {
        if (s.events.some((e) => e.type === 'roundStarted')) starts.push(s.match?.orb?.taken ?? true);
      },
    });
    expect(starts).toEqual([false, false]);
  });

  it('matches the committed checkpoints', () => {
    const actual: Checkpoint[] = [];
    play(start(), 0, {
      afterStep: (s) => {
        if (s.tick % 100 === 0) actual.push({ tick: s.tick, checksum: checksum(s) });
      },
    });
    expect(actual).toEqual(fixture.checkpoints);
  });

  it('reproduces the committed checksum', () => {
    expect(checksum(play(start()))).toBe(fixture.checksum);
  });

  it('gives the same checksum when replayed twice in one process', () => {
    expect(checksum(play(start()))).toBe(checksum(play(start())));
  });

  it('continues identically from a clone taken after the round 1 pickup, rng and orb included', () => {
    let copy: GameState | undefined;
    let cloneTick = -1;
    const original = play(start(), 0, {
      beforeTick: (s) => {
        if (!copy && s.match?.orb?.taken) {
          copy = cloneState(s);
          cloneTick = s.tick;
        }
      },
    });
    expect(cloneTick).toBe(1381);
    if (!copy) return;
    expect(checksum(play(copy, cloneTick))).toBe(checksum(original));
  });
});

/** The state after `ticks` steps of the fixture. */
function at(ticks: number): GameState {
  const state = start();
  for (let tick = 0; tick < ticks; tick++) step(state, inputsByTick[tick] as (PlayerInput | undefined)[]);
  return state;
}

describe('the orb oracles', () => {
  it('flag an orb state that breaks a rule', () => {
    const cases: [string, number, (s: GameState) => void][] = [
      ['an orb off the axis', 500, (s) => void (s.match!.orb!.x = 0.5)],
      ['an orb outside the end circle', 500, (s) => void (s.match!.orb!.y = 2.6)],
      ['an orb taken before the clock allows', 500, (s) => void (s.match!.orb!.taken = true)],
      ['an extra key on the orb', 500, (s) => void ((s.match!.orb as unknown as Record<string, number>).z = 1)],
      ['a taken flag that is not a boolean', 2000, (s) => void ((s.match!.orb as unknown as Record<string, unknown>).taken = 1)],
    ];
    for (const [name, ticks, mutate] of cases) {
      const state = at(ticks);
      expect(checkMatchInvariants(state), `${name} before`).toEqual([]);
      mutate(state);
      expect(checkMatchInvariants(state).length, name).toBeGreaterThan(0);
    }
  });

  it('flag an orb pickup that breaks a rule of the step', () => {
    // Each mutation rewrites the step of the tick-1381 pickup (the step that makes tick 1381).
    const cases: [string, (s: GameState) => void][] = [
      ['an amount above the cap', (s) => void ((s.events.find((e) => e.type === 'orbTaken') as { amount: number }).amount = 30)],
      ['a pickup that gave no energy', (s) => void (s.champions[2]!.energy = 0)],
      ['a pickup with no event', (s) => void (s.events = s.events.filter((e) => e.type !== 'orbTaken'))],
      ['a second pickup event', (s) => void s.events.push(s.events.find((e) => e.type === 'orbTaken')!)],
      ['an orb that stays up after its event', (s) => void (s.match!.orb!.taken = false)],
      ['a taker away from the orb', (s) => void (s.champions[2]!.x = 5)],
    ];
    for (const [name, mutate] of cases) {
      const state = at(1380);
      const watcher = new RoundWatcher();
      watcher.beforeStep(state);
      step(state, inputsByTick[1380] as (PlayerInput | undefined)[]);
      expect(state.events.some((e) => e.type === 'orbTaken'), `${name}: the step takes the orb`).toBe(true);
      expect(watcher.problems).toEqual([]);
      mutate(state);
      watcher.afterStep(state);
      expect(watcher.problems.length, name).toBeGreaterThan(0);
    }
  });

  it('flag a warning at the wrong tick', () => {
    const state = at(1199);
    const watcher = new RoundWatcher();
    watcher.beforeStep(state);
    step(state, inputsByTick[1199] as (PlayerInput | undefined)[]);
    expect(watcher.problems).toEqual([]);
    state.events.push({ type: 'orbSpawn', round: 1, x: 0, y: 2.5 });
    watcher.afterStep(state);
    expect(watcher.problems.length).toBeGreaterThan(0);
  });
});
