import type {
  ArenaDef,
  GameState,
  KitDef,
  MatchConfig,
  MoveAxis,
  PlayerInput,
  SimEvent,
  TeamId,
} from '@claudeline/sim';
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
} from './constants';
import type {
  ArenaListing,
  ClientMessage,
  DecodeResult,
  Difficulty,
  ErrorCode,
  EventBatch,
  FirstMessage,
  RoomSettings,
  SeatInfo,
  ServerMessage,
  SessionMessage,
  SnapshotState,
} from './messages';

// The codec of online design section 6. Three decoders, each total: they return a result and never
// throw. Every field is read as an own property, every record is built fresh from the known fields
// (so a stray field or an own `__proto__` key reaches nothing), and a reason names the field and the
// rule, never the value. The encoders write the keys in the order of the spec's tables.

type Obj = Record<string, unknown>;

const MAX_SEATS = 6;
const MAX_SEAT_INDEX = MAX_SEATS - 1;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const ROOM_CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const TOKEN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}\\.[A-Za-z0-9_-]{22}$`);

/** The one exception of the decoders. It never leaves them. */
class Reject extends Error {
  readonly code: 'version' | 'badMessage';
  constructor(code: 'version' | 'badMessage', reason: string) {
    super(reason);
    this.code = code;
  }
}

function bad(path: string, rule: string): never {
  throw new Reject('badMessage', `${path === '' ? 'message' : path}: ${rule}`);
}

function at(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`;
}

function isRecord(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An own property, or undefined: `{"t":"toString"}` and an inherited `id` read nothing. */
function get(o: Obj, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

function record(v: unknown, path: string): Obj {
  if (!isRecord(v)) return bad(path, 'an object');
  return v;
}

function array(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) return bad(path, 'an array');
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') return bad(path, 'a boolean');
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') return bad(path, 'a string');
  return v;
}

function nonEmpty(v: unknown, path: string): string {
  const s = str(v, path);
  if (s === '') return bad(path, 'a non-empty string');
  return s;
}

/** A safe integer within [min, max]. JSON `-0` and `1e999` are handled here: -0 becomes 0. */
function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    return bad(path, `an integer from ${min} to ${max === MAX_SAFE ? 'the safe maximum' : max}`);
  }
  return v === 0 ? 0 : v;
}

function nat(v: unknown, path: string): number {
  return int(v, path, 0, MAX_SAFE);
}

function seatIndex(v: unknown, path: string): number {
  return int(v, path, 0, MAX_SEAT_INDEX);
}

function team(v: unknown, path: string): TeamId {
  if (v === 'A' || v === 'B') return v;
  return bad(path, 'A or B');
}

function teamSize(v: unknown, path: string): 2 | 3 {
  if (v === 2 || v === 3) return v;
  return bad(path, '2 or 3');
}

function difficulty(v: unknown, path: string): Difficulty {
  const found = DIFFICULTIES.find((d) => d === v);
  return found ?? bad(path, 'easy, normal or hard');
}

function errorCode(v: unknown, path: string): ErrorCode {
  const found = ERROR_CODES.find((c) => c === v);
  return found ?? bad(path, 'a known error code');
}

function roomCode(v: unknown, path: string): string {
  const s = str(v, path);
  if (!ROOM_CODE.test(s)) return bad(path, 'five characters of the room code alphabet');
  return s;
}

function token(v: unknown, path: string): string {
  const s = str(v, path);
  if (!TOKEN.test(s)) return bad(path, 'a room code, a dot and 22 base64url characters');
  return s;
}

/**
 * The code points of a name, at most NAME_MAX, none of them a control character (U+0000 to U+001F
 * and U+007F to U+009F). Stops counting at the limit, so a huge string costs nothing.
 */
function codePoints(s: string, path: string): number {
  let count = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return bad(path, 'no control characters');
    count++;
    if (count > NAME_MAX) return bad(path, `at most ${NAME_MAX} code points`);
  }
  return count;
}

/** A player name: trimmed, then 1 to NAME_MAX code points. The result is the trimmed string. */
function playerName(v: unknown, path: string): string {
  const trimmed = str(v, path).trim();
  if (codePoints(trimmed, path) === 0) return bad(path, `1 to ${NAME_MAX} code points after trimming`);
  return trimmed;
}

/** True when `text` is more than `limit` UTF-8 bytes. A lone surrogate counts as 3, as `ws` writes it. */
function exceedsBytes(text: string, limit: number): boolean {
  // Each UTF-16 unit takes at least one byte, so a longer text is over without a count.
  if (text.length > limit) return true;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      bytes += 1;
    } else if (c < 0x800) {
      bytes += 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes > limit;
}

function parseText(text: unknown, capped: boolean): Obj {
  if (typeof text !== 'string') return bad('', 'a text frame');
  if (capped && exceedsBytes(text, MAX_CLIENT_MESSAGE_BYTES)) {
    return bad('', `at most ${MAX_CLIENT_MESSAGE_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return bad('', 'JSON');
  }
  if (!isRecord(value)) return bad('', 'a JSON object');
  return value;
}

function typeOf(o: Obj): string {
  const t = get(o, 't');
  if (typeof t !== 'string') return bad('t', 'a string');
  return t;
}

/** The version rule: a missing or non-integer v is a bad message, any other integer is `version`. */
function checkVersion(o: Obj): void {
  const v = get(o, 'v');
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) return bad('v', 'an integer');
  if (v !== PROTOCOL_VERSION) throw new Reject('version', 'v: not the protocol version of this side');
}

function decode<M>(text: unknown, capped: boolean, build: (o: Obj) => M): DecodeResult<M> {
  try {
    return { ok: true, message: build(parseText(text, capped)) };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, code: e.code, reason: e.message };
    // Not reachable by design. A decoder never throws, whatever the input.
    return { ok: false, code: 'badMessage', reason: 'message: could not be read' };
  }
}

function readSettings(v: unknown, path: string): RoomSettings {
  const o = record(v, path);
  return {
    teamSize: teamSize(get(o, 'teamSize'), at(path, 'teamSize')),
    arenaId: nonEmpty(get(o, 'arenaId'), at(path, 'arenaId')),
    difficulty: difficulty(get(o, 'difficulty'), at(path, 'difficulty')),
  };
}

function readInput(v: unknown, path: string): PlayerInput {
  const o = record(v, path);
  const axis = (key: string): MoveAxis => int(get(o, key), at(path, key), -1, 1) as MoveAxis;
  return {
    moveX: axis('moveX'),
    moveY: axis('moveY'),
    aimX: int(get(o, 'aimX'), at(path, 'aimX'), -MAX_AIM_CM, MAX_AIM_CM),
    aimY: int(get(o, 'aimY'), at(path, 'aimY'), -MAX_AIM_CM, MAX_AIM_CM),
    buttons: int(get(o, 'buttons'), at(path, 'buttons'), 0, BUTTONS_MAX),
  };
}

function readArenaListing(v: unknown, path: string): ArenaListing {
  const o = record(v, path);
  return {
    id: nonEmpty(get(o, 'id'), at(path, 'id')),
    name: str(get(o, 'name'), at(path, 'name')),
    maxTeamSize: teamSize(get(o, 'maxTeamSize'), at(path, 'maxTeamSize')),
  };
}

function readSeat(v: unknown, path: string): SeatInfo {
  const o = record(v, path);
  const teamField = get(o, 'team');
  const kind = get(o, 'kind');
  if (kind !== 'open' && kind !== 'human' && kind !== 'bot') return bad(at(path, 'kind'), 'open, human or bot');
  const championId = get(o, 'championId');
  const name = str(get(o, 'name'), at(path, 'name'));
  codePoints(name, at(path, 'name'));
  return {
    seat: seatIndex(get(o, 'seat'), at(path, 'seat')),
    team: teamField === null ? null : team(teamField, at(path, 'team')),
    kind,
    name,
    championId: championId === null ? null : nonEmpty(championId, at(path, 'championId')),
    ready: bool(get(o, 'ready'), at(path, 'ready')),
    connected: bool(get(o, 'connected'), at(path, 'connected')),
  };
}

function readConfig(v: unknown, path: string): MatchConfig {
  const o = record(v, path);
  const players = array(get(o, 'players'), at(path, 'players')).map((p, i) => {
    const at2 = `${at(path, 'players')}[${i}]`;
    const po = record(p, at2);
    return {
      championId: nonEmpty(get(po, 'championId'), at(at2, 'championId')),
      team: team(get(po, 'team'), at(at2, 'team')),
    };
  });
  const config: MatchConfig = { teamSize: teamSize(get(o, 'teamSize'), at(path, 'teamSize')), players };
  if (Object.hasOwn(o, 'roundsToWin')) {
    config.roundsToWin = int(get(o, 'roundsToWin'), at(path, 'roundsToWin'), 1, MAX_SAFE);
  }
  return config;
}

function readBatch(v: unknown, path: string): EventBatch {
  const o = record(v, path);
  return {
    tick: nat(get(o, 'tick'), at(path, 'tick')),
    events: array(get(o, 'events'), at(path, 'events')) as SimEvent[],
  };
}

function buildFirst(o: Obj): FirstMessage {
  checkVersion(o);
  const t = typeOf(o);
  switch (t) {
    case 'createRoom':
      return { t, v: PROTOCOL_VERSION, name: playerName(get(o, 'name'), 'name') };
    case 'joinRoom':
      return {
        t,
        v: PROTOCOL_VERSION,
        roomCode: roomCode(get(o, 'roomCode'), 'roomCode'),
        name: playerName(get(o, 'name'), 'name'),
      };
    case 'reconnect':
      return { t, v: PROTOCOL_VERSION, token: token(get(o, 'token'), 'token') };
    default:
      return bad('t', 'a first message: createRoom, joinRoom or reconnect');
  }
}

function buildSession(o: Obj): SessionMessage {
  const t = typeOf(o);
  switch (t) {
    case 'select':
      return { t, team: team(get(o, 'team'), 'team'), championId: nonEmpty(get(o, 'championId'), 'championId') };
    case 'settings':
      return { t, settings: readSettings(get(o, 'settings'), 'settings') };
    case 'ready':
      return { t, ready: bool(get(o, 'ready'), 'ready') };
    case 'input':
      return { t, tick: nat(get(o, 'tick'), 'tick'), input: readInput(get(o, 'input'), 'input') };
    case 'leave':
      return { t };
    case 'ping':
      return { t, id: nat(get(o, 'id'), 'id') };
    default:
      return bad('t', 'a message of a joined connection');
  }
}

function buildServer(o: Obj): ServerMessage {
  const t = typeOf(o);
  switch (t) {
    case 'welcome': {
      checkVersion(o);
      return {
        t,
        v: PROTOCOL_VERSION,
        roomCode: roomCode(get(o, 'roomCode'), 'roomCode'),
        seat: seatIndex(get(o, 'seat'), 'seat'),
        token: token(get(o, 'token'), 'token'),
        roster: array(get(o, 'roster'), 'roster').map((id, i) => nonEmpty(id, `roster[${i}]`)),
        arenas: array(get(o, 'arenas'), 'arenas').map((a, i) => readArenaListing(a, `arenas[${i}]`)),
      };
    }
    case 'room': {
      const seats = array(get(o, 'seats'), 'seats');
      if (seats.length > MAX_SEATS) return bad('seats', `at most ${MAX_SEATS} seats`);
      const phase = get(o, 'phase');
      if (phase !== 'lobby' && phase !== 'match') return bad('phase', 'lobby or match');
      return {
        t,
        roomCode: roomCode(get(o, 'roomCode'), 'roomCode'),
        phase,
        hostSeat: seatIndex(get(o, 'hostSeat'), 'hostSeat'),
        settings: readSettings(get(o, 'settings'), 'settings'),
        seats: seats.map((s, i) => readSeat(s, `seats[${i}]`)),
      };
    }
    case 'matchStart':
      return {
        t,
        you: seatIndex(get(o, 'you'), 'you'),
        config: readConfig(get(o, 'config'), 'config'),
        arena: record(get(o, 'arena'), 'arena') as unknown as ArenaDef,
        kits: array(get(o, 'kits'), 'kits') as unknown as KitDef[],
        snapshotEvery: exactly(get(o, 'snapshotEvery'), 'snapshotEvery', SNAPSHOT_EVERY),
        renderDelay: exactly(get(o, 'renderDelay'), 'renderDelay', RENDER_DELAY_TICKS),
      };
    case 'snapshot':
      return {
        t,
        tick: nat(get(o, 'tick'), 'tick'),
        ack: int(get(o, 'ack'), 'ack', -1, MAX_SAFE),
        state: record(get(o, 'state'), 'state') as unknown as SnapshotState,
        events: array(get(o, 'events'), 'events').map((b, i) => readBatch(b, `events[${i}]`)),
      };
    case 'matchEnd':
      return {
        t,
        winner: team(get(o, 'winner'), 'winner'),
        scoreA: nat(get(o, 'scoreA'), 'scoreA'),
        scoreB: nat(get(o, 'scoreB'), 'scoreB'),
      };
    case 'error':
      return { t, code: errorCode(get(o, 'code'), 'code'), fatal: bool(get(o, 'fatal'), 'fatal') };
    case 'pong':
      return { t, id: nat(get(o, 'id'), 'id'), tick: nat(get(o, 'tick'), 'tick') };
    default:
      return bad('t', 'a server message');
  }
}

function exactly<N extends number>(v: unknown, path: string, expected: N): N {
  if (v !== expected) return bad(path, `exactly ${expected}`);
  return expected;
}

/** A first message of a connection, server side: `createRoom`, `joinRoom` or `reconnect`. */
export function decodeFirstMessage(text: string): DecodeResult<FirstMessage> {
  return decode(text, true, buildFirst);
}

/** A message after `welcome`, server side: `select`, `settings`, `ready`, `input`, `leave`, `ping`. */
export function decodeClientMessage(text: string): DecodeResult<SessionMessage> {
  return decode(text, true, buildSession);
}

/** A message of the server, client side. It has no size cap; it checks the scalar fields only. */
export function decodeServerMessage(text: string): DecodeResult<ServerMessage> {
  return decode(text, false, buildServer);
}

// Encoders. They copy the known fields in the order of the spec's tables and do not validate: the
// callers are typed, trusted code. A NaN would be written as null, and the receiver rejects it.

function settingsOf(s: RoomSettings): RoomSettings {
  return { teamSize: s.teamSize, arenaId: s.arenaId, difficulty: s.difficulty };
}

function batchesOf(events: readonly EventBatch[]): EventBatch[] {
  return events.map((b) => ({ tick: b.tick, events: b.events }));
}

export function encodeClientMessage(m: ClientMessage): string {
  switch (m.t) {
    case 'createRoom':
      return JSON.stringify({ t: m.t, v: m.v, name: m.name });
    case 'joinRoom':
      return JSON.stringify({ t: m.t, v: m.v, roomCode: m.roomCode, name: m.name });
    case 'reconnect':
      return JSON.stringify({ t: m.t, v: m.v, token: m.token });
    case 'select':
      return JSON.stringify({ t: m.t, team: m.team, championId: m.championId });
    case 'settings':
      return JSON.stringify({ t: m.t, settings: settingsOf(m.settings) });
    case 'ready':
      return JSON.stringify({ t: m.t, ready: m.ready });
    case 'input':
      return JSON.stringify({
        t: m.t,
        tick: m.tick,
        input: {
          moveX: m.input.moveX,
          moveY: m.input.moveY,
          aimX: m.input.aimX,
          aimY: m.input.aimY,
          buttons: m.input.buttons,
        },
      });
    case 'leave':
      return JSON.stringify({ t: m.t });
    case 'ping':
      return JSON.stringify({ t: m.t, id: m.id });
    default:
      return unknownType(m);
  }
}

export function encodeServerMessage(m: ServerMessage): string {
  switch (m.t) {
    case 'welcome':
      return JSON.stringify({
        t: m.t,
        v: m.v,
        roomCode: m.roomCode,
        seat: m.seat,
        token: m.token,
        roster: m.roster,
        arenas: m.arenas.map((a) => ({ id: a.id, name: a.name, maxTeamSize: a.maxTeamSize })),
      });
    case 'room':
      return JSON.stringify({
        t: m.t,
        roomCode: m.roomCode,
        phase: m.phase,
        hostSeat: m.hostSeat,
        settings: settingsOf(m.settings),
        seats: m.seats.map((s) => ({
          seat: s.seat,
          team: s.team,
          kind: s.kind,
          name: s.name,
          championId: s.championId,
          ready: s.ready,
          connected: s.connected,
        })),
      });
    case 'matchStart': {
      const config: MatchConfig = {
        teamSize: m.config.teamSize,
        players: m.config.players.map((p) => ({ championId: p.championId, team: p.team })),
      };
      if (m.config.roundsToWin !== undefined) config.roundsToWin = m.config.roundsToWin;
      return JSON.stringify({
        t: m.t,
        you: m.you,
        config,
        arena: m.arena,
        kits: m.kits,
        snapshotEvery: m.snapshotEvery,
        renderDelay: m.renderDelay,
      });
    }
    case 'snapshot':
      return JSON.stringify({
        t: m.t,
        tick: m.tick,
        ack: m.ack,
        state: m.state,
        events: batchesOf(m.events),
      });
    case 'matchEnd':
      return JSON.stringify({ t: m.t, winner: m.winner, scoreA: m.scoreA, scoreB: m.scoreB });
    case 'error':
      return JSON.stringify({ t: m.t, code: m.code, fatal: m.fatal });
    case 'pong':
      return JSON.stringify({ t: m.t, id: m.id, tick: m.tick });
    default:
      return unknownType(m);
  }
}

function unknownType(m: never): never {
  throw new Error(`protocol: cannot encode a message of type ${String((m as { t?: unknown }).t)}`);
}

/**
 * The state of a snapshot as JSON text: the state without its root keys `arena`, `kits` and
 * `events`. The server writes this once per snapshot and splices it into each client's envelope.
 */
export function snapshotStateJson(state: GameState): string {
  const out: Obj = {};
  const source = state as unknown as Obj;
  for (const key of Object.keys(source)) {
    if (key === 'arena' || key === 'kits' || key === 'events') continue;
    out[key] = source[key];
  }
  return JSON.stringify(out);
}

/**
 * A snapshot message with the state text already written. Byte for byte the same text as
 * `encodeServerMessage` gives for the same snapshot.
 */
export function encodeSnapshot(
  tick: number,
  ack: number,
  stateJson: string,
  events: readonly EventBatch[],
): string {
  return `{"t":"snapshot","tick":${JSON.stringify(tick)},"ack":${JSON.stringify(ack)},"state":${stateJson},"events":${JSON.stringify(batchesOf(events))}}`;
}
