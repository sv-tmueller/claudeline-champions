import { describe, expect, it } from 'vitest';
import { decodeClientMessage, decodeFirstMessage, decodeServerMessage } from '../src/codec';
import { byType, edit } from './edit';
import { firstMessages, serverMessages, sessionMessages } from './samples';

const createRoom = byType(firstMessages, 'createRoom');
const joinRoom = byType(firstMessages, 'joinRoom');
const reconnect = byType(firstMessages, 'reconnect');
const ready = byType(sessionMessages, 'ready');
const input = byType(sessionMessages, 'input');
const ping = byType(sessionMessages, 'ping');
const room = byType(serverMessages, 'room');
const matchStart = byType(serverMessages, 'matchStart');
const snapshot = byType(serverMessages, 'snapshot');

type Row = [label: string, text: string, expected: unknown];

describe('the first-message decoder accepts the edge of each bound', () => {
  const rows: Row[] = [
    ['name of 1 character', edit(createRoom, ['name', 'A']), { ...createRoom, name: 'A' }],
    ['name of 16 characters', edit(createRoom, ['name', 'x'.repeat(16)]), { ...createRoom, name: 'x'.repeat(16) }],
    [
      'name of 16 astral code points (32 UTF-16 units)',
      edit(createRoom, ['name', '😀'.repeat(16)]),
      { ...createRoom, name: '😀'.repeat(16) },
    ],
    ['name with spaces around it, which are trimmed', edit(createRoom, ['name', '  Ada \t']), createRoom],
    [
      'name of 16 characters and spaces around it',
      edit(createRoom, ['name', ` ${'x'.repeat(16)} `]),
      { ...createRoom, name: 'x'.repeat(16) },
    ],
    ['name with a non-breaking space around it', edit(createRoom, ['name', ' Ada ']), createRoom],
    ['name with an inner space', edit(joinRoom, ['name', 'Bo Li']), joinRoom],
    ['name with accents and CJK', edit(createRoom, ['name', 'Zoë 李']), { ...createRoom, name: 'Zoë 李' }],
    ['name with U+00A0 inside', edit(createRoom, ['name', 'a b']), { ...createRoom, name: 'a b' }],
    ['roomCode of the first and last alphabet characters', edit(joinRoom, ['roomCode', 'A9ZZ2']), { ...joinRoom, roomCode: 'A9ZZ2' }],
    ['roomCode of digits', edit(joinRoom, ['roomCode', '23456']), { ...joinRoom, roomCode: '23456' }],
    ['token with - and _', edit(reconnect, ['token', 'AAAAA.-_-_-_-_-_-_-_-_-_-_-_']), { ...reconnect, token: 'AAAAA.-_-_-_-_-_-_-_-_-_-_-_' }],
    ['a message of exactly 1024 bytes', padFirst(1024), createRoom],
    ['an extra field, which is dropped', edit(createRoom, ['extra', 1]), createRoom],
  ];

  it.each(rows)('%s', (_label, text, expected) => {
    expect(decodeFirstMessage(text)).toEqual({ ok: true, message: expected });
  });
});

function padFirst(bytes: number): string {
  const head = '{"t":"createRoom","v":1,"name":"Ada","x":"';
  return `${head}${'a'.repeat(bytes - head.length - 2)}"}`;
}

describe('the client decoder accepts the edge of each bound', () => {
  const withInput = (field: string, value: unknown): [string, string, unknown] => [
    `${field} ${JSON.stringify(value)}`,
    edit(input, [`input.${field}`, value]),
    { ...input, input: { ...input.input, [field]: value } },
  ];
  const rows: Row[] = [
    withInput('aimX', 100000),
    withInput('aimX', -100000),
    withInput('aimY', 100000),
    withInput('aimY', -100000),
    withInput('aimX', 0),
    withInput('moveX', 0),
    withInput('moveY', -1),
    withInput('buttons', 0),
    withInput('buttons', 255),
    withInput('buttons', 1),
    ['tick 0', edit(input, ['tick', 0]), { ...input, tick: 0 }],
    ['tick 2^53 - 1', edit(input, ['tick', Number.MAX_SAFE_INTEGER]), { ...input, tick: Number.MAX_SAFE_INTEGER }],
    ['ping id 0', edit(ping, ['id', 0]), { ...ping, id: 0 }],
    ['leave', '{"t":"leave"}', { t: 'leave' }],
    ['a leave with fields, which are dropped', '{"t":"leave","x":1,"v":1}', { t: 'leave' }],
    ['ready false', edit(ready, ['ready', false]), { ...ready, ready: false }],
    ['teamSize 2', edit(byType(sessionMessages, 'settings'), ['settings.teamSize', 2]), { t: 'settings', settings: { teamSize: 2, arenaId: 'arena02', difficulty: 'hard' } }],
    ['a message of exactly 1024 bytes', padClient(1024), ping],
    ['a message of 1024 bytes of two-byte characters', padClient(1024, 'é'), ping],
    ['a message of 1024 bytes with four-byte characters', padClient(1024, '😀'), ping],
    ['a message of 1024 bytes with a lone surrogate', padClient(1024, '\ud800'), ping],
    ['a trailing newline and spaces around the JSON', ` ${edit(ping)}\n `, ping],
  ];

  function frame(pad: string): string {
    return `{"t":"ping","id":9,"x":"${pad}"}`;
  }
  function padClient(bytes: number, unit = 'a'): string {
    const room = bytes - frame('').length;
    const size = new Map([['a', 1], ['é', 2], ['\ud800', 3], ['😀', 4]]).get(unit) ?? 1;
    return frame(unit.repeat(Math.floor(room / size)) + 'a'.repeat(room % size));
  }

  it.each(rows)('%s', (_label, text, expected) => {
    expect(decodeClientMessage(text)).toEqual({ ok: true, message: expected });
  });
});

describe('the decoders build a fresh object of the known fields', () => {
  it('drops extra fields at every level of a client message', () => {
    const text =
      '{"t":"input","extra":1,"tick":5,"input":{"moveX":1,"moveY":0,"aimX":2,"aimY":3,"buttons":4,"z":1},"v":1}';
    const result = decodeClientMessage(text);
    expect(result).toEqual({
      ok: true,
      message: { t: 'input', tick: 5, input: { moveX: 1, moveY: 0, aimX: 2, aimY: 3, buttons: 4 } },
    });
    if (result.ok && result.message.t === 'input') {
      expect(Object.keys(result.message)).toEqual(['t', 'tick', 'input']);
      expect(Object.keys(result.message.input)).toEqual(['moveX', 'moveY', 'aimX', 'aimY', 'buttons']);
    }
  });

  it('drops an own __proto__ key and reaches nothing', () => {
    const text = '{"t":"ready","ready":true,"__proto__":{"polluted":1,"ready":false}}';
    const result = decodeClientMessage(text);
    expect(result).toEqual({ ok: true, message: { t: 'ready', ready: true } });
    if (result.ok) {
      expect(Object.getPrototypeOf(result.message)).toBe(Object.prototype);
      expect(Object.hasOwn(result.message, '__proto__')).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops an own __proto__ key inside a nested record', () => {
    const text = '{"t":"settings","settings":{"teamSize":2,"arenaId":"a","difficulty":"easy","__proto__":{"x":1}}}';
    const result = decodeClientMessage(text);
    expect(result.ok).toBe(true);
    if (result.ok && result.message.t === 'settings') {
      expect(Object.keys(result.message.settings)).toEqual(['teamSize', 'arenaId', 'difficulty']);
    }
  });

  it('drops the extra fields of a server message, and keeps arena, kits and state as they are', () => {
    const text = edit(snapshot, ['extra', 1], ['state.extra', 2], ['events.0.extra', 3]);
    const result = decodeServerMessage(text);
    expect(result.ok).toBe(true);
    if (result.ok && result.message.t === 'snapshot') {
      expect(Object.keys(result.message)).toEqual(['t', 'tick', 'ack', 'state', 'events']);
      expect(Object.keys(result.message.events[0] ?? {})).toEqual(['tick', 'events']);
      expect((result.message.state as unknown as Record<string, unknown>).extra).toBe(2);
    }
    const start = decodeServerMessage(edit(matchStart, ['arena.extra', 1], ['config.extra', 2]));
    expect(start.ok).toBe(true);
    if (start.ok && start.message.t === 'matchStart') {
      expect((start.message.arena as unknown as Record<string, unknown>).extra).toBe(1);
      expect(Object.keys(start.message.config)).toEqual(['teamSize', 'players', 'roundsToWin']);
    }
  });

  it('reads own properties only', () => {
    Object.defineProperty(Object.prototype, 'id', { value: 5, configurable: true });
    try {
      expect(decodeClientMessage('{"t":"ping"}').ok).toBe(false);
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).id;
    }
    expect(decodeClientMessage('{"t":"ping"}').ok).toBe(false);
  });
});

describe('the decoders normalise -0', () => {
  it('turns -0 into +0 in every number of an input', () => {
    const text = '{"t":"input","tick":-0,"input":{"moveX":-0,"moveY":-0,"aimX":-0,"aimY":-0,"buttons":-0}}';
    const result = decodeClientMessage(text);
    expect(result.ok).toBe(true);
    if (result.ok && result.message.t === 'input') {
      const m = result.message;
      for (const n of [m.tick, m.input.moveX, m.input.moveY, m.input.aimX, m.input.aimY, m.input.buttons]) {
        expect(Object.is(n, 0)).toBe(true);
      }
    }
  });

  it('turns -0 into +0 in a ping id and a pong tick', () => {
    const p = decodeClientMessage('{"t":"ping","id":-0}');
    expect(p.ok && Object.is(p.message.t === 'ping' ? p.message.id : 1, 0)).toBe(true);
    const q = decodeServerMessage('{"t":"pong","id":-0,"tick":-0}');
    expect(q).toEqual({ ok: true, message: { t: 'pong', id: 0, tick: 0 } });
  });

  it('turns -0 into +0 in a seat number', () => {
    const result = decodeServerMessage(edit(room).replace('"hostSeat":1', '"hostSeat":-0'));
    expect(result.ok && result.message.t === 'room' && Object.is(result.message.hostSeat, 0)).toBe(true);
  });
});

describe('the server decoder', () => {
  it('has no size limit', () => {
    const big = decodeServerMessage(edit(snapshot, ['state.blob', 'x'.repeat(100000)]));
    expect(big.ok).toBe(true);
  });

  it('accepts the edge of each scalar range', () => {
    const rows: [string, string][] = [
      ['seats: six', edit(room, ['seats', [0, 1, 2, 3, 4, 5].map((seat) => ({ ...room.seats[2], seat }))])],
      ['seats: none', edit(room, ['seats', []])],
      ['seat 5', edit(room, ['seats.0.seat', 5])],
      ['hostSeat 5', edit(room, ['hostSeat', 5])],
      ['seat name of 16 astral code points', edit(room, ['seats.1.name', '😀'.repeat(16)])],
      ['seat name empty', edit(room, ['seats.1.name', ''])],
      ['team null', edit(room, ['seats.0.team', null])],
      ['phase match', edit(room, ['phase', 'match'])],
      ['ack -1', edit(snapshot, ['ack', -1])],
      ['ack 0', edit(snapshot, ['ack', 0])],
      ['tick 0', edit(snapshot, ['tick', 0])],
      ['no batches', edit(snapshot, ['events', []])],
      ['no roundsToWin', edit(matchStart, ['config.roundsToWin', undefined])],
      ['roundsToWin 1', edit(matchStart, ['config.roundsToWin', 1])],
      ['you 5', edit(matchStart, ['you', 5])],
      ['no kits', edit(matchStart, ['kits', []])],
    ];
    for (const [label, text] of rows) {
      const result = decodeServerMessage(text);
      expect(result.ok, label).toBe(true);
    }
  });
});

describe('a stray v on a session message', () => {
  it('is dropped', () => {
    expect(decodeClientMessage('{"t":"ping","id":1,"v":2}')).toEqual({ ok: true, message: { t: 'ping', id: 1 } });
  });
});
