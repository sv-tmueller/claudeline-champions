// The format, the replay loop, the coverage and the oracle wiring of the scripted roster fixtures,
// shared by roster-fixtures.test.ts and by the fixture search (tools/fixtures), so the search and
// the test have one definition of each. It has no vitest import of its own, though ability-watch.ts
// does. The header of roster-fixtures.test.ts is the record of how the fixtures came to be.
import { createMatch, step } from '../src/index';
import type { GameState, KitDef, MatchConfig, PlayerInput } from '../src/index';
import { AbilityWatcher } from './ability-watch';
import { arena01, champion } from './helpers';

export type Entry = [number, number, number, number, number] | null;

export interface Segment {
  ticks: number;
  inputs: Entry[];
}

export interface Action {
  tick: number;
  type: 'setEnergy';
  spec: { championId: number; energy: number };
}

export interface Checkpoint {
  tick: number;
  checksum: number;
}

export interface Fixture {
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
export function decodeFixture(data: unknown, kitId: string): Fixture {
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

export function toInput(entry: Entry): PlayerInput | undefined {
  if (entry === null) return undefined;
  const [moveX, moveY, aimX, aimY, buttons] = entry;
  return { moveX: moveX as -1 | 0 | 1, moveY: moveY as -1 | 0 | 1, aimX, aimY, buttons };
}

/** What a fixture must show, as `slot/ex` keys, so a kit change cannot leave a cast untested. */
export interface Expected {
  /** A castFired for each. */
  fired: string[];
  /** An energyGained whose cast is each: every ability that damages or heals a hurt ally. */
  gains: string[];
  /** The `then` of each dash fired: a dash end followed by a spawn of the same champion. */
  thens: string[];
  /** A statusApplied of each type the kit applies. */
  statuses: string[];
}

export const EXPECTED: Record<string, Expected> = {
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
  // The M2 and F gains come only from a hurt ally, so the fixture must show support-heal energy.
  lumeth: {
    fired: ['M1/false', 'M2/false', 'M2/true', 'SPACE/false', 'Q/false', 'E/false', 'R/false', 'R/true', 'F/false'],
    gains: ['M1/false', 'M2/false', 'M2/true', 'Q/false', 'E/false', 'F/false'],
    thens: [],
    statuses: ['hot', 'haste', 'root', 'knockback', 'shield', 'slow'],
  },
};

/** Collects what the coverage test needs from the events of every step. */
export class RosterCoverage {
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

/** The match seed of each fixture, so no two kits share a stream. */
export const SEEDS: Record<string, number> = { hargrim: 5555, quillon: 5556, lumeth: 5557, skerrow: 5558 };

export interface Observer {
  /** Before the actions of the tick the state is about to run. */
  beforeTick?: (state: GameState) => void;
  /** After an action. */
  afterAction?: (state: GameState, action: Action) => void;
  /** Right before a step, after the actions of its tick. */
  beforeStep?: (state: GameState) => void;
  /** After a step; `inputs` are the ones it ran with. */
  afterStep?: (state: GameState, inputs: (PlayerInput | undefined)[]) => void;
}

/** The mirror config of a fixture: the kit twice on team A, twice on team B. */
export function mirrorConfig(kitId: string): MatchConfig {
  return {
    teamSize: 2,
    players: [
      { championId: kitId, team: 'A' },
      { championId: kitId, team: 'A' },
      { championId: kitId, team: 'B' },
      { championId: kitId, team: 'B' },
    ],
  };
}

/** The match the fixture search plays live, before it has a fixture: the mirror config on arena01. */
export function mirrorMatch(kit: KitDef, seed: number): GameState {
  return createMatch(mirrorConfig(kit.id), arena01, seed, [kit]);
}

/** The match a fixture replays: its config on arena01 with its own seed and the kit. */
export function startMatch(fixture: Fixture, kit: KitDef): GameState {
  return createMatch(fixture.config, arena01, fixture.seed, [kit]);
}

/** Plays the fixture from `state` (at tick `from`) to the end: the actions, then the step. */
export function play(fixture: Fixture, state: GameState, from = 0, observer: Observer = {}): GameState {
  /** The decoded inputs for every tick, so a replay can start at any tick. */
  const inputsByTick: (PlayerInput | undefined)[][] = fixture.segments.flatMap((segment) =>
    Array.from({ length: segment.ticks }, () => segment.inputs.map(toInput)),
  );
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

/** Plays the fixture from `state` under the ability oracle: the steps run and the problems it found. */
export function playUnderOracle(fixture: Fixture, state: GameState): { steps: number; problems: string[] } {
  const watcher = new AbilityWatcher(state);
  let steps = 0;
  play(fixture, state, 0, {
    afterAction: (s) => watcher.afterEnergySet(s),
    beforeStep: (s) => watcher.beforeStep(s),
    afterStep: (s, inputs) => {
      steps++;
      watcher.afterStep(s, inputs);
    },
  });
  return { steps, problems: watcher.problems };
}
