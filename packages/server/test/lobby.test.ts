import { describe, expect, it } from 'vitest';
import {
  clearBots,
  configure,
  createLobby,
  describeSeats,
  everyoneReady,
  fillBots,
  humanSeats,
  join,
  leave,
  select,
  setReady,
} from '../src/lobby';
import type { Lobby, LobbyData } from '../src/lobby';

// The rules of online design section 5: seats, host, settings, choices, ready and bot fill. They are
// pure functions over a lobby record, so each rule is one short row here.

const data: LobbyData = {
  roster: ['alpha', 'beta', 'gamma'],
  listings: [
    { id: 'duel', name: 'Duel', maxTeamSize: 2 },
    { id: 'grand', name: 'Grand', maxTeamSize: 3 },
  ],
};

let nextConn = 1;
function sit(lobby: Lobby, name: string): number {
  const seat = join(lobby, data, { name, conn: nextConn++, token: `token-${name}` });
  if (seat === null) throw new Error(`no seat for ${name}`);
  return seat;
}

function teamsOf(lobby: Lobby): (string | null)[] {
  return describeSeats(lobby).map((s) => s.team);
}

describe('a new lobby', () => {
  it('opens on team size 2, the first arena by id with two spawns a team and difficulty normal', () => {
    const lobby = createLobby(data);
    expect(lobby.settings).toEqual({ teamSize: 2, arenaId: 'duel', difficulty: 'normal' });
    expect(lobby.hostSeat).toBe(-1);
    expect(describeSeats(lobby).map((s) => s.kind)).toEqual(['open', 'open', 'open', 'open']);
  });
});

describe('seats and host', () => {
  it('seats the first joiner as host, on team A with the first champion in the roster', () => {
    const lobby = createLobby(data);
    const seat = sit(lobby, 'Ada');
    expect(seat).toBe(0);
    expect(lobby.hostSeat).toBe(0);
    expect(describeSeats(lobby)[0]).toEqual({
      seat: 0,
      team: 'A',
      kind: 'human',
      name: 'Ada',
      championId: 'alpha',
      ready: false,
      connected: true,
    });
  });

  it('puts a joiner on the team with fewer humans, team A on a tie, in the lowest open seat', () => {
    const lobby = createLobby(data);
    sit(lobby, 'a');
    sit(lobby, 'b');
    sit(lobby, 'c');
    expect(teamsOf(lobby).slice(0, 3)).toEqual(['A', 'B', 'A']);
    sit(lobby, 'd');
    expect(teamsOf(lobby)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('refuses a joiner when every seat is taken', () => {
    const lobby = createLobby(data);
    for (const name of ['a', 'b', 'c', 'd']) sit(lobby, name);
    expect(join(lobby, data, { name: 'e', conn: 99, token: 'x' })).toBeNull();
  });

  it('hands a freed seat to the next joiner, lowest first', () => {
    const lobby = createLobby(data);
    for (const name of ['a', 'b', 'c']) sit(lobby, name);
    leave(lobby, 1);
    expect(sit(lobby, 'd')).toBe(1);
  });

  it('moves the host to the human in the lowest seat when the host leaves', () => {
    const lobby = createLobby(data);
    for (const name of ['a', 'b', 'c']) sit(lobby, name);
    leave(lobby, 0);
    expect(lobby.hostSeat).toBe(1);
    leave(lobby, 1);
    expect(lobby.hostSeat).toBe(2);
    leave(lobby, 2);
    expect(lobby.hostSeat).toBe(-1);
    expect(humanSeats(lobby)).toEqual([]);
  });

  it('keeps the host when another seat leaves', () => {
    const lobby = createLobby(data);
    for (const name of ['a', 'b']) sit(lobby, name);
    leave(lobby, 1);
    expect(lobby.hostSeat).toBe(0);
  });
});

describe('select', () => {
  it('changes team and champion, and clears the ready flag only when something changed', () => {
    const lobby = createLobby(data);
    const seat = sit(lobby, 'a');
    setReady(lobby, seat, true);
    expect(select(lobby, data, seat, 'A', 'alpha')).toBeNull();
    expect(lobby.seats[seat]?.ready).toBe(true);
    expect(select(lobby, data, seat, 'A', 'gamma')).toBeNull();
    expect(lobby.seats[seat]).toMatchObject({ championId: 'gamma', ready: false });
    setReady(lobby, seat, true);
    expect(select(lobby, data, seat, 'B', 'gamma')).toBeNull();
    expect(lobby.seats[seat]).toMatchObject({ team: 'B', ready: false });
  });

  it('refuses a champion outside the roster as badMessage', () => {
    const lobby = createLobby(data);
    const seat = sit(lobby, 'a');
    expect(select(lobby, data, seat, 'A', 'nobody')).toBe('badMessage');
    expect(lobby.seats[seat]?.championId).toBe('alpha');
  });

  it('refuses a team that has its places taken as teamFull, and lets a human keep their own team', () => {
    const lobby = createLobby(data);
    const a = sit(lobby, 'a');
    sit(lobby, 'b');
    const c = sit(lobby, 'c');
    expect(teamsOf(lobby).slice(0, 3)).toEqual(['A', 'B', 'A']);
    // Team A has two humans: team size 2 is full for a third.
    const d = sit(lobby, 'd');
    expect(select(lobby, data, d, 'A', 'alpha')).toBe('teamFull');
    expect(lobby.seats[d]?.team).toBe('B');
    expect(select(lobby, data, a, 'A', 'beta')).toBeNull();
    expect(select(lobby, data, c, 'B', 'beta')).toBe('teamFull');
  });
});

describe('configure', () => {
  const grand = { teamSize: 3 as const, arenaId: 'grand', difficulty: 'hard' as const };

  it('accepts a setting that fits, resets every ready flag and keeps the seats', () => {
    const lobby = createLobby(data);
    const a = sit(lobby, 'a');
    const b = sit(lobby, 'b');
    setReady(lobby, a, true);
    setReady(lobby, b, true);
    expect(configure(lobby, data, grand)).toBeNull();
    expect(lobby.settings).toEqual(grand);
    expect(lobby.seats[a]?.ready).toBe(false);
    expect(lobby.seats[b]?.ready).toBe(false);
    expect(describeSeats(lobby)).toHaveLength(6);
  });

  it('refuses an arena outside the list, and one without spawns for the team size, as badMessage', () => {
    const lobby = createLobby(data);
    expect(configure(lobby, data, { ...grand, arenaId: 'nowhere' })).toBe('badMessage');
    expect(configure(lobby, data, { ...grand, arenaId: 'duel' })).toBe('badMessage');
    expect(lobby.settings.teamSize).toBe(2);
  });

  it('refuses a lower team size with a human in a seat that would no longer exist', () => {
    const lobby = createLobby(data);
    configure(lobby, data, grand);
    for (const name of ['a', 'b', 'c', 'd', 'e']) sit(lobby, name);
    // Five humans: seats 0 to 4, so team size 2 would drop seat 4.
    expect(configure(lobby, data, { teamSize: 2, arenaId: 'duel', difficulty: 'normal' })).toBe('teamFull');
    expect(lobby.settings.teamSize).toBe(3);
    leave(lobby, 4);
    leave(lobby, 3);
    // Three humans in seats 0 to 2: teams A, B, A, so a team of two fits.
    expect(configure(lobby, data, { teamSize: 2, arenaId: 'duel', difficulty: 'normal' })).toBeNull();
    expect(describeSeats(lobby)).toHaveLength(4);
  });

  it('refuses a lower team size when a team has more humans than it would have places', () => {
    const lobby = createLobby(data);
    configure(lobby, data, grand);
    const a = sit(lobby, 'a');
    const b = sit(lobby, 'b');
    const c = sit(lobby, 'c');
    select(lobby, data, b, 'A', 'alpha');
    select(lobby, data, c, 'A', 'alpha');
    expect(teamsOf(lobby).slice(0, 3)).toEqual(['A', 'A', 'A']);
    expect(a).toBe(0);
    expect(configure(lobby, data, { teamSize: 2, arenaId: 'duel', difficulty: 'normal' })).toBe('teamFull');
  });
});

describe('ready', () => {
  it('is everyone ready only with at least one human and every human ready', () => {
    const lobby = createLobby(data);
    expect(everyoneReady(lobby)).toBe(false);
    const a = sit(lobby, 'a');
    const b = sit(lobby, 'b');
    setReady(lobby, a, true);
    expect(everyoneReady(lobby)).toBe(false);
    setReady(lobby, b, true);
    expect(everyoneReady(lobby)).toBe(true);
    setReady(lobby, a, false);
    expect(everyoneReady(lobby)).toBe(false);
  });
});

describe('bot fill', () => {
  it('fills team A first and then team B from the open seats in seat order', () => {
    const lobby = createLobby(data);
    configure(lobby, data, { teamSize: 3, arenaId: 'grand', difficulty: 'normal' });
    sit(lobby, 'a'); // seat 0, team A
    sit(lobby, 'b'); // seat 1, team B
    fillBots(lobby, data);
    // Each team has one human and misses two places: team A takes the first two open seats (2 and
    // 3), team B the next two (4 and 5).
    expect(teamsOf(lobby)).toEqual(['A', 'B', 'A', 'A', 'B', 'B']);
    expect(describeSeats(lobby).map((s) => s.kind)).toEqual(['human', 'human', 'bot', 'bot', 'bot', 'bot']);
  });

  it('numbers champions team A seats first and gives the n-th bot the n-th roster champion, wrapping', () => {
    const lobby = createLobby(data);
    configure(lobby, data, { teamSize: 3, arenaId: 'grand', difficulty: 'normal' });
    sit(lobby, 'a');
    sit(lobby, 'b');
    select(lobby, data, 1, 'B', 'beta');
    const order = fillBots(lobby, data);
    // Champion ids: team A seats in seat order (0, 2, 3), then team B (1, 4, 5).
    expect(order).toEqual([0, 2, 3, 1, 4, 5]);
    const champions = order.map((seat) => lobby.seats[seat]?.championId);
    // Bots by id: seats 2, 3, 4, 5 are the 0th to 3rd bots: alpha, beta, gamma, alpha.
    expect(champions).toEqual(['alpha', 'alpha', 'beta', 'beta', 'gamma', 'alpha']);
  });

  it('fills nothing when the seats are all humans, and clearBots opens the bot seats again', () => {
    const lobby = createLobby(data);
    for (const name of ['a', 'b', 'c', 'd']) sit(lobby, name);
    expect(fillBots(lobby, data)).toEqual([0, 2, 1, 3]);
    expect(describeSeats(lobby).every((s) => s.kind === 'human')).toBe(true);

    const half = createLobby(data);
    sit(half, 'a');
    fillBots(half, data);
    expect(describeSeats(half).filter((s) => s.kind === 'bot')).toHaveLength(3);
    clearBots(half);
    expect(describeSeats(half).map((s) => s.kind)).toEqual(['human', 'open', 'open', 'open']);
    expect(describeSeats(half)[1]).toEqual({
      seat: 1,
      team: null,
      kind: 'open',
      name: '',
      championId: null,
      ready: false,
      connected: false,
    });
  });
});
