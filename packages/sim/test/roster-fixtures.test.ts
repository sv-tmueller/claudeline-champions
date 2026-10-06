// Scripted roster fixtures: one per kit, `scripted-roster-hargrim-arena01-2v2.json`,
// `scripted-roster-quillon-arena01-2v2.json` and `scripted-roster-skerrow-arena01-2v2.json`.
//
// Each fixture runs 2400 ticks on arena01 with the kit of `data/kits/<id>.json` for all four
// champions (a mirror: two on team A, two on team B), so one kit meets itself in every exchange.
// Its inputs are in the format of the ability fixture: a segment holds its inputs for `ticks` ticks,
// and an entry is [moveX, moveY, aimX, aimY, buttons], or null for a missing input. The only
// `actions` are `setEnergy` (`championId`, `energy`), run when `state.tick === tick`, before that
// tick's step: energy cannot be earned fast enough to reach an EX variant or an F at chosen moments,
// and it is the one thing the script writes outside `step`, in a test only. `checkpoints` hold the
// checksum of the whole state, `state.kits` included, after the step that makes `state.tick` equal
// to `tick`; `checksum` is the one after the last tick. There is no `legacyState` projection: these
// fixtures are new, so a change to a kit file moves every checkpoint from the first one a cast
// reaches.
//
// How the committed scripts were generated: a seeded random player (the policy of
// `scripted-abilities-arena01-2v2.json`, see the header of `abilities.test.ts`) tried one attempt
// after another until a run satisfied every item of the coverage test below with no oracle problem.
// The search script is not committed; the script it produced is the data. It used mulberry32 seeded
// with the attempt number (1, 2, 3 and so on) and ran the mirror config of the fixture for 2400
// ticks. Match seed 5555 for Hargrim, 5556 for Quillon and 5558 for Skerrow. Attempt 1 was the first
// to cover everything for Hargrim, attempt 23 the first for Quillon and attempt 6 the first for
// Skerrow (attempts 1 to 22 and 1 to 5 each missed an item of the coverage test, and none had an
// oracle problem); each one's output is that fixture's segments and actions exactly.
//
// The player. The abilities header leaves draw-level detail open, so this is the order the
// committed Hargrim and Quillon fixtures fix. The player was written again from that header (the
// original script is not committed either), and it reproduces Hargrim attempt 1 and Quillon attempt
// 23 byte for byte, segments and actions, which is what makes this record exact. At the start of a
// tick, for each champion in id order (a dead one too) whose window ran out, from the state before
// that tick's step, it draws in this order: (1) the length, 5 + floor(rnd * 14) ticks; (2) a flag,
// where below 0.3 the target is a random living enemy and otherwise the nearest one (a tie goes to
// the lower id); (3) the random enemy index, floor(rnd * living enemies), drawn in every window and
// used only when the flag was below 0.3; (4) the random ally index, floor(rnd * living allies other
// than the champion), drawn in every window and used only by an ally aim; (5) the aim kind, where
// below 0.6 aims at the target, below 0.8 at the ally, below 0.92 at a uniform point (two more
// draws, x = -14 + 28 * rnd and then y = -9 + 18 * rnd, in meters) and otherwise at the champion
// itself; a kind with nobody to aim at (no living enemy, no living ally) falls through to the next
// one that applies, so an ally kind with no living ally becomes the uniform point; the aim is then
// rounded to whole centimeters as Math.round(meters * 100), which takes no draw; (6) the walk: one
// draw, where below 0.45 walks along the axes toward the aim point (away from it when within 3.5 m,
// per axis only when more than 0.5 m off, with no more draws), below 0.70 takes a uniform axis in
// each of x and y (two more draws, floor(rnd * 3) - 1, x first) and otherwise stands, with no more
// draws; (7) seven button draws for M1, M2, SPACE, Q, E, R, F against 0.5, 0.3, 0.2, 0.3, 0.3,
// 0.15, 0.3, then one for SHIFT against 0.3; (8) one draw for a `setEnergy` action against 0.2,
// and when it is taken the champion, floor(rnd * 4), and then the energy, [0, 24, 25, 98, 99, 100,
// 60][floor(rnd * 7)], both at the current tick. Flipping any one of these choices (the order of
// the uniform point, centimeter rounding, allies including the champion, the energy order, the
// ally threshold, a walk that always draws its axes) changes the winning Skerrow segments within
// the first 90 ticks.
//
// The checksums were then generated as for the other fixtures: set every checksum to 0, run
// `npx vitest run --project sim packages/sim/test/roster-fixtures.test.ts`, copy the actual values
// from the failing checkpoint and checksum assertions into the fixture, and rerun until it is green.
// Changing a number in `data/kits/<id>.json` on purpose means changing `docs/design/roster-v1.md`
// and regenerating that kit's checksums the same way in the same change (the search need not run
// again unless the coverage test fails).
//
// "Replay once in a separate process" is met by the committed checksums, which the authoring run
// produced, plus every CI run that replays them again, on Linux x86 as well as on a Mac.
import { describe, expect, it } from 'vitest';
import hargrimFixtureJson from './fixtures/scripted-roster-hargrim-arena01-2v2.json';
import quillonFixtureJson from './fixtures/scripted-roster-quillon-arena01-2v2.json';
import skerrowFixtureJson from './fixtures/scripted-roster-skerrow-arena01-2v2.json';
import hargrimJson from '../../../data/kits/hargrim.json';
import quillonJson from '../../../data/kits/quillon.json';
import skerrowJson from '../../../data/kits/skerrow.json';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, MatchConfig, PlayerInput } from '../src/index';
import { validateKit } from '../src/kit';
import { AbilityWatcher } from './ability-watch';
import { arena01, champion } from './helpers';

type Entry = [number, number, number, number, number] | null;

interface Segment {
  ticks: number;
  inputs: Entry[];
}

interface Action {
  tick: number;
  type: 'setEnergy';
  spec: { championId: number; energy: number };
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
  actions: Action[];
  checkpoints: Checkpoint[];
  checksum: number;
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Checks the shape of a fixture; the players must be the kit, twice for team A, twice for team B. */
function decodeFixture(data: unknown, kitId: string): Fixture {
  const f = data as Fixture;
  if (f.format !== 1) throw new Error('fixture format must be 1');
  if (f.arena !== 'arena01') throw new Error('fixture arena must be arena01');
  if (!isInt(f.seed)) throw new Error('fixture seed must be an integer');
  if (!isInt(f.checksum)) throw new Error('fixture checksum must be an integer');
  const players = f.config.players.map((p) => `${p.championId}/${p.team}`).join();
  if (players !== `${kitId}/A,${kitId}/A,${kitId}/B,${kitId}/B`) {
    throw new Error(`players must be ${kitId} twice on team A and twice on team B`);
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
  if (f.ticks < 1200) throw new Error('fixture must run at least 1200 ticks');
  let previous = 0;
  for (const action of f.actions) {
    if (!isInt(action.tick) || action.tick < previous || action.tick >= f.ticks) {
      throw new Error(`action at tick ${action.tick} is out of order or range`);
    }
    if (action.type !== 'setEnergy') throw new Error(`unknown action type ${String(action.type)}`);
    const { championId, energy } = action.spec;
    if (!isInt(championId) || championId < 0 || championId >= f.config.players.length) {
      throw new Error(`action at tick ${action.tick}: bad champion ${championId}`);
    }
    if (!isInt(energy) || energy < 0 || energy > 100) {
      throw new Error(`action at tick ${action.tick}: bad energy ${energy}`);
    }
    previous = action.tick;
  }
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

/** What a fixture must show, as `slot/ex` keys, so a kit change cannot leave a cast untested. */
interface Expected {
  /** A castFired for each. */
  fired: string[];
  /** An energyGained whose cast is each: every ability that damages. */
  gains: string[];
  /** The `then` of each dash fired: a dash end followed by a spawn of the same champion. */
  thens: string[];
  /** A statusApplied of each type the kit applies. */
  statuses: string[];
}

const EXPECTED: Record<string, Expected> = {
  hargrim: {
    fired: ['M1/false', 'M2/false', 'M2/true', 'SPACE/false', 'SPACE/true', 'Q/false', 'E/false', 'R/false', 'F/false'],
    gains: ['M1/false', 'M2/false', 'M2/true', 'SPACE/true', 'E/false', 'F/false'],
    thens: ['SPACE/true', 'F/false'],
    statuses: ['slow', 'haste', 'stun', 'shield', 'knockback'],
  },
  quillon: {
    fired: ['M1/false', 'M2/false', 'M2/true', 'SPACE/false', 'Q/false', 'E/false', 'E/true', 'R/false', 'F/false'],
    gains: ['M1/false', 'M2/false', 'M2/true', 'Q/false', 'E/false', 'E/true', 'F/false'],
    thens: [],
    statuses: ['slow', 'haste', 'root', 'shield'],
  },
  skerrow: {
    fired: ['M1/false', 'M2/false', 'SPACE/false', 'SPACE/true', 'Q/false', 'E/false', 'E/true', 'R/false', 'F/false'],
    gains: ['M1/false', 'M2/false', 'SPACE/true', 'Q/false', 'E/false', 'E/true', 'F/false'],
    thens: ['SPACE/true'],
    statuses: ['slow', 'haste', 'silence', 'dot', 'invulnerable', 'stun'],
  },
};

/** Collects what the coverage test needs from the events of every step. */
class RosterCoverage {
  readonly fired = new Set<string>();
  readonly gains = new Set<string>();
  readonly thens = new Set<string>();
  readonly statuses = new Set<string>();
  private readonly casts = new Map<number, string>();
  private dashing: { championId: number; key: string }[] = [];

  /** Right before a step: the dashes that hold effects for their end, and the cast they belong to. */
  before(state: GameState): void {
    this.dashing = state.champions.flatMap((c) => {
      const { dash } = c;
      if (!dash || dash.castId === null || dash.then.length === 0) return [];
      const record = state.casts.find((r) => r.id === dash.castId);
      return record ? [{ championId: c.id, key: `${record.slot}/${record.ex}` }] : [];
    });
  }

  after(state: GameState): void {
    state.events.forEach((e, i) => {
      switch (e.type) {
        case 'castStarted':
          this.casts.set(e.castId, `${e.slot}/${e.ex}`);
          break;
        case 'castFired':
          this.fired.add(`${e.slot}/${e.ex}`);
          break;
        case 'energyGained':
          this.gains.add(this.casts.get(e.castId) ?? `cast ${e.castId}`);
          break;
        case 'statusApplied':
          this.statuses.add(e.status);
          break;
        case 'dashEnded': {
          if (e.reason !== 'complete' && e.reason !== 'blocked' && e.reason !== 'rooted') break;
          const dash = this.dashing.find((d) => d.championId === e.championId);
          if (!dash) break;
          const spawned = state.events.slice(i + 1).some(
            (later) =>
              (later.type === 'areaSpawned' && later.ownerId === e.championId) ||
              (later.type === 'projectileSpawned' && later.ownerId === e.championId) ||
              (later.type === 'meleeArc' && later.ownerId === e.championId),
          );
          if (spawned) this.thens.add(dash.key);
          break;
        }
        default:
          break;
      }
    });
  }

  /** What the run still has to show, as readable names; empty when everything is covered. */
  missing(expected: Expected): string[] {
    return [
      ...expected.fired.filter((k) => !this.fired.has(k)).map((k) => `castFired ${k}`),
      ...expected.gains.filter((k) => !this.gains.has(k)).map((k) => `energyGained ${k}`),
      ...expected.thens.filter((k) => !this.thens.has(k)).map((k) => `dash then ${k}`),
      ...expected.statuses.filter((k) => !this.statuses.has(k)).map((k) => `statusApplied ${k}`),
    ];
  }
}

interface Subject {
  name: string;
  kit: ReturnType<typeof validateKit>;
  fixture: Fixture;
}

const SUBJECTS: Subject[] = [
  { name: 'hargrim', kit: validateKit(hargrimJson), fixture: decodeFixture(hargrimFixtureJson, 'hargrim') },
  { name: 'quillon', kit: validateKit(quillonJson), fixture: decodeFixture(quillonFixtureJson, 'quillon') },
  { name: 'skerrow', kit: validateKit(skerrowJson), fixture: decodeFixture(skerrowFixtureJson, 'skerrow') },
];

/** The match seed of each fixture, so no two kits share a stream. */
const SEEDS: Record<string, number> = { hargrim: 5555, quillon: 5556, skerrow: 5558 };

interface Observer {
  /** Before the actions of the tick the state is about to run. */
  beforeTick?: (state: GameState) => void;
  /** After an action. */
  afterAction?: (state: GameState, action: Action) => void;
  /** Right before a step, after the actions of its tick. */
  beforeStep?: (state: GameState) => void;
  /** After a step; `inputs` are the ones it ran with. */
  afterStep?: (state: GameState, inputs: (PlayerInput | undefined)[]) => void;
}

describe.each(SUBJECTS)('scripted $name fixture', ({ name, kit, fixture }) => {
  /** The decoded inputs for every tick, so a replay can start at any tick. */
  const inputsByTick: (PlayerInput | undefined)[][] = fixture.segments.flatMap((segment) =>
    Array.from({ length: segment.ticks }, () => segment.inputs.map(toInput)),
  );

  /** Plays the fixture from `state` (at tick `from`) to the end. */
  function play(state: GameState, from = 0, observer: Observer = {}): GameState {
    for (let tick = from; tick < fixture.ticks; tick++) {
      observer.beforeTick?.(state);
      for (const action of fixture.actions) {
        if (action.tick !== tick) continue;
        champion(state, action.spec.championId).energy = action.spec.energy;
        observer.afterAction?.(state, action);
      }
      const inputs = inputsByTick[tick] as (PlayerInput | undefined)[];
      observer.beforeStep?.(state);
      step(state, inputs);
      observer.afterStep?.(state, inputs);
    }
    return state;
  }

  function start(): GameState {
    return createMatch(fixture.config, arena01, fixture.seed, [kit]);
  }

  it('uses the kit of its data file and its own match seed', () => {
    expect(start().kits).toStrictEqual([kit]);
    expect(fixture.seed).toBe(SEEDS[name]);
    expect(fixture.ticks).toBe(2400);
  });

  it('keeps every oracle after every action and every step', () => {
    const state = start();
    const watcher = new AbilityWatcher(state);
    let steps = 0;
    play(state, 0, {
      afterAction: (s) => watcher.afterEnergySet(s),
      beforeStep: (s) => watcher.beforeStep(s),
      afterStep: (s, inputs) => {
        steps++;
        watcher.afterStep(s, inputs);
      },
    });
    expect(steps).toBe(fixture.ticks);
    expect(watcher.problems).toEqual([]);
  });

  it('exercises everything the plan requires', () => {
    const coverage = new RosterCoverage();
    play(start(), 0, {
      beforeStep: (s) => coverage.before(s),
      afterStep: (s) => coverage.after(s),
    });
    expect(coverage.missing(EXPECTED[name] as Expected)).toEqual([]);
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

  it('continues identically from a clone taken during a windup with live statuses and entities', () => {
    let copy: GameState | undefined;
    let cloneTick = -1;
    const original = play(start(), 0, {
      beforeTick: (s) => {
        const winding = s.champions.some((c) => c.cast !== null);
        const statuses = s.champions.some((c) => c.statuses.length > 0);
        const entities = s.projectiles.length > 0 || s.areas.length > 0;
        if (!copy && winding && statuses && entities && s.casts.length >= 2) {
          copy = cloneState(s);
          cloneTick = s.tick;
        }
      },
    });
    expect(copy).toBeDefined();
    if (!copy) return;
    expect(copy.champions.some((c) => c.cast !== null)).toBe(true);
    expect(checksum(play(copy, cloneTick))).toBe(checksum(original));
  });
});
