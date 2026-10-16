import {
  createMatch,
  debug,
  parseArenaDef,
  step,
  type GameState,
  type ProjectileEndReason,
  type SimEvent,
  type TeamId,
} from '@claudeline/sim';
import type { Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { PROJECTILE_ALLY_COLOUR, PROJECTILE_ENEMY_COLOUR } from './entity-views';
import {
  CombatFeedback,
  FLASH_TICKS,
  flashText,
  flashTexts,
  routeEvents,
  type FeedbackHandlers,
} from './feedback';
import { RING_COLOUR, createImpactRings } from './impact-rings';
import { createKillFeed } from './kill-feed';

/** Champions 0 and 1 on team A, 2 and 3 on team B, like the real 2v2. */
const TEAMS_2V2: readonly { readonly team: TeamId }[] = [{ team: 'A' }, { team: 'A' }, { team: 'B' }, { team: 'B' }];

interface Call {
  kind: string;
  args: number[];
}

function recorder(): { handlers: FeedbackHandlers; calls: Call[]; records: SimEvent[] } {
  const calls: Call[] = [];
  // The event records the hit and expire handlers were given, in call order.
  const records: SimEvent[] = [];
  const handlers: FeedbackHandlers = {
    damage: (tick, targetId) => calls.push({ kind: 'damage', args: [tick, targetId] }),
    hit: (tick, event) => {
      calls.push({ kind: 'hit', args: [tick, event.x, event.y] });
      records.push(event);
    },
    expire: (tick, event) => {
      calls.push({ kind: 'expire', args: [tick, event.x, event.y] });
      records.push(event);
    },
    death: (tick, targetId, sourceId) => calls.push({ kind: 'death', args: [tick, targetId, sourceId] }),
  };
  return { handlers, calls, records };
}

function fakeState(tick: number, events: SimEvent[]): GameState {
  return { tick, events } as GameState;
}

function expired(reason: ProjectileEndReason): SimEvent {
  return { type: 'projectileExpired', projectileId: 9, reason, x: 1, y: 2 };
}

describe('routeEvents', () => {
  it('routes damage, hit and death with the current tick', () => {
    const { handlers, calls } = recorder();
    routeEvents(
      fakeState(40, [
        { type: 'projectileHit', projectileId: 9, ownerId: 0, targetId: 2, x: 5, y: 6 },
        { type: 'damage', targetId: 2, sourceId: 0, amount: 30, health: 90 },
        { type: 'death', targetId: 2, sourceId: 0 },
      ]),
      handlers,
    );
    expect(calls).toEqual([
      { kind: 'hit', args: [40, 5, 6] },
      { kind: 'damage', args: [40, 2] },
      { kind: 'death', args: [40, 2, 0] },
    ]);
  });

  it('passes the event records themselves to hit and expire, not copies', () => {
    const { handlers, records } = recorder();
    const hit: SimEvent = { type: 'projectileHit', projectileId: 9, ownerId: 0, targetId: 2, x: 5, y: 6 };
    const end = expired('lifetime');
    routeEvents(fakeState(7, [hit, end]), handlers);
    expect(records).toHaveLength(2);
    expect(records[0]).toBe(hit);
    expect(records[1]).toBe(end);
  });

  it.each(['obstacle', 'boundary', 'lifetime'] as const)('rings for a %s expiry', (reason) => {
    const { handlers, calls } = recorder();
    routeEvents(fakeState(7, [expired(reason)]), handlers);
    expect(calls).toEqual([{ kind: 'expire', args: [7, 1, 2] }]);
  });

  it('gives no ring for the expiry that repeats a hit', () => {
    const { handlers, calls } = recorder();
    routeEvents(
      fakeState(7, [
        { type: 'projectileHit', projectileId: 9, ownerId: 0, targetId: 2, x: 1, y: 2 },
        expired('hit'),
      ]),
      handlers,
    );
    expect(calls.map((call) => call.kind)).toEqual(['hit']);
  });

  it('gives no ring for a shot that ended with the round', () => {
    const { handlers, calls } = recorder();
    routeEvents(fakeState(7, [expired('roundEnd')]), handlers);
    expect(calls).toEqual([]);
  });

  it('ignores heal, areaTick and the spawn and area events', () => {
    const { handlers, calls } = recorder();
    routeEvents(
      fakeState(7, [
        { type: 'heal', targetId: 1, sourceId: 0, amount: 5, health: 100 },
        { type: 'areaTick', areaId: 4, targetIds: [1] },
        { type: 'areaSpawned', areaId: 4, ownerId: 0, x: 0, y: 0, radius: 1 },
        { type: 'areaExpired', areaId: 4 },
        { type: 'projectileSpawned', projectileId: 9, ownerId: 0, x: 0, y: 0, vx: 1, vy: 0, radius: 0.25 },
      ]),
      handlers,
    );
    expect(calls).toEqual([]);
  });
});

describe('combat feedback', () => {
  it('flashes for exactly FLASH_TICKS ticks from the tick of the damage', () => {
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', createImpactRings(), createKillFeed());
    feedback.damage(100, 2);
    expect(FLASH_TICKS).toBe(8);
    let flashing = 0;
    for (let tick = 100; tick < 120; tick++) if (feedback.isFlashing(2, tick)) flashing++;
    expect(flashing).toBe(FLASH_TICKS);
    expect(feedback.isFlashing(2, 100 + FLASH_TICKS - 1)).toBe(true);
    expect(feedback.isFlashing(2, 100 + FLASH_TICKS)).toBe(false);
    expect(feedback.isFlashing(1, 100)).toBe(false);
  });

  it('restarts the flash on a second hit', () => {
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', createImpactRings(), createKillFeed());
    feedback.damage(100, 2);
    feedback.damage(105, 2);
    expect(feedback.isFlashing(2, 112)).toBe(true);
    expect(feedback.isFlashing(2, 113)).toBe(false);
  });

  it('counts hits and deaths', () => {
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', createImpactRings(), createKillFeed());
    feedback.hit(1, { type: 'projectileHit', projectileId: 1, ownerId: 0, targetId: 2, x: 0, y: 0 });
    feedback.hit(1, { type: 'projectileHit', projectileId: 1, ownerId: 0, targetId: 2, x: 0, y: 0 });
    feedback.death(1, 2, 0);
    expect([feedback.hits, feedback.deaths]).toEqual([2, 1]);
  });

  it('pushes a death onto the kill feed as killer then victim', () => {
    const feed = createKillFeed();
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', createImpactRings(), feed);
    feedback.death(40, 2, 0);
    expect(feed.count).toBe(1);
    expect(feed.line(0)).toEqual({ tick: 40, killerId: 0, victimId: 2 });
  });

  it('lists flashing ids as a mask and as text', () => {
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', createImpactRings(), createKillFeed());
    expect(feedback.flashMask(100)).toBe(0);
    feedback.damage(100, 2);
    feedback.damage(100, 0);
    expect(feedback.flashMask(100)).toBe(0b101);
    expect(flashText(0b101)).toBe('0,2');
    expect(flashText(0)).toBe('');
  });

  it('tables the flash text of every mask for the champion count, equal to flashText', () => {
    for (const count of [1, 2, 4]) {
      const table = flashTexts(count);
      expect(table).toHaveLength(2 ** count);
      for (let mask = 0; mask < table.length; mask++) expect(table[mask], `${count} champions, mask ${mask}`).toBe(flashText(mask));
    }
    expect(flashTexts(4)[0b101]).toBe('0,2');
    expect(flashTexts(4)[0b1111]).toBe('0,1,2,3');
  });

  it('ignores a champion id it does not know', () => {
    const feedback = new CombatFeedback(TEAMS_2V2.slice(0, 2), 'A', createImpactRings(), createKillFeed());
    expect(() => feedback.damage(1, 9)).not.toThrow();
    expect(feedback.isFlashing(9, 1)).toBe(false);
  });
});

describe('the ring of a projectile hit', () => {
  function hitEvent(ownerId: number, targetId: number, x = 3, y = 4): SimEvent {
    return { type: 'projectileHit', projectileId: 9, ownerId, targetId, x, y };
  }

  function make(localTeam: TeamId) {
    const rings = createImpactRings();
    const feedback = new CombatFeedback(TEAMS_2V2, localTeam, rings, createKillFeed());
    const colours = (): string[] =>
      (rings.group.children as Mesh[])
        .filter((mesh) => mesh.visible)
        .map((mesh) => `#${(mesh.material as MeshBasicMaterial).color.getHexString()}`);
    return { rings, feedback, colours };
  }

  it('is yellow for a hit on an enemy, as before', () => {
    const { feedback, colours } = make('A');
    routeEvents(fakeState(5, [hitEvent(0, 2)]), feedback);
    expect(colours()).toEqual([RING_COLOUR]);
    expect(feedback.hits).toBe(1);
  });

  it('is in the ally projectile colour for a hit on an ally of the local team, and still counts as a hit', () => {
    const { rings, feedback, colours } = make('A');
    routeEvents(fakeState(5, [hitEvent(0, 1)]), feedback);
    expect(colours()).toEqual([PROJECTILE_ALLY_COLOUR]);
    expect(feedback.hits).toBe(1);
    expect(rings.visibleCount).toBe(1);
  });

  it('is in the enemy projectile colour for a hit between two champions of the other team', () => {
    const { feedback, colours } = make('A');
    routeEvents(fakeState(5, [hitEvent(2, 3)]), feedback);
    expect(colours()).toEqual([PROJECTILE_ENEMY_COLOUR]);
    expect(feedback.hits).toBe(1);
  });

  it('takes the colour of the owner team, so it follows the local team', () => {
    const { feedback, colours } = make('B');
    routeEvents(fakeState(5, [hitEvent(0, 1), hitEvent(2, 3)]), feedback);
    expect(colours()).toEqual([PROJECTILE_ENEMY_COLOUR, PROJECTILE_ALLY_COLOUR]);
  });

  it('turns yellow again when an enemy hit recycles the slot of a heal ring', () => {
    const { rings, feedback, colours } = make('A');
    for (let i = 0; i < 16; i++) routeEvents(fakeState(5, [hitEvent(0, 1)]), feedback);
    expect(colours()).toEqual(Array.from({ length: 16 }, () => PROJECTILE_ALLY_COLOUR));
    routeEvents(fakeState(6, [hitEvent(0, 2)]), feedback);
    expect(colours()).toEqual([RING_COLOUR, ...Array.from({ length: 15 }, () => PROJECTILE_ALLY_COLOUR)]);
    expect(rings.visibleCount).toBe(16);
  });

  it('is yellow when the sim names a champion the feedback does not know', () => {
    const { feedback, colours } = make('A');
    routeEvents(fakeState(5, [hitEvent(0, 9), hitEvent(9, 1)]), feedback);
    expect(colours()).toEqual([RING_COLOUR, RING_COLOUR]);
    expect(feedback.hits).toBe(2);
  });

  it('is in the ally projectile colour for a real heal bolt that lands on a teammate', () => {
    const state = createMatch(
      {
        teamSize: 2,
        players: [
          { championId: 'a', team: 'A' },
          { championId: 'b', team: 'A' },
          { championId: 'c', team: 'B' },
          { championId: 'd', team: 'B' },
        ],
      },
      parseArenaDef(arena01Json),
      1,
    );
    const mate = state.champions[1];
    if (!mate) throw new Error('no teammate');
    debug.spawnProjectile(state, {
      ownerId: 0,
      x: mate.x - 3,
      y: mate.y,
      dirX: 1,
      dirY: 0,
      speed: 10,
      radius: 0.25,
      lifetimeTicks: 180,
      pierce: false,
      effects: [],
      allyEffects: [{ type: 'heal', amount: 5 }],
    });
    const rings = createImpactRings();
    const feedback = new CombatFeedback(state.champions, 'A', rings, createKillFeed());
    for (let i = 0; i < 60; i++) {
      step(state, []);
      routeEvents(state, feedback);
    }
    expect(feedback.hits).toBe(1);
    const lit = (rings.group.children as Mesh[]).filter((mesh) => mesh.visible);
    expect(lit.map((mesh) => `#${(mesh.material as MeshBasicMaterial).color.getHexString()}`)).toEqual([
      PROJECTILE_ALLY_COLOUR,
    ]);
  });
});

// Real events from the real sim, so the routing matches what the sim emits.
describe('routing real sim events', () => {
  function match(): GameState {
    return createMatch(
      {
        teamSize: 2,
        players: [
          { championId: 'a', team: 'A' },
          { championId: 'b', team: 'A' },
          { championId: 'c', team: 'B' },
          { championId: 'd', team: 'B' },
        ],
      },
      parseArenaDef(arena01Json),
      1,
    );
  }

  function shoot(state: GameState, x: number, y: number, dirX: number, dirY: number, lifetime = 180): void {
    debug.spawnProjectile(state, {
      ownerId: 0,
      x,
      y,
      dirX,
      dirY,
      speed: 10,
      radius: 0.25,
      lifetimeTicks: lifetime,
      pierce: false,
      effects: [{ type: 'damage', amount: 30 }],
    });
  }

  function run(state: GameState, ticks: number, feed = createKillFeed()): CombatFeedback {
    const rings = createImpactRings();
    const feedback = new CombatFeedback(state.champions, 'A', rings, feed);
    for (let i = 0; i < ticks; i++) {
      step(state, []);
      routeEvents(state, feedback);
    }
    return feedback;
  }

  // The rings keep the sim's event record until their draw reads it, so the sim must
  // never write to a record after pushing it, and spawn must not share one between rings.
  it('draws each ring at its own hit point after the sim has stepped on', () => {
    const state = match();
    shoot(state, 10, 2, 1, 0);
    shoot(state, 10, -2, 1, 0);
    const rings = createImpactRings();
    const feedback = new CombatFeedback(state.champions, 'A', rings, createKillFeed());
    const hits: { x: number; y: number }[] = [];
    for (let i = 0; i < 30 && hits.length < 2; i++) {
      step(state, []);
      for (const event of state.events) if (event.type === 'projectileHit') hits.push({ x: event.x, y: event.y });
      routeEvents(state, feedback);
    }
    expect(hits).toHaveLength(2);
    expect(hits[0]?.y).not.toBe(hits[1]?.y);
    // A few more ticks, then draw while the rings still live.
    for (let i = 0; i < 4; i++) {
      step(state, []);
      routeEvents(state, feedback);
    }
    rings.draw(state.tick, { alpha: 0 });
    const shown = (rings.group.children as Mesh[]).filter((mesh) => mesh.visible);
    expect(shown.map((mesh) => [mesh.position.x, mesh.position.z])).toEqual(
      hits.map((hit) => [hit.x, -hit.y]),
    );
  });

  it('makes one ring, one hit and one flash for a projectile that hits', () => {
    const state = match();
    shoot(state, 10, 2, 1, 0);
    const rings = createImpactRings();
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', rings, createKillFeed());
    let flashAtHit = -1;
    for (let i = 0; i < 30; i++) {
      step(state, []);
      routeEvents(state, feedback);
      if (feedback.hits === 1 && flashAtHit < 0) flashAtHit = feedback.flashMask(state.tick);
    }
    expect(feedback.hits).toBe(1);
    expect(rings.visibleCount).toBe(1);
    expect(flashAtHit).toBe(0b100);
    expect(state.projectiles).toHaveLength(0);
  });

  it.each([
    ['lifetime', 10, 2, 1, 0, 3],
    ['boundary', 14, -6, 1, 0, 180],
    ['obstacle', -12, -5, 1, 0, 180],
  ])('makes one ring for a %s expiry and no hit', (_name, x, y, dirX, dirY, lifetime) => {
    const state = match();
    shoot(state, x as number, y as number, dirX as number, dirY as number, lifetime as number);
    const rings = createImpactRings();
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', rings, createKillFeed());
    for (let i = 0; i < 60; i++) {
      step(state, []);
      routeEvents(state, feedback);
    }
    expect(feedback.hits).toBe(0);
    expect(rings.visibleCount).toBe(1);
  });

  it('counts a death once the fourth hit lands', () => {
    const state = match();
    for (let i = 0; i < 4; i++) shoot(state, 10 - 0.001 * i, 2, 1, 0);
    const feed = createKillFeed();
    const feedback = run(state, 40, feed);
    expect(feedback.hits).toBe(4);
    expect(feedback.deaths).toBe(1);
    expect(feed.count).toBe(1);
    expect(feed.line(0)).toMatchObject({ killerId: 0, victimId: 2 });
  });
});

// The deciding step of a round: the last death, `roundEnded`, and every shot
// still flying ends with the reason `roundEnd` (simulation.md, match flow).
describe('routing the end of a round', () => {
  function roundMatch(): GameState {
    const state = createMatch(
      {
        teamSize: 2,
        players: [
          { championId: 'a', team: 'A' },
          { championId: 'b', team: 'A' },
          { championId: 'c', team: 'B' },
          { championId: 'd', team: 'B' },
        ],
        roundsToWin: 3,
      },
      parseArenaDef(arena01Json),
      1,
    );
    // The warmup locks the champions for 180 steps.
    for (let i = 0; i < 180; i++) step(state, []);
    return state;
  }

  function shoot(state: GameState, ownerId: number, x: number, y: number): void {
    debug.spawnProjectile(state, {
      ownerId,
      x,
      y,
      dirX: 1,
      dirY: 0,
      speed: 10,
      radius: 0.25,
      lifetimeTicks: 180,
      pierce: false,
      effects: [{ type: 'damage', amount: 30 }],
    });
  }

  it('rings once per hit and leaves the shots that end with the round without a ring', () => {
    const state = roundMatch();
    expect(state.match?.phase).toBe('round');
    // Four hits kill each enemy: champion 0 shoots champion 2 and champion 1
    // shoots champion 3. Two more shots are far behind, still in flight when
    // the second death decides the round.
    for (let i = 0; i < 4; i++) {
      shoot(state, 0, 10 - 0.001 * i, 2);
      shoot(state, 1, 10 - 0.001 * i, -2);
    }
    shoot(state, 0, -5, 2);
    shoot(state, 1, -5, -2);

    const rings = createImpactRings();
    const feed = createKillFeed();
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', rings, feed);
    let endedWithRound = 0;
    for (let i = 0; i < 40; i++) {
      step(state, []);
      for (const event of state.events) {
        if (event.type === 'projectileExpired' && event.reason === 'roundEnd') endedWithRound++;
      }
      routeEvents(state, feedback);
    }

    expect(state.match?.phase).toBe('roundEnd');
    expect(endedWithRound, 'two shots were still in flight when the round was decided').toBe(2);
    expect(feedback.hits).toBe(8);
    expect(feedback.deaths).toBe(2);
    expect(feed.count).toBe(2);
    expect([feed.line(0), feed.line(1)]).toEqual([
      expect.objectContaining({ killerId: 0, victimId: 2 }),
      expect.objectContaining({ killerId: 1, victimId: 3 }),
    ]);
    expect(rings.visibleCount, 'one ring per hit and none for the two roundEnd expiries').toBe(8);
  });
});
