import { describe, expect, it } from 'vitest';
import { createMatch, step } from '../src/index';
import type { GameState, Obstacle, SimEvent } from '../src/index';
import { startDash, teleport } from '../src/motion';
import { applyKnockback, applyStatus } from '../src/status';
import { checkInvariants, champion, config2v2, input, openArena, place } from './helpers';

const NONE = { sourceId: 0, slot: null } as const;

function wall(x: number, y: number, w: number, h: number, blocksProjectiles = true): Obstacle {
  return { type: 'rect', x, y, w, h, height: 1, blocksProjectiles };
}

function open(obstacles: Obstacle[] = []): GameState {
  const state = createMatch(config2v2(), openArena(obstacles), 1);
  // Move everyone out of the way of the scenes below.
  place(state, 0, 0, 0);
  place(state, 1, -12, 8);
  place(state, 2, 12, 8);
  place(state, 3, 12, -8);
  return state;
}

function run(state: GameState, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(state, []);
    events.push(...state.events);
    expect(checkInvariants(state)).toEqual([]);
  }
  return events;
}

const dashOf = (distance: number, ticks: number, dirX = 1, dirY = 0) => ({ dirX, dirY, distance, ticks });

describe('startDash', () => {
  it('sets the dash record and emits dashStarted from the current position', () => {
    const state = open();
    place(state, 0, 1, 2);
    expect(startDash(state, 0, dashOf(3, 6, 0, 2))).toBe(true);
    expect(champion(state, 0).dash).toEqual({ dirX: 0, dirY: 1, stepLength: 0.5, ticksLeft: 6 });
    expect(state.events).toEqual([
      { type: 'dashStarted', championId: 0, x: 1, y: 2, dirX: 0, dirY: 1, distance: 3, ticks: 6 },
    ]);
  });

  it('normalizes the direction', () => {
    const state = open();
    startDash(state, 0, dashOf(5, 5, 3, 4));
    const dash = champion(state, 0).dash;
    expect(dash?.dirX).toBeCloseTo(0.6, 15);
    expect(dash?.dirY).toBeCloseTo(0.8, 15);
  });

  it('replaces a running dash and reports it as replaced', () => {
    const state = open();
    startDash(state, 0, dashOf(3, 6));
    step(state, []);
    place(state, 0, 0.5, 0);
    state.events.length = 0;
    startDash(state, 0, dashOf(2, 4, 0, 1));
    expect(state.events.map((e) => e.type)).toEqual(['dashEnded', 'dashStarted']);
    expect(state.events[0]).toEqual({ type: 'dashEnded', championId: 0, x: 0.5, y: 0, reason: 'replaced' });
    expect(champion(state, 0).dash).toMatchObject({ dirX: 0, dirY: 1, ticksLeft: 4 });
  });

  it('does nothing for a dead champion', () => {
    const state = open();
    champion(state, 0).alive = false;
    expect(startDash(state, 0, dashOf(3, 6))).toBe(false);
    expect(champion(state, 0).dash).toBeNull();
    expect(state.events).toEqual([]);
  });

  it('throws Invalid dash for a bad champion or spec', () => {
    const state = open();
    expect(() => startDash(state, 9, dashOf(3, 6))).toThrow('Invalid dash: unknown champion 9');
    const bad = [
      dashOf(3, 6, 0, 0),
      dashOf(3, 6, NaN, 1),
      dashOf(3, 6, Infinity, 0),
      dashOf(0, 6),
      dashOf(-1, 6),
      dashOf(NaN, 6),
      dashOf(Infinity, 6),
      dashOf(1001, 6),
      dashOf(3, 0),
      dashOf(3, 1.5),
      dashOf(3, NaN),
    ];
    for (const spec of bad) {
      expect(() => startDash(state, 0, spec), JSON.stringify(spec)).toThrow(/^Invalid dash: /);
    }
    expect(champion(state, 0).dash).toBeNull();
    expect(state.events).toEqual([]);
  });
});

describe('dash motion', () => {
  it('moves the step length each tick and completes when its ticks run out', () => {
    const state = open();
    startDash(state, 0, dashOf(3, 6));
    state.events.length = 0;
    for (let i = 1; i <= 5; i++) {
      step(state, []);
      expect(champion(state, 0).x).toBeCloseTo(0.5 * i, 12);
      expect(state.events).toEqual([]);
    }
    step(state, []);
    expect(champion(state, 0).x).toBeCloseTo(3, 12);
    expect(state.events).toEqual([
      { type: 'dashEnded', championId: 0, x: champion(state, 0).x, y: 0, reason: 'complete' },
    ]);
    expect(champion(state, 0).dash).toBeNull();
    step(state, []);
    expect(champion(state, 0).x).toBeCloseTo(3, 12);
  });

  it('takes walking away: input is ignored while dashing and the velocity is +0', () => {
    const state = open();
    startDash(state, 0, dashOf(3, 6));
    step(state, [input(-1, -1, 0, 0)]);
    expect(champion(state, 0).x).toBeCloseTo(0.5, 12);
    expect(champion(state, 0).y).toBe(0);
    expect(Object.is(champion(state, 0).vx, 0)).toBe(true);
    expect(Object.is(champion(state, 0).vy, 0)).toBe(true);
  });

  it('keeps aiming and facing while dashing', () => {
    const state = open();
    startDash(state, 0, dashOf(3, 6));
    step(state, [input(0, 0, 0, 1000)]);
    expect([champion(state, 0).aimX, champion(state, 0).aimY]).toEqual([0, 1000]);
    expect(champion(state, 0).facing).toBeCloseTo(Math.PI / 2, 12);
  });

  it('ignores stun when it was started on an already stunned champion', () => {
    const state = open();
    applyStatus(state, 0, { type: 'stun', ticks: 20 }, NONE);
    startDash(state, 0, dashOf(3, 6));
    run(state, 6);
    expect(champion(state, 0).x).toBeCloseTo(3, 12);
  });

  it('is cancelled by a stun when the stun is applied, with the reason stunned and no motion after', () => {
    const state = open();
    startDash(state, 0, dashOf(3, 6));
    step(state, []);
    state.events.length = 0;
    applyStatus(state, 0, { type: 'stun', ticks: 30 }, NONE);
    expect(state.events.map((e) => e.type)).toEqual(['statusApplied', 'dashEnded']);
    expect(state.events[1]).toMatchObject({ type: 'dashEnded', reason: 'stunned', x: champion(state, 0).x });
    expect(champion(state, 0).dash).toBeNull();
    const x = champion(state, 0).x;
    run(state, 5);
    expect(champion(state, 0).x).toBe(x);
  });

  it('does not end a dash for a stun that changes nothing', () => {
    const state = open();
    applyStatus(state, 0, { type: 'stun', ticks: 30 }, NONE);
    startDash(state, 0, dashOf(3, 6));
    expect(applyStatus(state, 0, { type: 'stun', ticks: 10 }, NONE)).toBe(false);
    expect(champion(state, 0).dash).not.toBeNull();
  });

  it('ends as rooted in the next step, before any motion, when root lands on it', () => {
    const state = open();
    startDash(state, 0, dashOf(3, 6));
    step(state, []);
    const x = champion(state, 0).x;
    applyStatus(state, 0, { type: 'root', ticks: 30 }, NONE);
    expect(champion(state, 0).dash).not.toBeNull();
    step(state, []);
    expect(state.events).toEqual([{ type: 'dashEnded', championId: 0, x, y: 0, reason: 'rooted' }]);
    expect(champion(state, 0).x).toBe(x);
    expect(champion(state, 0).dash).toBeNull();
  });

  it('is not slowed by slow or haste', () => {
    const state = open();
    applyStatus(state, 0, { type: 'slow', percent: 60, ticks: 60 }, NONE);
    startDash(state, 0, dashOf(3, 6));
    run(state, 6);
    expect(champion(state, 0).x).toBeCloseTo(3, 12);
  });

  it('stops at contact with a wall, without sliding along it', () => {
    // A tall wall face at x = 2; the dash runs diagonally into it.
    const state = open([wall(2.5, 0, 1, 40)]);
    startDash(state, 0, dashOf(10, 10, 1, 1));
    const events = run(state, 3);
    const ended = events.filter((e) => e.type === 'dashEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ reason: 'blocked' });
    const c = champion(state, 0);
    expect(c.x).toBeCloseTo(1.5, 9);
    // The y it had when the wall was reached; pushing the x back must not slide it on.
    expect(c.y).toBeGreaterThan(1.4);
    expect(c.y).toBeLessThan(1.5 + 0.25);
    const [x, y] = [c.x, c.y];
    run(state, 20);
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([x, y]);
    expect(champion(state, 0).dash).toBeNull();
  });

  it('does not tunnel through a thin wall in a fast dash', () => {
    const state = open([wall(3, 0, 0.1, 40)]);
    startDash(state, 0, dashOf(10, 1));
    const events = run(state, 1);
    expect(events).toMatchObject([{ type: 'dashEnded', reason: 'blocked' }]);
    expect(champion(state, 0).x).toBeCloseTo(3 - 0.05 - 0.5, 9);
  });

  it('stops against another champion', () => {
    const state = open();
    place(state, 2, 4, 0);
    startDash(state, 0, dashOf(10, 5));
    const events = run(state, 3);
    expect(events).toMatchObject([{ type: 'dashEnded', reason: 'blocked' }]);
    expect(champion(state, 0).x).toBeCloseTo(3, 9);
  });

  it('stops at the boundary', () => {
    const state = open();
    place(state, 0, 14, 0);
    startDash(state, 0, dashOf(5, 5));
    const events = run(state, 2);
    expect(events).toMatchObject([{ type: 'dashEnded', reason: 'blocked' }]);
    expect(champion(state, 0).x).toBeCloseTo(14.5, 9);
  });

  it('ends as blocked, not complete, when contact comes on the last tick', () => {
    const state = open([wall(2.5, 0, 1, 40)]);
    startDash(state, 0, dashOf(2, 2));
    const events = run(state, 2);
    expect(events.filter((e) => e.type === 'dashEnded')).toMatchObject([{ reason: 'blocked' }]);
  });
});

describe('knockback motion', () => {
  const push = (distance: number, ticks: number, dirX = 1, dirY = 0) => ({ dirX, dirY, distance, ticks });

  it('moves D 2 n / (N (N + 1)) in the tick with n ticks left and totals D', () => {
    const state = open();
    applyKnockback(state, 0, push(3, 6), NONE);
    state.events.length = 0;
    let x = 0;
    for (let n = 6; n >= 1; n--) {
      step(state, []);
      expect(champion(state, 0).x - x, `n=${n}`).toBeCloseTo((3 * 2 * n) / 42, 12);
      x = champion(state, 0).x;
    }
    expect(x).toBeCloseTo(3, 12);
    expect(state.events).toEqual([
      { type: 'statusExpired', targetId: 0, sourceId: 0, slot: null, status: 'knockback', reason: 'expired' },
    ]);
    step(state, []);
    expect(champion(state, 0).x).toBeCloseTo(3, 12);
  });

  it('moves a stunned and a rooted champion', () => {
    const state = open();
    applyStatus(state, 0, { type: 'stun', ticks: 30 }, NONE);
    applyStatus(state, 0, { type: 'root', ticks: 30 }, NONE);
    applyKnockback(state, 0, push(2, 4), NONE);
    run(state, 4);
    expect(champion(state, 0).x).toBeCloseTo(2, 12);
  });

  it('adds to walking, which is applied first', () => {
    const state = open();
    applyKnockback(state, 0, push(2, 4, 0, 1), NONE);
    step(state, [input(1, 0, 0, 0)]);
    expect(champion(state, 0).x).toBeCloseTo((5.5 / 60), 12);
    expect(champion(state, 0).y).toBeCloseTo((2 * 2 * 4) / 20, 12);
    // The stored velocity is the walk velocity only.
    expect(champion(state, 0).vx).toBe(5.5);
    expect(champion(state, 0).vy).toBe(0);
  });

  it('sums with a dash and with other knockbacks', () => {
    const state = open();
    startDash(state, 0, dashOf(2, 4));
    applyKnockback(state, 0, push(1, 2, 0, 1), { sourceId: 1, slot: null });
    applyKnockback(state, 0, push(1, 2, 0, -1), { sourceId: 2, slot: null });
    run(state, 4);
    expect(champion(state, 0).x).toBeCloseTo(2, 12);
    expect(champion(state, 0).y).toBeCloseTo(0, 12);
  });

  it('does not stop two knockbacks that cancel to no motion', () => {
    const state = open();
    applyKnockback(state, 0, push(2, 4, 1, 0), { sourceId: 1, slot: null });
    applyKnockback(state, 0, push(2, 4, -1, 0), { sourceId: 2, slot: null });
    const events = run(state, 3);
    expect(events).toEqual([]);
    expect(champion(state, 0).x).toBeCloseTo(0, 12);
  });

  it('stops on contact with a wall: the champion rests at contact and the push ends as stopped', () => {
    const state = open([wall(2.5, 0, 1, 40)]);
    applyKnockback(state, 0, push(5, 5), NONE);
    const events = run(state, 5);
    expect(champion(state, 0).x).toBeCloseTo(1.5, 9);
    expect(events).toEqual([
      { type: 'statusExpired', targetId: 0, sourceId: 0, slot: null, status: 'knockback', reason: 'stopped' },
    ]);
    expect(champion(state, 0).statuses).toEqual([]);
  });

  it('stops every knockback and ends a dash as blocked on any push', () => {
    const state = open([wall(2.5, 0, 1, 40)]);
    startDash(state, 0, dashOf(5, 5));
    applyKnockback(state, 0, push(3, 5), { sourceId: 1, slot: null });
    applyKnockback(state, 0, push(2, 5, 1, 0.2), { sourceId: 2, slot: null });
    state.events.length = 0;
    const events = run(state, 3);
    expect(events.map((e) => (e.type === 'dashEnded' ? `dash ${e.reason}` : e.type === 'statusExpired' ? `${e.status} ${e.reason}` : e.type))).toEqual([
      'dash blocked',
      'knockback stopped',
      'knockback stopped',
    ]);
    expect(champion(state, 0).statuses).toEqual([]);
  });

  it('does not tunnel through a thin wall in a one-tick push', () => {
    const state = open([wall(3, 0, 0.1, 40)]);
    applyKnockback(state, 0, push(6, 1), NONE);
    const events = run(state, 1);
    expect(events).toMatchObject([{ type: 'statusExpired', reason: 'stopped' }]);
    expect(champion(state, 0).x).toBeCloseTo(3 - 0.05 - 0.5, 9);
  });

  it('pushes a champion into the boundary and stops there', () => {
    const state = open();
    place(state, 0, 14, 0);
    applyKnockback(state, 0, push(3, 6), NONE);
    const events = run(state, 6);
    expect(champion(state, 0).x).toBeCloseTo(14.5, 9);
    expect(events).toMatchObject([{ reason: 'stopped' }]);
  });

  it('starts pushing in the first step after it was applied between steps', () => {
    const state = open();
    applyKnockback(state, 0, push(3, 6), NONE);
    expect(champion(state, 0).x).toBe(0);
    step(state, []);
    expect(champion(state, 0).x).toBeGreaterThan(0.8);
  });

  it('never pushes a dead champion', () => {
    const state = open();
    applyKnockback(state, 0, push(3, 6), NONE);
    champion(state, 0).alive = false;
    champion(state, 0).statuses.length = 0;
    run(state, 3);
    expect(champion(state, 0).x).toBe(0);
  });
});

describe('teleport', () => {
  it('moves the champion to the point and emits the event', () => {
    const state = open();
    expect(teleport(state, 0, 4, 3)).toBe(true);
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([4, 3]);
    expect(state.events).toEqual([
      { type: 'teleport', championId: 0, fromX: 0, fromY: 0, toX: 4, toY: 3, blocked: false },
    ]);
  });

  it('leaves the champion in place and reports blocked when a wall is in the way', () => {
    const state = open([wall(2, 0, 0.5, 6)]);
    expect(teleport(state, 0, 5, 0)).toBe(false);
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([0, 0]);
    expect(state.events).toEqual([
      { type: 'teleport', championId: 0, fromX: 0, fromY: 0, toX: 0, toY: 0, blocked: true },
    ]);
  });

  it('counts a path that only touches a wall as blocked', () => {
    const state = open([wall(2, 0, 1, 2)]);
    expect(teleport(state, 0, 4, 1)).toBe(false);
  });

  it('is not blocked by a low wall that lets projectiles through', () => {
    const state = open([wall(2, 0, 0.5, 6, false)]);
    expect(teleport(state, 0, 5, 0)).toBe(true);
    expect(champion(state, 0).x).toBe(5);
  });

  it('is not blocked by a wall behind the target or off to the side', () => {
    const state = open([wall(8, 0, 1, 6), wall(2, 5, 1, 2)]);
    expect(teleport(state, 0, 5, 0)).toBe(true);
  });

  it('resolves collision at the destination: out of an obstacle', () => {
    const state = open([{ type: 'circle', x: 5, y: 0, r: 1, height: 1, blocksProjectiles: false }]);
    expect(teleport(state, 0, 4.5, 0)).toBe(true);
    // Pushed out along the centre line, to 1 + 0.5 from the circle centre.
    expect(champion(state, 0).x).toBeCloseTo(3.5, 9);
    expect(state.events).toMatchObject([{ type: 'teleport', toX: champion(state, 0).x, blocked: false }]);
  });

  it('resolves collision at the destination: out of another champion', () => {
    const state = open();
    place(state, 2, 4, 0);
    teleport(state, 0, 4.2, 0);
    expect(Math.hypot(champion(state, 0).x - 4, champion(state, 0).y)).toBeCloseTo(1, 9);
  });

  it('resolves collision at the destination: back inside the boundary', () => {
    const state = open();
    teleport(state, 0, 20, 0);
    expect(champion(state, 0).x).toBeCloseTo(14.5, 9);
    teleport(state, 0, 14.5, -30);
    expect(champion(state, 0).y).toBeCloseTo(-9.5, 9);
  });

  it('falls back to the start when the destination cannot be resolved', () => {
    const state = open([wall(-2.8, 0, 5, 10, false), wall(2.8, 0, 5, 10, false)]);
    place(state, 0, 0, 7);
    expect(teleport(state, 0, 0, 0)).toBe(true);
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([0, 7]);
    expect(state.events).toMatchObject([{ fromX: 0, fromY: 7, toX: 0, toY: 7, blocked: false }]);
  });

  it('does nothing to a dead champion', () => {
    const state = open();
    champion(state, 0).alive = false;
    expect(teleport(state, 0, 4, 3)).toBe(false);
    expect(champion(state, 0).x).toBe(0);
    expect(state.events).toEqual([]);
  });

  it('throws Invalid teleport for a bad champion or point', () => {
    const state = open();
    expect(() => teleport(state, 9, 1, 1)).toThrow('Invalid teleport: unknown champion 9');
    for (const [x, y] of [[NaN, 0], [0, Infinity], [-Infinity, 0]] as const) {
      expect(() => teleport(state, 0, x, y)).toThrow(/^Invalid teleport: /);
    }
  });

  it('keeps a running dash and the velocity, and stores +0', () => {
    const state = open();
    startDash(state, 0, dashOf(3, 6));
    teleport(state, 0, -0, -0);
    expect(Object.is(champion(state, 0).x, 0)).toBe(true);
    expect(Object.is(champion(state, 0).y, 0)).toBe(true);
    expect(champion(state, 0).dash).not.toBeNull();
  });
});
