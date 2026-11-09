// Scripted endArea fixture test (spec 4.3, #160).
//
// The fixture runs 2400 ticks on arena01 with the `test-ender` kit (`test/kits.ts`) for all four
// champions (a mirror: two on team A, two on team B), seed 5600. It holds inputs only, in the
// format of the roster fixture: a segment holds its inputs for `ticks` ticks, and an entry is
// [moveX, moveY, aimX, aimY, buttons], or null for a missing input. `checkpoints` hold the checksum
// of the whole state, `state.kits` included, after the step that makes `state.tick` equal to
// `tick`; `checksum` is the one after the last tick.
//
// The kit is the ender: M2 is a non-piercing bolt with an unfused `endArea`, SPACE a non-piercing
// bolt whose `endArea` carries a fuse of 30 (rules 2.7), both with M1 a close arc. Team A fires M2
// at the near obstacle (the pillar at 0, 0, then the -8, 0 wall), team B fires SPACE at the far
// boundary; both walks are none. So the fixture shows an unfused area spawned from an obstacle end,
// a fused (armed) area spawned from a lifetime or edge end, their first pulses (`areaTick`), and
// their expiry, which is what the `endArea` coverage needs.
//
// How the committed script was made: a plain policy (stand still, fire the one button at a fixed
// far aim) ran the mirror match for 2400 ticks and recorded the lockstep inputs; the checkpoint
// checksums were then generated as for the other fixtures: set every checksum to 0, run
// `npx vitest run --project sim packages/sim/test/endarea-fixture.test.ts`, copy the actual values
// from the failing checkpoint and checksum assertions into the fixture, and rerun until green.
// Changing gameplay or `test/kits.ts` on purpose means regenerating the same way in the same change.
//
// "Replay once in a separate process" is met by the committed checksums, which the authoring run
// produced, plus every CI run that replays them again, on Linux x86 as well as on a Mac.
import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/scripted-endarea-arena01-2v2.json';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, MatchConfig, PlayerInput, SimEvent } from '../src/index';
import { arena01 } from './helpers';
import { testEnder } from './kits';

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
  const ids = f.config.players.map((p) => p.championId);
  if (ids.join() !== 'test-ender,test-ender,test-ender,test-ender') {
    throw new Error('players must be the ender twice on team A and twice on team B');
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
  /** Right before a step. */
  beforeStep?: (state: GameState) => void;
  /** After a step; `inputs` are the ones it ran with. */
  afterStep?: (state: GameState, inputs: (PlayerInput | undefined)[]) => void;
}

/** Plays the fixture from `state` (at tick `from`) to the end. */
function play(state: GameState, from = 0, observer: Observer = {}): GameState {
  for (let tick = from; tick < fixture.ticks; tick++) {
    const inputs = inputsByTick[tick] as (PlayerInput | undefined)[];
    observer.beforeStep?.(state);
    step(state, inputs);
    observer.afterStep?.(state, inputs);
  }
  return state;
}

function start(): GameState {
  return createMatch(fixture.config, arena01, fixture.seed, [testEnder()]);
}

interface Logged {
  tick: number;
  event: SimEvent;
}

/** Every event with the `state.tick` the step that emitted it made, and the area it spawned. */
function events(): { log: Logged[]; areas: Map<number, { fuseTicks?: number }> } {
  const log: Logged[] = [];
  const areas = new Map<number, { fuseTicks?: number }>();
  const state = start();
  play(state, 0, {
    afterStep: (s) => {
      for (const event of s.events) {
        log.push({ tick: s.tick, event });
        if (event.type === 'areaSpawned') {
          const area = s.areas.find((a) => a.id === event.areaId);
          areas.set(event.areaId, { fuseTicks: area?.fuseTicks });
        }
      }
    },
  });
  return { log, areas };
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

describe('the endArea fixture', () => {
  it('decodes to the committed shape', () => {
    expect(fixture.ticks).toBe(2400);
    expect(fixture.checkpoints).toHaveLength(24);
    expect(fixture.seed).toBe(5600);
  });

  it('spawns an area from an unfused endArea at an obstacle or boundary end, and a fused one at a lifetime end', () => {
    const { log, areas } = events();
    const spawned = of(log, 'areaSpawned');
    expect(spawned).not.toEqual([]);
    // Both an armed (fused) and a live (unfused) area are spawned by the endArea mechanic.
    const fused = spawned.filter((l) => (areas.get(l.event.areaId)?.fuseTicks ?? 0) > 0);
    const live = spawned.filter((l) => areas.get(l.event.areaId)?.fuseTicks === undefined);
    expect(fused).not.toEqual([]);
    expect(live).not.toEqual([]);
    // Each spawn follows a projectileExpired that is not a champion hit.
    const seen = new Set<string>();
    for (const spawn of spawned) {
      const before = log
        .slice(0, log.indexOf(spawn))
        .reverse()
        .find((l) => l.event.type === 'projectileExpired');
      if (before && before.event.type === 'projectileExpired') seen.add(before.event.reason);
    }
    expect([...seen].sort()).toEqual(['boundary', 'lifetime', 'obstacle']);
  });

  it('pulses and expires every spawned area, so nothing is left alive at the end', () => {
    const { log } = events();
    const ticks = of(log, 'areaTick').map((l) => l.event.areaId);
    const expired = new Set(of(log, 'areaExpired').map((l) => l.event.areaId));
    for (const id of new Set(of(log, 'areaSpawned').map((l) => l.event.areaId))) {
      expect(ticks, `area ${id} never pulsed`).toContain(id);
      expect(expired.has(id), `area ${id} never expired`).toBe(true);
    }
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

  it('continues identically from a clone taken while an area is live', () => {
    let copy: GameState | undefined;
    let cloneTick = -1;
    const original = play(start(), 0, {
      beforeStep: (s) => {
        if (!copy && s.areas.length > 0) {
          copy = cloneState(s);
          cloneTick = s.tick;
        }
      },
    });
    expect(copy).toBeDefined();
    if (!copy) return;
    expect(copy.areas.length).toBeGreaterThan(0);
    expect(checksum(play(copy, cloneTick))).toBe(checksum(original));
  });
});
