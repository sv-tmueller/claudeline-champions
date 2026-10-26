import type { SnapshotMessage } from '@claudeline/protocol';

// The last few snapshots, sorted by tick, and the answer to "which two does the render tick fall
// between" (online design section 9, Buffer). It holds the newest snapshot when the render tick
// has passed it and never extrapolates.

/** How many snapshots it keeps: the render delay is two snapshot gaps, and a burst after a stall adds more. */
export const BUFFER_CAPACITY = 8;

/**
 * The answer of `select`, one record the buffer reuses. It fits `AlphaClock` of interpolate.ts by
 * shape (the net core imports nothing outside net/), so the interpolation reads `alpha` from it.
 */
export interface BufferView {
  /** The snapshot at or before the render tick. */
  a: SnapshotMessage | null;
  /** The next one after it. The same snapshot as `a` when the buffer holds the newest. */
  b: SnapshotMessage | null;
  /** `(render tick - A tick) / (B tick - A tick)`, in [0, 1]. */
  alpha: number;
}

export interface SnapshotBuffer {
  /** How many snapshots it holds. */
  size: number;
  /** The tick of the newest, -1 while empty. */
  newestTick: number;
  /**
   * Stores a snapshot. False for a duplicate tick, for a tick at or below the A of the last
   * `select` (the render tick never goes back, so it could not be drawn), and for one older than
   * everything in a full buffer. It does nothing with the batches of the snapshot: the event
   * release dedupes them on its own.
   */
  add(snapshot: SnapshotMessage): boolean;
  /**
   * Writes A, B and alpha for `renderTick` into the one reused record, and drops the snapshots
   * below A. Null before the first snapshot. Past the newest, A and B are the newest and alpha is
   * 1; before the oldest, A and B are the oldest and alpha is 0.
   */
  select(renderTick: number): BufferView | null;
}

export function createSnapshotBuffer(): SnapshotBuffer {
  const held: SnapshotMessage[] = [];
  const view: BufferView = { a: null, b: null, alpha: 0 };
  // The tick of the A the last select chose. A snapshot at or below it can no longer be drawn.
  let floorTick = -1;

  const buffer: SnapshotBuffer = {
    size: 0,
    newestTick: -1,
    add(snapshot) {
      const tick = snapshot.tick;
      if (tick <= floorTick) return false;
      let at = held.length;
      while (at > 0 && (held[at - 1] as SnapshotMessage).tick > tick) at--;
      if (at > 0 && (held[at - 1] as SnapshotMessage).tick === tick) return false;
      if (at === 0 && held.length >= BUFFER_CAPACITY) return false;
      held.push(snapshot);
      for (let i = held.length - 1; i > at; i--) held[i] = held[i - 1] as SnapshotMessage;
      held[at] = snapshot;
      if (held.length > BUFFER_CAPACITY) held.shift();
      buffer.size = held.length;
      buffer.newestTick = (held[held.length - 1] as SnapshotMessage).tick;
      return true;
    },
    select(renderTick) {
      const count = held.length;
      if (count === 0) return null;
      const oldest = held[0] as SnapshotMessage;
      if (renderTick < oldest.tick) {
        view.a = oldest;
        view.b = oldest;
        view.alpha = 0;
        return view;
      }
      let at = count - 1;
      while (at > 0 && (held[at] as SnapshotMessage).tick > renderTick) at--;
      const a = held[at] as SnapshotMessage;
      floorTick = a.tick;
      for (let i = 0; i < at; i++) held.shift();
      buffer.size = held.length;
      view.a = a;
      if (held.length === 1) {
        view.b = a;
        view.alpha = 1;
        return view;
      }
      const b = held[1] as SnapshotMessage;
      view.b = b;
      view.alpha = (renderTick - a.tick) / (b.tick - a.tick);
      return view;
    },
  };
  return buffer;
}
