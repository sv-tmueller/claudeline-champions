import { Button } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import {
  BUTTONS_MAX,
  DIFFICULTIES,
  ERROR_CODES,
  MAX_AIM_CM,
  MAX_CLIENT_MESSAGE_BYTES,
  NAME_MAX,
  PROTOCOL_VERSION,
  RENDER_DELAY_TICKS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SNAPSHOT_EVERY,
} from '../src/constants';
import * as api from '../src/index';

describe('the constants', () => {
  it('has the protocol version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('has the numbers of online design sections 4 and 6', () => {
    expect(MAX_CLIENT_MESSAGE_BYTES).toBe(1024);
    expect(MAX_AIM_CM).toBe(100000);
    expect(NAME_MAX).toBe(16);
    expect(SNAPSHOT_EVERY).toBe(3);
    expect(RENDER_DELAY_TICKS).toBe(6);
    expect(ROOM_CODE_LENGTH).toBe(5);
  });

  it('keeps BUTTONS_MAX equal to the OR of the sim Button bits', () => {
    // A new button bit must become a deliberate protocol version decision.
    const all = Object.values(Button).reduce((mask, bit) => mask | bit, 0);
    expect(BUTTONS_MAX).toBe(all);
    expect(BUTTONS_MAX).toBe(255);
  });

  it('lists the nine error codes of the spec table, in its order', () => {
    expect([...ERROR_CODES]).toEqual([
      'version',
      'badMessage',
      'roomNotFound',
      'roomFull',
      'matchRunning',
      'badToken',
      'notHost',
      'notInLobby',
      'teamFull',
    ]);
  });

  it('lists the three difficulties', () => {
    expect([...DIFFICULTIES]).toEqual(['easy', 'normal', 'hard']);
  });

  it('has the 31 characters of the room code alphabet, without 0, O, 1, I and L', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(31);
    for (const ch of '0O1IL') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    expect(ROOM_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  });

  it('exports the codec and the constants from the index', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'BUTTONS_MAX',
        'DIFFICULTIES',
        'ERROR_CODES',
        'MAX_AIM_CM',
        'MAX_CLIENT_MESSAGE_BYTES',
        'NAME_MAX',
        'PROTOCOL_VERSION',
        'RENDER_DELAY_TICKS',
        'ROOM_CODE_ALPHABET',
        'ROOM_CODE_LENGTH',
        'SNAPSHOT_EVERY',
        'decodeClientMessage',
        'decodeFirstMessage',
        'decodeServerMessage',
        'encodeClientMessage',
        'encodeServerMessage',
        'encodeSnapshot',
        'snapshotStateJson',
      ].sort(),
    );
  });
});
