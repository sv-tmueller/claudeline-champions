import type { PlayerInput } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import { INPUT_QUEUE_CAP, InputQueue } from '../src/input-queue';

// Online design section 7: a FIFO per human seat, capped at 6 with the oldest dropped, a mark that
// drops duplicates and reordered messages, one input taken a tick, and an empty queue that repeats
// the last move and aim with the buttons cleared.

function input(n: number, buttons = 0): PlayerInput {
  return { moveX: 1, moveY: -1, aimX: 100 * n, aimY: -100 * n, buttons };
}

describe('InputQueue', () => {
  it('has the cap of the design', () => {
    expect(INPUT_QUEUE_CAP).toBe(6);
  });

  it('gives no input before the seat has sent one, and acks -1', () => {
    const queue = new InputQueue();
    expect(queue.take()).toBeUndefined();
    expect(queue.ack).toBe(-1);
  });

  it('hands the inputs out oldest first, one per take, and acks the tick it applied', () => {
    const queue = new InputQueue();
    queue.push(0, input(0, 1));
    queue.push(1, input(1, 2));
    queue.push(2, input(2, 4));
    expect(queue.take()).toEqual(input(0, 1));
    expect(queue.ack).toBe(0);
    expect(queue.take()).toEqual(input(1, 2));
    expect(queue.take()).toEqual(input(2, 4));
    expect(queue.ack).toBe(2);
  });

  it('drops a message at or below the last tick received', () => {
    const queue = new InputQueue();
    queue.push(5, input(5));
    queue.push(5, input(9));
    queue.push(3, input(3));
    queue.push(4, input(4));
    expect(queue.take()).toEqual(input(5));
    // The queue is empty now, so the next take repeats the last input without its buttons.
    expect(queue.take()).toEqual({ ...input(5), buttons: 0 });
    expect(queue.ack).toBe(5);
  });

  it('keeps the mark of a message that was already taken', () => {
    const queue = new InputQueue();
    queue.push(0, input(0));
    queue.take();
    queue.push(0, input(7));
    expect(queue.take()).toEqual({ ...input(0), buttons: 0 });
    expect(queue.ack).toBe(0);
  });

  it('drops the oldest input beyond six', () => {
    const queue = new InputQueue();
    for (let tick = 0; tick < 8; tick++) queue.push(tick, input(tick));
    expect(queue.take()).toEqual(input(2));
    expect(queue.ack).toBe(2);
    const rest: number[] = [];
    for (let i = 0; i < 5; i++) {
      queue.take();
      rest.push(queue.ack);
    }
    expect(rest).toEqual([3, 4, 5, 6, 7]);
  });

  it('repeats the last move and aim with the buttons cleared when it runs dry', () => {
    const queue = new InputQueue();
    queue.push(0, { moveX: -1, moveY: 1, aimX: 321, aimY: -654, buttons: 255 });
    queue.take();
    expect(queue.take()).toEqual({ moveX: -1, moveY: 1, aimX: 321, aimY: -654, buttons: 0 });
    expect(queue.take()).toEqual({ moveX: -1, moveY: 1, aimX: 321, aimY: -654, buttons: 0 });
    expect(queue.ack).toBe(0);
  });

  it('returns a fresh record each take and keeps a copy of what was pushed', () => {
    const queue = new InputQueue();
    const pushed = input(1, 8);
    queue.push(0, pushed);
    pushed.buttons = 0;
    const first = queue.take();
    expect(first).toEqual(input(1, 8));
    if (first === undefined) throw new Error('no input');
    first.moveX = 0;
    const repeat = queue.take();
    expect(repeat?.moveX).toBe(1);
    expect(repeat).not.toBe(first);
  });

  it('forgets everything on reset, so a counter that starts at 0 again is accepted', () => {
    const queue = new InputQueue();
    queue.push(40, input(1));
    queue.push(41, input(2));
    queue.take();
    queue.reset();
    expect(queue.ack).toBe(-1);
    expect(queue.take()).toBeUndefined();
    queue.push(0, input(3));
    expect(queue.take()).toEqual(input(3));
    expect(queue.ack).toBe(0);
  });
});
