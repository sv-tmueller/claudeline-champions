import type { RoomSettings, SeatInfo } from '@claudeline/protocol';
import type { TeamId } from '@claudeline/sim';
import type { RoomData } from './data';

// The seat, host, settings, choice, ready and bot-fill rules of online design section 5, as pure
// functions over a lobby record. They touch no transport and no clock. `Room` owns the connections
// and calls these in the lobby and at a match start.

export type LobbyData = Pick<RoomData, 'roster' | 'listings'>;

/** The most seats a room has: twice the largest team size. */
export const MAX_SEATS = 6;
/** The name a bot shows in the room message. */
export const BOT_NAME = 'Bot';

export interface LobbySeat {
  kind: 'open' | 'human' | 'bot';
  team: TeamId | null;
  name: string;
  championId: string | null;
  ready: boolean;
  /** The connection of a human, null while the socket is gone and for open and bot seats. */
  conn: number | null;
  /** The reconnect token of a human (P5 reads it). */
  token: string | null;
}

export interface Lobby {
  settings: RoomSettings;
  /** The seat of the host, -1 while the room has no human. */
  hostSeat: number;
  /** MAX_SEATS entries; only the first `2 * settings.teamSize` are seats of the room. */
  seats: LobbySeat[];
}

export interface Joiner {
  name: string;
  conn: number;
  token: string;
}

/** The refusals the lobby decides. `Room` turns them into the error codes of the same name. */
export type Refusal = 'badMessage' | 'teamFull';

function openSeat(): LobbySeat {
  return { kind: 'open', team: null, name: '', championId: null, ready: false, conn: null, token: null };
}

/** A new room: team size 2, the first arena by id (every listed arena has two spawns a team), `normal`. */
export function createLobby(data: LobbyData): Lobby {
  const first = data.listings[0];
  if (first === undefined) throw new Error('the room data has no arena');
  return {
    settings: { teamSize: 2, arenaId: first.id, difficulty: 'normal' },
    hostSeat: -1,
    seats: Array.from({ length: MAX_SEATS }, openSeat),
  };
}

export function seatCount(lobby: Lobby): number {
  return 2 * lobby.settings.teamSize;
}

function liveSeats(lobby: Lobby): LobbySeat[] {
  return lobby.seats.slice(0, seatCount(lobby));
}

/** The seats of the humans, in seat order, whether or not their socket is connected. */
export function humanSeats(lobby: Lobby): number[] {
  const seats: number[] = [];
  lobby.seats.forEach((s, i) => {
    if (s.kind === 'human') seats.push(i);
  });
  return seats;
}

function humansOn(lobby: Lobby, team: TeamId, except = -1): number {
  return lobby.seats.filter((s, i) => s.kind === 'human' && s.team === team && i !== except).length;
}

/**
 * Seats a joiner in the lowest open seat, on the team with fewer humans (A on a tie), with the
 * first champion of the roster. The first human of a room is its host. Null when no seat is open.
 */
export function join(lobby: Lobby, data: LobbyData, who: Joiner): number | null {
  const seat = liveSeats(lobby).findIndex((s) => s.kind === 'open');
  if (seat === -1) return null;
  const team: TeamId = humansOn(lobby, 'B') < humansOn(lobby, 'A') ? 'B' : 'A';
  lobby.seats[seat] = {
    kind: 'human',
    team,
    name: who.name,
    championId: data.roster[0] ?? null,
    ready: false,
    conn: who.conn,
    token: who.token,
  };
  if (lobby.hostSeat === -1) lobby.hostSeat = seat;
  return seat;
}

/** Frees a seat. If it was the host's, the human in the lowest seat becomes host, else -1. */
export function leave(lobby: Lobby, seat: number): void {
  lobby.seats[seat] = openSeat();
  if (lobby.hostSeat === seat) lobby.hostSeat = humanSeats(lobby)[0] ?? -1;
}

/** A team and a champion. A change of either clears the ready flag. */
export function select(
  lobby: Lobby,
  data: LobbyData,
  seat: number,
  team: TeamId,
  championId: string,
): Refusal | null {
  const me = lobby.seats[seat];
  if (me === undefined) return 'badMessage';
  if (!data.roster.includes(championId)) return 'badMessage';
  if (humansOn(lobby, team, seat) >= lobby.settings.teamSize) return 'teamFull';
  if (me.team !== team || me.championId !== championId) me.ready = false;
  me.team = team;
  me.championId = championId;
  return null;
}

/**
 * The host's settings. The arena must be listed with spawns for the team size (`badMessage`
 * otherwise). A lower team size is refused with `teamFull` unless the humans still fit: each team
 * has at most the new size and no human sits in a seat the room would no longer have. Accepted
 * settings reset every ready flag. Seats are never renumbered.
 */
export function configure(lobby: Lobby, data: LobbyData, settings: RoomSettings): Refusal | null {
  const listing = data.listings.find((l) => l.id === settings.arenaId);
  if (listing === undefined || listing.maxTeamSize < settings.teamSize) return 'badMessage';
  if (settings.teamSize < lobby.settings.teamSize) {
    if (humansOn(lobby, 'A') > settings.teamSize || humansOn(lobby, 'B') > settings.teamSize) return 'teamFull';
    const last = humanSeats(lobby).at(-1) ?? -1;
    if (last >= 2 * settings.teamSize) return 'teamFull';
  }
  lobby.settings = { teamSize: settings.teamSize, arenaId: settings.arenaId, difficulty: settings.difficulty };
  for (const s of lobby.seats) s.ready = false;
  return null;
}

export function setReady(lobby: Lobby, seat: number, ready: boolean): void {
  const me = lobby.seats[seat];
  if (me !== undefined && me.kind === 'human') me.ready = ready;
}

/** At least one human and every human ready: the match starts. */
export function everyoneReady(lobby: Lobby): boolean {
  const humans = humanSeats(lobby);
  return humans.length > 0 && humans.every((i) => lobby.seats[i]?.ready === true);
}

/**
 * The match start. Each team's open places become bots: the open seats in seat order, team A's
 * missing places first, then team B's. The result lists the seats by champion id, team A's seats
 * in seat order and then team B's (the position is the champion id of `createMatch`), and each
 * bot seat gets its champion: the n-th bot by id takes the n-th roster champion, wrapping.
 */
export function fillBots(lobby: Lobby, data: LobbyData): number[] {
  const size = lobby.settings.teamSize;
  const open: number[] = [];
  liveSeats(lobby).forEach((s, i) => {
    if (s.kind === 'open') open.push(i);
  });
  let missingA = size - humansOn(lobby, 'A');
  for (const i of open) {
    const team: TeamId = missingA > 0 ? 'A' : 'B';
    if (team === 'A') missingA--;
    lobby.seats[i] = { ...openSeat(), kind: 'bot', team, name: BOT_NAME };
  }
  const order: number[] = [];
  for (const team of ['A', 'B'] as const) {
    liveSeats(lobby).forEach((s, i) => {
      if (s.team === team) order.push(i);
    });
  }
  let bots = 0;
  for (const i of order) {
    const s = lobby.seats[i];
    if (s !== undefined && s.kind === 'bot') {
      s.championId = data.roster[bots % data.roster.length] ?? null;
      bots++;
    }
  }
  return order;
}

/** The end of a match: the bot seats are open again. */
export function clearBots(lobby: Lobby): void {
  lobby.seats.forEach((s, i) => {
    if (s.kind === 'bot') lobby.seats[i] = openSeat();
  });
}

export function describeSeats(lobby: Lobby): SeatInfo[] {
  return liveSeats(lobby).map((s, seat) => ({
    seat,
    team: s.team,
    kind: s.kind,
    name: s.name,
    championId: s.championId,
    ready: s.kind === 'human' && s.ready,
    connected: s.kind === 'human' && s.conn !== null,
  }));
}
