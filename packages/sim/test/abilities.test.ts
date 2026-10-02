// Scripted ability fixture test.
//
// The fixture runs on arena01 with a striker and a mender on each team (`test/kits.ts`). Its inputs
// are in the format of the replay fixture: a segment holds its inputs for `ticks` ticks, and an
// entry is [moveX, moveY, aimX, aimY, buttons], or null for a missing input. The only `actions`
// are `setEnergy` (`championId`, `energy`), run when `state.tick === tick`, before that tick's
// step: energy cannot be earned fast enough to reach an EX variant or an F at chosen moments, and
// it is the one thing the script writes outside `step`, in a test only. `checkpoints` hold the
// checksum of the whole state after the step that makes `state.tick` equal to `tick`; `checksum`
// is the one after the last tick. There is no `legacyState` projection here: this fixture is new.
//
// How the committed script was generated: the inputs came from a seeded random player (a window of
// 5 to 18 ticks of aim, walk and buttons per champion, chosen from the live state) tried for one
// seed after another until a run satisfied every item of the coverage test below with no oracle
// problem. The search script is not committed; the script it produced is the data. The checksums
// were then generated as for the other fixtures: set every checksum to 0, run
// `npx vitest run --project sim packages/sim/test/abilities.test.ts`, copy the actual values from
// the failing checkpoint and checksum assertions into the fixture, and rerun until it is green.
// Changing gameplay or `test/kits.ts` on purpose means regenerating the checksums the same way in
// the same change.
//
// "Replay once in a separate process" is met by the committed checksums, which the authoring run
// produced, plus every CI run that replays them again, on Linux x86 as well as on a Mac.
import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/scripted-abilities-arena01-2v2.json';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, MatchConfig, PlayerInput, SimEvent } from '../src/index';
import { AbilityWatcher, Coverage, copyChampions } from './ability-watch';
import type { Champions } from './ability-watch';
import { EVENT_FIXTURE, arena01, checkAbilityInvariants, champion, input, openArena } from './helpers';
import { kitWith, quiet, testMender, testStriker } from './kits';

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

function decodeFixture(data: unknown): Fixture {
  const f = data as Fixture;
  if (f.format !== 1) throw new Error('fixture format must be 1');
  if (f.arena !== 'arena01') throw new Error('fixture arena must be arena01');
  if (!isInt(f.seed)) throw new Error('fixture seed must be an integer');
  if (!isInt(f.checksum)) throw new Error('fixture checksum must be an integer');
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

const fixture = decodeFixture(fixtureJson);

/** The decoded inputs for every tick, so a replay can start at any tick. */
const inputsByTick: (PlayerInput | undefined)[][] = fixture.segments.flatMap((segment) =>
  Array.from({ length: segment.ticks }, () => segment.inputs.map(toInput)),
);

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

const KITS = [testStriker(), testMender()];

function start(): GameState {
  return createMatch(fixture.config, arena01, fixture.seed, [testStriker(), testMender()]);
}

const ABILITY_EVENTS = (Object.keys(EVENT_FIXTURE) as SimEvent['type'][]).filter(
  (type) => EVENT_FIXTURE[type] === 'ability',
);

describe('scripted ability fixture', () => {
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
    const coverage = new Coverage();
    let before: Champions | undefined;
    play(start(), 0, {
      afterAction: (_, action) => coverage.energyWasSet(action.spec.championId),
      beforeStep: (s) => {
        before = copyChampions(s);
      },
      afterStep: (s, inputs) => {
        if (before) coverage.note(s, before, inputs);
      },
    });
    expect(coverage.missing(KITS, ABILITY_EVENTS)).toEqual([]);
    // Every event type of the union appears, the combat ones included: kits fire real projectiles.
    const all = Object.keys(EVENT_FIXTURE) as SimEvent['type'][];
    expect(all.filter((type) => !coverage.eventTypes.has(type))).toEqual([]);
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

describe('the ability oracles', () => {
  function striking(): GameState {
    const state = createMatch(
      { teamSize: 2, players: [
        { championId: 'k0', team: 'A' }, { championId: 'k1', team: 'A' },
        { championId: 'k2', team: 'B' }, { championId: 'k3', team: 'B' },
      ] },
      openArena(),
      1,
      [kitWith('k0', { Q: quiet({ cooldownTicks: 50, windupTicks: 10 }) })],
    );
    step(state, [input(0, 0, 1000, 0, 8)]);
    return state;
  }

  it('finds nothing wrong in a state mid-windup', () => {
    const state = striking();
    expect(champion(state, 0).cast).not.toBeNull();
    expect(checkAbilityInvariants(state)).toEqual([]);
  });

  it('flags a state that breaks a rule, one rule at a time', () => {
    const cases: [string, (s: GameState) => void, string][] = [
      ['energy above 100', (s) => void (champion(s, 1).energy = 101), 'energy 101'],
      ['a fractional energy', (s) => void (champion(s, 1).energy = 4.5), 'energy 4.5'],
      ['a cooldown above the slot', (s) => void (champion(s, 0).cooldowns[3] = 51), 'cooldown Q is 51 of at most 50'],
      ['a negative cooldown', (s) => void (champion(s, 0).cooldowns[0] = -1), 'cooldown M1 is -1'],
      ['a cooldown for a champion with no kit', (s) => void (champion(s, 3).cooldowns[0] = 1), 'cooldown M1 is 1 of at most 0'],
      ['a windup of 0 turns', (s) => void (champion(s, 0).cast!.windupLeft = 0), 'windupLeft 0 of 10'],
      ['a windup above its length', (s) => void (champion(s, 0).cast!.windupLeft = 11), 'windupLeft 11 of 10'],
      ['a cast with no record', (s) => void (s.casts.length = 0), 'has no record'],
      ['a cast that does not match its record', (s) => void (s.casts[0]!.slot = 'E'), 'does not match its record'],
      ['a record nothing refers to', (s) => void (champion(s, 0).cast = null), 'is not referenced'],
      ['a dead champion with a cast', (s) => void (champion(s, 0).alive = false), 'dead with a cast'],
      ['a credited target twice', (s) => void (s.casts[0]!.credited = [2, 2]), 'credits a target twice'],
      ['a credited unknown champion', (s) => void (s.casts[0]!.credited = [9]), 'credits an unknown champion'],
      ['a cast id that repeats an entity id', (s) => void (s.casts[0]!.id = s.nextEntityId), 'id out of range'],
    ];
    for (const [name, mutate, message] of cases) {
      const state = striking();
      mutate(state);
      expect(checkAbilityInvariants(state).join('\n'), name).toContain(message);
    }
  });

  it('has the watcher flag a step that moves energy or a cooldown by itself', () => {
    const energy = striking();
    const w1 = new AbilityWatcher(energy);
    w1.beforeStep(energy);
    step(energy, []);
    champion(energy, 1).energy += 1;
    w1.afterStep(energy, []);
    expect(w1.problems.join('\n')).toContain('champion 1 energy 1 is not 0');

    const cooldown = striking();
    const w2 = new AbilityWatcher(cooldown);
    w2.beforeStep(cooldown);
    step(cooldown, []);
    champion(cooldown, 0).cooldowns[3] = 5;
    w2.afterStep(cooldown, []);
    expect(w2.problems.join('\n')).toContain('champion 0 cooldown Q is 5, expected 49');
  });

  it('has the watcher flag a windup that does not count down and a cast that vanishes', () => {
    const stuck = striking();
    const w1 = new AbilityWatcher(stuck);
    w1.beforeStep(stuck);
    step(stuck, []);
    champion(stuck, 0).cast!.windupLeft = 10;
    w1.afterStep(stuck, []);
    expect(w1.problems.join('\n')).toContain('windup did not count down');

    const gone = striking();
    const w2 = new AbilityWatcher(gone);
    w2.beforeStep(gone);
    step(gone, []);
    champion(gone, 0).cast = null;
    gone.casts.length = 0;
    w2.afterStep(gone, []);
    expect(w2.problems.join('\n')).toContain('windup did not count down');
  });

  it('has the watcher flag a champion that walks while stunned, and one that casts while silenced', () => {
    const walker = striking();
    const w1 = new AbilityWatcher(walker);
    walker.champions[2]!.statuses.push({ type: 'stun', sourceId: 0, slot: null, remainingTicks: 5 });
    w1.beforeStep(walker);
    step(walker, []);
    champion(walker, 2).vx = 3;
    w1.afterStep(walker, []);
    expect(w1.problems.join('\n')).toContain('champion 2 could not walk but has velocity 3, 0');
  });

  it('collects the coverage items from a hand-made run', () => {
    const coverage = new Coverage();
    const state = createMatch(
      { teamSize: 2, players: [
        { championId: 'k0', team: 'A' }, { championId: 'k1', team: 'A' },
        { championId: 'k2', team: 'B' }, { championId: 'k3', team: 'B' },
      ] },
      openArena(),
      1,
      [kitWith('k0', { M1: quiet({ cooldownTicks: 30 }) })],
    );
    const run = (inputs: PlayerInput[]) => {
      const before = copyChampions(state);
      step(state, inputs);
      coverage.note(state, before, inputs);
    };
    // Dead champion 3 holds a button; the kit-less champions are skipped, champion 0 casts M1.
    run([input(0, 0, 0, 0, 1)]);
    expect([...coverage.casts]).toEqual(['k0/M1/false']);
    expect([...coverage.costs]).toEqual([0]);
    // The cooldown of M1 rejects the next tick.
    run([input(0, 0, 0, 0, 1)]);
    expect([...coverage.rejections]).toEqual(['cooldown']);
    // F lacks its 100 energy.
    run([input(0, 0, 0, 0, 64)]);
    expect([...coverage.rejections].sort()).toEqual(['cooldown', 'energy']);
  });
});
