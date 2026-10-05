import { describe, expect, it } from 'vitest';
import { createMatch, step } from '../src/index';
import type { GameState, Obstacle, SimEvent } from '../src/index';
import { applyDamage } from '../src/health';
import { spawnProjectile } from '../src/projectile';
import type { ProjectileSpec } from '../src/projectile';
import { arena01, champion, config2v2, input, openArena, place } from './helpers';

function spec(over: Partial<ProjectileSpec> = {}): ProjectileSpec {
  return {
    ownerId: 0,
    x: -5,
    y: 0,
    dirX: 1,
    dirY: 0,
    speed: 25,
    radius: 0.2,
    lifetimeTicks: 120,
    pierce: false,
    effects: [{ type: 'damage', amount: 10 }],
    ...over,
  };
}

function open(obstacles: Obstacle[] = []): GameState {
  return createMatch(config2v2(), openArena(obstacles), 1);
}

function arena(): GameState {
  return createMatch(config2v2(), arena01, 1);
}

function kill(state: GameState, id: number): void {
  applyDamage(state, id, 1000, 0);
  state.events.length = 0;
}

/** Steps until no projectile is left (or `max` steps) and returns every event, in order. */
function runOut(state: GameState, max = 200): SimEvent[] {
  const all: SimEvent[] = [];
  for (let n = 0; n < max && state.projectiles.length > 0; n++) {
    step(state, []);
    all.push(...state.events);
  }
  return all;
}

function ofType<T extends SimEvent['type']>(
  events: SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

describe('spawnProjectile', () => {
  it('takes the next id, stores the record and emits projectileSpawned', () => {
    const state = open();
    const id = spawnProjectile(state, spec());
    expect(id).toBe(4);
    expect(state.nextEntityId).toBe(5);
    expect(state.projectiles).toEqual([
      {
        id: 4,
        ownerId: 0,
        team: 'A',
        x: -5,
        y: 0,
        vx: 25,
        vy: 0,
        radius: 0.2,
        remainingTicks: 120,
        pierce: false,
        hitIds: [],
        effects: [{ type: 'damage', amount: 10 }],
        castId: null,
      },
    ]);
    expect(state.events).toEqual([
      { type: 'projectileSpawned', projectileId: 4, ownerId: 0, x: -5, y: 0, vx: 25, vy: 0, radius: 0.2 },
    ]);
  });

  it('normalizes the direction and copies the owner team', () => {
    const state = open();
    spawnProjectile(state, spec({ ownerId: 2, dirX: 3, dirY: 4 }));
    const p = state.projectiles[0];
    expect(p?.team).toBe('B');
    expect(p?.vx).toBeCloseTo(15, 12);
    expect(p?.vy).toBeCloseTo(20, 12);
  });

  it('stores -0 coordinates and velocities as +0', () => {
    const state = open();
    spawnProjectile(state, spec({ x: -0, y: -0, dirX: 1, dirY: -0 }));
    const p = state.projectiles[0];
    expect([p?.x, p?.y, p?.vy].map((v) => Object.is(v, 0))).toEqual([true, true, true]);
  });

  it('copies the effects so the caller keeps no alias into the state', () => {
    const state = open();
    const effect = { type: 'damage' as const, amount: 10 };
    const effects = [effect];
    spawnProjectile(state, spec({ effects }));
    effect.amount = 99;
    expect(state.projectiles[0]?.effects).toEqual([{ type: 'damage', amount: 10 }]);
  });

  it('lets a dead owner spawn', () => {
    const state = open();
    kill(state, 0);
    expect(spawnProjectile(state, spec())).toBe(4);
  });

  it('leaves its event for the next step to clear', () => {
    const state = open();
    spawnProjectile(state, spec());
    expect(state.events.map((e) => e.type)).toEqual(['projectileSpawned']);
    step(state, []);
    expect(state.events).toEqual([]);
  });

  it.each([
    ['an unknown owner', { ownerId: 9 }],
    ['a NaN x', { x: NaN }],
    ['an infinite y', { y: Infinity }],
    ['a NaN direction', { dirX: NaN }],
    ['a zero direction', { dirX: 0, dirY: 0 }],
    ['a direction too large to measure', { dirX: 1e200, dirY: 1e200 }],
    ['a direction too small to measure', { dirX: 1e-160, dirY: 0 }],
    ['a direction far too small to measure', { dirX: 1e-170, dirY: 0 }],
    ['a zero speed', { speed: 0 }],
    ['a negative speed', { speed: -1 }],
    ['a zero radius', { radius: 0 }],
    ['a negative radius', { radius: -0.1 }],
    ['a zero lifetime', { lifetimeTicks: 0 }],
    ['a fractional lifetime', { lifetimeTicks: 1.5 }],
    ['a NaN lifetime', { lifetimeTicks: NaN }],
    ['a zero effect amount', { effects: [{ type: 'damage' as const, amount: 0 }] }],
    ['a NaN effect amount', { effects: [{ type: 'heal' as const, amount: NaN }] }],
    ['a negative effect amount', { effects: [{ type: 'damage' as const, amount: -3 }] }],
    ['an unknown effect type', { effects: [{ type: 'burn', amount: 3 } as never] }],
    ['a status effect with a bad spec', { effects: [{ type: 'applyStatus' as const, status: { type: 'slow' as const, percent: 0, ticks: 5 } }] }],
    ['a shield effect with no absorb', { effects: [{ type: 'shield' as const, absorb: 0, ticks: 60 }] }],
    ['a knockback effect with a bad direction', { effects: [{ type: 'knockback', distance: 2, ticks: 8, direction: 'up' } as never] }],
  ])('throws on %s and changes nothing', (_name, over) => {
    const state = open();
    expect(() => spawnProjectile(state, spec(over))).toThrow('Invalid projectile');
    expect(state.nextEntityId).toBe(4);
    expect(state.projectiles).toEqual([]);
    expect(state.events).toEqual([]);
  });
});

describe('projectile direction bounds', () => {
  it.each([
    ['1e200 on both axes', { dirX: 1e200, dirY: 1e200 }, 'direction is too large to measure'],
    ['1e-160 on one axis', { dirX: 1e-160, dirY: 0 }, 'direction is too small to measure'],
    ['1e-170 on one axis', { dirX: 1e-170, dirY: 0 }, 'direction is too small to measure'],
    ['1e-160 on both axes', { dirX: -1e-160, dirY: 1e-160 }, 'direction is too small to measure'],
    ['an exact zero', { dirX: 0, dirY: 0 }, 'direction is zero'],
  ])('names the problem for %s', (_name, over, message) => {
    expect(() => spawnProjectile(open(), spec(over))).toThrow(message);
  });

  it('accepts a direction of exactly 1e-150 on one axis, since only values below it are rejected', () => {
    const state = open();
    spawnProjectile(state, spec({ dirX: 1e-150, dirY: 0, speed: 10 }));
    expect(state.projectiles[0]?.vx).toBe(10);
    expect(state.projectiles[0]?.vy).toBe(0);
  });

  it('still accepts a small direction above the bound and normalizes it', () => {
    const state = open();
    spawnProjectile(state, spec({ dirX: 1e-140, dirY: 0, speed: 10 }));
    expect(state.projectiles[0]?.vx).toBe(10);
    expect(state.projectiles[0]?.vy).toBe(0);
  });
});

describe('projectile flight', () => {
  it('hits on the step whose sweep reaches the contact, not the one before', () => {
    // Contact 0.7 m before the target centre: 9.3 m from the start, 25 / 60 m per step.
    const state = open();
    place(state, 2, 5, 0);
    spawnProjectile(state, spec());
    for (let i = 0; i < 22; i++) step(state, []);
    expect(state.projectiles).toHaveLength(1);
    expect(champion(state, 2).health).toBe(120);

    step(state, []);
    expect(state.projectiles).toHaveLength(0);
    expect(champion(state, 2).health).toBe(110);
    expect(state.events.map((e) => e.type)).toEqual([
      'projectileHit',
      'damage',
      'projectileExpired',
    ]);
    const [hit, damage, expired] = state.events;
    expect(hit).toMatchObject({ type: 'projectileHit', projectileId: 4, ownerId: 0, targetId: 2, y: 0 });
    expect((hit as { x: number }).x).toBeCloseTo(4.3, 9);
    expect(damage).toEqual({ type: 'damage', targetId: 2, sourceId: 0, amount: 10, health: 110 });
    expect(expired).toMatchObject({ type: 'projectileExpired', projectileId: 4, reason: 'hit' });
    expect((expired as { x: number }).x).toBeCloseTo(4.3, 9);
  });

  it('agrees with a point-to-segment oracle for a target walking across the path', () => {
    const outcomes: boolean[] = [];
    for (const startY of [1.5, 2, 2.5, 3, 4]) {
      const state = open();
      place(state, 2, 3, startY);
      spawnProjectile(state, spec());
      let hit = false;
      for (let tick = 0; tick < 40 && !hit; tick++) {
        const p = state.projectiles[0];
        if (!p) break;
        const [ax, ay] = [p.x, p.y];
        const [bx, by] = [p.x + p.vx / 60, p.y + p.vy / 60];
        step(state, [undefined, undefined, input(0, -1)]);
        const c = champion(state, 2);
        const dist = distToSegment(c.x, c.y, ax, ay, bx, by);
        hit = state.projectiles.length === 0;
        if (Math.abs(dist - 0.7) > 1e-9) expect(hit).toBe(dist <= 0.7);
      }
      outcomes.push(hit);
    }
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
  });

  it('misses a standing champion just outside the reach and hits one just inside', () => {
    const miss = open();
    place(miss, 2, 5, 0.75);
    spawnProjectile(miss, spec());
    const missEvents = runOut(miss);
    expect(ofType(missEvents, 'projectileHit')).toEqual([]);
    expect(champion(miss, 2).health).toBe(120);

    const hit = open();
    place(hit, 2, 5, 0.69);
    spawnProjectile(hit, spec());
    expect(ofType(runOut(hit), 'projectileHit')).toHaveLength(1);
    expect(champion(hit, 2).health).toBe(110);
  });

  it('does not tunnel through a champion at 120 m/s', () => {
    const state = open();
    place(state, 2, 0, 0);
    spawnProjectile(state, spec({ speed: 120 }));
    let steps = 0;
    while (state.projectiles.length > 0) {
      const p = state.projectiles[0];
      // No end-of-step position overlaps the champion (reach 0.7), only the sweep does.
      if (p) expect(Math.abs(p.x)).toBeGreaterThan(0.7);
      step(state, []);
      steps++;
    }
    expect(steps).toBe(3);
    expect(champion(state, 2).health).toBe(110);
  });

  it('does not tunnel through a thin blocking rect at 120 m/s', () => {
    const wall: Obstacle = { type: 'rect', x: 0, y: 0, w: 0.5, h: 4, height: 1, blocksProjectiles: true };
    const state = open([wall]);
    place(state, 2, 5, 0);
    spawnProjectile(state, spec({ speed: 120 }));
    const events = runOut(state);
    const [expired] = ofType(events, 'projectileExpired');
    expect(expired?.reason).toBe('obstacle');
    expect(expired?.x).toBeCloseTo(-0.45, 9);
    expect(champion(state, 2).health).toBe(120);
  });

  it('is stopped by the pillar and does not reach the target behind it', () => {
    const state = arena();
    place(state, 2, 5, 0);
    spawnProjectile(state, spec());
    const [expired] = ofType(runOut(state), 'projectileExpired');
    expect(expired?.reason).toBe('obstacle');
    expect(expired?.x).toBeCloseTo(-1.7, 9);
    expect(champion(state, 2).health).toBe(120);
  });

  it('flies over a low wall and hits the target behind it', () => {
    const state = arena();
    place(state, 2, -2, 5);
    spawnProjectile(state, spec({ x: -10, y: 5 }));
    const events = runOut(state);
    expect(ofType(events, 'projectileHit')).toHaveLength(1);
    expect(champion(state, 2).health).toBe(110);
  });

  it('expires at the boundary on the computed step', () => {
    const state = open();
    spawnProjectile(state, spec({ x: -5, y: 8 }));
    // The centre stops at 15 - 0.2 = 14.8: 19.8 m, 47.52 steps of 25 / 60 m.
    for (let i = 0; i < 47; i++) step(state, []);
    expect(state.projectiles).toHaveLength(1);
    step(state, []);
    expect(state.projectiles).toHaveLength(0);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ type: 'projectileExpired', reason: 'boundary', y: 8 });
    expect((state.events[0] as { x: number }).x).toBeCloseTo(14.8, 9);
  });

  it('expires at a north boundary as well', () => {
    const state = open();
    spawnProjectile(state, spec({ x: 0, y: 0, dirX: 0, dirY: 1 }));
    const [expired] = ofType(runOut(state), 'projectileExpired');
    expect(expired?.reason).toBe('boundary');
    expect(expired?.y).toBeCloseTo(9.8, 9);
  });

  it('expires after exactly its lifetime in steps', () => {
    const state = open();
    spawnProjectile(state, spec({ x: -5, y: 8, speed: 10, lifetimeTicks: 5 }));
    for (let i = 0; i < 4; i++) {
      step(state, []);
      expect(state.projectiles).toHaveLength(1);
    }
    step(state, []);
    expect(state.projectiles).toHaveLength(0);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ type: 'projectileExpired', reason: 'lifetime' });
    expect((state.events[0] as { x: number }).x).toBeCloseTo(-5 + (5 * 10) / 60, 9);
  });

  it('passes a dead enemy and hits the one behind it', () => {
    const state = open();
    place(state, 2, 3, 0);
    place(state, 3, 6, 0);
    kill(state, 2);
    spawnProjectile(state, spec());
    const hits = ofType(runOut(state), 'projectileHit');
    expect(hits.map((h) => h.targetId)).toEqual([3]);
  });
});

describe('who a projectile hits', () => {
  it('hits only the first enemy in line without pierce', () => {
    const state = open();
    place(state, 2, 3, 0);
    place(state, 3, 6, 0);
    spawnProjectile(state, spec());
    const events = runOut(state);
    expect(ofType(events, 'projectileHit').map((h) => h.targetId)).toEqual([2]);
    expect(champion(state, 3).health).toBe(120);
  });

  it('hits two enemies in line once each with pierce, then ends at the boundary', () => {
    const state = open();
    place(state, 2, 3, 0);
    place(state, 3, 6, 0);
    spawnProjectile(state, spec({ pierce: true }));
    const events = runOut(state);
    expect(ofType(events, 'projectileHit').map((h) => h.targetId)).toEqual([2, 3]);
    expect(ofType(events, 'damage')).toHaveLength(2);
    expect(champion(state, 2).health).toBe(110);
    expect(champion(state, 3).health).toBe(110);
    expect(ofType(events, 'projectileExpired').map((e) => e.reason)).toEqual(['boundary']);
  });

  it('remembers the champions it pierced in hitIds', () => {
    const state = open();
    place(state, 2, 3, 0);
    spawnProjectile(state, spec({ pierce: true }));
    for (let i = 0; i < 40; i++) step(state, []);
    expect(state.projectiles[0]?.hitIds).toEqual([2]);
  });

  it('is still stopped by the pillar with pierce', () => {
    const state = arena();
    place(state, 2, -3, 0);
    place(state, 3, 3, 0);
    spawnProjectile(state, spec({ pierce: true }));
    const events = runOut(state);
    expect(ofType(events, 'projectileHit').map((h) => h.targetId)).toEqual([2]);
    expect(ofType(events, 'projectileExpired').map((e) => e.reason)).toEqual(['obstacle']);
    expect(champion(state, 3).health).toBe(120);
  });

  it('never hits its owner or an ally but hits the enemy behind them', () => {
    const state = open();
    place(state, 0, -5, 0);
    place(state, 1, -2, 0);
    place(state, 2, 3, 0);
    spawnProjectile(state, spec());
    runOut(state);
    expect(champion(state, 0).health).toBe(120);
    expect(champion(state, 1).health).toBe(120);
    expect(champion(state, 2).health).toBe(110);
  });

  it('lets the lower champion id take a hit when two enemies are reached at once', () => {
    const state = open();
    place(state, 2, 3, 0.5);
    place(state, 3, 3, -0.5);
    spawnProjectile(state, spec());
    const hits = ofType(runOut(state), 'projectileHit');
    expect(hits.map((h) => h.targetId)).toEqual([2]);
  });

  it('lands the hits of one piercing sweep in order of contact, not of champion id', () => {
    const state = open();
    // 120 m/s is 2 m per tick: from x = -5 the sweep reaches champion 3 before champion 2.
    place(state, 3, -4.2, 0);
    place(state, 2, -3.2, 0);
    spawnProjectile(state, spec({ pierce: true, speed: 120 }));
    step(state, []);
    expect(ofType(state.events, 'projectileHit').map((h) => h.targetId)).toEqual([3, 2]);
    expect(state.projectiles[0]?.hitIds).toEqual([3, 2]);
  });

  it('lets the lower projectile id kill and skips the dead champion for the next', () => {
    const state = open();
    place(state, 2, 3, 0);
    champion(state, 2).health = 10;
    const first = spawnProjectile(state, spec({ effects: [{ type: 'damage', amount: 20 }] }));
    const second = spawnProjectile(state, spec({ effects: [{ type: 'damage', amount: 20 }] }));
    state.events.length = 0;
    const events = runOut(state);
    expect(ofType(events, 'death')).toHaveLength(1);
    expect(ofType(events, 'damage')).toHaveLength(1);
    expect(ofType(events, 'projectileHit').map((h) => h.projectileId)).toEqual([first]);
    const ends = ofType(events, 'projectileExpired').map((e) => [e.projectileId, e.reason]);
    expect(ends).toEqual([
      [first, 'hit'],
      [second, 'boundary'],
    ]);
  });

  it('hits an enemy it overlaps at spawn, at t = 0', () => {
    const state = open();
    place(state, 2, -5, 0.3);
    spawnProjectile(state, spec());
    step(state, []);
    expect(state.projectiles).toHaveLength(0);
    expect(state.events[0]).toMatchObject({ type: 'projectileHit', targetId: 2, x: -5, y: 0 });
  });

  it('hits an enemy at the same t = 0 as the boundary instead of expiring', () => {
    const state = open();
    place(state, 2, 14.5, 1);
    spawnProjectile(state, spec({ x: 14.5, y: 0, dirX: 1, radius: 0.6 }));
    step(state, []);
    expect(state.projectiles).toHaveLength(0);
    expect(ofType(state.events, 'projectileHit')).toMatchObject([{ targetId: 2, x: 14.5, y: 0 }]);
    expect(ofType(state.events, 'projectileExpired').map((e) => e.reason)).toEqual(['hit']);
    expect(champion(state, 2).health).toBe(110);
  });
});

describe('a champion against a wall', () => {
  it('fires a 0.6 m projectile away from the boundary and into it', () => {
    const away = open();
    place(away, 0, 14.5, 0);
    spawnProjectile(away, spec({ x: 14.5, y: 0, dirX: -1, radius: 0.6 }));
    step(away, []);
    expect(away.projectiles).toHaveLength(1);
    expect(away.projectiles[0]?.x).toBeLessThan(14.5);

    const into = open();
    place(into, 0, 14.5, 0);
    spawnProjectile(into, spec({ x: 14.5, y: 0, dirX: 1, radius: 0.6 }));
    step(into, []);
    expect(into.projectiles).toHaveLength(0);
    expect(into.events[0]).toMatchObject({ type: 'projectileExpired', reason: 'boundary', x: 14.5 });
  });

  it('fires a 0.6 m projectile away from the pillar and into it', () => {
    const away = arena();
    place(away, 0, 2, 0);
    spawnProjectile(away, spec({ x: 2, y: 0, dirX: 1, radius: 0.6 }));
    step(away, []);
    expect(away.projectiles).toHaveLength(1);
    expect(away.projectiles[0]?.x).toBeGreaterThan(2);

    const into = arena();
    place(into, 0, 2, 0);
    spawnProjectile(into, spec({ x: 2, y: 0, dirX: -1, radius: 0.6 }));
    step(into, []);
    expect(into.projectiles).toHaveLength(0);
    expect(into.events[0]).toMatchObject({ type: 'projectileExpired', reason: 'obstacle', x: 2, y: 0 });
  });

  it('fires away from a rect it touches, and is stopped inside one', () => {
    const away = arena();
    place(away, 0, -7, 0);
    // The rect at (-8, 0) spans x -8.5..-7.5; a projectile of radius 0.6 at x = -7 overlaps it.
    spawnProjectile(away, spec({ x: -7, y: 0, dirX: 1, radius: 0.6 }));
    step(away, []);
    expect(away.projectiles).toHaveLength(1);

    const into = arena();
    spawnProjectile(into, spec({ x: -7, y: 0, dirX: -1, radius: 0.6 }));
    step(into, []);
    expect(into.projectiles).toHaveLength(0);
    expect(into.events[0]).toMatchObject({ reason: 'obstacle', x: -7 });

    const inside = arena();
    spawnProjectile(inside, spec({ x: -8, y: 0, dirX: 1, radius: 0.2 }));
    step(inside, []);
    expect(inside.projectiles).toHaveLength(0);
  });
});

describe('projectile hit effects', () => {
  it('pushes the target away from the contact point, not from the projectile centre line', () => {
    const state = open();
    place(state, 2, 5, 0.3);
    spawnProjectile(
      state,
      spec({ effects: [{ type: 'knockback', distance: 2, ticks: 8, direction: 'away' }] }),
    );
    for (let i = 0; i < 30 && state.projectiles.length > 0; i++) step(state, []);
    const hit = state.events.find((e) => e.type === 'projectileHit');
    if (hit?.type !== 'projectileHit') throw new Error('no hit');
    const dx = 5 - hit.x;
    const dy = 0.3 - hit.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const push = champion(state, 2).statuses[0] as { dirX: number; dirY: number };
    expect(push.dirX).toBeCloseTo(dx / len, 12);
    expect(push.dirY).toBeCloseTo(dy / len, 12);
  });

  it('applies status effects from the owner with no slot', () => {
    const state = open();
    place(state, 2, 5, 0);
    spawnProjectile(
      state,
      spec({
        effects: [
          { type: 'applyStatus', status: { type: 'slow', percent: 30, ticks: 60 } },
          { type: 'shield', absorb: 10, ticks: 60 },
        ],
      }),
    );
    for (let i = 0; i < 30 && state.projectiles.length > 0; i++) step(state, []);
    expect(champion(state, 2).statuses).toMatchObject([
      { type: 'slow', sourceId: 0, slot: null, percent: 30 },
      { type: 'shield', sourceId: 0, slot: null, absorb: 10 },
    ]);
  });
});
