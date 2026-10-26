import { describe, expect, it } from 'vitest';
import { RENDER_DELAY_TICKS, SNAPSHOT_EVERY } from '@claudeline/protocol';
import { Harness, ROOM_CODE, STEP_MS, roomData } from './loopback';
import type { TestClient } from './loopback';

// The Room's lobby and match behaviour beyond the loopback match: the message flow of online
// design section 5, the rules the package picked for P2 (online.md), and the loop of section 4.
// Matches here use roundsToWin 1, which the Room offers for tests only.

const data = roomData();
const roster = data.roster;

function create(harness: Harness, name = 'Ada'): TestClient {
  const client = harness.client();
  client.create(name);
  harness.flush();
  return client;
}

function join(harness: Harness, name: string): TestClient {
  const client = harness.client();
  client.join(name);
  harness.flush();
  return client;
}

function ready(harness: Harness, ...clients: TestClient[]): void {
  for (const c of clients) c.send({ t: 'ready', ready: true });
  harness.flush();
}

describe('the lobby flow', () => {
  it('answers createRoom with welcome and then room, and the host sits in seat 0', () => {
    const harness = new Harness();
    const host = create(harness);
    expect(host.inbox.map((m) => m.t)).toEqual(['welcome', 'room']);
    const welcome = host.welcome;
    expect(welcome?.roomCode).toBe(ROOM_CODE);
    expect(welcome?.seat).toBe(0);
    expect(welcome?.token).toMatch(new RegExp(`^${ROOM_CODE}\\.[A-Za-z0-9_-]{22}$`));
    expect(welcome?.roster).toEqual(roster);
    expect(welcome?.arenas).toEqual(data.listings);
    const room = host.room();
    expect(room.phase).toBe('lobby');
    expect(room.hostSeat).toBe(0);
    expect(room.settings).toEqual({ teamSize: 2, arenaId: data.listings[0]?.id, difficulty: 'normal' });
    expect(room.seats).toHaveLength(4);
    expect(room.seats[0]).toEqual({
      seat: 0,
      team: 'A',
      kind: 'human',
      name: 'Ada',
      championId: roster[0],
      ready: false,
      connected: true,
    });
  });

  it('gives each joiner their own token', () => {
    const harness = new Harness();
    const host = create(harness);
    const guest = join(harness, 'Bo');
    expect(guest.welcome?.token).not.toBe(host.welcome?.token);
    expect(guest.welcome?.token.startsWith(`${ROOM_CODE}.`)).toBe(true);
  });

  it('answers a join with welcome to the joiner and room to everyone', () => {
    const harness = new Harness();
    const host = create(harness);
    const before = host.of('room').length;
    const guest = join(harness, 'Bo');
    expect(guest.inbox.map((m) => m.t)).toEqual(['welcome', 'room']);
    expect(guest.welcome?.seat).toBe(1);
    expect(host.of('room')).toHaveLength(before + 1);
    expect(host.room().seats[1]).toMatchObject({ kind: 'human', team: 'B', name: 'Bo', connected: true });
  });

  it('sends room after select, settings and ready, and resets ready on a new setting', () => {
    const harness = new Harness();
    const host = create(harness);
    const guest = join(harness, 'Bo');
    const target = roster[roster.length - 1] ?? '';
    guest.send({ t: 'select', team: 'B', championId: target });
    harness.flush();
    expect(host.room().seats[1]?.championId).toBe(target);
    ready(harness, host);
    expect(host.room().seats[0]?.ready).toBe(true);
    host.send({ t: 'settings', settings: { teamSize: 3, arenaId: data.listings[0]?.id ?? '', difficulty: 'hard' } });
    harness.flush();
    const room = guest.room();
    expect(room.settings.difficulty).toBe('hard');
    expect(room.settings.teamSize).toBe(3);
    expect(room.seats).toHaveLength(6);
    expect(room.seats.every((s) => !s.ready)).toBe(true);
  });

  it('refuses settings from a non-host with notHost', () => {
    const harness = new Harness();
    create(harness);
    const guest = join(harness, 'Bo');
    guest.send({ t: 'settings', settings: { teamSize: 2, arenaId: data.listings[0]?.id ?? '', difficulty: 'easy' } });
    harness.flush();
    expect(guest.of('error').at(-1)).toEqual({ t: 'error', code: 'notHost', fatal: false });
  });

  it('answers a ping with a pong carrying the tick, 0 in the lobby', () => {
    const harness = new Harness();
    const host = create(harness);
    host.send({ t: 'ping', id: 41 });
    harness.flush();
    expect(host.of('pong')).toEqual([{ t: 'pong', id: 41, tick: 0 }]);
  });

  it('frees the seat on leave, sends room, closes the socket and moves the host', () => {
    const harness = new Harness();
    const host = create(harness);
    const guest = join(harness, 'Bo');
    host.send({ t: 'leave' });
    harness.flush();
    expect(host.closed).toBe(true);
    expect(guest.room().hostSeat).toBe(1);
    expect(guest.room().seats[0]?.kind).toBe('open');
    expect(harness.emptied).toBe(0);
  });

  it('frees the seat when the socket closes, and calls empty() when no human is left', () => {
    const harness = new Harness();
    const host = create(harness);
    const guest = join(harness, 'Bo');
    host.disconnect();
    harness.flush();
    expect(guest.room().seats[0]?.kind).toBe('open');
    expect(harness.emptied).toBe(0);
    guest.send({ t: 'leave' });
    harness.flush();
    expect(harness.emptied).toBe(1);
  });

  it('refuses a joiner with roomFull when every seat is taken', () => {
    const harness = new Harness();
    create(harness);
    for (const name of ['b', 'c', 'd']) join(harness, name);
    const late = join(harness, 'e');
    expect(late.of('error')).toEqual([{ t: 'error', code: 'roomFull', fatal: true }]);
    expect(late.closed).toBe(true);
  });

  it('refuses a select to a full team with teamFull, not fatal', () => {
    const harness = new Harness();
    create(harness);
    join(harness, 'b');
    join(harness, 'c');
    const d = join(harness, 'd');
    d.send({ t: 'select', team: 'A', championId: roster[0] ?? '' });
    harness.flush();
    expect(d.of('error')).toEqual([{ t: 'error', code: 'teamFull', fatal: false }]);
    expect(d.closed).toBe(false);
  });

  it('starts when the last human readies, not before', () => {
    const harness = new Harness({ roundsToWin: 1 });
    const host = create(harness);
    const guest = join(harness, 'Bo');
    ready(harness, host);
    expect(harness.room.phase).toBe('lobby');
    expect(host.of('matchStart')).toHaveLength(0);
    ready(harness, guest);
    expect(harness.room.phase).toBe('match');
    expect(host.of('matchStart')).toHaveLength(1);
    expect(guest.of('matchStart')).toHaveLength(1);
  });

  it('starts when a leaver was the only human who was not ready', () => {
    const harness = new Harness({ roundsToWin: 1 });
    const host = create(harness);
    const guest = join(harness, 'Bo');
    ready(harness, host);
    guest.send({ t: 'leave' });
    harness.flush();
    expect(harness.room.phase).toBe('match');
    expect(host.of('matchStart')).toHaveLength(1);
  });
});

describe('the match start', () => {
  it('sends room with phase match and the bots in their seats, then matchStart to each human', () => {
    const harness = new Harness({ roundsToWin: 1 });
    const host = create(harness);
    ready(harness, host);
    const types = host.inbox.map((m) => m.t);
    expect(types.slice(-2)).toEqual(['room', 'matchStart']);
    const room = host.room();
    expect(room.phase).toBe('match');
    expect(room.seats.map((s) => s.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    const start = host.start;
    expect(start?.you).toBe(0);
    expect(start?.snapshotEvery).toBe(SNAPSHOT_EVERY);
    expect(start?.renderDelay).toBe(RENDER_DELAY_TICKS);
    expect(start?.config.roundsToWin).toBe(1);
    expect(start?.config.players).toHaveLength(4);
    expect(start?.kits.map((k) => k.id)).toEqual(roster.filter((id) => start?.config.players.some((p) => p.championId === id)));
  });

  it('refuses a joiner and a settings message while the match runs', () => {
    const harness = new Harness({ roundsToWin: 1 });
    const host = create(harness);
    ready(harness, host);
    const late = join(harness, 'Bo');
    expect(late.of('error')).toEqual([{ t: 'error', code: 'matchRunning', fatal: true }]);
    host.send({ t: 'settings', settings: { teamSize: 2, arenaId: data.listings[0]?.id ?? '', difficulty: 'easy' } });
    host.send({ t: 'select', team: 'A', championId: roster[0] ?? '' });
    host.send({ t: 'ready', ready: false });
    harness.flush();
    expect(host.of('error')).toEqual([
      { t: 'error', code: 'notInLobby', fatal: false },
      { t: 'error', code: 'notInLobby', fatal: false },
      { t: 'error', code: 'notInLobby', fatal: false },
    ]);
  });

  it('draws the match seed from the injected bytes: another entropy, another seed', () => {
    const a = new Harness({ roundsToWin: 1, entropy: 1 });
    const b = new Harness({ roundsToWin: 1, entropy: 2 });
    for (const h of [a, b]) ready(h, create(h));
    expect(a.observed.seed).not.toBeNull();
    expect(a.observed.seed).not.toBe(b.observed.seed);
    expect(Number.isInteger(a.observed.seed)).toBe(true);
    expect(a.observed.seed).toBeGreaterThanOrEqual(0);
    expect(a.observed.seed).toBeLessThan(2 ** 32);
  });
});

describe('the loop', () => {
  function started(options: { roundsToWin?: number } = {}): { harness: Harness; host: TestClient } {
    const harness = new Harness({ roundsToWin: 1, ...options });
    const host = create(harness);
    ready(harness, host);
    return { harness, host };
  }

  it('runs no step while no match runs', () => {
    const harness = new Harness({ roundsToWin: 1 });
    create(harness);
    harness.frame();
    harness.frame();
    expect(harness.observed.steps).toBe(0);
  });

  it('runs exactly one step for each 1000 / 60 ms of the injected clock', () => {
    const { harness } = started();
    for (let i = 0; i < 120; i++) harness.frame();
    expect(harness.observed.steps).toBe(120);
  });

  it('runs no step when the clock has not moved, and banks a partial step', () => {
    const { harness } = started();
    harness.room.wake();
    expect(harness.observed.steps).toBe(0);
    harness.now += STEP_MS / 2;
    harness.room.wake();
    expect(harness.observed.steps).toBe(0);
    harness.now += STEP_MS / 2;
    harness.room.wake();
    expect(harness.observed.steps).toBe(1);
  });

  it('runs at most 5 steps for a wake and drops the backlog after a stall', () => {
    const { harness } = started();
    harness.now += 10_000;
    harness.room.wake();
    expect(harness.observed.steps).toBe(5);
    harness.frame();
    expect(harness.observed.steps).toBe(6);
  });

  it('sends a snapshot every third tick, with the ack of the last applied input', () => {
    const { harness, host } = started();
    for (let i = 0; i < 9; i++) {
      host.send({ t: 'input', tick: i, input: { moveX: 1, moveY: 0, aimX: 0, aimY: 0, buttons: 0 } });
      harness.flush();
      harness.frame();
    }
    const snapshots = host.of('snapshot');
    expect(snapshots.map((s) => s.tick)).toEqual([3, 6, 9]);
    // One input is taken a tick, oldest first: after tick 3 the inputs 0, 1 and 2 are applied.
    expect(snapshots.map((s) => s.ack)).toEqual([2, 5, 8]);
  });

  it('acks -1 before the seat has sent an input and gives the sim no input for it', () => {
    const { harness, host } = started();
    for (let i = 0; i < 3; i++) harness.frame();
    expect(host.of('snapshot')[0]?.ack).toBe(-1);
    expect(harness.observed.inputs.get(1)?.[0]).toBeUndefined();
    // A bot still drives the others.
    expect(harness.observed.inputs.get(1)?.[1]).toBeDefined();
  });

  it('repeats the last move and aim with the buttons cleared when the queue runs dry', () => {
    const { harness, host } = started();
    host.send({ t: 'input', tick: 0, input: { moveX: 1, moveY: -1, aimX: 500, aimY: 600, buttons: 3 } });
    harness.flush();
    harness.frame();
    harness.frame();
    expect(harness.observed.inputs.get(1)?.[0]).toEqual({ moveX: 1, moveY: -1, aimX: 500, aimY: 600, buttons: 3 });
    expect(harness.observed.inputs.get(2)?.[0]).toEqual({ moveX: 1, moveY: -1, aimX: 500, aimY: 600, buttons: 0 });
  });

  it('gives a closed seat the missing input and keeps the match going', () => {
    const { harness, host } = started();
    host.send({ t: 'input', tick: 0, input: { moveX: 1, moveY: 0, aimX: 0, aimY: 0, buttons: 0 } });
    harness.flush();
    harness.frame();
    host.disconnect();
    harness.flush();
    harness.frame();
    expect(harness.observed.inputs.get(1)?.[0]).toBeDefined();
    expect(harness.observed.inputs.get(2)?.[0]).toBeUndefined();
    expect(harness.room.phase).toBe('match');
  });

  it('puts a bot in the seat of a human who leaves, for good', () => {
    const harness = new Harness({ roundsToWin: 1 });
    const host = create(harness);
    const guest = join(harness, 'Bo');
    ready(harness, host, guest);
    const id = guest.start?.you ?? -1;
    harness.frame();
    expect(harness.observed.inputs.get(1)?.[id]).toBeUndefined();
    guest.send({ t: 'leave' });
    harness.flush();
    expect(guest.closed).toBe(true);
    expect(host.room().seats[1]).toMatchObject({ kind: 'bot', connected: false });
    harness.frame();
    harness.frame();
    expect(harness.observed.inputs.get(3)?.[id]).toBeDefined();
  });

  it('copies the events of a tick into the batch: the next step clears state.events', () => {
    const { harness, host } = started();
    // Frames until the first snapshot after a tick with events has been delivered.
    for (let i = 0; i < 600 && host.batches.length === 0; i++) harness.frame();
    expect(host.batches.length).toBeGreaterThan(0);
    const first = host.batches[0];
    expect(first?.events).toEqual(harness.observed.events.get(first?.tick ?? -1));
  });
});

describe('the end of a match', () => {
  function playOut(harness: Harness, players: TestClient[]): void {
    for (let i = 0; i < 60_000 && harness.room.phase === 'match'; i++) harness.playFrame(players);
    expect(harness.room.phase).toBe('lobby');
  }

  it('sends the final snapshot, then matchEnd, then room with the lobby phase', () => {
    const harness = new Harness({ roundsToWin: 1 });
    const host = create(harness);
    ready(harness, host);
    playOut(harness, [host]);
    const types = host.inbox.map((m) => m.t);
    const end = types.lastIndexOf('matchEnd');
    expect(end).toBeGreaterThan(0);
    expect(types[end - 1]).toBe('snapshot');
    expect(types[end + 1]).toBe('room');
    expect(types).toHaveLength(end + 2);
    const snapshot = host.of('snapshot').at(-1);
    expect(snapshot?.tick).toBe(harness.observed.matchEndedAt);
    const room = host.room();
    expect(room.phase).toBe('lobby');
    expect(room.seats.map((s) => s.kind)).toEqual(['human', 'open', 'open', 'open']);
    expect(room.seats[0]?.ready).toBe(false);
    expect(host.of('matchEnd')).toHaveLength(1);
  });

  it('keeps the settings and the choices, and lets the room play again', () => {
    const harness = new Harness({ roundsToWin: 1 });
    const host = create(harness);
    host.send({ t: 'settings', settings: { teamSize: 2, arenaId: data.listings[0]?.id ?? '', difficulty: 'easy' } });
    host.send({ t: 'select', team: 'B', championId: roster[roster.length - 1] ?? '' });
    harness.flush();
    ready(harness, host);
    playOut(harness, [host]);
    const room = host.room();
    expect(room.settings.difficulty).toBe('easy');
    expect(room.seats[0]).toMatchObject({ team: 'B', championId: roster[roster.length - 1] });
    ready(harness, host);
    expect(harness.room.phase).toBe('match');
    expect(host.of('matchStart')).toHaveLength(2);
  });

  it('frees the seats of humans who were disconnected, moves the host, and calls empty() at the end', () => {
    const harness = new Harness({ roundsToWin: 1 });
    const host = create(harness);
    const guest = join(harness, 'Bo');
    ready(harness, host, guest);
    host.disconnect();
    harness.flush();
    playOut(harness, [guest]);
    const room = guest.room();
    expect(room.seats[0]?.kind).toBe('open');
    expect(room.hostSeat).toBe(1);
    expect(harness.emptied).toBe(0);

    // The last human closes too: the match runs on with bots and the room is empty at the end.
    ready(harness, guest);
    guest.disconnect();
    harness.flush();
    playOut(harness, []);
    expect(harness.emptied).toBe(1);
  });
});
