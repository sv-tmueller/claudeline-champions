import { describe, expect, it } from 'vitest';
import type { AlphaClock } from '../interpolate';
import { BUFFER_CAPACITY, createSnapshotBuffer } from './snapshot-buffer';
import { snapshotAt } from './test-stream';

// The buffer keeps the last few snapshots and answers, for a render tick, which two it falls
// between and how far: the A, B and alpha the interpolation reads (online design section 9).

describe('the snapshot buffer', () => {
  it('has no answer before the first snapshot', () => {
    const buffer = createSnapshotBuffer();
    expect(buffer.size).toBe(0);
    expect(buffer.newestTick).toBe(-1);
    expect(buffer.select(10)).toBeNull();
  });

  it('keeps at least four snapshots', () => {
    expect(BUFFER_CAPACITY).toBeGreaterThanOrEqual(4);
  });

  it('brackets the render tick between A and B, with alpha the fraction between them', () => {
    const buffer = createSnapshotBuffer();
    for (const tick of [3, 6, 9]) buffer.add(snapshotAt(tick));
    const view = buffer.select(7.5);
    expect(view?.a?.tick).toBe(6);
    expect(view?.b?.tick).toBe(9);
    expect(view?.alpha).toBe(0.5);
    const edge = buffer.select(6);
    expect(edge?.a?.tick).toBe(6);
    expect(edge?.b?.tick).toBe(9);
    expect(edge?.alpha).toBe(0);
  });

  it('writes into one record that fits the AlphaClock the interpolation reads', () => {
    const buffer = createSnapshotBuffer();
    for (const tick of [3, 6, 9]) buffer.add(snapshotAt(tick));
    const first = buffer.select(4);
    const second = buffer.select(8);
    expect(second).toBe(first);
    const clock: AlphaClock = second as AlphaClock;
    expect(clock.alpha).toBeCloseTo(2 / 3, 12);
  });

  it('keeps the snapshots sorted by tick when they arrive out of order', () => {
    const buffer = createSnapshotBuffer();
    for (const tick of [9, 3, 6]) buffer.add(snapshotAt(tick));
    expect(buffer.size).toBe(3);
    const view = buffer.select(4.5);
    expect(view?.a?.tick).toBe(3);
    expect(view?.b?.tick).toBe(6);
  });

  it('inserts, in order, an out-of-order snapshot that is newer than A', () => {
    const buffer = createSnapshotBuffer();
    buffer.add(snapshotAt(3));
    buffer.add(snapshotAt(9));
    expect(buffer.select(4)?.a?.tick).toBe(3);
    expect(buffer.add(snapshotAt(6))).toBe(true);
    const view = buffer.select(7);
    expect(view?.a?.tick).toBe(6);
    expect(view?.b?.tick).toBe(9);
    expect(buffer.newestTick).toBe(9);
  });

  it('ignores a duplicate tick, and keeps the first snapshot of it', () => {
    const buffer = createSnapshotBuffer();
    const first = snapshotAt(6);
    expect(buffer.add(first)).toBe(true);
    expect(buffer.add(snapshotAt(6))).toBe(false);
    expect(buffer.size).toBe(1);
    expect(buffer.select(6)?.a).toBe(first);
  });

  it('ignores a snapshot at or below A', () => {
    const buffer = createSnapshotBuffer();
    for (const tick of [3, 6, 9]) buffer.add(snapshotAt(tick));
    expect(buffer.select(7)?.a?.tick).toBe(6);
    expect(buffer.add(snapshotAt(6))).toBe(false);
    expect(buffer.add(snapshotAt(5))).toBe(false);
    expect(buffer.add(snapshotAt(3))).toBe(false);
    expect(buffer.add(snapshotAt(7))).toBe(true);
    expect(buffer.select(6.5)?.b?.tick).toBe(7);
  });

  it('drops the snapshots below A, which the render tick has passed', () => {
    const buffer = createSnapshotBuffer();
    for (const tick of [3, 6, 9, 12]) buffer.add(snapshotAt(tick));
    expect(buffer.size).toBe(4);
    buffer.select(10);
    expect(buffer.size).toBe(2);
  });

  it('drops the oldest when it is full', () => {
    const buffer = createSnapshotBuffer();
    for (let i = 1; i <= BUFFER_CAPACITY + 3; i++) buffer.add(snapshotAt(3 * i));
    expect(buffer.size).toBe(BUFFER_CAPACITY);
    expect(buffer.newestTick).toBe(3 * (BUFFER_CAPACITY + 3));
    const view = buffer.select(0);
    expect(view?.a?.tick).toBe(3 * 4);
  });

  it('holds the newest snapshot when the render tick has passed it, with no extrapolation', () => {
    const buffer = createSnapshotBuffer();
    for (const tick of [3, 6, 9]) buffer.add(snapshotAt(tick));
    for (const render of [9, 9.001, 12, 1000]) {
      const view = buffer.select(render);
      expect(view?.a?.tick).toBe(9);
      expect(view?.b?.tick).toBe(9);
      expect(view?.alpha).toBeGreaterThanOrEqual(0);
      expect(view?.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('holds the oldest snapshot while the render tick is before it', () => {
    const buffer = createSnapshotBuffer();
    for (const tick of [3, 6, 9]) buffer.add(snapshotAt(tick));
    for (const render of [-3, 0, 2.999]) {
      const view = buffer.select(render);
      expect(view?.a?.tick).toBe(3);
      expect(view?.b?.tick).toBe(3);
      expect(view?.alpha).toBe(0);
    }
  });

  it('gives the alpha of an uneven final gap of 2 ticks', () => {
    const buffer = createSnapshotBuffer();
    buffer.add(snapshotAt(57));
    buffer.add(snapshotAt(60));
    buffer.add(snapshotAt(62));
    const quarter = buffer.select(60.5);
    expect(quarter?.a?.tick).toBe(60);
    expect(quarter?.b?.tick).toBe(62);
    expect(quarter?.alpha).toBe(0.25);
    expect(buffer.select(61)?.alpha).toBe(0.5);
    expect(buffer.select(62)?.alpha).toBeLessThanOrEqual(1);
  });

  it('gives the alpha of an uneven gap of 1 tick', () => {
    const buffer = createSnapshotBuffer();
    buffer.add(snapshotAt(60));
    buffer.add(snapshotAt(61));
    expect(buffer.select(60.25)?.alpha).toBe(0.25);
  });
});
