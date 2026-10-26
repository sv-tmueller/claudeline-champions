import type { PlayerInput } from '@claudeline/sim';

/** 6 ticks is 100 ms of input: more adds latency, fewer drops inputs on jitter (design section 4). */
export const INPUT_QUEUE_CAP = 6;

interface Queued {
  tick: number;
  input: PlayerInput;
}

function copyOf(input: PlayerInput, buttons: number): PlayerInput {
  return { moveX: input.moveX, moveY: input.moveY, aimX: input.aimX, aimY: input.aimY, buttons };
}

/**
 * The input FIFO of one human seat (online design section 7). `push` takes the client's input
 * counter, not the server's tick, and drops a message at or below the last one received, so a
 * duplicate or a reordered message does nothing. `take` is called once per server tick.
 */
export class InputQueue {
  /** The last input tick applied by `take`, -1 before the first. It goes out as `ack`. */
  ack = -1;
  private readonly cap: number;
  private queue: Queued[] = [];
  private received = -1;
  private last: PlayerInput | undefined;

  constructor(cap: number = INPUT_QUEUE_CAP) {
    this.cap = cap;
  }

  push(tick: number, input: PlayerInput): void {
    if (tick <= this.received) return;
    this.received = tick;
    this.queue.push({ tick, input: copyOf(input, input.buttons) });
    if (this.queue.length > this.cap) this.queue.shift();
  }

  /**
   * The next input, oldest first. With the queue empty it repeats the last move and aim with the
   * buttons cleared, so a late packet does not stop a running champion and does not fire again;
   * a seat that never sent an input gets undefined, the sim's missing input. The record is fresh.
   */
  take(): PlayerInput | undefined {
    const next = this.queue.shift();
    if (next !== undefined) {
      this.ack = next.tick;
      this.last = next.input;
      return copyOf(next.input, next.input.buttons);
    }
    return this.last === undefined ? undefined : copyOf(this.last, 0);
  }

  /** Forgets the queue, the mark, the repeat and the ack: the returning client counts from 0 again. */
  reset(): void {
    this.queue = [];
    this.received = -1;
    this.ack = -1;
    this.last = undefined;
  }
}
