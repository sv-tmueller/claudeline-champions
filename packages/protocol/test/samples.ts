import type { ArenaDef, KitDef } from '@claudeline/sim';
import type {
  ClientMessage,
  FirstMessage,
  ServerMessage,
  SessionMessage,
  SnapshotState,
} from '../src/messages';

// One valid message of each of the sixteen types, with values that are not the neutral ones, so a
// swapped key or a dropped field changes the bytes.

export const TOKEN = 'K7MQ2.AbCdEfGhIjKlMnOpQr_-01';

export const firstMessages: FirstMessage[] = [
  { t: 'createRoom', v: 1, name: 'Ada' },
  { t: 'joinRoom', v: 1, roomCode: 'K7MQ2', name: 'Bo Li' },
  { t: 'reconnect', v: 1, token: TOKEN },
];

export const sessionMessages: SessionMessage[] = [
  { t: 'select', team: 'B', championId: 'quillon' },
  { t: 'settings', settings: { teamSize: 3, arenaId: 'arena02', difficulty: 'hard' } },
  { t: 'ready', ready: true },
  {
    t: 'input',
    tick: 1234567,
    input: { moveX: -1, moveY: 1, aimX: -100000, aimY: 100000, buttons: 255 },
  },
  { t: 'leave' },
  { t: 'ping', id: 9 },
];

export const clientMessages: ClientMessage[] = [...firstMessages, ...sessionMessages];

// Opaque to the codec: the arena, the kits and the state only have to be objects and an array.
const arena = { id: 'arena02', size: [40.5, 30] } as unknown as ArenaDef;
const kits = [{ id: 'hargrim', maxHealth: 120.25 }] as unknown as KitDef[];
const state = { tick: 51, rng: 4294967295, champions: [], projectiles: [] } as unknown as SnapshotState;

export const serverMessages: ServerMessage[] = [
  {
    t: 'welcome',
    v: 1,
    roomCode: 'K7MQ2',
    seat: 4,
    token: TOKEN,
    roster: ['hargrim', 'lumeth', 'quillon', 'skerrow'],
    arenas: [
      { id: 'arena01', name: 'The Yard', maxTeamSize: 3 },
      { id: 'arena02', name: 'Pillars', maxTeamSize: 2 },
    ],
  },
  {
    t: 'room',
    roomCode: 'K7MQ2',
    phase: 'lobby',
    hostSeat: 1,
    settings: { teamSize: 2, arenaId: 'arena01', difficulty: 'easy' },
    seats: [
      { seat: 0, team: 'A', kind: 'bot', name: '', championId: 'hargrim', ready: false, connected: false },
      { seat: 1, team: 'A', kind: 'human', name: 'Ada', championId: 'lumeth', ready: true, connected: true },
      { seat: 2, team: null, kind: 'open', name: '', championId: null, ready: false, connected: false },
    ],
  },
  {
    t: 'matchStart',
    you: 2,
    config: {
      teamSize: 2,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'lumeth', team: 'A' },
        { championId: 'quillon', team: 'B' },
        { championId: 'hargrim', team: 'B' },
      ],
      roundsToWin: 3,
    },
    arena,
    kits,
    snapshotEvery: 3,
    renderDelay: 6,
  },
  {
    t: 'snapshot',
    tick: 51,
    ack: -1,
    state,
    events: [
      { tick: 49, events: [{ type: 'roundStarted', round: 1 }] },
      { tick: 51, events: [] },
    ],
  },
  { t: 'matchEnd', winner: 'B', scoreA: 1, scoreB: 3 },
  { t: 'error', code: 'teamFull', fatal: false },
  { t: 'pong', id: 7, tick: 600 },
];

/** The golden text of each type, as the encoder must write it (the key order of the spec's tables). */
export const goldens: Record<string, string> = {
  createRoom: '{"t":"createRoom","v":1,"name":"Ada"}',
  joinRoom: '{"t":"joinRoom","v":1,"roomCode":"K7MQ2","name":"Bo Li"}',
  reconnect: `{"t":"reconnect","v":1,"token":"${TOKEN}"}`,
  select: '{"t":"select","team":"B","championId":"quillon"}',
  settings: '{"t":"settings","settings":{"teamSize":3,"arenaId":"arena02","difficulty":"hard"}}',
  ready: '{"t":"ready","ready":true}',
  input:
    '{"t":"input","tick":1234567,"input":{"moveX":-1,"moveY":1,"aimX":-100000,"aimY":100000,"buttons":255}}',
  leave: '{"t":"leave"}',
  ping: '{"t":"ping","id":9}',
  welcome:
    `{"t":"welcome","v":1,"roomCode":"K7MQ2","seat":4,"token":"${TOKEN}",` +
    '"roster":["hargrim","lumeth","quillon","skerrow"],' +
    '"arenas":[{"id":"arena01","name":"The Yard","maxTeamSize":3},' +
    '{"id":"arena02","name":"Pillars","maxTeamSize":2}]}',
  room:
    '{"t":"room","roomCode":"K7MQ2","phase":"lobby","hostSeat":1,' +
    '"settings":{"teamSize":2,"arenaId":"arena01","difficulty":"easy"},' +
    '"seats":[{"seat":0,"team":"A","kind":"bot","name":"","championId":"hargrim","ready":false,"connected":false},' +
    '{"seat":1,"team":"A","kind":"human","name":"Ada","championId":"lumeth","ready":true,"connected":true},' +
    '{"seat":2,"team":null,"kind":"open","name":"","championId":null,"ready":false,"connected":false}]}',
  matchStart:
    '{"t":"matchStart","you":2,"config":{"teamSize":2,"players":[' +
    '{"championId":"hargrim","team":"A"},{"championId":"lumeth","team":"A"},' +
    '{"championId":"quillon","team":"B"},{"championId":"hargrim","team":"B"}],"roundsToWin":3},' +
    '"arena":{"id":"arena02","size":[40.5,30]},"kits":[{"id":"hargrim","maxHealth":120.25}],' +
    '"snapshotEvery":3,"renderDelay":6}',
  snapshot:
    '{"t":"snapshot","tick":51,"ack":-1,' +
    '"state":{"tick":51,"rng":4294967295,"champions":[],"projectiles":[]},' +
    '"events":[{"tick":49,"events":[{"type":"roundStarted","round":1}]},{"tick":51,"events":[]}]}',
  matchEnd: '{"t":"matchEnd","winner":"B","scoreA":1,"scoreB":3}',
  error: '{"t":"error","code":"teamFull","fatal":false}',
  pong: '{"t":"pong","id":7,"tick":600}',
};
