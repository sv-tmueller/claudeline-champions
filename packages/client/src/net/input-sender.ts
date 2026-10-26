import { MAX_AIM_CM, encodeClientMessage, type InputMessage } from '@claudeline/protocol';
import type { PlayerInput } from '@claudeline/sim';
import type { Transport } from './transport';

// The input sender (online design section 7): one `input` message per sampled tick, with the
// client's own counter, 0 at the first. One sender per `matchStart`: a reconnect's match start
// (P5) makes a new one, which counts from 0 again.

export interface InputSender {
  /** The counter the next `send` uses. */
  nextTick: number;
  /**
   * Sends one input. The aim is clamped to the protocol's range on a copy, so the record the
   * input core shares is not changed.
   */
  send(input: PlayerInput): void;
}

export function createInputSender(transport: Transport): InputSender {
  // The sender's own scratch: the message and the input it carries are reused every tick.
  const scratch: PlayerInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };
  const message: InputMessage = { t: 'input', tick: 0, input: scratch };

  const sender: InputSender = {
    nextTick: 0,
    send(input) {
      scratch.moveX = input.moveX;
      scratch.moveY = input.moveY;
      scratch.aimX = clampAim(input.aimX);
      scratch.aimY = clampAim(input.aimY);
      scratch.buttons = input.buttons;
      message.tick = sender.nextTick;
      sender.nextTick += 1;
      transport.send(encodeClientMessage(message));
    },
  };
  return sender;
}

function clampAim(value: number): number {
  if (value > MAX_AIM_CM) return MAX_AIM_CM;
  if (value < -MAX_AIM_CM) return -MAX_AIM_CM;
  return value;
}
