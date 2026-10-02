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

export function createFixedStepClock(): FixedStepClock {
  // A number stored in a closure variable is a new heap number on every store, and
  // one returned from a getter is boxed again, so each frame would leave garbage.
  // Fields of one object are updated in place.
  const clock = {
    started: false,
    last: 0,
    accumulator: 0,
    alpha: 0,
    advance(nowMs: number): number {
      const previous = this.last;
      const started = this.started;
      this.started = true;
      this.last = nowMs;
      if (!started || nowMs < previous) return 0;

      this.accumulator += nowMs - previous;
      let steps = 0;
      while (this.accumulator >= STEP_MS - EPSILON_MS) {
        if (steps === MAX_STEPS_PER_FRAME) {
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
