import { SNAPSHOT_EVERY } from '@claudeline/protocol';
import type { SimEvent } from '@claudeline/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRoomData } from '../src/data';
import type { RoomData } from '../src/data';
import { Harness, roomData } from './loopback';
import type { TestClient } from './loopback';

// The energy orb through the Room and the codec (online design section 5, Data; rules.md 3.3): the
// Room sets `energyOrb` from its data, `matchStart` carries it to both clients, and `orbSpawn` and
// `orbTaken` reach both of them at the server's tick. One human walks to the orb point, the other
// stands still. It pins no tick and no taker: the bots change, and the first pickup may fall in a
// later round.

const ARENA_ID = 'arena01';
const LIMIT_FRAMES = 20_000;

interface Played {
  harness: Harness;
  host: TestClient;
  guest: TestClient;
  /** The tick of the first `orbTaken` the server stepped, or null. */
  takenAt: number | null;
}

function setUp(data: RoomData): Played {
  const harness = new Harness({ entropy: 3, data });
  const host = harness.client();
  host.create('Ada');
  harness.flush();
  host.send({ t: 'settings', settings: { teamSize: 2, arenaId: ARENA_ID, difficulty: 'normal' } });
  harness.flush();
  const guest = harness.client();
  guest.join('Bo');
  harness.flush();
  guest.send({ t: 'select', team: 'B', championId: data.roster[0] ?? '' });
  harness.flush();
  for (const p of [host, guest]) p.send({ t: 'ready', ready: true });
  harness.flush();
  return { harness, host, guest, takenAt: null };
}

function orbEvents(events: readonly SimEvent[]): SimEvent[] {
  return events.filter((e) => e.type === 'orbSpawn' || e.type === 'orbTaken');
}

/** Plays until the first snapshot on or after the first `orbTaken`, or until the limit. */
function playToThePickup(played: Played, walkTo: { x: number; y: number } | undefined): void {
  const { harness, host, guest } = played;
  let frames = 0;
  while (harness.room.phase === 'match' && frames++ < LIMIT_FRAMES) {
    if (walkTo !== undefined) host.sendWalkTo(walkTo);
    harness.flush();
    harness.frame();
    if (played.takenAt === null) {
      for (const [tick, events] of harness.observed.events) {
        if (events.some((e) => e.type === 'orbTaken')) played.takenAt = Math.min(played.takenAt ?? tick, tick);
      }
    } else if (guest.rebuilt.some((r) => r.tick >= (played.takenAt ?? 0))) {
      break;
    }
  }
}

// The play is one hook, 2.4 s locally with the non-vacuous row; the runner is 3 to 4 times slower (the
// loopback files of this folder), so the hook takes the 20 s top of the rule (testing.md, Check suite).
describe('loopback: the energy orb', () => {
  const data = roomData();
  const point = data.orbs.get(ARENA_ID);
  let played: Played;
  let harness: Harness;
  let host: TestClient;
  let guest: TestClient;

  beforeAll(() => {
    played = setUp(data);
    playToThePickup(played, point);
    ({ harness, host, guest } = played);
  }, 20_000);

  it('is set up with the arena01 point from the table', () => {
    expect(point).toEqual({ x: 0, y: 2.5 });
  });

  it('sends the orb point in the config of matchStart, to both clients, as the Room built the match', () => {
    expect(host.start?.config.energyOrb).toEqual(point);
    expect(guest.start?.config.energyOrb).toEqual(point);
    expect(harness.observed.config?.energyOrb).toEqual(point);
  });

  it('delivers orbSpawn and orbTaken once each in the round of the pickup, equal to the server copies', () => {
    expect(played.takenAt).not.toBeNull();
    const takenAt = played.takenAt ?? 0;
    const taken = harness.observed.events.get(takenAt)?.find((e) => e.type === 'orbTaken');
    if (taken?.type !== 'orbTaken') throw new Error('no orbTaken');
    const spawnTick = [...harness.observed.events]
      .filter(([, events]) => events.some((e) => e.type === 'orbSpawn' && e.round === taken.round))
      .map(([tick]) => tick);
    expect(spawnTick).toHaveLength(1);
    expect(spawnTick[0]).toBeLessThan(takenAt);
    for (const client of [host, guest]) {
      const inRound = (e: SimEvent): boolean => (e.type === 'orbSpawn' || e.type === 'orbTaken') && e.round === taken.round;
      const received = client.batches.flatMap((b) => b.events.filter(inRound).map((e) => ({ tick: b.tick, e })));
      expect(received.map((r) => r.e.type)).toEqual(['orbSpawn', 'orbTaken']);
      expect(received.map((r) => r.tick)).toEqual([spawnTick[0], takenAt]);
      expect(received[1]?.e).toEqual(taken);
      expect(received[0]?.e).toEqual(harness.observed.events.get(spawnTick[0] ?? -1)?.find((e) => e.type === 'orbSpawn'));
    }
  });

  it('rebuilds a state after the pickup with the orb taken and the taker energy of the event', () => {
    const takenAt = played.takenAt ?? 0;
    const taken = harness.observed.events.get(takenAt)?.find((e) => e.type === 'orbTaken');
    if (taken?.type !== 'orbTaken') throw new Error('no orbTaken');
    for (const client of [host, guest]) {
      // The play stopped at the first snapshot on or after the pickup, so the newest state is that one.
      expect(client.state?.tick).toBeGreaterThanOrEqual(takenAt);
      expect(client.state?.tick).toBeLessThan(takenAt + SNAPSHOT_EVERY);
      expect(client.state?.match?.orb).toEqual({ x: point?.x, y: point?.y, taken: true });
      expect(client.state?.champions[taken.championId]?.energy).toBe(taken.energy);
    }
  });

  it('rebuilds the server checksum at every snapshot with the orb on', () => {
    for (const client of [host, guest]) {
      expect(client.rebuilt.length).toBeGreaterThan(300);
      for (const { tick, checksum } of client.rebuilt) {
        expect(checksum, `checksum at tick ${tick}`).toBe(harness.observed.checksums.get(tick));
      }
    }
  });

  it('is not vacuous: data with no row for the arena gives no energyOrb key and no orb events', { timeout: 15_000 }, () => {
    const bare: RoomData = { ...loadRoomData(), orbs: new Map() };
    const off = setUp(bare);
    playToThePickup(off, { x: 0, y: 2.5 });
    expect(off.host.start).not.toBeNull();
    expect(Object.hasOwn(off.host.start?.config ?? {}, 'energyOrb')).toBe(false);
    expect(Object.hasOwn(off.harness.observed.config ?? {}, 'energyOrb')).toBe(false);
    expect(off.takenAt).toBeNull();
    expect(off.host.batches.flatMap((b) => orbEvents(b.events))).toEqual([]);
  });
});
