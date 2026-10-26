import { describe, expect, it } from 'vitest';
import {
  CORRECTION_DOWN,
  CORRECTION_UP,
  MAX_CATCH_UP_RATE,
  createRenderClock,
  type RenderClock,
} from './render-clock';
import { STREAM_LATENCY_MS, buildStream, type StreamEntry } from './test-stream';

// The render clock turns the arrival times of snapshots into the tick to draw: the newest tick
// plus the time since it arrived, minus the render delay of 6, corrected gently by each newer
// arrival, never backward and never past the newest snapshot held.

const DELAY = 6;
const FRAME_MS = 1000 / 60;
const TICKS_PER_MS = 60 / 1000;

/** What the server's tick is at `nowMs`, for a stream that left tick 0 at 0 ms. */
function serverTickAt(nowMs: number): number {
  return (nowMs - STREAM_LATENCY_MS) * TICKS_PER_MS;
}

/**
 * Plays frames of 1/60 s from `fromMs` to `untilMs`, handing the clock every entry that arrived by
 * a frame before its update. `extra` may add arrivals of its own after an entry.
 */
function drive(
  clock: RenderClock,
  entries: readonly StreamEntry[],
  fromMs: number,
  untilMs: number,
  onFrame: (nowMs: number) => void,
  extra?: (entry: StreamEntry) => void,
): void {
  let next = 0;
  for (let now = fromMs; now <= untilMs; now += FRAME_MS) {
    while (next < entries.length && (entries[next] as StreamEntry).atMs <= now) {
      const entry = entries[next] as StreamEntry;
      clock.onSnapshot(entry.snapshot.tick, entry.atMs);
      extra?.(entry);
      next++;
    }
    clock.update(now);
    onFrame(now);
  }
}

describe('the render clock', () => {
  it('reports no tick until the first snapshot', () => {
    const clock = createRenderClock(DELAY);
    expect(clock.started).toBe(false);
    clock.update(500);
    expect(clock.started).toBe(false);
    expect(clock.newestTick).toBe(-1);
    clock.onSnapshot(30, 1000);
    clock.update(1000);
    expect(clock.started).toBe(true);
    expect(clock.newestTick).toBe(30);
    expect(clock.renderTick).toBe(30 - DELAY);
  });

  it('draws the delay behind the newest tick plus the time since it arrived', () => {
    const clock = createRenderClock(DELAY);
    clock.onSnapshot(30, 1000);
    clock.update(1000);
    clock.update(1050);
    expect(clock.renderTick).toBeCloseTo(27, 9);
    expect(clock.estimateTick).toBeCloseTo(33, 9);
  });

  it('corrects the estimate gently toward a newer tick that arrives ahead of it', () => {
    const clock = createRenderClock(DELAY);
    clock.onSnapshot(30, 1000);
    clock.update(1000);
    // At 1500 ms the estimate reads 60; the snapshot says 66.
    clock.onSnapshot(66, 1500);
    clock.update(1500);
    expect(clock.estimateTick).toBeCloseTo(60 + CORRECTION_UP * 6, 9);
    expect(clock.renderTick).toBeCloseTo(60 + CORRECTION_UP * 6 - DELAY, 9);
  });

  it('corrects the estimate down more gently toward a newer tick that arrives behind it', () => {
    expect(CORRECTION_DOWN).toBeLessThan(CORRECTION_UP);
    const clock = createRenderClock(DELAY);
    clock.onSnapshot(30, 1000);
    clock.update(1000);
    clock.onSnapshot(54, 1500);
    clock.update(1500);
    expect(clock.estimateTick).toBeCloseTo(60 - CORRECTION_DOWN * 6, 9);
    expect(clock.renderTick).toBeCloseTo(60 - CORRECTION_DOWN * 6 - DELAY, 9);
  });

  it('never moves backward when a correction lowers the estimate', () => {
    const clock = createRenderClock(DELAY);
    clock.onSnapshot(30, 1000);
    clock.update(1100);
    expect(clock.renderTick).toBe(30);
    // The estimate reads 36 and the snapshot says 31: the estimate drops, the render tick holds.
    clock.onSnapshot(31, 1100);
    clock.update(1100);
    expect(clock.estimateTick).toBeLessThan(36);
    expect(clock.renderTick).toBe(30);
  });

  it('never passes the newest tick held, however long the stream stalls', () => {
    const clock = createRenderClock(DELAY);
    clock.onSnapshot(30, 1000);
    for (const now of [1100, 1500, 5000, 60000]) {
      clock.update(now);
      expect(clock.renderTick).toBe(30);
    }
    clock.onSnapshot(33, 60050);
    clock.update(60050);
    expect(clock.renderTick).toBeGreaterThan(30);
    expect(clock.renderTick).toBeLessThanOrEqual(33);
  });

  it('is not moved by a late, a duplicate or an out-of-order tick, and never goes backward', () => {
    const stream = buildStream();
    const clean = createRenderClock(DELAY);
    const noisy = createRenderClock(DELAY);
    const cleanTicks: number[] = [];
    const noisyTicks: number[] = [];
    drive(clean, stream, 0, 1100, () => clean.started && cleanTicks.push(clean.renderTick));
    drive(
      noisy,
      stream,
      0,
      1100,
      () => noisy.started && noisyTicks.push(noisy.renderTick),
      (entry) => {
        const tick = entry.snapshot.tick;
        noisy.onSnapshot(tick, entry.atMs + 3);
        noisy.onSnapshot(tick - 3, entry.atMs + 5);
        noisy.onSnapshot(tick - 9, entry.atMs + 9);
        noisy.onSnapshot(tick, entry.atMs + 20);
      },
    );
    expect(noisyTicks).toEqual(cleanTicks);
    for (let i = 1; i < noisyTicks.length; i++) {
      expect(noisyTicks[i] as number).toBeGreaterThanOrEqual(noisyTicks[i - 1] as number);
    }
  });

  it('stays within a tick of the server tick minus 6 on a steady 20 Hz stream with jitter, once settled', () => {
    const stream = buildStream();
    const clock = createRenderClock(DELAY);
    const errors: number[] = [];
    let first = 0;
    let last = 0;
    drive(clock, stream, 0, 1000, (now) => {
      if (now < 400) return;
      if (first === 0) first = clock.renderTick;
      last = clock.renderTick;
      errors.push(clock.renderTick - (serverTickAt(now) - DELAY));
    });
    expect(Math.max(...errors.map(Math.abs))).toBeLessThanOrEqual(1);
    // About 60 ticks a second: 600 ms is 36 ticks, give or take the two ends' error.
    expect(last - first).toBeGreaterThan(34);
    expect(last - first).toBeLessThan(38);
  });

  it('holds through a stall, then catches up in bounded steps and not at once', () => {
    const stream = buildStream();
    const early = stream.filter((entry) => entry.atMs <= 400);
    const late = stream.filter((entry) => entry.atMs > 400 && entry.atMs <= 900);
    const clock = createRenderClock(DELAY);
    drive(clock, early, 0, 400, () => undefined);
    const newestBefore = clock.newestTick;
    // Half a second of nothing: it holds at the newest tick.
    for (let now = 400 + FRAME_MS; now <= 900; now += FRAME_MS) {
      clock.update(now);
      expect(clock.renderTick).toBeLessThanOrEqual(newestBefore);
    }
    expect(clock.renderTick).toBe(newestBefore);
    // Then everything that was held up arrives at once.
    for (const entry of late) clock.onSnapshot(entry.snapshot.tick, 900);
    expect(clock.newestTick).toBeGreaterThan(newestBefore + 20);
    const jump = clock.newestTick - DELAY - clock.renderTick;
    expect(jump).toBeGreaterThan(20);
    let previous = clock.renderTick;
    let biggest = 0;
    let moved = 0;
    for (let now = 900 + FRAME_MS; now <= 4000; now += FRAME_MS) {
      clock.update(now);
      const step = clock.renderTick - previous;
      expect(step).toBeGreaterThanOrEqual(0);
      biggest = Math.max(biggest, step);
      if (step > 0) moved++;
      previous = clock.renderTick;
    }
    expect(biggest).toBeLessThanOrEqual(MAX_CATCH_UP_RATE * FRAME_MS * TICKS_PER_MS + 1e-9);
    expect(biggest).toBeLessThan(jump / 4);
    expect(moved).toBeGreaterThan(8);
    // It caught up with its target, which is the estimate minus the delay or the newest tick.
    expect(clock.renderTick).toBeCloseTo(Math.min(clock.estimateTick - DELAY, clock.newestTick), 9);
  });
});
