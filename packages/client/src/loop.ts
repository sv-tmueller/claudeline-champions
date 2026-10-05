import { TICK_RATE } from '@claudeline/sim';

export const STEP_MS = 1000 / TICK_RATE;
export const MAX_STEPS_PER_FRAME = 5;

// Absorbs floating point error in the accumulator, so 60 fps frames at
// i * 1000 / 60 do not lose a step to rounding.
const EPSILON_MS = 1e-6;

export interface FixedStepClock {
  /** Steps to run for a frame at `nowMs`. The first call and a backwards timestamp give 0. */
  advance(nowMs: number): number;
  /** Fraction of a step left over after the last `advance`, in [0, 1). */
  readonly alpha: number;
}

/**
 * `scale` multiplies the elapsed time, so scale 100 runs a hundred ticks for each
 * tick's worth of wall time, and the step cap grows with it. It is an integer,
 * held in a field of the clock. Only the dev-only launch reads it from the
 * address (`?timescale`, see dev-launch.ts); scale 1, the default, is the plain
 * clock.
 */
export function createFixedStepClock(scale = 1): FixedStepClock {
  // A number stored in a closure variable is a new heap number on every store, and
  // one returned from a getter is boxed again, so each frame would leave garbage.
  // Fields of one object are updated in place.
  const clock = {
    started: false,
    scale,
    maxSteps: MAX_STEPS_PER_FRAME * scale,
    last: 0,
    accumulator: 0,
    alpha: 0,
    advance(nowMs: number): number {
      const previous = this.last;
      const started = this.started;
      this.started = true;
      this.last = nowMs;
      if (!started || nowMs < previous) return 0;

      this.accumulator += (nowMs - previous) * this.scale;
      let steps = 0;
      while (this.accumulator >= STEP_MS - EPSILON_MS) {
        if (steps === this.maxSteps) {
          // A stall (hidden tab, debugger): catching up would freeze the page, so drop the backlog.
          this.accumulator = 0;
          break;
        }
        this.accumulator -= STEP_MS;
        steps++;
      }
      this.alpha = Math.min(Math.max(this.accumulator / STEP_MS, 0), 1 - Number.EPSILON);
      return steps;
    },
  };
  return clock;
}
