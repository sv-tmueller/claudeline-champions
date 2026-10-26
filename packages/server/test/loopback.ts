import { createHash } from 'node:crypto';
import {
  decodeServerMessage,
  encodeClientMessage,
  PROTOCOL_VERSION,
} from '@claudeline/protocol';
import type {
  ClientMessage,
  EventBatch,
  MatchStartMessage,
  RoomMessage,
  ServerMessage,
  WelcomeMessage,
} from '@claudeline/protocol';
import { checksum } from '@claudeline/sim';
import type { GameState, MatchConfig, MoveAxis, PlayerInput, SimEvent } from '@claudeline/sim';
import { loadRoomData } from '../src/data';
import type { RoomData } from '../src/data';
import { Room } from '../src/room';
import type { RoomObserver, RoomOptions } from '../src/room';

// The loopback transport of online design section 12: a Room, a transport with an explicit flush(),
// no timers, a manual clock and a seeded byte stream. Nothing here waits: a test advances the clock
// and calls flush(), so the order of messages and ticks is the same on every run.

export const ROOM_CODE = 'K7MQ2';

let shared: RoomData | undefined;
/** The shipped data, read once for the whole test run. */
export function roomData(): RoomData {
  shared ??= loadRoomData();
  return shared;
}

/** An LCG on Math.imul, as the protocol snapshot test: the same bytes on every machine. */
export function seededBytes(seed: number): (n: number) => Uint8Array {
  let s = seed >>> 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  };
}

/** What the observer of the Room saw, step by step. */
export interface Observed {
  seed: number | null;
  config: MatchConfig | null;
  /** checksum(state) after each step, by the state's tick. */
  checksums: Map<number, number>;
  /** Each step's inputs, copied: bot records are overwritten by the bot's next think. */
  inputs: Map<number, (PlayerInput | undefined)[]>;
  /** The events of each tick that had any, copied. */
  events: Map<number, SimEvent[]>;
  steps: number;
  matchEndedAt: number | null;
}

function copyInput(i: PlayerInput | undefined): PlayerInput | undefined {
  return i === undefined ? undefined : { moveX: i.moveX, moveY: i.moveY, aimX: i.aimX, aimY: i.aimY, buttons: i.buttons };
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SLOT_BITS = [1, 2, 4, 8, 16, 32, 64];

/** A client of the loopback: it decodes what it receives and rebuilds the state like the real one. */
export class TestClient {
  readonly conn: number;
  /** Every decoded server message, in arrival order. */
  readonly inbox: ServerMessage[] = [];
  closed = false;
  welcome: WelcomeMessage | null = null;
  start: MatchStartMessage | null = null;
  /** The state rebuilt from the newest snapshot, null before the first. */
  state: GameState | null = null;
  /** The rebuilt checksum of each snapshot, by tick. */
  readonly rebuilt: { tick: number; checksum: number }[] = [];
  /** Every event batch received, in arrival order. */
  readonly batches: EventBatch[] = [];
  private counter = 0;
  private readonly script: () => number;
  private readonly harness: Harness;

  constructor(harness: Harness, conn: number, scriptSeed: number) {
    this.harness = harness;
    this.conn = conn;
    this.script = lcg(scriptSeed);
  }

  send(message: ClientMessage): void {
    this.sendText(encodeClientMessage(message));
  }

  sendText(text: string): void {
    this.harness.upstream.push({ conn: this.conn, text });
  }

  create(name: string): void {
    this.send({ t: 'createRoom', v: PROTOCOL_VERSION, name });
  }

  join(name: string, roomCode: string = ROOM_CODE): void {
    this.send({ t: 'joinRoom', v: PROTOCOL_VERSION, roomCode, name });
  }

  /** The socket closes from the client's side. */
  disconnect(): void {
    this.harness.upstream.push({ conn: this.conn, text: null });
    this.closed = true;
  }

  receive(message: ServerMessage): void {
    this.inbox.push(message);
    switch (message.t) {
      case 'welcome':
        this.welcome = message;
        break;
      case 'matchStart':
        this.start = message;
        this.state = null;
        this.counter = 0;
        break;
      case 'snapshot': {
        if (this.start === null) throw new Error('a snapshot before matchStart');
        for (const batch of message.events) this.batches.push(batch);
        // The rule of design section 8: the events of the snapshot's tick are the last batch when
        // its tick is the snapshot's, else none.
        const last = message.events[message.events.length - 1];
        const events = last !== undefined && last.tick === message.tick ? last.events : [];
        this.state = { ...message.state, arena: this.start.arena, kits: this.start.kits, events };
        this.rebuilt.push({ tick: message.tick, checksum: checksum(this.state) });
        break;
      }
      default:
        break;
    }
  }

  of<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }>[] {
    return this.inbox.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === type);
  }

  /** The newest `room` message, or throws. */
  room(): RoomMessage {
    const rooms = this.of('room');
    const last = rooms[rooms.length - 1];
    if (last === undefined) throw new Error('no room message yet');
    return last;
  }

  /**
   * One scripted input for this frame, from the rebuilt state and a seeded script: it walks at the
   * nearest living enemy and casts at it now and then. Sends nothing before the first snapshot.
   */
  sendScriptedInput(): void {
    if (this.start === null) return;
    const you = this.start.you;
    const state = this.state;
    let input: PlayerInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };
    const me = state?.champions[you];
    if (state !== null && me !== undefined) {
      const enemies = state.champions.filter((c) => c.team !== me.team && c.alive);
      const target = enemies[Math.floor(this.script() * enemies.length)] ?? me;
      const axis = (d: number): MoveAxis => (d > 1 ? 1 : d < -1 ? -1 : 0);
      const flip = this.script() < 0.3 ? -1 : 1;
      const slot = SLOT_BITS[Math.floor(this.script() * SLOT_BITS.length)] ?? 0;
      input = {
        moveX: axis((target.x - me.x) * flip),
        moveY: axis((target.y - me.y) * flip),
        aimX: Math.round(target.x * 100),
        aimY: Math.round(target.y * 100),
        buttons: this.script() < 0.5 ? slot : 0,
      };
    }
    this.send({ t: 'input', tick: this.counter++, input });
  }
}

export interface HarnessOptions {
  /** The seed of the byte stream: tokens and the match seed come from it. */
  entropy?: number;
  roundsToWin?: number;
  data?: RoomData;
  /** Left out to see what the Room does with no observer. */
  observe?: boolean;
}

export const STEP_MS = 1000 / 60;

export class Harness {
  readonly room: Room;
  /** The manual clock, in milliseconds. */
  now = 1_000_000;
  readonly observed: Observed = {
    seed: null,
    config: null,
    checksums: new Map(),
    inputs: new Map(),
    events: new Map(),
    steps: 0,
    matchEndedAt: null,
  };
  readonly clients: TestClient[] = [];
  /** Client to room: a null text is a socket close. */
  readonly upstream: { conn: number; text: string | null }[] = [];
  private readonly downstream: { conn: number; text: string | null }[] = [];
  private readonly hash = createHash('sha256');
  emptied = 0;
  private nextConn = 1;

  constructor(options: HarnessOptions = {}) {
    const observer: RoomObserver = {
      matchStarted: (seed, config) => {
        this.observed.seed = seed;
        this.observed.config = structuredClone(config);
      },
      stepped: (state, inputs) => {
        this.observed.steps++;
        this.observed.checksums.set(state.tick, checksum(state));
        this.observed.inputs.set(state.tick, inputs.map(copyInput));
        if (state.events.length > 0) {
          this.observed.events.set(state.tick, structuredClone(state.events));
          if (state.events.some((e) => e.type === 'matchEnded')) this.observed.matchEndedAt = state.tick;
        }
      },
    };
    const roomOptions: RoomOptions = {
      roomCode: ROOM_CODE,
      data: options.data ?? roomData(),
      send: (conn, text) => this.downstream.push({ conn, text }),
      close: (conn) => this.downstream.push({ conn, text: null }),
      now: () => this.now,
      randomBytes: seededBytes(options.entropy ?? 1),
      empty: () => {
        this.emptied++;
      },
    };
    if (options.roundsToWin !== undefined) roomOptions.roundsToWin = options.roundsToWin;
    if (options.observe !== false) roomOptions.observer = observer;
    this.room = new Room(roomOptions);
  }

  /** A client with a fresh connection id; the Room has seen it open. */
  client(): TestClient {
    const conn = this.nextConn++;
    const client = new TestClient(this, conn, 20261026 + conn);
    this.clients.push(client);
    this.room.open(conn);
    return client;
  }

  /** Delivers everything in flight in both directions, in order, until nothing is left. */
  flush(): void {
    for (;;) {
      const up = this.upstream.shift();
      if (up !== undefined) {
        this.hash.update(`up ${up.conn} ${up.text ?? '<close>'}\n`);
        if (up.text === null) this.room.closed(up.conn);
        else this.room.message(up.conn, up.text);
        continue;
      }
      const down = this.downstream.shift();
      if (down === undefined) return;
      this.hash.update(`down ${down.conn} ${down.text ?? '<close>'}\n`);
      const client = this.clients.find((c) => c.conn === down.conn);
      if (client === undefined) continue;
      if (down.text === null) {
        client.closed = true;
        continue;
      }
      if (client.closed) continue;
      const decoded = decodeServerMessage(down.text);
      if (!decoded.ok) throw new Error(`the server sent a message that does not decode: ${decoded.reason}`);
      client.receive(decoded.message);
    }
  }

  /** One frame of the manual clock: the clock moves one step, the Room wakes, everything is delivered. */
  frame(): void {
    this.now += STEP_MS;
    this.room.wake();
    this.flush();
  }

  /** A frame in which each of these clients first sends its scripted input. */
  playFrame(players: readonly TestClient[]): void {
    for (const p of players) if (!p.closed) p.sendScriptedInput();
    this.flush();
    this.frame();
  }

  /** The sha256 of every text delivered in both directions, in order. */
  digest(): string {
    return this.hash.copy().digest('hex');
  }
}
