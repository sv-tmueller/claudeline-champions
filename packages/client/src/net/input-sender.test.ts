import { MAX_AIM_CM, decodeClientMessage, encodeClientMessage } from '@claudeline/protocol';
import type { PlayerInput } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import { createFakeTransport } from './fake-transport';
import { createInputSender } from './input-sender';

// One `input` message per sampled tick, counted from 0 (online design section 7), with the aim
// held inside the range the server's decoder accepts.

function input(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { moveX: 1, moveY: -1, aimX: 250, aimY: -40, buttons: 3, ...overrides };
}

function decodedInput(text: string | undefined): { tick: number; input: PlayerInput } {
  const result = decodeClientMessage(text as string);
  if (!result.ok || result.message.t !== 'input') throw new Error('not an input message');
  return result.message;
}

describe('the input sender', () => {
  it('sends one message per sampled tick, with the text the protocol writes', () => {
    const transport = createFakeTransport();
    const sender = createInputSender(transport);
    sender.send(input());
    expect(transport.sent).toEqual([encodeClientMessage({ t: 'input', tick: 0, input: input() })]);
  });

  it('counts the ticks 0, 1, 2, ... one a send', () => {
    const transport = createFakeTransport();
    const sender = createInputSender(transport);
    for (let i = 0; i < 5; i++) sender.send(input({ aimX: i }));
    expect(transport.sent.map((text) => decodedInput(text).tick)).toEqual([0, 1, 2, 3, 4]);
    expect(sender.nextTick).toBe(5);
  });

  it('starts every instance at 0: a new match gets a new sender', () => {
    const transport = createFakeTransport();
    createInputSender(transport).send(input());
    createInputSender(transport).send(input());
    expect(transport.sent.map((text) => decodedInput(text).tick)).toEqual([0, 0]);
  });

  it('sends an in-range aim unchanged, and the bounds themselves', () => {
    const transport = createFakeTransport();
    const sender = createInputSender(transport);
    sender.send(input({ aimX: 250, aimY: -40 }));
    sender.send(input({ aimX: MAX_AIM_CM, aimY: -MAX_AIM_CM }));
    const [middle, bounds] = transport.sent.map((text) => decodedInput(text).input);
    expect(middle).toMatchObject({ aimX: 250, aimY: -40 });
    expect(bounds).toMatchObject({ aimX: 100000, aimY: -100000 });
  });

  it('clamps an aim past the bound into one the decoder accepts', () => {
    const transport = createFakeTransport();
    const sender = createInputSender(transport);
    sender.send(input({ aimX: 100001, aimY: -100001 }));
    sender.send(input({ aimX: 1e9, aimY: -1e9 }));
    sender.send(input({ aimX: -1e9, aimY: 1e9 }));
    const sent = transport.sent.map((text) => decodedInput(text).input);
    expect(sent[0]).toMatchObject({ aimX: MAX_AIM_CM, aimY: -MAX_AIM_CM });
    expect(sent[1]).toMatchObject({ aimX: MAX_AIM_CM, aimY: -MAX_AIM_CM });
    expect(sent[2]).toMatchObject({ aimX: -MAX_AIM_CM, aimY: MAX_AIM_CM });
  });

  it('does not change the record it is given: the input core shares one', () => {
    const transport = createFakeTransport();
    const sender = createInputSender(transport);
    const shared = input({ aimX: 1e9, aimY: -1e9 });
    sender.send(shared);
    expect(shared).toEqual(input({ aimX: 1e9, aimY: -1e9 }));
    // A second send after the caller changed the record sends the new values.
    shared.aimX = 7;
    shared.moveX = -1;
    sender.send(shared);
    expect(decodedInput(transport.sent[1]).input).toMatchObject({ moveX: -1, aimX: 7, aimY: -MAX_AIM_CM });
  });

  it('carries the move and the buttons through as they are', () => {
    const transport = createFakeTransport();
    createInputSender(transport).send(input({ moveX: -1, moveY: 0, buttons: 255 }));
    expect(decodedInput(transport.sent[0]).input).toMatchObject({ moveX: -1, moveY: 0, buttons: 255 });
  });
});
