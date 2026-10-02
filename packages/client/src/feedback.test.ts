import {
  createMatch,
  debug,
  parseArenaDef,
  step,
  type GameState,
  type ProjectileEndReason,
  type SimEvent,
} from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import {
  CombatFeedback,
  FLASH_TICKS,
  flashText,
  routeEvents,
  type FeedbackHandlers,
} from './feedback';
import { createImpactRings } from './impact-rings';

interface Call {
  kind: string;
  args: number[];
}

function recorder(): { handlers: FeedbackHandlers; calls: Call[] } {
  const calls: Call[] = [];
  const handlers: FeedbackHandlers = {
    damage: (tick, targetId) => calls.push({ kind: 'damage', args: [tick, targetId] }),
    hit: (tick, x, y) => calls.push({ kind: 'hit', args: [tick, x, y] }),
    expire: (tick, x, y) => calls.push({ kind: 'expire', args: [tick, x, y] }),
    death: (tick, targetId, sourceId) => calls.push({ kind: 'death', args: [tick, targetId, sourceId] }),
  };
  return { handlers, calls };
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
    const feedback = new CombatFeedback(4, createImpactRings());
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
    const feedback = new CombatFeedback(4, createImpactRings());
    feedback.damage(100, 2);
    feedback.damage(105, 2);
    expect(feedback.isFlashing(2, 112)).toBe(true);
    expect(feedback.isFlashing(2, 113)).toBe(false);
  });

  it('counts hits and deaths', () => {
    const feedback = new CombatFeedback(4, createImpactRings());
    feedback.hit(1, 0, 0);
    feedback.hit(1, 0, 0);
    feedback.death();
    expect([feedback.hits, feedback.deaths]).toEqual([2, 1]);
  });

  it('lists flashing ids as a mask and as text', () => {
    const feedback = new CombatFeedback(4, createImpactRings());
    expect(feedback.flashMask(100)).toBe(0);
    feedback.damage(100, 2);
    feedback.damage(100, 0);
    expect(feedback.flashMask(100)).toBe(0b101);
    expect(flashText(0b101)).toBe('0,2');
    expect(flashText(0)).toBe('');
  });

  it('ignores a champion id it does not know', () => {
    const feedback = new CombatFeedback(2, createImpactRings());
    expect(() => feedback.damage(1, 9)).not.toThrow();
    expect(feedback.isFlashing(9, 1)).toBe(false);
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

  function run(state: GameState, ticks: number): CombatFeedback {
    const rings = createImpactRings();
    const feedback = new CombatFeedback(state.champions.length, rings);
    for (let i = 0; i < ticks; i++) {
      step(state, []);
      routeEvents(state, feedback);
    }
    return feedback;
  }

  it('makes one ring, one hit and one flash for a projectile that hits', () => {
    const state = match();
    shoot(state, 10, 2, 1, 0);
    const rings = createImpactRings();
    const feedback = new CombatFeedback(4, rings);
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
    const feedback = new CombatFeedback(4, rings);
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
    const feedback = run(state, 40);
    expect(feedback.hits).toBe(4);
    expect(feedback.deaths).toBe(1);
  });
});
