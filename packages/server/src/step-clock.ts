import { TICK_RATE } from '@claudeline/sim';

export const STEP_MS = 1000 / TICK_RATE;
export const MAX_STEPS_PER_WAKE = 5;

// Absorbs floating point error in the accumulator, so a clock that moves by 1000 / 60 each time
// does not lose a step to rounding. The client's createFixedStepClock uses the same value.
const EPSILON_MS = 1e-6;

/**
 * The fixed-step accumulator of the room's loop (online design section 4). The same idea as the
 * client's `createFixedStepClock`, written again because the server cannot import the client. It
 * reads no clock: the caller passes the time in milliseconds.
 */
export class StepClock {
  private started = false;
  private last = 0;
  private accumulator = 0;

  /** Steps to run at `nowMs`. The first call after `reset` and a backwards timestamp give 0. */
  advance(nowMs: number): number {
    const previous = this.last;
    const started = this.started;
    this.started = true;
    this.last = nowMs;
    if (!started || nowMs < previous) return 0;

    this.accumulator += nowMs - previous;
    let steps = 0;
    while (this.accumulator >= STEP_MS - EPSILON_MS) {
      if (steps === MAX_STEPS_PER_WAKE) {
        // A stall: catching up would run the match ahead of every client, so drop the backlog.
        this.accumulator = 0;
        break;
      }
      this.accumulator -= STEP_MS;
      steps++;
    }
    return steps;
  }

  /** Forgets the last timestamp and the banked time: the next `advance` returns 0 whatever the gap. */
  reset(): void {
    this.started = false;
    this.accumulator = 0;
  }
}
