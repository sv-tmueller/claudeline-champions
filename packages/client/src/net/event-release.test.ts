import type { EventBatch } from '@claudeline/protocol';
import { describe, expect, it } from 'vitest';
import { createEventRelease } from './event-release';
import { buildStream } from './test-stream';

// A batch of events is released when the render tick passes its tick, so a hit lines up with the
// projectile drawn (online design section 9, Events).

function batch(tick: number, ...types: string[]): EventBatch {
  return {
    tick,
    events: types.map((type) => ({ type, round: tick }) as unknown as EventBatch['events'][number]),
  };
}

function ticksOf(batches: readonly EventBatch[]): number[] {
  return batches.map((b) => b.tick);
}

describe('the event release', () => {
  it('releases a batch once the render tick reaches its tick, and not before', () => {
    const release = createEventRelease();
    release.add([batch(10, 'a')]);
    expect(release.release(9.999)).toEqual([]);
    expect(ticksOf(release.release(10))).toEqual([10]);
  });

  it('releases each batch once, in tick order, on the first frame that passes it', () => {
    const release = createEventRelease();
    release.add([batch(7, 'a'), batch(8, 'b'), batch(9, 'c')]);
    expect(ticksOf(release.release(7.5))).toEqual([7]);
    expect(ticksOf(release.release(7.9))).toEqual([]);
    expect(ticksOf(release.release(12))).toEqual([8, 9]);
    expect(ticksOf(release.release(13))).toEqual([]);
  });

  it('keeps the order of the events inside a batch', () => {
    const release = createEventRelease();
    const sent = batch(9, 'damage', 'energyGained', 'shieldAbsorbed');
    release.add([sent]);
    const out = release.release(9);
    expect(out[0]?.events.map((event) => event.type)).toEqual(['damage', 'energyGained', 'shieldAbsorbed']);
  });

  it('releases nothing twice for a duplicate snapshot, pending or released', () => {
    const release = createEventRelease();
    release.add([batch(7, 'a'), batch(8, 'b')]);
    release.add([batch(7, 'a'), batch(8, 'b')]);
    expect(ticksOf(release.release(7))).toEqual([7]);
    // 7 is released, 8 is still pending: the duplicate arrives again.
    release.add([batch(7, 'a'), batch(8, 'b')]);
    expect(ticksOf(release.release(20))).toEqual([8]);
    release.add([batch(7, 'a'), batch(8, 'b')]);
    expect(ticksOf(release.release(30))).toEqual([]);
  });

  it('drops a batch at or below the last released tick, which over an ordered transport is a duplicate', () => {
    const release = createEventRelease();
    release.add([batch(10, 'a')]);
    release.release(12);
    release.add([batch(10, 'a'), batch(9, 'late')]);
    expect(ticksOf(release.release(20))).toEqual([]);
    release.add([batch(11, 'fresh')]);
    expect(ticksOf(release.release(20))).toEqual([11]);
  });

  it('still releases in tick order a snapshot that arrives out of order within the delay', () => {
    const release = createEventRelease();
    release.add([batch(14, 'a'), batch(15, 'b')]);
    release.add([batch(7, 'c'), batch(9, 'd')]);
    expect(ticksOf(release.release(8))).toEqual([7]);
    release.add([batch(11, 'e')]);
    expect(ticksOf(release.release(16))).toEqual([9, 11, 14, 15]);
  });

  it('hands out the same array every call, emptied first', () => {
    const release = createEventRelease();
    release.add([batch(5, 'a')]);
    const first = release.release(5);
    expect(first).toHaveLength(1);
    const second = release.release(6);
    expect(second).toBe(first);
    expect(second).toHaveLength(0);
  });

  it('releases every batch of the scripted stream once and in order, whatever the frame rate', () => {
    const stream = buildStream();
    const expected = stream.flatMap((entry) => ticksOf(entry.snapshot.events));
    for (const step of [0.25, 1, 2.5]) {
      const release = createEventRelease();
      const got: number[] = [];
      let next = 0;
      for (let render = 0; render <= 70; render += step) {
        // A snapshot arrives while the render tick is 6 behind its tick.
        while (next < stream.length && (stream[next] as { snapshot: { tick: number } }).snapshot.tick <= render + 6) {
          release.add((stream[next] as { snapshot: { events: EventBatch[] } }).snapshot.events);
          // The next arrival repeats this one: a duplicate.
          release.add((stream[next] as { snapshot: { events: EventBatch[] } }).snapshot.events);
          next++;
        }
        got.push(...ticksOf(release.release(render)));
      }
      expect(got).toEqual(expected);
    }
  });
});
