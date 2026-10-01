// Replay fixture test.
//
// The fixture records one input stream for four champions on arena01. A
// segment holds its inputs for `ticks` ticks. An entry is
// [moveX, moveY, aimX, aimY, buttons], or null for a missing input.
//
// How the committed checksum was generated: author the segments with
// "checksum": 0, run `npx vitest run --project sim packages/sim/test/replay.test.ts`,
// copy the actual value from the failing checksum assertion into the fixture,
// and rerun until it is green. There is no writer script. Changing gameplay on
// purpose means regenerating it the same way in the same change.
//
// "Replay once in a separate process" is met by the committed checksum, which
// the authoring run produced, plus every CI run that replays it again.
import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/replay-arena01-2v2.json';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, MatchConfig, PlayerInput } from '../src/index';
import { ALL_CONTACT_KINDS, arena01, checkInvariants, contactKinds } from './helpers';
import type { ContactKind } from './helpers';

type Entry = [number, number, number, number, number] | null;

interface Segment {
  ticks: number;
  inputs: Entry[];
}

interface Fixture {
  format: 1;
  arena: 'arena01';
  seed: number;
  config: MatchConfig;
  ticks: number;
  segments: Segment[];
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
  if (!Array.isArray(f.segments) || f.segments.length === 0) throw new Error('no segments');
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
  if (f.ticks < 600) throw new Error('fixture must run at least 600 ticks');
  return f;
}

function toInput(entry: Entry): PlayerInput | undefined {
  if (entry === null) return undefined;
  const [moveX, moveY, aimX, aimY, buttons] = entry;
  return { moveX: moveX as -1 | 0 | 1, moveY: moveY as -1 | 0 | 1, aimX, aimY, buttons };
}

const fixture = decodeFixture(fixtureJson);

/** Calls `onTick` with the state after each tick, then returns the final state. */
function replay(onTick?: (state: GameState) => void): GameState {
  const state = createMatch(fixture.config, arena01, fixture.seed);
  for (const segment of fixture.segments) {
    const inputs = segment.inputs.map(toInput);
    for (let i = 0; i < segment.ticks; i++) {
      step(state, inputs);
      onTick?.(state);
    }
  }
  return state;
}

describe('replay fixture', () => {
  it('has the shape the decoder expects and exercises every input kind', () => {
    const entries = fixture.segments.flatMap((s) => s.inputs);
    expect(entries.some((e) => e === null)).toBe(true);
    expect(entries.some((e) => e !== null && e[0] !== 0 && e[1] !== 0)).toBe(true);
    expect(entries.some((e) => e !== null && e[4] !== 0)).toBe(true);
    const aims = new Set(entries.map((e) => (e === null ? '' : `${e[2]},${e[3]}`)));
    expect(aims.size).toBeGreaterThan(2);
  });

  it('keeps every invariant on every tick and covers every contact kind', () => {
    const seen = new Set<ContactKind>();
    let ticks = 0;
    replay((state) => {
      ticks++;
      expect(checkInvariants(state)).toEqual([]);
      for (const kind of contactKinds(state)) seen.add(kind);
    });
    expect(ticks).toBe(fixture.ticks);
    expect(ALL_CONTACT_KINDS.filter((kind) => !seen.has(kind))).toEqual([]);
  });

  it('reproduces the committed checksum', () => {
    const { projectiles, areas, nextEntityId, ...movement } = replay();
    // The fixture predates these fields, so its checksum covers the state without them.
    expect(projectiles).toEqual([]);
    expect(areas).toEqual([]);
    expect(nextEntityId).toBe(4);
    expect(checksum(movement as GameState)).toBe(fixture.checksum);
  });

  it('gives the same checksum when replayed twice in one process', () => {
    expect(checksum(replay())).toBe(checksum(replay()));
  });

  it('continues identically from a clone taken at tick 300', () => {
    const state = createMatch(fixture.config, arena01, fixture.seed);
    let copy: GameState | undefined;
    let tick = 0;
    for (const segment of fixture.segments) {
      const inputs = segment.inputs.map(toInput);
      for (let i = 0; i < segment.ticks; i++) {
        step(state, inputs);
        tick++;
        if (tick === 300) copy = cloneState(state);
        if (copy && tick > 300) step(copy, inputs);
      }
    }
    expect(copy).toBeDefined();
    if (!copy) return;
    expect(copy.tick).toBe(fixture.ticks);
    expect(checksum(copy)).toBe(checksum(state));
  });
});
