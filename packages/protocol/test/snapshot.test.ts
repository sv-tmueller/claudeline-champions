import arena02Json from '../../../data/arenas/arena02.json';
import hargrimJson from '../../../data/kits/hargrim.json';
import lumethJson from '../../../data/kits/lumeth.json';
import quillonJson from '../../../data/kits/quillon.json';
import { Button, checksum, createMatch, parseArenaDef, step } from '@claudeline/sim';
import type { GameState, KitDef, MatchConfig, MoveAxis, PlayerInput } from '@claudeline/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeServerMessage,
  encodeServerMessage,
  encodeSnapshot,
  snapshotStateJson,
} from '../src/codec';
import type { EventBatch, SnapshotState } from '../src/messages';

// The check of online design section 8: a 3v3 on arena02 is played with scripted inputs, and at
// every third tick the snapshot is encoded, spliced, decoded and rebuilt into a state that must
// have the live state's checksum. The kit files are imported by name, so a new kit in data/kits
// changes nothing here.

const arena = parseArenaDef(arena02Json);
const kits = [hargrimJson, lumethJson, quillonJson]
  .map((kit) => structuredClone(kit) as unknown as KitDef)
  .sort((a, b) => (a.id < b.id ? -1 : 1));
const roster = ['hargrim', 'quillon', 'lumeth'];
const config: MatchConfig = {
  teamSize: 3,
  roundsToWin: 3,
  players: [
    ...roster.map((championId) => ({ championId, team: 'A' as const })),
    ...roster.map((championId) => ({ championId, team: 'B' as const })),
  ],
};
const SEED = 7;
const TICKS = 1800;
const SLOT_BITS = [Button.M1, Button.M2, Button.SPACE, Button.Q, Button.E, Button.R, Button.F];

/** A linear congruential generator, so the script is the same on every machine. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Each champion holds an input for a while: it walks at the nearest enemy and casts at it. */
class Script {
  private readonly random = lcg(20261019);
  private readonly held: PlayerInput[];
  constructor(count: number) {
    this.held = Array.from({ length: count }, () => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 }));
  }
  next(state: GameState): PlayerInput[] {
    return state.champions.map((c, i) => {
      if (this.random() < 0.15) {
        const enemies = state.champions.filter((o) => o.team !== c.team && o.alive);
        const target = enemies[Math.floor(this.random() * enemies.length)] ?? c;
        const axis = (d: number): MoveAxis => (d > 1 ? 1 : d < -1 ? -1 : 0);
        const flip = this.random() < 0.3 ? -1 : 1;
        const slot = SLOT_BITS[Math.floor(this.random() * SLOT_BITS.length)] ?? 0;
        this.held[i] = {
          moveX: axis((target.x - c.x) * flip),
          moveY: axis((target.y - c.y) * flip),
          aimX: Math.round(target.x * 100),
          aimY: Math.round(target.y * 100),
          buttons: this.random() < 0.6 ? slot : 0,
        };
      }
      return { ...(this.held[i] as PlayerInput) };
    });
  }
}

/** The state of a snapshot, built by hand so the test does not lean on the helper it checks. */
function withoutDataKeys(state: GameState): SnapshotState {
  const copy: Partial<GameState> = { ...state };
  delete copy.arena;
  delete copy.kits;
  delete copy.events;
  return copy as SnapshotState;
}

interface Coverage {
  snapshots: number;
  projectile: boolean;
  area: boolean;
  status: boolean;
  withBatch: number;
  withoutBatch: number;
  batchTicks: number[];
  batchesSeen: number[];
}

function play(rebuildEvents: (batches: EventBatch[], tick: number) => GameState['events']): Coverage {
  const live = createMatch(config, arena, SEED, kits);
  const start = decodeServerMessage(
    encodeServerMessage({
      t: 'matchStart',
      you: 0,
      config,
      arena: live.arena,
      kits: live.kits,
      snapshotEvery: 3,
      renderDelay: 6,
    }),
  );
  if (!start.ok || start.message.t !== 'matchStart') throw new Error('matchStart did not decode');
  expect(start.message.arena).toEqual(live.arena);
  expect(start.message.kits).toEqual(live.kits);

  const script = new Script(live.champions.length);
  const cover: Coverage = {
    snapshots: 0,
    projectile: false,
    area: false,
    status: false,
    withBatch: 0,
    withoutBatch: 0,
    batchTicks: [],
    batchesSeen: [],
  };
  let pending: EventBatch[] = [];
  for (let i = 0; i < TICKS; i++) {
    step(live, script.next(live));
    // step clears state.events in place on the next call, so the batch holds a copy.
    if (live.events.length > 0) {
      pending.push({ tick: live.tick, events: structuredClone(live.events) });
      cover.batchTicks.push(live.tick);
    }
    const ended = live.events.some((e) => e.type === 'matchEnded');
    if (live.tick % 3 !== 0 && !ended) continue;

    const ack = live.tick - 1;
    const spliced = encodeSnapshot(live.tick, ack, snapshotStateJson(live), pending);
    const full = encodeServerMessage({
      t: 'snapshot',
      tick: live.tick,
      ack,
      state: withoutDataKeys(live),
      events: pending,
    });
    expect(spliced).toBe(full);

    const decoded = decodeServerMessage(spliced);
    if (!decoded.ok || decoded.message.t !== 'snapshot') throw new Error(`snapshot at ${live.tick} did not decode`);
    const msg = decoded.message;
    expect(msg.tick).toBe(live.tick);
    expect(msg.ack).toBe(ack);
    for (const batch of msg.events) cover.batchesSeen.push(batch.tick);

    const rebuilt: GameState = {
      ...msg.state,
      arena: start.message.arena,
      kits: start.message.kits,
      events: rebuildEvents(msg.events, msg.tick),
    };
    expect(checksum(rebuilt), `checksum at tick ${live.tick}`).toBe(checksum(live));

    cover.snapshots++;
    if (live.projectiles.length > 0) cover.projectile = true;
    if (live.areas.length > 0) cover.area = true;
    if (live.champions.some((c) => c.statuses.length > 0)) cover.status = true;
    if (live.events.length > 0) cover.withBatch++;
    else cover.withoutBatch++;
    pending = [];
    if (ended) break;
  }
  return cover;
}

/** The rule of online design section 8: the last batch when its tick is the snapshot's, else none. */
function eventsOfTick(batches: EventBatch[], tick: number): GameState['events'] {
  const last = batches[batches.length - 1];
  return last !== undefined && last.tick === tick ? last.events : [];
}

describe('a real 3v3 on arena02 through the codec', () => {
  let cover: Coverage;
  beforeAll(() => {
    cover = play(eventsOfTick);
  });

  it('rebuilds a state with the live checksum at every snapshot, spliced and full alike', () => {
    expect(cover.snapshots).toBeGreaterThan(300);
  });

  it('is not vacuous: projectiles, areas and statuses are in some snapshot', () => {
    expect(cover.projectile).toBe(true);
    expect(cover.area).toBe(true);
    expect(cover.status).toBe(true);
  });

  it('is not vacuous: some snapshot tick has events and some has none', () => {
    expect(cover.withBatch).toBeGreaterThan(0);
    expect(cover.withoutBatch).toBeGreaterThan(0);
  });

  it('carries the events of every tick exactly once, in tick order', () => {
    expect(cover.batchesSeen).toEqual(cover.batchTicks.filter((t) => t <= (cover.batchesSeen.at(-1) ?? 0)));
    expect(cover.batchesSeen.length).toBeGreaterThan(10);
  });

  it('turns red when the batch of the snapshot tick is dropped from the rebuild', () => {
    // The mutation of the sub-plan, run in the test itself: without the tick's events the
    // checksum cannot match, which is what makes the check above meaningful.
    expect(() => play(() => [])).toThrow(/checksum at tick/);
  });
});

describe('snapshotStateJson', () => {
  it('drops the root keys arena, kits and events and nothing else', () => {
    const live = createMatch(config, arena, SEED, kits);
    step(live, []);
    const parsed = JSON.parse(snapshotStateJson(live)) as Record<string, unknown>;
    const expected = Object.keys(live).filter((k) => !['arena', 'kits', 'events'].includes(k));
    expect(Object.keys(parsed)).toEqual(expected);
    expect(expected).toContain('champions');
    expect(expected).toContain('match');
    expect(snapshotStateJson(live)).toBe(JSON.stringify(withoutDataKeys(live)));
  });
});
