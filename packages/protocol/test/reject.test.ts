import { describe, expect, it } from 'vitest';
import { decodeClientMessage, decodeFirstMessage, decodeServerMessage } from '../src/codec';
import { edit, byType } from './edit';
import { clientMessages, firstMessages, goldens, serverMessages, sessionMessages } from './samples';

type Which = 'first' | 'client' | 'server';
type Code = 'badMessage' | 'version';

const decoders = {
  first: decodeFirstMessage,
  client: decodeClientMessage,
  server: decodeServerMessage,
};

const createRoom = byType(firstMessages, 'createRoom');
const joinRoom = byType(firstMessages, 'joinRoom');
const reconnect = byType(firstMessages, 'reconnect');
const select = byType(sessionMessages, 'select');
const settings = byType(sessionMessages, 'settings');
const ready = byType(sessionMessages, 'ready');
const input = byType(sessionMessages, 'input');
const ping = byType(sessionMessages, 'ping');
const welcome = byType(serverMessages, 'welcome');
const room = byType(serverMessages, 'room');
const matchStart = byType(serverMessages, 'matchStart');
const snapshot = byType(serverMessages, 'snapshot');
const matchEnd = byType(serverMessages, 'matchEnd');
const errorMessage = byType(serverMessages, 'error');
const pong = byType(serverMessages, 'pong');

const rows: [label: string, which: Which, text: string, code: Code][] = [];
function bad(label: string, which: Which, text: string, code: Code = 'badMessage'): void {
  rows.push([label, which, text, code]);
}
/** The same rejection by all three decoders, for the envelope rules that do not depend on the type. */
function badEverywhere(label: string, text: string): void {
  for (const which of ['first', 'client', 'server'] as const) bad(`${which}: ${label}`, which, text);
}

// The envelope.
badEverywhere('not JSON', 'not json');
badEverywhere('the empty text', '');
badEverywhere('truncated JSON', '{"t":"ping","id":1');
badEverywhere('text after the JSON', '{"t":"ping","id":1}x');
badEverywhere('an array', '[]');
badEverywhere('an array of messages', '[{"t":"ping","id":1}]');
badEverywhere('null', 'null');
badEverywhere('a number', '5');
badEverywhere('a string', '"ping"');
badEverywhere('a boolean', 'true');
badEverywhere('a missing t', '{"v":1,"id":1}');
badEverywhere('a t that is not a string', '{"t":5,"v":1}');
badEverywhere('an unknown t', '{"t":"nope","v":1}');
for (const t of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', '']) {
  badEverywhere(`t is "${t}"`, JSON.stringify({ t, v: 1, id: 1 }));
}
badEverywhere('an own __proto__ key that holds the t', '{"__proto__":{"t":"ping","id":1}}');
badEverywhere('deep nesting', `${'['.repeat(200000)}${']'.repeat(200000)}`);

// Each decoder knows its own types only.
for (const m of firstMessages) bad(`client: the first message ${m.t}`, 'client', goldens[m.t] ?? '');
for (const m of sessionMessages) {
  bad(`first: the session message ${m.t} without v`, 'first', goldens[m.t] ?? '');
  bad(`first: the session message ${m.t} with v`, 'first', edit(m, ['v', 1]));
}
for (const m of serverMessages) {
  bad(`client: the server message ${m.t}`, 'client', goldens[m.t] ?? '');
  bad(`first: the server message ${m.t}`, 'first', edit(m, ['v', 1]));
}
for (const m of clientMessages) bad(`server: the client message ${m.t}`, 'server', goldens[m.t] ?? '');

// The version, checked before everything else but the envelope.
bad('first: v missing', 'first', edit(createRoom, ['v', undefined]));
bad('first: v as a string', 'first', edit(createRoom, ['v', '1']));
bad('first: v 1.5', 'first', edit(createRoom, ['v', 1.5]));
bad('first: v null', 'first', edit(createRoom, ['v', null]));
bad('first: v true', 'first', edit(createRoom, ['v', true]));
bad('first: v 1e999', 'first', '{"t":"createRoom","v":1e999,"name":"Ada"}');
bad('first: v 2', 'first', edit(createRoom, ['v', 2]), 'version');
bad('first: v 0', 'first', edit(createRoom, ['v', 0]), 'version');
bad('first: v -1', 'first', edit(createRoom, ['v', -1]), 'version');
bad('first: v 2 on joinRoom', 'first', edit(joinRoom, ['v', 2]), 'version');
bad('first: v 2 on reconnect', 'first', edit(reconnect, ['v', 2]), 'version');
bad('first: v 2 beats an unknown t', 'first', '{"t":"nope","v":2}', 'version');
bad('first: v 2 beats a missing t', 'first', '{"v":2}', 'version');
bad('first: v 2 beats a bad name', 'first', edit(createRoom, ['v', 2], ['name', '']), 'version');
bad('first: v 2 beats a session type', 'first', '{"t":"ping","v":2,"id":1}', 'version');
bad('server: welcome with v 2', 'server', edit(welcome, ['v', 2]), 'version');
bad('server: welcome with v 2 and nothing else', 'server', '{"t":"welcome","v":2}', 'version');
bad('server: welcome v missing', 'server', edit(welcome, ['v', undefined]));
bad('server: welcome v as a string', 'server', edit(welcome, ['v', '1']));

// The size limit, in UTF-8 bytes.
const frame = (pad: string): string => `{"t":"ping","id":1,"x":"${pad}"}`;
const room1024 = 1024 - frame('').length;
bad('client: 1025 ASCII bytes', 'client', frame('a'.repeat(room1024 + 1)));
const frameFirst = (pad: string): string => `{"t":"createRoom","v":1,"name":"Ada","x":"${pad}"}`;
bad('first: 1025 ASCII bytes', 'first', frameFirst('a'.repeat(1024 - frameFirst('').length + 1)));
bad('client: 5000 ASCII bytes', 'client', frame('a'.repeat(5000)));
bad('client: 600 two-byte characters, 1200 bytes in 626 units', 'client', frame('é'.repeat(600)));
bad(
  'client: 1025 bytes of two-byte characters',
  'client',
  frame('é'.repeat(Math.floor(room1024 / 2)) + 'a'.repeat(room1024 % 2 + 1)),
);
bad('client: 300 four-byte characters, 1200 bytes in 626 units', 'client', frame('😀'.repeat(300)));
bad(
  'client: 1025 bytes with a four-byte character',
  'client',
  frame('😀'.repeat(Math.floor(room1024 / 4)) + 'a'.repeat(room1024 % 4 + 1)),
);
bad('client: 1025 bytes with a lone surrogate', 'client', frame('a'.repeat(room1024 - 2) + '\ud800'));

// The client's fields.
for (const name of [
  '',
  '   ',
  '\t \n',
  'x'.repeat(17),
  '😀'.repeat(17),
  '\u0007',
  'a\u0007',
  '\u0000',
  '\u001f',
  '\u007f',
  '\u0085',
  '\u009f',
  'A\nB',
  'a\tb',
]) {
  bad(`createRoom: name ${JSON.stringify(name)}`, 'first', edit(createRoom, ['name', name]));
}
for (const name of [5, null, true, ['Ada'], { a: 1 }, undefined]) {
  bad(`createRoom: name ${JSON.stringify(name)}`, 'first', edit(createRoom, ['name', name]));
}
bad('joinRoom: name too long', 'first', edit(joinRoom, ['name', 'x'.repeat(17)]));
bad('joinRoom: name empty', 'first', edit(joinRoom, ['name', '']));
for (const code of ['k7mq2', 'K7MQ', 'K7MQ2A', '', 'O7MQ2', '07MQ2', 'I7MQ2', '17MQ2', 'L7MQ2', 'K7MQ2\n', ' K7MQ2', 'K7M-2']) {
  bad(`joinRoom: roomCode ${JSON.stringify(code)}`, 'first', edit(joinRoom, ['roomCode', code]));
}
bad('joinRoom: roomCode as a number', 'first', edit(joinRoom, ['roomCode', 12345]));
bad('joinRoom: roomCode missing', 'first', edit(joinRoom, ['roomCode', undefined]));
const tokenTail = 'AbCdEfGhIjKlMnOpQr_-01';
for (const [label, token] of [
  ['21 characters after the dot', `K7MQ2.${tokenTail.slice(1)}`],
  ['23 characters after the dot', `K7MQ2.${tokenTail}A`],
  ['no dot', `K7MQ2${tokenTail}`],
  ['a plus', `K7MQ2.${tokenTail.slice(1)}+`],
  ['a slash', `K7MQ2.${tokenTail.slice(1)}/`],
  ['an equals sign', `K7MQ2.${tokenTail.slice(1)}=`],
  ['a lowercase room code', `k7mq2.${tokenTail}`],
  ['a 4 character room code', `K7MQ.${tokenTail}`],
  ['a trailing newline', `K7MQ2.${tokenTail}\n`],
  ['nothing', ''],
] as const) {
  bad(`reconnect: token with ${label}`, 'first', edit(reconnect, ['token', token]));
}
bad('reconnect: token as a number', 'first', edit(reconnect, ['token', 5]));
bad('reconnect: token missing', 'first', edit(reconnect, ['token', undefined]));

bad('select: team C', 'client', edit(select, ['team', 'C']));
bad('select: team lowercase', 'client', edit(select, ['team', 'a']));
bad('select: team null', 'client', edit(select, ['team', null]));
bad('select: team missing', 'client', edit(select, ['team', undefined]));
bad('select: championId empty', 'client', edit(select, ['championId', '']));
bad('select: championId a number', 'client', edit(select, ['championId', 5]));
bad('select: championId missing', 'client', edit(select, ['championId', undefined]));

bad('settings: missing', 'client', edit(settings, ['settings', undefined]));
bad('settings: null', 'client', edit(settings, ['settings', null]));
bad('settings: an array', 'client', edit(settings, ['settings', []]));
bad('settings: teamSize 1', 'client', edit(settings, ['settings.teamSize', 1]));
bad('settings: teamSize 4', 'client', edit(settings, ['settings.teamSize', 4]));
bad('settings: teamSize "2"', 'client', edit(settings, ['settings.teamSize', '2']));
bad('settings: teamSize 2.5', 'client', edit(settings, ['settings.teamSize', 2.5]));
bad('settings: teamSize missing', 'client', edit(settings, ['settings.teamSize', undefined]));
bad('settings: arenaId empty', 'client', edit(settings, ['settings.arenaId', '']));
bad('settings: arenaId a number', 'client', edit(settings, ['settings.arenaId', 2]));
bad('settings: difficulty Hard', 'client', edit(settings, ['settings.difficulty', 'Hard']));
bad('settings: difficulty toString', 'client', edit(settings, ['settings.difficulty', 'toString']));
bad('settings: difficulty missing', 'client', edit(settings, ['settings.difficulty', undefined]));

bad('ready: "true"', 'client', edit(ready, ['ready', 'true']));
bad('ready: 1', 'client', edit(ready, ['ready', 1]));
bad('ready: null', 'client', edit(ready, ['ready', null]));
bad('ready: missing', 'client', edit(ready, ['ready', undefined]));

bad('input: tick -1', 'client', edit(input, ['tick', -1]));
bad('input: tick 1.5', 'client', edit(input, ['tick', 1.5]));
bad('input: tick 1e999', 'client', '{"t":"input","tick":1e999,"input":{"moveX":0,"moveY":0,"aimX":0,"aimY":0,"buttons":0}}');
bad('input: tick 2^53', 'client', edit(input, ['tick', 2 ** 53]));
bad('input: tick "5"', 'client', edit(input, ['tick', '5']));
bad('input: tick null', 'client', edit(input, ['tick', null]));
bad('input: tick missing', 'client', edit(input, ['tick', undefined]));
bad('input: input missing', 'client', edit(input, ['input', undefined]));
bad('input: input null', 'client', edit(input, ['input', null]));
bad('input: input an array', 'client', edit(input, ['input', []]));
for (const axis of ['moveX', 'moveY']) {
  for (const value of [2, -2, 0.5, '1', null, true, undefined]) {
    bad(`input: ${axis} ${JSON.stringify(value)}`, 'client', edit(input, [`input.${axis}`, value]));
  }
}
for (const aim of ['aimX', 'aimY']) {
  for (const value of [100001, -100001, 1.5, '5', null, 1e21, undefined]) {
    bad(`input: ${aim} ${JSON.stringify(value)}`, 'client', edit(input, [`input.${aim}`, value]));
  }
}
bad('input: aimX 1e999', 'client', '{"t":"input","tick":0,"input":{"moveX":0,"moveY":0,"aimX":1e999,"aimY":0,"buttons":0}}');
bad('input: aimY -1e999', 'client', '{"t":"input","tick":0,"input":{"moveX":0,"moveY":0,"aimX":0,"aimY":-1e999,"buttons":0}}');
for (const value of [256, -1, 1.5, 511, '1', null, undefined]) {
  bad(`input: buttons ${JSON.stringify(value)}`, 'client', edit(input, ['input.buttons', value]));
}

bad('ping: id -1', 'client', edit(ping, ['id', -1]));
bad('ping: id 1.5', 'client', edit(ping, ['id', 1.5]));
bad('ping: id "1"', 'client', edit(ping, ['id', '1']));
bad('ping: id 2^53', 'client', edit(ping, ['id', 2 ** 53]));
bad('ping: id 1e999', 'client', '{"t":"ping","id":1e999}');
bad('ping: id missing', 'client', edit(ping, ['id', undefined]));

// The server's fields: scalar ranges only.
for (const seat of [-1, 6, 1.5, '4', null, undefined]) {
  bad(`welcome: seat ${JSON.stringify(seat)}`, 'server', edit(welcome, ['seat', seat]));
}
bad('welcome: roomCode lowercase', 'server', edit(welcome, ['roomCode', 'k7mq2']));
bad('welcome: roomCode 4 characters', 'server', edit(welcome, ['roomCode', 'K7MQ']));
bad('welcome: token with no dot', 'server', edit(welcome, ['token', `K7MQ2${tokenTail}`]));
bad('welcome: token missing', 'server', edit(welcome, ['token', undefined]));
bad('welcome: roster not an array', 'server', edit(welcome, ['roster', 'hargrim']));
bad('welcome: roster with an empty id', 'server', edit(welcome, ['roster.1', '']));
bad('welcome: roster with a number', 'server', edit(welcome, ['roster.1', 5]));
bad('welcome: roster missing', 'server', edit(welcome, ['roster', undefined]));
bad('welcome: arenas not an array', 'server', edit(welcome, ['arenas', {}]));
bad('welcome: arenas with a null', 'server', edit(welcome, ['arenas.0', null]));
bad('welcome: arena id empty', 'server', edit(welcome, ['arenas.0.id', '']));
bad('welcome: arena name a number', 'server', edit(welcome, ['arenas.0.name', 5]));
bad('welcome: arena name missing', 'server', edit(welcome, ['arenas.0.name', undefined]));
for (const size of [1, 4, '2', 2.5, null, undefined]) {
  bad(`welcome: arena maxTeamSize ${JSON.stringify(size)}`, 'server', edit(welcome, ['arenas.1.maxTeamSize', size]));
}

bad('room: roomCode bad', 'server', edit(room, ['roomCode', 'O0O0O']));
bad('room: phase "playing"', 'server', edit(room, ['phase', 'playing']));
bad('room: phase missing', 'server', edit(room, ['phase', undefined]));
for (const seat of [-1, 6, 1.5, '1', null]) {
  bad(`room: hostSeat ${JSON.stringify(seat)}`, 'server', edit(room, ['hostSeat', seat]));
}
bad('room: settings teamSize 4', 'server', edit(room, ['settings.teamSize', 4]));
bad('room: settings arenaId empty', 'server', edit(room, ['settings.arenaId', '']));
bad('room: settings difficulty "x"', 'server', edit(room, ['settings.difficulty', 'x']));
bad('room: settings missing', 'server', edit(room, ['settings', undefined]));
bad('room: seats not an array', 'server', edit(room, ['seats', {}]));
bad('room: seats missing', 'server', edit(room, ['seats', undefined]));
bad('room: 7 seats', 'server', edit(room, ['seats', Array.from({ length: 7 }, (_, seat) => ({ ...room.seats[2], seat: seat % 6 }))]));
bad('room: a seat that is null', 'server', edit(room, ['seats.0', null]));
bad('room: seat 6', 'server', edit(room, ['seats.0.seat', 6]));
bad('room: seat -1', 'server', edit(room, ['seats.0.seat', -1]));
bad('room: seat 0.5', 'server', edit(room, ['seats.0.seat', 0.5]));
bad('room: team "C"', 'server', edit(room, ['seats.0.team', 'C']));
bad('room: team missing', 'server', edit(room, ['seats.0.team', undefined]));
bad('room: kind "ghost"', 'server', edit(room, ['seats.0.kind', 'ghost']));
bad('room: kind missing', 'server', edit(room, ['seats.0.kind', undefined]));
bad('room: seat name 17 code points', 'server', edit(room, ['seats.1.name', 'x'.repeat(17)]));
bad('room: seat name 17 astral code points', 'server', edit(room, ['seats.1.name', '😀'.repeat(17)]));
bad('room: seat name with U+0007', 'server', edit(room, ['seats.1.name', 'a\u0007']));
bad('room: seat name with U+0085', 'server', edit(room, ['seats.1.name', '\u0085']));
bad('room: seat name a number', 'server', edit(room, ['seats.1.name', 5]));
bad('room: seat name missing', 'server', edit(room, ['seats.1.name', undefined]));
bad('room: championId empty', 'server', edit(room, ['seats.1.championId', '']));
bad('room: championId a number', 'server', edit(room, ['seats.1.championId', 5]));
bad('room: championId missing', 'server', edit(room, ['seats.1.championId', undefined]));
bad('room: ready "yes"', 'server', edit(room, ['seats.1.ready', 'yes']));
bad('room: ready missing', 'server', edit(room, ['seats.1.ready', undefined]));
bad('room: connected 1', 'server', edit(room, ['seats.1.connected', 1]));
bad('room: connected missing', 'server', edit(room, ['seats.1.connected', undefined]));

for (const you of [-1, 6, 1.5, '2', null, undefined]) {
  bad(`matchStart: you ${JSON.stringify(you)}`, 'server', edit(matchStart, ['you', you]));
}
bad('matchStart: config missing', 'server', edit(matchStart, ['config', undefined]));
bad('matchStart: config an array', 'server', edit(matchStart, ['config', []]));
bad('matchStart: teamSize 4', 'server', edit(matchStart, ['config.teamSize', 4]));
bad('matchStart: teamSize "2"', 'server', edit(matchStart, ['config.teamSize', '2']));
bad('matchStart: players not an array', 'server', edit(matchStart, ['config.players', {}]));
bad('matchStart: players missing', 'server', edit(matchStart, ['config.players', undefined]));
bad('matchStart: a player that is null', 'server', edit(matchStart, ['config.players.0', null]));
bad('matchStart: player team "C"', 'server', edit(matchStart, ['config.players.0.team', 'C']));
bad('matchStart: player championId empty', 'server', edit(matchStart, ['config.players.0.championId', '']));
bad('matchStart: player championId missing', 'server', edit(matchStart, ['config.players.0.championId', undefined]));
for (const rounds of [0, -1, 1.5, '3', null]) {
  bad(`matchStart: roundsToWin ${JSON.stringify(rounds)}`, 'server', edit(matchStart, ['config.roundsToWin', rounds]));
}
bad('matchStart: roundsToWin 2^53', 'server', edit(matchStart, ['config.roundsToWin', 2 ** 53]));
for (const arena of [null, [], 'arena02', 5, undefined]) {
  bad(`matchStart: arena ${JSON.stringify(arena)}`, 'server', edit(matchStart, ['arena', arena]));
}
for (const kits of [{}, null, 'x', undefined]) {
  bad(`matchStart: kits ${JSON.stringify(kits)}`, 'server', edit(matchStart, ['kits', kits]));
}
for (const value of [2, 6, 4, '3', null, undefined]) {
  bad(`matchStart: snapshotEvery ${JSON.stringify(value)}`, 'server', edit(matchStart, ['snapshotEvery', value]));
}
for (const value of [3, 5, 7, '6', null, undefined]) {
  bad(`matchStart: renderDelay ${JSON.stringify(value)}`, 'server', edit(matchStart, ['renderDelay', value]));
}

for (const tick of [-1, 1.5, '51', null, undefined]) {
  bad(`snapshot: tick ${JSON.stringify(tick)}`, 'server', edit(snapshot, ['tick', tick]));
}
for (const ack of [-2, 1.5, '0', null, undefined]) {
  bad(`snapshot: ack ${JSON.stringify(ack)}`, 'server', edit(snapshot, ['ack', ack]));
}
for (const state of [null, [], 'state', 5, undefined]) {
  bad(`snapshot: state ${JSON.stringify(state)}`, 'server', edit(snapshot, ['state', state]));
}
bad('snapshot: events not an array', 'server', edit(snapshot, ['events', {}]));
bad('snapshot: events missing', 'server', edit(snapshot, ['events', undefined]));
bad('snapshot: a batch that is null', 'server', edit(snapshot, ['events.0', null]));
bad('snapshot: batch tick -1', 'server', edit(snapshot, ['events.0.tick', -1]));
bad('snapshot: batch tick 1.5', 'server', edit(snapshot, ['events.0.tick', 1.5]));
bad('snapshot: batch events not an array', 'server', edit(snapshot, ['events.0.events', {}]));
bad('snapshot: batch events missing', 'server', edit(snapshot, ['events.0.events', undefined]));

bad('matchEnd: winner "C"', 'server', edit(matchEnd, ['winner', 'C']));
bad('matchEnd: winner null', 'server', edit(matchEnd, ['winner', null]));
bad('matchEnd: scoreA -1', 'server', edit(matchEnd, ['scoreA', -1]));
bad('matchEnd: scoreB 1.5', 'server', edit(matchEnd, ['scoreB', 1.5]));
bad('matchEnd: scoreA "1"', 'server', edit(matchEnd, ['scoreA', '1']));
bad('matchEnd: scoreB missing', 'server', edit(matchEnd, ['scoreB', undefined]));

bad('error: code "nope"', 'server', edit(errorMessage, ['code', 'nope']));
bad('error: code "constructor"', 'server', edit(errorMessage, ['code', 'constructor']));
bad('error: code "toString"', 'server', edit(errorMessage, ['code', 'toString']));
bad('error: code missing', 'server', edit(errorMessage, ['code', undefined]));
bad('error: fatal "yes"', 'server', edit(errorMessage, ['fatal', 'yes']));
bad('error: fatal missing', 'server', edit(errorMessage, ['fatal', undefined]));

bad('pong: id -1', 'server', edit(pong, ['id', -1]));
bad('pong: id 1.5', 'server', edit(pong, ['id', 1.5]));
bad('pong: tick -1', 'server', edit(pong, ['tick', -1]));
bad('pong: tick 1.5', 'server', edit(pong, ['tick', 1.5]));
bad('pong: tick missing', 'server', edit(pong, ['tick', undefined]));

describe('the decoders reject', () => {
  it('has a row for every rule', () => {
    expect(rows.length).toBeGreaterThan(300);
  });

  it.each(rows)('%s', (_label, which, text, code) => {
    const result = decoders[which](text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      // The reason is for logs: it names the rule and never repeats the raw value.
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('never throws on any text, whatever the input', () => {
    const texts = ['\u0000', '{"t":', '{"t":"ping","id":-0}', '\ud800', '{}', '{"t":"ping","id":1,"id":2}', '{"t":"ping","id":{}}'];
    for (const text of texts) {
      for (const which of ['first', 'client', 'server'] as const) {
        expect(() => decoders[which](text)).not.toThrow();
      }
    }
    // A value that is not text at all, as a binary frame decoded wrongly would be.
    for (const which of ['first', 'client', 'server'] as const) {
      const result = decoders[which](5 as unknown as string);
      expect(result.ok).toBe(false);
    }
  });

  it('does not echo the raw value of a field in the reason', () => {
    const result = decodeClientMessage(edit(select, ['championId', ['secret-value-xyz']]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain('secret-value-xyz');
    const named = decodeFirstMessage(edit(createRoom, ['name', 'x'.repeat(17) + 'secret-value-xyz']));
    expect(named.ok).toBe(false);
    if (!named.ok) expect(named.reason).not.toContain('secret-value-xyz');
  });

  it('names the field and the rule in the reason', () => {
    const result = decodeClientMessage(edit(input, ['input.aimX', 100001]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('input.aimX');
  });
});
