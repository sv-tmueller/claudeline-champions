import type { EventBatch } from '@claudeline/protocol';

// The events of a snapshot travel in per-tick batches. A batch is released when the render tick
// reaches its tick (online design section 9, Events), so a hit lines up with the projectile drawn.
// P4b writes each released batch into the state that `routeEvents` and `routeSounds` read.

export interface EventRelease {
  /**
   * Takes the batches of one snapshot. A batch already pending, or at or below the last released
   * tick, is dropped: over an ordered transport that can only be a duplicate. One that arrives out
   * of order and is still above the last released tick is kept, and is released in tick order.
   */
  add(batches: readonly EventBatch[]): void;
  /**
   * The batches whose tick the render tick has reached, in tick order, each handed out once. The
   * returned array is the same one every call, emptied first: read it before the next call.
   */
  release(renderTick: number): readonly EventBatch[];
}

export function createEventRelease(): EventRelease {
  // Sorted by tick, none twice.
  const pending: EventBatch[] = [];
  const released: EventBatch[] = [];
  // The last tick released: nothing at or below it is taken again.
  let lastReleased = -1;

  return {
    add(batches) {
      for (let i = 0; i < batches.length; i++) {
        const incoming = batches[i] as EventBatch;
        const tick = incoming.tick;
        if (tick <= lastReleased) continue;
        let at = pending.length;
        while (at > 0 && (pending[at - 1] as EventBatch).tick > tick) at--;
        if (at > 0 && (pending[at - 1] as EventBatch).tick === tick) continue;
        pending.push(incoming);
        for (let j = pending.length - 1; j > at; j--) pending[j] = pending[j - 1] as EventBatch;
        pending[at] = incoming;
      }
    },
    release(renderTick) {
      released.length = 0;
      let count = 0;
      while (count < pending.length && (pending[count] as EventBatch).tick <= renderTick) {
        const batch = pending[count] as EventBatch;
        released.push(batch);
        lastReleased = batch.tick;
        count++;
      }
      for (let i = 0; i < count; i++) pending.shift();
      return released;
    },
  };
}
