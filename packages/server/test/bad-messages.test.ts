import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@claudeline/protocol';
import type { ErrorMessage } from '@claudeline/protocol';
import { Harness, ROOM_CODE, roomData } from './loopback';
import type { TestClient } from './loopback';

// Online design sections 6 and 11: an invalid message is answered with `error` and never thrown on,
// and the twentieth in a row closes the connection. The counter rules are the package's (online.md).

function errors(client: TestClient): ErrorMessage[] {
  return client.of('error');
}

function host(harness: Harness): TestClient {
  const client = harness.client();
  client.create('Ada');
  harness.flush();
  return client;
}

function joiner(harness: Harness, name = 'Bo'): TestClient {
  const client = harness.client();
  client.join(name);
  harness.flush();
  return client;
}

function sendBad(harness: Harness, client: TestClient, times: number): void {
  for (let i = 0; i < times; i++) client.sendText('not json');
  harness.flush();
}

describe('a first message that is not acceptable', () => {
  it('answers garbage with a fatal badMessage and closes', () => {
    const harness = new Harness();
    const client = harness.client();
    client.sendText('{"t":');
    harness.flush();
    expect(errors(client)).toEqual([{ t: 'error', code: 'badMessage', fatal: true }]);
    expect(client.closed).toBe(true);
  });

  it('answers a message that is not a first message with a fatal badMessage', () => {
    const harness = new Harness();
    const client = harness.client();
    client.send({ t: 'ping', id: 1 });
    harness.flush();
    expect(errors(client)).toEqual([{ t: 'error', code: 'badMessage', fatal: true }]);
    expect(client.closed).toBe(true);
  });

  it('answers another protocol version with a fatal version error', () => {
    const harness = new Harness();
    const client = harness.client();
    client.sendText(JSON.stringify({ t: 'createRoom', v: PROTOCOL_VERSION + 1, name: 'Ada' }));
    harness.flush();
    expect(errors(client)).toEqual([{ t: 'error', code: 'version', fatal: true }]);
    expect(client.closed).toBe(true);
  });

  it('answers a reconnect with a fatal badToken (P5 replaces this)', () => {
    const harness = new Harness();
    const client = harness.client();
    client.sendText(JSON.stringify({ t: 'reconnect', v: PROTOCOL_VERSION, token: `${ROOM_CODE}.AAAAAAAAAAAAAAAAAAAAAA` }));
    harness.flush();
    expect(errors(client)).toEqual([{ t: 'error', code: 'badToken', fatal: true }]);
    expect(client.closed).toBe(true);
  });

  it('answers a second createRoom with a fatal badMessage and leaves the room alone', () => {
    const harness = new Harness();
    const first = host(harness);
    const second = harness.client();
    second.create('Bo');
    harness.flush();
    expect(errors(second)).toEqual([{ t: 'error', code: 'badMessage', fatal: true }]);
    expect(second.closed).toBe(true);
    expect(first.room().seats.filter((s) => s.kind === 'human')).toHaveLength(1);
    expect(first.closed).toBe(false);
  });

  it('answers a joinRoom for another code, or for a room nobody created, with a fatal roomNotFound', () => {
    const harness = new Harness();
    const early = harness.client();
    early.join('Bo');
    harness.flush();
    expect(errors(early)).toEqual([{ t: 'error', code: 'roomNotFound', fatal: true }]);
    host(harness);
    const wrong = harness.client();
    wrong.join('Cy', 'ABCDE');
    harness.flush();
    expect(errors(wrong)).toEqual([{ t: 'error', code: 'roomNotFound', fatal: true }]);
    expect(wrong.closed).toBe(true);
  });

  it('ignores a message from a connection it never saw open, and from one it closed', () => {
    const harness = new Harness();
    const client = harness.client();
    client.sendText('nope');
    harness.flush();
    const again = errors(client).length;
    client.sendText('nope');
    harness.flush();
    expect(errors(client)).toHaveLength(again);
    expect(() => harness.room.message(999, 'x')).not.toThrow();
    expect(() => harness.room.closed(999)).not.toThrow();
  });
});

describe('the counter of bad messages after welcome', () => {
  it('answers the first nineteen with a non-fatal badMessage and keeps the seat', () => {
    const harness = new Harness();
    const client = host(harness);
    sendBad(harness, client, 19);
    const list = errors(client);
    expect(list).toHaveLength(19);
    expect(list.every((e) => e.code === 'badMessage' && !e.fatal)).toBe(true);
    expect(client.closed).toBe(false);
  });

  it('answers the twentieth with a fatal badMessage, closes, and frees the seat', () => {
    const harness = new Harness();
    const first = host(harness);
    const second = joiner(harness);
    sendBad(harness, second, 20);
    const list = errors(second);
    expect(list).toHaveLength(20);
    expect(list.slice(0, 19).every((e) => !e.fatal)).toBe(true);
    expect(list[19]).toEqual({ t: 'error', code: 'badMessage', fatal: true });
    expect(second.closed).toBe(true);
    // The lobby sends `room` with the seat open again.
    expect(first.room().seats.filter((s) => s.kind === 'human')).toHaveLength(1);
    expect(first.room().seats[1]?.kind).toBe('open');
  });

  it('moves the host when the host is the one closed, and closes the lobby when none is left', () => {
    const harness = new Harness();
    const first = host(harness);
    const second = joiner(harness);
    sendBad(harness, first, 20);
    expect(first.closed).toBe(true);
    expect(second.room().hostSeat).toBe(1);
    expect(harness.emptied).toBe(0);
    sendBad(harness, second, 20);
    expect(harness.emptied).toBe(1);
  });

  it('resets on any message that is not bad, ping included', () => {
    const harness = new Harness();
    const client = host(harness);
    sendBad(harness, client, 19);
    client.send({ t: 'ping', id: 1 });
    sendBad(harness, client, 19);
    expect(client.closed).toBe(false);
    expect(client.of('pong')).toHaveLength(1);
  });

  it('resets on a message refused with notHost, notInLobby or teamFull', () => {
    const harness = new Harness();
    host(harness);
    const guest = joiner(harness);
    sendBad(harness, guest, 19);
    guest.send({ t: 'settings', settings: { teamSize: 2, arenaId: roomData().listings[0]?.id ?? '', difficulty: 'easy' } });
    harness.flush();
    expect(errors(guest).at(-1)).toEqual({ t: 'error', code: 'notHost', fatal: false });
    sendBad(harness, guest, 19);
    expect(guest.closed).toBe(false);

    // teamFull: a third human on team A of a team of two.
    const third = joiner(harness, 'Cy');
    const fourth = joiner(harness, 'Di');
    expect(third.room().seats.map((s) => s.team)).toEqual(['A', 'B', 'A', 'B']);
    sendBad(harness, fourth, 19);
    fourth.send({ t: 'select', team: 'A', championId: roomData().roster[0] ?? '' });
    harness.flush();
    expect(errors(fourth).at(-1)).toEqual({ t: 'error', code: 'teamFull', fatal: false });
    sendBad(harness, fourth, 19);
    expect(fourth.closed).toBe(false);
  });

  it('resets on an input outside a match, which is dropped without an answer', () => {
    const harness = new Harness();
    const client = host(harness);
    sendBad(harness, client, 19);
    const before = client.inbox.length;
    client.send({ t: 'input', tick: 0, input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 } });
    harness.flush();
    expect(client.inbox).toHaveLength(before);
    sendBad(harness, client, 19);
    expect(client.closed).toBe(false);
  });

  it('does not reset on a refusal that is a badMessage: a championId outside the roster counts', () => {
    const harness = new Harness();
    const client = host(harness);
    for (let i = 0; i < 20; i++) client.send({ t: 'select', team: 'A', championId: 'nobody' });
    harness.flush();
    expect(client.closed).toBe(true);
    expect(errors(client)).toHaveLength(20);
  });

  it('counts an arena outside the list and one with too few spawns for the team size', () => {
    // The shipped arenas all have three spawns a team, so this room gets one more with two.
    const base = roomData();
    const arena = structuredClone(base.arenas[0]);
    if (arena === undefined) throw new Error('no arena');
    arena.id = 'duel';
    arena.spawns.teamA = arena.spawns.teamA.slice(0, 2);
    arena.spawns.teamB = arena.spawns.teamB.slice(0, 2);
    const data = {
      ...base,
      arenas: [...base.arenas, arena],
      listings: [...base.listings, { id: 'duel', name: 'Duel', maxTeamSize: 2 as const }],
    };
    const harness = new Harness({ data });
    const client = host(harness);
    client.send({ t: 'settings', settings: { teamSize: 2, arenaId: 'nowhere', difficulty: 'easy' } });
    client.send({ t: 'settings', settings: { teamSize: 3, arenaId: 'duel', difficulty: 'easy' } });
    harness.flush();
    expect(errors(client)).toEqual([
      { t: 'error', code: 'badMessage', fatal: false },
      { t: 'error', code: 'badMessage', fatal: false },
    ]);
    // The count carries across the two kinds: eighteen more make the twentieth.
    sendBad(harness, client, 18);
    expect(client.closed).toBe(true);
  });

  it('answers a first message after welcome with a badMessage, counted', () => {
    const harness = new Harness();
    const client = host(harness);
    client.create('Again');
    harness.flush();
    expect(errors(client)).toEqual([{ t: 'error', code: 'badMessage', fatal: false }]);
  });

  it('never throws on any text', () => {
    const harness = new Harness();
    const client = host(harness);
    const texts = [
      '',
      'null',
      '[]',
      '"x"',
      '{}',
      '{"t":"toString"}',
      '{"t":"input","tick":-1}',
      '{"__proto__":{"t":"leave"}}',
      '{"t":"select","team":"C","championId":1}',
      '\u0000',
      '{"t":"settings","settings":null}',
      'x'.repeat(5000),
    ];
    for (const text of texts) {
      expect(() => harness.room.message(client.conn, text)).not.toThrow();
      if (client.closed) break;
    }
  });
});
