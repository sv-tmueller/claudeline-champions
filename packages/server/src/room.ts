import { createBot } from '@claudeline/bots';
import type { Bot } from '@claudeline/bots';
import {
  decodeClientMessage,
  decodeFirstMessage,
  encodeServerMessage,
  encodeSnapshot,
  PROTOCOL_VERSION,
  RENDER_DELAY_TICKS,
  SNAPSHOT_EVERY,
  snapshotStateJson,
} from '@claudeline/protocol';
import type {
  ErrorCode,
  EventBatch,
  FirstMessage,
  ServerMessage,
  SessionMessage,
} from '@claudeline/protocol';
import { createMatch, DEFAULT_ROUNDS_TO_WIN, step } from '@claudeline/sim';
import type { GameState, MatchConfig, PlayerInput } from '@claudeline/sim';
import type { RoomData } from './data';
import { InputQueue } from './input-queue';
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
  moveHost,
  select,
  setReady,
} from './lobby';
import type { Lobby } from './lobby';
import { StepClock } from './step-clock';

/** The twentieth bad message in a row closes the connection (online design section 4, a default). */
export const BAD_MESSAGE_LIMIT = 20;

/**
 * Hooks for a test that watches the Room. The loopback test records what the Room did with them;
 * production passes none, so nothing is recorded.
 */
export interface RoomObserver {
  /** A match was created with this seed and this config. */
  matchStarted?(seed: number, config: MatchConfig): void;
  /**
   * After each step, with the inputs it was given. The records of a bot are overwritten by its
   * next think, so a recorder copies what it keeps.
   */
  stepped?(state: GameState, inputs: readonly (PlayerInput | undefined)[]): void;
}

export interface RoomOptions {
  /** The room's code. The router draws it (P3); the Room only carries it. */
  roomCode: string;
  data: RoomData;
  /** Sends one text to a connection. */
  send(conn: number, text: string): void;
  /** Closes a connection from the server's side. */
  close(conn: number): void;
  /** The wall clock in milliseconds, injected: the Room reads no other time. */
  now(): number;
  /** Entropy, injected: the Room draws no other. */
  randomBytes(n: number): Uint8Array;
  /** Called once when the lobby holds no human. */
  empty(): void;
  /** `DEFAULT_ROUNDS_TO_WIN` unless a test shortens the match. */
  roundsToWin?: number;
  observer?: RoomObserver;
}

interface ConnState {
  /** -1 before welcome. */
  seat: number;
  /** Bad messages in a row since welcome. */
  bad: number;
}

interface MatchRun {
  state: GameState;
  difficulty: Lobby['settings']['difficulty'];
  seed: number;
  /** Champion id to seat, and seat to champion id (-1 for a seat the room does not have). */
  seatOfId: number[];
  idOfSeat: number[];
  /** By champion id: the bot driving it, if any. */
  bots: (Bot | undefined)[];
  /** By seat: the input queue of a human seat. */
  queues: InputQueue[];
  /** By seat: the batches since that client's last snapshot. */
  pending: EventBatch[][];
  inputs: (PlayerInput | undefined)[];
}

/** An outcome of a lobby message: `bad` counts toward the twenty, anything else resets the count. */
type Outcome = 'ok' | 'bad' | ErrorCode;

function seedOf(bytes: Uint8Array): number {
  return ((bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8) | ((bytes[2] ?? 0) << 16) | ((bytes[3] ?? 0) << 24)) >>> 0;
}

/**
 * One room: the lobby and, one at a time, its matches (online design sections 4 and 5). It holds no
 * process and no transport. Messages arrive through `open`, `message` and `closed`, texts leave
 * through `send`, and the loop is `wake`, which the owner calls on a timer (package P3). Every
 * branch is total over decoded messages: it answers an invalid one with `error` and never throws.
 */
export class Room {
  private readonly o: RoomOptions;
  private readonly lobby: Lobby;
  private readonly conns = new Map<number, ConnState>();
  private readonly clock = new StepClock();
  private run: MatchRun | null = null;

  constructor(options: RoomOptions) {
    this.o = options;
    this.lobby = createLobby(options.data);
  }

  get phase(): 'lobby' | 'match' {
    return this.run === null ? 'lobby' : 'match';
  }

  /** A connection arrived. Its first message must create or join. */
  open(conn: number): void {
    this.conns.set(conn, { seat: -1, bad: 0 });
  }

  /** The text of one message from a connection. A connection the Room does not know is ignored. */
  message(conn: number, text: string): void {
    const st = this.conns.get(conn);
    if (st === undefined) return;
    if (st.seat === -1) {
      this.first(conn, st, text);
      return;
    }
    const decoded = decodeClientMessage(text);
    const outcome: Outcome = decoded.ok ? this.session(conn, st, decoded.message) : 'bad';
    if (outcome === 'bad') {
      this.badMessage(conn, st);
      return;
    }
    st.bad = 0;
    if (outcome !== 'ok') this.error(conn, outcome, false);
  }

  /** A connection's socket is gone. */
  closed(conn: number): void {
    const st = this.conns.get(conn);
    if (st === undefined) return;
    this.conns.delete(conn);
    if (st.seat === -1) return;
    const seat = this.lobby.seats[st.seat];
    if (seat === undefined) return;
    if (this.run === null) {
      this.freeLobbySeat(st.seat);
      return;
    }
    // A match is running: the seat stays, with the sim's missing input, until the match ends (P5 adds
    // the grace period and the return).
    seat.conn = null;
    const run = this.run;
    run.queues[st.seat]?.reset();
    if (run.pending[st.seat] !== undefined) run.pending[st.seat] = [];
    this.broadcastRoom();
  }

  /**
   * The loop: runs the steps the injected clock owes, at most 5 for a wake and none while no match
   * runs. A longer stall drops the backlog.
   */
  wake(): void {
    if (this.run === null) return;
    const steps = this.clock.advance(this.o.now());
    for (let i = 0; i < steps && this.run !== null; i++) this.tick(this.run);
  }

  // The first message of a connection.

  private first(conn: number, st: ConnState, text: string): void {
    const decoded = decodeFirstMessage(text);
    if (!decoded.ok) {
      this.fatal(conn, decoded.code);
      return;
    }
    const m: FirstMessage = decoded.message;
    switch (m.t) {
      case 'createRoom':
        // The router sends one createRoom to a new room. A second one has nothing to create.
        if (this.lobby.hostSeat !== -1 || this.run !== null) this.fatal(conn, 'badMessage');
        else this.seat(conn, st, m.name);
        return;
      case 'joinRoom':
        if (m.roomCode !== this.o.roomCode || this.lobby.hostSeat === -1) this.fatal(conn, 'roomNotFound');
        else if (this.run !== null) this.fatal(conn, 'matchRunning');
        else this.seat(conn, st, m.name);
        return;
      case 'reconnect':
        // P5 replaces this: no seat holds a token across a socket yet.
        this.fatal(conn, 'badToken');
        return;
      default:
        return m satisfies never;
    }
  }

  private seat(conn: number, st: ConnState, name: string): void {
    const token = `${this.o.roomCode}.${Buffer.from(this.o.randomBytes(16)).toString('base64url')}`;
    const seat = join(this.lobby, this.o.data, { name, conn, token });
    if (seat === null) {
      this.fatal(conn, 'roomFull');
      return;
    }
    st.seat = seat;
    this.send(conn, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      roomCode: this.o.roomCode,
      seat,
      token,
      roster: this.o.data.roster,
      arenas: this.o.data.listings,
    });
    this.broadcastRoom();
  }

  // A message after welcome.

  private session(conn: number, st: ConnState, m: SessionMessage): Outcome {
    const seat = st.seat;
    switch (m.t) {
      case 'ping':
        this.send(conn, { t: 'pong', id: m.id, tick: this.run?.state.tick ?? 0 });
        return 'ok';
      case 'input': {
        // After matchEnd the race of a late input is dropped silently and counts as valid.
        this.run?.queues[seat]?.push(m.tick, m.input);
        return 'ok';
      }
      case 'leave':
        if (this.run === null) {
          this.o.close(conn);
          this.conns.delete(conn);
          this.freeLobbySeat(seat);
        } else {
          this.botTakesSeat(this.run, conn, st);
        }
        return 'ok';
      case 'ready':
        if (this.run !== null) return 'notInLobby';
        setReady(this.lobby, seat, m.ready);
        this.broadcastRoom();
        this.startIfReady();
        return 'ok';
      case 'select': {
        if (this.run !== null) return 'notInLobby';
        const refusal = select(this.lobby, this.o.data, seat, m.team, m.championId);
        if (refusal !== null) return refusal === 'badMessage' ? 'bad' : refusal;
        this.broadcastRoom();
        return 'ok';
      }
      case 'settings': {
        if (this.run !== null) return 'notInLobby';
        if (this.lobby.hostSeat !== seat) return 'notHost';
        const refusal = configure(this.lobby, this.o.data, m.settings);
        if (refusal !== null) return refusal === 'badMessage' ? 'bad' : refusal;
        this.broadcastRoom();
        return 'ok';
      }
      default:
        return m satisfies never;
    }
  }

  /** An answer of `badMessage` after welcome: not fatal until the twentieth in a row. */
  private badMessage(conn: number, st: ConnState): void {
    st.bad++;
    if (st.bad < BAD_MESSAGE_LIMIT) {
      this.error(conn, 'badMessage', false);
      return;
    }
    this.error(conn, 'badMessage', true);
    this.o.close(conn);
    this.closed(conn);
  }

  // The lobby.

  private freeLobbySeat(seat: number): void {
    leave(this.lobby, seat);
    if (humanSeats(this.lobby).length === 0) {
      this.o.empty();
      return;
    }
    this.broadcastRoom();
    this.startIfReady();
  }

  private startIfReady(): void {
    if (this.run === null && everyoneReady(this.lobby)) this.startMatch();
  }

  private startMatch(): void {
    const { lobby } = this;
    const { data } = this.o;
    const order = fillBots(lobby, data);
    const config: MatchConfig = {
      teamSize: lobby.settings.teamSize,
      players: order.map((seat) => {
        const s = lobby.seats[seat];
        return { championId: s?.championId ?? '', team: s?.team ?? 'A' };
      }),
      roundsToWin: this.o.roundsToWin ?? DEFAULT_ROUNDS_TO_WIN,
    };
    const arena = data.arenas.find((a) => a.id === lobby.settings.arenaId);
    if (arena === undefined) throw new Error(`the room's arena ${lobby.settings.arenaId} is not in its data`);
    const seed = seedOf(this.o.randomBytes(4));
    const state = createMatch(config, arena, seed, data.kits);

    const idOfSeat: number[] = lobby.seats.map(() => -1);
    order.forEach((seat, id) => {
      idOfSeat[seat] = id;
    });
    const run: MatchRun = {
      state,
      difficulty: lobby.settings.difficulty,
      seed,
      seatOfId: order,
      idOfSeat,
      bots: order.map(() => undefined),
      queues: lobby.seats.map(() => new InputQueue()),
      pending: lobby.seats.map(() => []),
      inputs: [],
    };
    order.forEach((seat, id) => {
      if (lobby.seats[seat]?.kind === 'bot') run.bots[id] = createBot(id, run.difficulty, seed * 100 + id);
    });
    this.run = run;
    this.o.observer?.matchStarted?.(seed, config);

    this.broadcastRoom();
    for (const seat of humanSeats(lobby)) {
      const conn = lobby.seats[seat]?.conn;
      if (conn === null || conn === undefined) continue;
      this.send(conn, {
        t: 'matchStart',
        you: idOfSeat[seat] ?? 0,
        config,
        arena: state.arena,
        kits: state.kits,
        snapshotEvery: SNAPSHOT_EVERY,
        renderDelay: RENDER_DELAY_TICKS,
      });
    }
    this.clock.reset();
    this.clock.advance(this.o.now());
  }

  /** A human leaves a running match: a bot takes the seat for good (online design section 5). */
  private botTakesSeat(run: MatchRun, conn: number, st: ConnState): void {
    const seat = this.lobby.seats[st.seat];
    const id = run.idOfSeat[st.seat] ?? -1;
    this.o.close(conn);
    this.conns.delete(conn);
    if (seat === undefined || id === -1) return;
    seat.kind = 'bot';
    seat.name = 'Bot';
    seat.ready = false;
    seat.conn = null;
    seat.token = null;
    moveHost(this.lobby, st.seat);
    run.bots[id] = createBot(id, run.difficulty, run.seed * 100 + id);
    run.queues[st.seat]?.reset();
    run.pending[st.seat] = [];
    this.broadcastRoom();
  }

  // One tick of a match (online design section 4, order within a tick).

  private tick(run: MatchRun): void {
    const { state, inputs } = run;
    inputs.length = 0;
    for (let id = 0; id < run.seatOfId.length; id++) {
      const seat = run.seatOfId[id] ?? 0;
      const bot = run.bots[id];
      if (bot !== undefined) inputs[id] = bot.think(state);
      // A human with no socket gets the sim's missing input, not a repeat.
      else inputs[id] = this.lobby.seats[seat]?.conn === null ? undefined : run.queues[seat]?.take();
    }
    step(state, inputs);
    this.o.observer?.stepped?.(state, inputs);

    if (state.events.length > 0) {
      // step clears state.events in place on the next call, so a batch holds a copy.
      const batch: EventBatch = { tick: state.tick, events: structuredClone(state.events) };
      for (const seat of humanSeats(this.lobby)) {
        if (this.lobby.seats[seat]?.conn !== null) run.pending[seat]?.push(batch);
      }
    }
    const ended = state.events.find((e) => e.type === 'matchEnded');
    if (state.tick % SNAPSHOT_EVERY === 0 || ended !== undefined) this.snapshots(run);
    if (ended !== undefined && ended.type === 'matchEnded') {
      for (const seat of humanSeats(this.lobby)) {
        const conn = this.lobby.seats[seat]?.conn;
        if (conn !== null && conn !== undefined) {
          this.send(conn, { t: 'matchEnd', winner: ended.winner, scoreA: ended.scoreA, scoreB: ended.scoreB });
        }
      }
      this.endMatch();
    }
  }

  private snapshots(run: MatchRun): void {
    const stateJson = snapshotStateJson(run.state);
    for (const seat of humanSeats(this.lobby)) {
      const conn = this.lobby.seats[seat]?.conn;
      if (conn === null || conn === undefined) continue;
      const ack = run.queues[seat]?.ack ?? -1;
      this.o.send(conn, encodeSnapshot(run.state.tick, ack, stateJson, run.pending[seat] ?? []));
      run.pending[seat] = [];
    }
  }

  /** Back to the lobby: ready reset, bots cleared, the seats of humans who are gone freed. */
  private endMatch(): void {
    this.run = null;
    clearBots(this.lobby);
    for (const seat of humanSeats(this.lobby)) {
      const s = this.lobby.seats[seat];
      if (s === undefined) continue;
      if (s.conn === null) leave(this.lobby, seat);
      else s.ready = false;
    }
    if (humanSeats(this.lobby).length === 0) {
      this.o.empty();
      return;
    }
    this.broadcastRoom();
  }

  // Sending.

  private send(conn: number, message: ServerMessage): void {
    this.o.send(conn, encodeServerMessage(message));
  }

  private error(conn: number, code: ErrorCode, fatal: boolean): void {
    this.send(conn, { t: 'error', code, fatal });
  }

  /** An error that closes the connection, before welcome. */
  private fatal(conn: number, code: ErrorCode): void {
    this.error(conn, code, true);
    this.o.close(conn);
    this.conns.delete(conn);
  }

  private broadcastRoom(): void {
    const message: ServerMessage = {
      t: 'room',
      roomCode: this.o.roomCode,
      phase: this.phase,
      hostSeat: this.lobby.hostSeat,
      settings: this.lobby.settings,
      seats: describeSeats(this.lobby),
    };
    const text = encodeServerMessage(message);
    for (const seat of humanSeats(this.lobby)) {
      const conn = this.lobby.seats[seat]?.conn;
      if (conn !== null && conn !== undefined) this.o.send(conn, text);
    }
  }
}
