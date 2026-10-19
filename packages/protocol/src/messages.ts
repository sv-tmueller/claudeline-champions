import type {
  ArenaDef,
  GameState,
  KitDef,
  MatchConfig,
  PlayerInput,
  SimEvent,
  TeamId,
} from '@claudeline/sim';
import type {
  DIFFICULTIES,
  ERROR_CODES,
  PROTOCOL_VERSION,
  RENDER_DELAY_TICKS,
  SNAPSHOT_EVERY,
} from './constants';

// The types of online design section 6. The field order of each interface is the key order of its
// encoder, so the bytes of a message do not depend on the caller's object.

export type Difficulty = (typeof DIFFICULTIES)[number];
/** A string-literal union, not an enum: the server loads this file through Node's type stripping. */
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface RoomSettings {
  teamSize: 2 | 3;
  arenaId: string;
  difficulty: Difficulty;
}

export interface ArenaListing {
  id: string;
  name: string;
  /** 3 only with three spawns a team. */
  maxTeamSize: 2 | 3;
}

export interface SeatInfo {
  /** 0 to 2 * teamSize - 1. */
  seat: number;
  /** null while the seat is open. */
  team: TeamId | null;
  kind: 'open' | 'human' | 'bot';
  /** '' while open. */
  name: string;
  /** null while open. */
  championId: string | null;
  /** false for open and bot seats. */
  ready: boolean;
  /** false for open and bot seats. */
  connected: boolean;
}

/** The state of a snapshot: the match state without what `matchStart` and the batches carry. */
export type SnapshotState = Omit<GameState, 'arena' | 'kits' | 'events'>;

export interface EventBatch {
  tick: number;
  events: SimEvent[];
}

// Client to server.

export interface CreateRoomMessage {
  t: 'createRoom';
  v: typeof PROTOCOL_VERSION;
  name: string;
}
export interface JoinRoomMessage {
  t: 'joinRoom';
  v: typeof PROTOCOL_VERSION;
  roomCode: string;
  name: string;
}
export interface ReconnectMessage {
  t: 'reconnect';
  v: typeof PROTOCOL_VERSION;
  token: string;
}
export interface SelectMessage {
  t: 'select';
  team: TeamId;
  championId: string;
}
export interface SettingsMessage {
  t: 'settings';
  settings: RoomSettings;
}
export interface ReadyMessage {
  t: 'ready';
  ready: boolean;
}
export interface InputMessage {
  t: 'input';
  /** The client's input counter, not the server's tick. */
  tick: number;
  input: PlayerInput;
}
export interface LeaveMessage {
  t: 'leave';
}
export interface PingMessage {
  t: 'ping';
  id: number;
}

/** The three messages a connection may start with. */
export type FirstMessage = CreateRoomMessage | JoinRoomMessage | ReconnectMessage;
/** The six messages after `welcome`. */
export type SessionMessage =
  | SelectMessage
  | SettingsMessage
  | ReadyMessage
  | InputMessage
  | LeaveMessage
  | PingMessage;
export type ClientMessage = FirstMessage | SessionMessage;

// Server to client.

export interface WelcomeMessage {
  t: 'welcome';
  v: typeof PROTOCOL_VERSION;
  roomCode: string;
  seat: number;
  token: string;
  roster: string[];
  arenas: ArenaListing[];
}
export interface RoomMessage {
  t: 'room';
  roomCode: string;
  phase: 'lobby' | 'match';
  hostSeat: number;
  settings: RoomSettings;
  seats: SeatInfo[];
}
export interface MatchStartMessage {
  t: 'matchStart';
  /** The receiving human's champion id. */
  you: number;
  config: MatchConfig;
  arena: ArenaDef;
  kits: KitDef[];
  snapshotEvery: typeof SNAPSHOT_EVERY;
  renderDelay: typeof RENDER_DELAY_TICKS;
}
export interface SnapshotMessage {
  t: 'snapshot';
  tick: number;
  /** The last input tick the server applied for this client, -1 before the first. */
  ack: number;
  state: SnapshotState;
  events: EventBatch[];
}
export interface MatchEndMessage {
  t: 'matchEnd';
  winner: TeamId;
  scoreA: number;
  scoreB: number;
}
export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  fatal: boolean;
}
export interface PongMessage {
  t: 'pong';
  id: number;
  /** The server's `state.tick`, 0 in the lobby. */
  tick: number;
}

export type ServerMessage =
  | WelcomeMessage
  | RoomMessage
  | MatchStartMessage
  | SnapshotMessage
  | MatchEndMessage
  | ErrorMessage
  | PongMessage;

/** `version` and `badMessage` are the only codes a decoder can produce. */
export type DecodeFailure = { ok: false; code: 'version' | 'badMessage'; reason: string };
export type DecodeResult<M> = { ok: true; message: M } | DecodeFailure;
