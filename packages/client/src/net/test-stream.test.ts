import { decodeServerMessage, encodeServerMessage } from '@claudeline/protocol';
import { describe, expect, it } from 'vitest';
import {
  FINAL_TICK,
  GOLDEN_MATCH_START,
  GOLDEN_SNAPSHOT,
  buildStream,
  snapshotText,
} from './test-stream';

// The stream every net unit is driven by. These rows pin the stream itself: the golden texts it
// is built from and the shape the units' tests lean on.

describe('the golden copies', () => {
  it('are texts the protocol still writes byte for byte', () => {
    for (const text of [GOLDEN_MATCH_START, GOLDEN_SNAPSHOT]) {
      const decoded = decodeServerMessage(text);
      if (!decoded.ok) throw new Error(decoded.reason);
      expect(encodeServerMessage(decoded.message)).toBe(text);
    }
  });

  it('are the texts of packages/protocol/test/samples.ts, word for word', () => {
    expect(GOLDEN_MATCH_START).toBe(
      '{"t":"matchStart","you":2,"config":{"teamSize":2,"players":[' +
        '{"championId":"hargrim","team":"A"},{"championId":"lumeth","team":"A"},' +
        '{"championId":"quillon","team":"B"},{"championId":"hargrim","team":"B"}],"roundsToWin":3},' +
        '"arena":{"id":"arena02","size":[40.5,30]},"kits":[{"id":"hargrim","maxHealth":120.25}],' +
        '"snapshotEvery":3,"renderDelay":6}',
    );
    expect(GOLDEN_SNAPSHOT).toBe(
      '{"t":"snapshot","tick":51,"ack":-1,' +
        '"state":{"tick":51,"rng":4294967295,"champions":[],"projectiles":[]},' +
        '"events":[{"tick":49,"events":[{"type":"roundStarted","round":1}]},{"tick":51,"events":[]}]}',
    );
  });

  it('are what snapshotText writes for the same tick, ack and batches', () => {
    const decoded = decodeServerMessage(GOLDEN_SNAPSHOT);
    if (!decoded.ok || decoded.message.t !== 'snapshot') throw new Error('golden snapshot');
    const { tick, ack, events } = decoded.message;
    expect(snapshotText(tick, ack, events)).toBe(GOLDEN_SNAPSHOT);
  });
});

describe('the stream', () => {
  const stream = buildStream();

  it('has a snapshot every third tick from 3 to 60 and a last one off the cadence', () => {
    const ticks = stream.map((entry) => entry.snapshot.tick);
    const cadence = Array.from({ length: 20 }, (_, i) => 3 * (i + 1));
    expect(ticks).toEqual([...cadence, FINAL_TICK]);
    expect(FINAL_TICK - 60).toBe(2);
  });

  it('arrives in order, with a jitter that is not the same gap twice running', () => {
    for (let i = 1; i < stream.length; i++) {
      expect((stream[i] as { atMs: number }).atMs).toBeGreaterThanOrEqual(
        (stream[i - 1] as { atMs: number }).atMs,
      );
    }
    const gaps = new Set<number>();
    for (let i = 1; i < 20; i++) {
      gaps.add((stream[i] as { atMs: number }).atMs - (stream[i - 1] as { atMs: number }).atMs);
    }
    expect(gaps.size).toBeGreaterThan(4);
  });

  it('decodes every text to the snapshot it carries, with the state at its own tick', () => {
    for (const entry of stream) {
      const decoded = decodeServerMessage(entry.text);
      expect(decoded.ok).toBe(true);
      expect(decoded.ok && decoded.message).toEqual(entry.snapshot);
      expect(entry.snapshot.state.tick).toBe(entry.snapshot.tick);
    }
  });

  it('has snapshots with no batch, with two or three, and a batch of several events', () => {
    const counts = stream.map((entry) => entry.snapshot.events.length);
    expect(counts).toContain(0);
    expect(counts).toContain(2);
    expect(counts).toContain(3);
    const biggest = Math.max(...stream.flatMap((entry) => entry.snapshot.events.map((b) => b.events.length)));
    expect(biggest).toBeGreaterThanOrEqual(3);
  });

  it('keeps each batch to the ticks since the last snapshot, in tick order, each tick once', () => {
    const seen = new Set<number>();
    let previous = 0;
    for (const entry of stream) {
      for (const batch of entry.snapshot.events) {
        expect(batch.tick).toBeGreaterThan(previous);
        expect(batch.tick).toBeLessThanOrEqual(entry.snapshot.tick);
        expect(seen.has(batch.tick)).toBe(false);
        seen.add(batch.tick);
        previous = batch.tick;
      }
      previous = entry.snapshot.tick;
    }
  });

  it('ends on the matchEnded tick with a gap of 2', () => {
    const last = stream[stream.length - 1] as (typeof stream)[number];
    expect(last.snapshot.tick).toBe(FINAL_TICK);
    const lastBatch = last.snapshot.events[last.snapshot.events.length - 1] as { tick: number; events: { type: string }[] };
    expect(lastBatch.tick).toBe(FINAL_TICK);
    expect(lastBatch.events.map((event) => event.type)).toContain('matchEnded');
  });
});
