import {
  decodeServerMessage,
  encodeSnapshot,
  type EventBatch,
  type ServerMessage,
  type SnapshotMessage,
} from '@claudeline/protocol';
import type { SimEvent } from '@claudeline/sim';

// A scripted server stream for the net units: a `matchStart` and the snapshots of a short match,
// each with the time it arrives. A test-only module, which no client code imports, like
// test-fake.ts. The texts are built with the protocol's own encoder and read back through
// `decodeServerMessage`, so a unit never sees a message the client could not.

// The golden texts of packages/protocol/test/samples.ts, copied word for word. That folder is not
// an export of the protocol package and a relative import into it would be a new boundary
// exception, so the copies are pinned in test-stream.test.ts: they must round trip through the
// protocol's codec. If the key order of the protocol changes, those rows go red here too.
export const GOLDEN_MATCH_START =
  '{"t":"matchStart","you":2,"config":{"teamSize":2,"players":[' +
  '{"championId":"hargrim","team":"A"},{"championId":"lumeth","team":"A"},' +
  '{"championId":"quillon","team":"B"},{"championId":"hargrim","team":"B"}],"roundsToWin":3},' +
  '"arena":{"id":"arena02","size":[40.5,30]},"kits":[{"id":"hargrim","maxHealth":120.25}],' +
  '"snapshotEvery":3,"renderDelay":6}';

export const GOLDEN_SNAPSHOT =
  '{"t":"snapshot","tick":51,"ack":-1,' +
  '"state":{"tick":51,"rng":4294967295,"champions":[],"projectiles":[]},' +
  '"events":[{"tick":49,"events":[{"type":"roundStarted","round":1}]},{"tick":51,"events":[]}]}';

/** Every message goes through the decoder before a unit sees it. */
export function decoded(text: string): ServerMessage {
  const result = decodeServerMessage(text);
  if (!result.ok) throw new Error(`the test stream wrote a text the client rejects: ${result.reason}`);
  return result.message;
}

function goldenSnapshot(): SnapshotMessage {
  const message = decoded(GOLDEN_SNAPSHOT);
  if (message.t !== 'snapshot') throw new Error('the golden snapshot is not a snapshot');
  return message;
}

/** A snapshot text at `tick`: the golden's state with its tick changed, and the given batches. */
export function snapshotText(tick: number, ack: number, batches: readonly EventBatch[]): string {
  const state = { ...goldenSnapshot().state, tick };
  return encodeSnapshot(tick, ack, JSON.stringify(state), batches);
}

/** The snapshot a text decodes to. */
export function snapshotOf(text: string): SnapshotMessage {
  const message = decoded(text);
  if (message.t !== 'snapshot') throw new Error('not a snapshot');
  return message;
}

/** A snapshot with these batches, for a unit that needs one of its own. */
export function snapshotAt(tick: number, batches: readonly EventBatch[] = []): SnapshotMessage {
  return snapshotOf(snapshotText(tick, Math.max(-1, tick - 4), batches));
}

/** The tick of the last snapshot of the cadence. The one after it is on the matchEnded tick. */
export const LAST_CADENCE_TICK = 60;
export const FINAL_TICK = 62;

/** The ticks that had events, and the events of each. The other ticks have no batch. */
const EVENTS_AT: ReadonlyMap<number, SimEvent[]> = new Map<number, SimEvent[]>([
  [5, [{ type: 'projectileSpawned', projectileId: 1, ownerId: 0, x: 1, y: 2, vx: 3, vy: 0, radius: 0.2 }]],
  [7, [{ type: 'damage', targetId: 2, sourceId: 0, amount: 10, health: 110 }]],
  [8, [{ type: 'heal', targetId: 1, sourceId: 1, amount: 4, health: 100 }]],
  [
    9,
    [
      { type: 'damage', targetId: 3, sourceId: 0, amount: 12, health: 98 },
      { type: 'energyGained', championId: 0, castId: 1, targetId: 3, amount: 6, energy: 6 },
      { type: 'shieldAbsorbed', targetId: 3, sourceId: 0, amount: 3, absorbLeft: 0 },
    ],
  ],
  [14, [{ type: 'castStarted', championId: 2, castId: 2, slot: 'M1', ex: false, windupTicks: 4, cost: 0 }]],
  [15, [{ type: 'castFired', championId: 2, castId: 2, slot: 'M1', ex: false }]],
  [30, [{ type: 'death', targetId: 3, sourceId: 0 }]],
  [33, [{ type: 'roundStarted', round: 2 }]],
  [34, [{ type: 'areaExpired', areaId: 1 }]],
  [
    FINAL_TICK - 1,
    [{ type: 'roundEnded', round: 3, winner: 'A', scoreA: 3, scoreB: 1 }],
  ],
  [FINAL_TICK, [{ type: 'matchEnded', winner: 'A', scoreA: 3, scoreB: 1 }]],
]);

/** The batches of the ticks after `from` up to `to`, the ticks that had events, in tick order. */
function batchesBetween(from: number, to: number): EventBatch[] {
  const batches: EventBatch[] = [];
  for (let tick = from + 1; tick <= to; tick++) {
    const events = EVENTS_AT.get(tick);
    if (events !== undefined) batches.push({ tick, events });
  }
  return batches;
}

/** One snapshot of the stream: when it arrives, its text and what the text decodes to. */
export interface StreamEntry {
  atMs: number;
  text: string;
  snapshot: SnapshotMessage;
}

/** The network latency, and a fixed table of jitter in ms (no Math.random: the stream is the same every run). */
export const STREAM_LATENCY_MS = 40;
export const STREAM_JITTER_MS = [0, 9, -7, 4, 12, -10, 2, 7, -3, 11, -12, 5];

/**
 * The snapshots of ticks 3, 6 ... 60 and one more at FINAL_TICK, the matchEnded tick, 2 after the
 * cadence. A snapshot arrives its tick's time (tick * 1000 / 60 ms) after the match start, plus
 * the latency and the jitter of its turn; an arrival never comes before the one before it, as
 * over an ordered transport.
 */
export function buildStream(): StreamEntry[] {
  const ticks: number[] = [];
  for (let tick = 3; tick <= LAST_CADENCE_TICK; tick += 3) ticks.push(tick);
  ticks.push(FINAL_TICK);
  const entries: StreamEntry[] = [];
  let previousTick = 0;
  let previousAt = 0;
  ticks.forEach((tick, index) => {
    const jitter = STREAM_JITTER_MS[index % STREAM_JITTER_MS.length] as number;
    const atMs = Math.max(previousAt, Math.round((tick * 1000) / 60) + STREAM_LATENCY_MS + jitter);
    const text = snapshotText(tick, Math.max(-1, tick - 4), batchesBetween(previousTick, tick));
    entries.push({ atMs, text, snapshot: snapshotOf(text) });
    previousTick = tick;
    previousAt = atMs;
  });
  return entries;
}
