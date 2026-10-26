import { createBot } from '@claudeline/bots';
import type { Difficulty } from '@claudeline/protocol';
import { checksum, createMatch, step } from '@claudeline/sim';
import type { PlayerInput } from '@claudeline/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { Harness, roomData } from './loopback';
import type { TestClient } from './loopback';

// The headless test of online design section 12: a full 2v2 and a full 3v3 through the codec, with
// bots in the empty seats, on the loopback transport with a manual clock. It pins no end tick, no
// winner and no champion list: the bots change with lane A's work and the roster with the kits, so
// every expectation here is a rule or a comparison with a local run of the same inputs.

const data = roomData();
// Two rounds to win, not the default three: the match still crosses a round boundary, and the file
// runs in under half the time (14 s to 5.5 s locally; the runner took 29 s at three rounds).
const ROUNDS_TO_WIN = 2;

interface Spec {
  name: string;
  arenaId: string;
  teamSize: 2 | 3;
  difficulty: Difficulty;
  /** Whether a second human joins and moves to team B. */
  joiner: boolean;
}

const SPECS: Spec[] = [
  { name: '2v2 on arena01, one human and three bots', arenaId: 'arena01', teamSize: 2, difficulty: 'normal', joiner: false },
  { name: '3v3 on arena02, hard bots, a human on each team', arenaId: 'arena02', teamSize: 3, difficulty: 'hard', joiner: true },
];

interface Played {
  harness: Harness;
  host: TestClient;
  players: TestClient[];
}

function setUp(spec: Spec, entropy: number): Played {
  const harness = new Harness({ entropy, roundsToWin: ROUNDS_TO_WIN });
  const host = harness.client();
  host.create('Ada');
  harness.flush();
  host.send({ t: 'settings', settings: { teamSize: spec.teamSize, arenaId: spec.arenaId, difficulty: spec.difficulty } });
  harness.flush();
  const players = [host];
  if (spec.joiner) {
    const guest = harness.client();
    guest.join('Bo');
    harness.flush();
    guest.send({ t: 'select', team: 'B', championId: data.roster[data.roster.length - 1] ?? '' });
    harness.flush();
    players.push(guest);
  }
  return { harness, host, players };
}

function ready(played: Played): void {
  for (const p of played.players) p.send({ t: 'ready', ready: true });
  played.harness.flush();
}

/** The match to its end: every frame the humans send an input, the clock moves one step, the Room wakes. */
function playOut(played: Played): void {
  const { harness, players } = played;
  const LIMIT = 120_000;
  let frames = 0;
  while (harness.room.phase === 'match' && frames++ < LIMIT) harness.playFrame(players);
  if (harness.room.phase === 'match') throw new Error(`the match did not end in ${LIMIT} frames`);
}

function play(spec: Spec, entropy: number): Played {
  const played = setUp(spec, entropy);
  ready(played);
  playOut(played);
  return played;
}

/** The first tick at which a local run of the same inputs and seed leaves the server's checksum, or null. */
function firstDivergence(played: Played, arenaId: string, difficulty: Difficulty): number | null {
  const { observed } = played.harness;
  const { config, seed } = observed;
  if (config === null || seed === null || observed.matchEndedAt === null) throw new Error('no match was observed');
  const def = data.arenas.find((a) => a.id === arenaId);
  if (def === undefined) throw new Error('arena missing');
  const local = createMatch(config, def, seed, data.kits);
  const humanIds = new Set(played.players.map((p) => p.start?.you ?? -1));
  const bots = local.champions.map((c) => (humanIds.has(c.id) ? undefined : createBot(c.id, difficulty, seed * 100 + c.id)));
  for (let tick = 1; tick <= observed.matchEndedAt; tick++) {
    const recorded = observed.inputs.get(tick);
    const inputs: (PlayerInput | undefined)[] = local.champions.map((c) => {
      const bot = bots[c.id];
      return bot === undefined ? recorded?.[c.id] : bot.think(local);
    });
    step(local, inputs);
    if (checksum(local) !== observed.checksums.get(tick)) return tick;
  }
  return null;
}

// Runner (ubuntu-latest, Node 22) at three rounds, 779e504 (job 121633905207): the two matches of
// a beforeAll took about 11 s, the two local-reference rows 3.9 s and 2.6 s, the file 28.7 s. At
// two rounds the local times are 4.7 s for the beforeAll (8.2 s at three) and 0.7 s and 0.5 s for
// the rows (1.4 s and 1.5 s), on an Apple M5 Pro with Node 22.23.2; the runner has not timed the
// two-round file yet. Timeouts (testing.md, Check suite): 10 s for the rows, twice 3.9 s is 7.8 s;
// 20 s for the beforeAll, which the rule allows for a runner time up to 10 s, and the shorter match
// should take about half of the 11 s. Rescan when a runner has timed this file.
describe.each(SPECS)('loopback: $name', { timeout: 10_000 }, (spec) => {
  let first: Played;
  let second: Played;

  beforeAll(() => {
    first = play(spec, 1);
    second = play(spec, 1);
  }, 20_000);

  it('plays to a result: a final snapshot, matchEnd, then the lobby', () => {
    const { harness, players } = first;
    expect(harness.observed.matchEndedAt).not.toBeNull();
    for (const p of players) {
      const types = p.inbox.map((m) => m.t);
      const end = types.lastIndexOf('matchEnd');
      expect(types[end - 1]).toBe('snapshot');
      expect(types.slice(end)).toEqual(['matchEnd', 'room']);
      expect(p.of('snapshot').at(-1)?.tick).toBe(harness.observed.matchEndedAt);
      const ended = harness.observed.events.get(harness.observed.matchEndedAt ?? -1)?.find((e) => e.type === 'matchEnded');
      expect(ended).toBeDefined();
      const message = p.of('matchEnd')[0];
      if (ended?.type !== 'matchEnded') throw new Error('no matchEnded event');
      expect(message).toEqual({ t: 'matchEnd', winner: ended.winner, scoreA: ended.scoreA, scoreB: ended.scoreB });
    }
  });

  it('returns to a lobby with ready reset, the bots cleared and the humans seated', () => {
    const room = first.host.room();
    expect(room.phase).toBe('lobby');
    expect(room.settings).toEqual({ teamSize: spec.teamSize, arenaId: spec.arenaId, difficulty: spec.difficulty });
    expect(room.seats.filter((s) => s.kind === 'bot')).toHaveLength(0);
    expect(room.seats.filter((s) => s.kind === 'human')).toHaveLength(first.players.length);
    expect(room.seats.every((s) => !s.ready)).toBe(true);
    expect(room.seats).toHaveLength(2 * spec.teamSize);
  });

  it('rebuilds the server checksum from every snapshot, through the codec', () => {
    const { observed } = first.harness;
    const end = observed.matchEndedAt ?? 0;
    const expected = Math.floor(end / 3) + (end % 3 === 0 ? 0 : 1);
    for (const p of first.players) {
      expect(p.rebuilt).toHaveLength(expected);
      expect(p.rebuilt.length).toBeGreaterThan(100);
      for (const { tick, checksum: rebuilt } of p.rebuilt) {
        expect(rebuilt, `checksum at tick ${tick}`).toBe(observed.checksums.get(tick));
      }
    }
  });

  it('carries the events of every tick exactly once, in tick order', () => {
    const { observed } = first.harness;
    const ticks = [...observed.events.keys()].sort((a, b) => a - b);
    expect(ticks.length).toBeGreaterThan(10);
    for (const p of first.players) {
      expect(p.batches.map((b) => b.tick)).toEqual(ticks);
      for (const batch of p.batches) expect(batch.events).toEqual(observed.events.get(batch.tick));
    }
  });

  it('fills the empty seats with bots, team A first, with champions by the rule', () => {
    const { host, players } = first;
    const room = host.of('room').find((r) => r.phase === 'match');
    if (room === undefined || host.welcome === null) throw new Error('no match room message');
    const roster = host.welcome.roster;
    const humans = room.seats.filter((s) => s.kind === 'human');
    expect(humans).toHaveLength(players.length);
    expect(room.seats.filter((s) => s.kind === 'bot')).toHaveLength(2 * spec.teamSize - players.length);

    // Champion ids: team A seats in seat order, then team B.
    const order = [
      ...room.seats.filter((s) => s.team === 'A'),
      ...room.seats.filter((s) => s.team === 'B'),
    ];
    expect(order).toHaveLength(2 * spec.teamSize);
    expect(room.seats.filter((s) => s.team === 'A')).toHaveLength(spec.teamSize);
    let bot = 0;
    order.forEach((seat, id) => {
      if (seat.kind === 'bot') {
        expect(seat.championId, `the champion of bot seat ${seat.seat}`).toBe(roster[bot % roster.length]);
        bot++;
      }
      expect(first.harness.observed.config?.players[id]).toEqual({ championId: seat.championId, team: seat.team });
    });
    // Each human's id is the position of their seat in that order.
    for (const p of players) {
      expect(order[p.start?.you ?? -1]?.seat).toBe(p.welcome?.seat);
    }
    if (spec.joiner) {
      expect(players[1]?.start?.you).not.toBe(0);
      expect(new Set(players.map((p) => room.seats[p.welcome?.seat ?? 0]?.team)).size).toBe(2);
    }
  });

  it('matches a local sim of the same seed, kits and inputs at every tick, bots as the rule says', () => {
    expect(firstDivergence(first, spec.arenaId, spec.difficulty)).toBeNull();
  });

  it('is not vacuous: a local run with the bots at another tier diverges', () => {
    const other: Difficulty = spec.difficulty === 'easy' ? 'normal' : 'easy';
    expect(firstDivergence(first, spec.arenaId, other)).not.toBeNull();
  });

  it('is not vacuous: the humans had inputs applied and the bots were driven', () => {
    const { observed } = first.harness;
    const ids = first.players.map((p) => p.start?.you ?? -1);
    const mid = Math.floor((observed.matchEndedAt ?? 0) / 2);
    const inputs = observed.inputs.get(mid) ?? [];
    for (const id of ids) expect(inputs[id]).toBeDefined();
    expect(inputs.filter((i) => i !== undefined)).toHaveLength(2 * spec.teamSize);
    expect(first.players[0]?.of('snapshot').some((s) => s.ack > 0)).toBe(true);
  });

  it('plays the same match twice: the same bytes in both directions, the same checksums', () => {
    expect(second.harness.digest()).toBe(first.harness.digest());
    expect([...second.harness.observed.checksums]).toEqual([...first.harness.observed.checksums]);
  });

  it('is not vacuous: other entropy gives another digest, tokens and seed alike', () => {
    const a = setUp(spec, 1);
    const b = setUp(spec, 2);
    ready(a);
    ready(b);
    expect(a.harness.observed.seed).not.toBe(b.harness.observed.seed);
    expect(a.harness.digest()).toMatch(/^[0-9a-f]{64}$/);
    expect(a.harness.digest()).not.toBe(b.harness.digest());
  });
});
