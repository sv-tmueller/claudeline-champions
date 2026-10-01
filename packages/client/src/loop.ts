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
  let last: number | null = null;
  let accumulator = 0;
  let alpha = 0;

  return {
    advance(nowMs: number): number {
      const previous = last;
      last = nowMs;
      if (previous === null || nowMs < previous) return 0;

      accumulator += nowMs - previous;
      let steps = 0;
      while (accumulator >= STEP_MS - EPSILON_MS) {
        if (steps === MAX_STEPS_PER_FRAME) {
          // A stall (hidden tab, debugger): catching up would freeze the page, so drop the backlog.
          accumulator = 0;
          break;
        }
        accumulator -= STEP_MS;
        steps++;
      }
      alpha = Math.min(Math.max(accumulator / STEP_MS, 0), 1 - Number.EPSILON);
      return steps;
    },
    get alpha(): number {
      return alpha;
    },
  };
}
