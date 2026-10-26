// The render clock (online design section 9, Render tick): the tick to draw, from the arrival
// times of snapshots. Time comes in as a parameter, `nowMs`, in the same unit and origin for
// `onSnapshot` and `update`: the net core never reads a clock.

const TICKS_PER_MS = 60 / 1000;

/**
 * How much of the error of a newer snapshot the estimate takes. The error is the snapshot's tick
 * minus what the estimate read at its arrival. A snapshot ahead of the estimate (the estimate
 * runs late: the network got faster, or the first estimate was late) pulls it up by this share.
 */
export const CORRECTION_UP = 0.1;
/**
 * A snapshot behind the estimate is most often a late one (jitter, a burst after a stall), so it
 * pulls the estimate down by a smaller share. It still bounds a drift: a local clock that runs
 * fast is brought back.
 */
export const CORRECTION_DOWN = 0.02;
/**
 * The render tick advances at most this many times as fast as real time when it catches up with
 * its target (after a stall, or when a correction put the target ahead). A jump of the target
 * is a run of bounded steps, not one.
 */
export const MAX_CATCH_UP_RATE = 2;

export interface RenderClock {
  /** False until the first snapshot: there is no tick to draw yet. */
  started: boolean;
  /** The tick to draw, a double: set by `update`. Meaningless while `started` is false. */
  renderTick: number;
  /** The tick of the newest snapshot, -1 before the first. */
  newestTick: number;
  /** The estimated server tick at the last `update`, before the render delay is taken off. */
  estimateTick: number;
  /**
   * A snapshot of this tick arrived at `nowMs`. Only a tick newer than the newest corrects the
   * estimate: a late, duplicate or out-of-order one does nothing.
   */
  onSnapshot(tick: number, nowMs: number): void;
  /**
   * Sets `renderTick` for the frame at `nowMs`: the estimate minus the render delay, never past
   * the newest snapshot (it holds there, with no extrapolation), never backward, and rising by at
   * most `MAX_CATCH_UP_RATE` times real time after the first frame.
   */
  update(nowMs: number): void;
}

export function createRenderClock(renderDelay: number): RenderClock {
  // The estimate: `anchorTick` at `anchorMs`, running at 60 ticks a second.
  let anchorTick = 0;
  let anchorMs = 0;
  let lastUpdateMs = 0;
  let rendering = false;

  const clock: RenderClock = {
    started: false,
    renderTick: 0,
    newestTick: -1,
    estimateTick: 0,
    onSnapshot(tick, nowMs) {
      if (tick <= clock.newestTick) return;
      if (!clock.started) {
        clock.started = true;
        anchorTick = tick;
      } else {
        const estimate = anchorTick + (nowMs - anchorMs) * TICKS_PER_MS;
        const error = tick - estimate;
        anchorTick = estimate + error * (error > 0 ? CORRECTION_UP : CORRECTION_DOWN);
      }
      anchorMs = nowMs;
      clock.newestTick = tick;
    },
    update(nowMs) {
      if (!clock.started) return;
      const estimate = anchorTick + (nowMs - anchorMs) * TICKS_PER_MS;
      clock.estimateTick = estimate;
      let target = estimate - renderDelay;
      if (target > clock.newestTick) target = clock.newestTick;
      if (!rendering) {
        rendering = true;
        clock.renderTick = target;
      } else if (target > clock.renderTick) {
        const elapsed = nowMs - lastUpdateMs;
        const most = clock.renderTick + (elapsed > 0 ? elapsed : 0) * TICKS_PER_MS * MAX_CATCH_UP_RATE;
        clock.renderTick = target < most ? target : most;
      }
      lastUpdateMs = nowMs;
    },
  };
  return clock;
}
