// Scripted match flow fixture test.
//
// The fixture runs a match with `roundsToWin: 3` on arena01 with a striker and a mender on each
// team (`test/kits.ts`, which stays frozen). It holds inputs only, in the format of the ability
// fixture: a segment holds its inputs for `ticks` ticks, and an entry is [moveX, moveY, aimX,
// aimY, buttons], or null for a missing input. There are no actions: everything that happens
// comes from the inputs, the kits and the ring. `checkpoints` hold the checksum of the whole
// state, with no projection, after the step that makes `state.tick` equal to `tick`; `checksum`
// is the one after the last tick.
//
// How the committed script was made: a throwaway generator (not committed) ran the match and
// chose each tick's inputs from the live state, then recorded them. Every locked tick (warmup,
// each pause, the match end) holds the same non-zero move, aim and buttons for all four, so the
// locks are what the checkpoints cover. In a round the attacking team plays and the other team
// stands still (null inputs):
// - Rounds 1, 4 and 5 (team A attacks), round 2 (team B, the same script mirrored). The mender
//   walks along a path finder route to (+-3, 2) and holds M2 at the enemy striker until it has
//   4 health left (13 darts: energy reaches 100 after the tenth). The striker walks to the enemy
//   mender and holds M1 until it is dead, then waits at (+-7, 2.6). When the enemy striker is at
//   4 or less, the mender presses F (windup 24), then M2 aimed away from everyone (a dart that
//   stays alive), then Q (windup 12). Once that Q is in its windup the striker presses SPACE,
//   dashes at the enemy striker and presses M1 when it is within 2.8 m: that hit decides the
//   round while a windup, a dart, the F area and the striker's dash are all alive.
// - Round 3: every champion walks into its own corner, (-14.5, 9.5), (-14.5, -9.5), (14.5, 9.5)
//   and (14.5, -9.5) for ids 0 to 3, and stands. Ids 0 and 2 and ids 1 and 3 are mirror images
//   on a mirror exact arena with equal kits, so the ring takes both menders on one tick and both
//   strikers on a later one: a draw.
// - After round 5 the match is won, and the locked inputs run on for 100 more ticks or more.
// The checksums were then set to 0, `npx vitest run --project sim
// packages/sim/test/rounds.test.ts` run, and the actual values copied in. Changing gameplay or
// `test/kits.ts` on purpose means regenerating them the same way in the same change.
//
// "Replay once in a separate process" is met by the committed checksums, which the authoring run
// produced, plus every CI run that replays them again, on Linux x86 as well as on a Mac.
import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/scripted-rounds-arena01-2v2.json';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, MatchConfig, PlayerInput, SimEvent } from '../src/index';
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
  if (f.config.roundsToWin !== 3) throw new Error('roundsToWin must be 3');
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

describe('the rounds fixture', () => {
  it('decodes to the committed shape', () => {
    expect(fixture.ticks).toBe(11700);
    expect(fixture.checkpoints).toHaveLength(117);
    expect(fixture.config.roundsToWin).toBe(3);
  });

  it('follows the timeline of the script, pinned by literal ticks', () => {
    const log = events();
    expect(of(log, 'roundStarted').map((l) => [l.tick, l.event.round])).toEqual([
      [180, 1],
      [1366, 2],
      [2552, 3],
      [9172, 4],
      [10358, 5],
    ]);
    expect(
      of(log, 'roundEnded').map((l) => [
        l.tick,
        l.event.round,
        l.event.winner,
        l.event.scoreA,
        l.event.scoreB,
      ]),
    ).toEqual([
      [1187, 1, 'A', 1, 0],
      [2373, 2, 'B', 1, 1],
      [8993, 3, null, 1, 1],
      [10179, 4, 'A', 2, 1],
      [11365, 5, 'A', 3, 1],
    ]);
    expect(of(log, 'suddenDeathStarted').map((l) => [l.tick, l.event.round, l.event.radius])).toEqual([
      [7953, 3, 18],
    ]);
    expect(of(log, 'matchEnded').map((l) => [l.tick, l.event.winner, l.event.scoreA, l.event.scoreB])).toEqual([
      [11544, 'A', 3, 1],
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
    const matchTypes = (Object.keys(EVENT_FIXTURE) as SimEvent['type'][]).filter(
      (type) => EVENT_FIXTURE[type] === 'match',
    );
    const seen = new Set<string>();
    const winners = new Set<string | null>();
    const flags = new Set<string>();
    const phases: string[] = [];
    let before: GameState | undefined;
    play(start(), 0, {
      beforeTick: (s) => {
        before = cloneState(s);
      },
      afterStep: (s, inputs) => {
        const m = s.match;
        const prev = before?.match;
        if (!m || !prev || !before) return;
        const held = inputs.some((i) => i !== undefined && (i.moveX !== 0 || i.moveY !== 0));
        if (held) flags.add(`input held in ${prev.phase}`);
        const key = `${m.phase}/${m.round}`;
        if (phases[phases.length - 1] !== key) phases.push(key);
        const decided = s.events.some((e) => e.type === 'roundEnded');
        for (const e of s.events) {
          seen.add(e.type);
          if (e.type === 'roundEnded') winners.add(e.winner);
          if (e.type === 'castInterrupted' && e.reason === 'roundEnd') flags.add('castInterrupted roundEnd');
          if (e.type === 'projectileExpired' && e.reason === 'roundEnd') flags.add('projectileExpired roundEnd');
          if (e.type === 'areaExpired' && decided) flags.add('areaExpired in a deciding step');
          if (e.type === 'damage' && e.sourceId === -1) flags.add('ring damage');
          if (e.type === 'death' && e.sourceId === -1) flags.add('ring death');
          if (e.type === 'roundStarted') {
            const loaded =
              before.champions.some((c) => c.energy > 0) &&
              before.champions.some((c) => c.cooldowns.some((v) => v > 0)) &&
              before.champions.some((c) => c.statuses.length > 0) &&
              before.casts.length > 0 &&
              before.champions.some((c) => !c.alive);
            if (loaded) flags.add('reset of a loaded state');
          }
        }
      },
    });
    expect(matchTypes.filter((type) => !seen.has(type))).toEqual([]);
    expect(winners).toEqual(new Set(['A', 'B', null]));
    expect([...flags].sort()).toEqual([
      'areaExpired in a deciding step',
      'castInterrupted roundEnd',
      'input held in matchEnd',
      'input held in round',
      'input held in roundEnd',
      'input held in warmup',
      'projectileExpired roundEnd',
      'reset of a loaded state',
      'ring damage',
      'ring death',
    ]);
    expect(phases).toEqual([
      'warmup/0',
      'round/1',
      'roundEnd/1',
      'round/2',
      'roundEnd/2',
      'round/3',
      'roundEnd/3',
      'round/4',
      'roundEnd/4',
      'round/5',
      'roundEnd/5',
      'matchEnd/5',
    ]);
  });

  it('ends a decided round with a windup, a projectile and an area alive, in the pinned order', () => {
    const log = events();
    const at = log.filter((l) => l.tick === 1187).map((l) => l.event.type);
    const decided = at.indexOf('roundEnded');
    expect(at.slice(decided)).toEqual([
      'roundEnded',
      'castInterrupted',
      'projectileExpired',
      'areaExpired',
    ]);
    expect(at.slice(0, decided)).toContain('death');
  });

  it('draws round 3 by the ring: the menders die first, the strikers on a later tick', () => {
    const log = events();
    const deaths = of(log, 'death').filter((l) => l.tick > 7953 && l.tick < 9000);
    expect(deaths.map((l) => [l.tick, l.event.targetId, l.event.sourceId])).toEqual([
      [8752, 1, -1],
      [8752, 3, -1],
      [8993, 0, -1],
      [8993, 2, -1],
    ]);
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

  it('continues identically from a clone taken in the pause after the sudden death round', () => {
    let copy: GameState | undefined;
    let cloneTick = -1;
    const original = play(start(), 0, {
      beforeTick: (s) => {
        if (!copy && s.match?.phase === 'roundEnd' && s.match.ring !== null) {
          copy = cloneState(s);
          cloneTick = s.tick;
        }
      },
    });
    expect(copy?.match?.ring).not.toBeNull();
    expect(cloneTick).toBe(8993);
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

describe('the round oracles', () => {
  it('flag a state that breaks a match rule', () => {
    const cases: [string, number, (s: GameState) => void][] = [
      ['a phase that is not one', 500, (s) => void ((s.match as { phase: string }).phase = 'pause')],
      ['a score above the rounds played', 500, (s) => void (s.match!.score.B = 5)],
      ['a won match with no winner', 11700, (s) => void (s.match!.score.A = 0)],
      ['an area in the match end', 11700, (s) => void s.areas.push({
        id: 999, type: 'circle', ownerId: 0, team: 'A', x: 0, y: 0, radius: 1, targets: 'all',
        remainingTicks: 5, intervalTicks: 1, ticksToNextApply: 0, effects: [], castId: null,
      })],
      ['a ring before sudden death', 500, (s) => void (s.match!.ring = { x: 0, y: 0, radius: 18, damagePerTick: 1 / 6 })],
      ['a ring with the wrong radius', 8000, (s) => void (s.match!.ring!.radius += 1e-6)],
      ['a dead team in the round phase', 500, (s) => void kill(s)],
      ['a warmup champion off its spawn', 100, (s) => void (s.champions[2]!.x = 11)],
    ];
    for (const [name, ticks, mutate] of cases) {
      const state = at(ticks);
      expect(checkMatchInvariants(state), `${name} before`).toEqual([]);
      mutate(state);
      expect(checkMatchInvariants(state).length, name).toBeGreaterThan(0);
    }
  });

  it('flag a step that moves a champion in a locked phase', () => {
    const state = at(100);
    const watcher = new RoundWatcher();
    watcher.beforeStep(state);
    step(state, []);
    state.champions[0]!.x += 0.1;
    watcher.afterStep(state);
    expect(watcher.problems.length).toBeGreaterThan(0);
  });

  it('flag ring damage that was not applied, and a champion that was not hurt by the ring', () => {
    for (const mutate of [
      (s: GameState) => void (s.champions[0]!.health += 0.1),
      (s: GameState) => void (s.events = s.events.filter((e) => e.type !== 'damage')),
    ]) {
      const state = at(8100);
      const watcher = new RoundWatcher();
      watcher.beforeStep(state);
      step(state, inputsByTick[8100] as (PlayerInput | undefined)[]);
      expect(state.events.some((e) => e.type === 'damage' && e.sourceId === -1)).toBe(true);
      expect(watcher.problems).toEqual([]);
      mutate(state);
      watcher.afterStep(state);
      expect(watcher.problems.length).toBeGreaterThan(0);
    }
  });

  it('accept a clean step and flag a wrong round number', () => {
    const state = at(1365);
    const watcher = new RoundWatcher();
    watcher.beforeStep(state);
    step(state, inputsByTick[1365] as (PlayerInput | undefined)[]);
    expect(state.events).toEqual([{ type: 'roundStarted', round: 2 }]);
    watcher.afterStep(state);
    expect(watcher.problems).toEqual([]);

    const wrong = at(1365);
    const second = new RoundWatcher();
    second.beforeStep(wrong);
    step(wrong, inputsByTick[1365] as (PlayerInput | undefined)[]);
    wrong.match!.round = 3;
    second.afterStep(wrong);
    expect(second.problems.length).toBeGreaterThan(0);
  });
});

function kill(state: GameState): void {
  for (const c of state.champions) if (c.team === 'B') c.alive = false;
}
