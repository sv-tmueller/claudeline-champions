import { describe, expect, it } from 'vitest';
import { BASE_MOVE_SPEED, DT, createMatch, step } from '../src/index';
import { resolveChampion } from '../src/collision';
import type { GameState, Obstacle, PlayerInput } from '../src/index';
import {
  TOLERANCE,
  arena01,
  champion,
  checkInvariants,
  config2v2,
  input,
  openArena,
  place,
} from './helpers';

function openMatch(obstacles: Obstacle[] = []): GameState {
  return createMatch(config2v2(), openArena(obstacles), 1);
}

function pairDistance(state: GameState, a: number, b: number): number {
  return Math.hypot(champion(state, a).x - champion(state, b).x, champion(state, a).y - champion(state, b).y);
}

// Steps the sim for `ticks` ticks and fails on the first invariant violation.
function runChecked(state: GameState, inputs: (PlayerInput | undefined)[], ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    step(state, inputs);
    expect(checkInvariants(state)).toEqual([]);
  }
}

describe('boundary', () => {
  it('slides along the north wall at an angle', () => {
    const state = openMatch();
    place(state, 0, -10, 9.5);
    const expectedStep = BASE_MOVE_SPEED * Math.SQRT1_2 * DT;
    for (let i = 1; i <= 60; i++) {
      step(state, [input(1, 1, 0, 0)]);
      expect(champion(state, 0).y).toBe(9.5);
      expect(champion(state, 0).x).toBeCloseTo(-10 + i * expectedStep, 12);
    }
  });

  it('stops at every wall and corner', () => {
    const state = openMatch();
    place(state, 0, 0, 0);
    place(state, 1, 0, 5);
    place(state, 2, 5, 0);
    place(state, 3, 5, 5);
    runChecked(state, [input(-1, -1), input(1, 1), input(1, -1), input(-1, 1)], 600);
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([-14.5, -9.5]);
    expect([champion(state, 1).x, champion(state, 1).y]).toEqual([14.5, 9.5]);
    expect([champion(state, 2).x, champion(state, 2).y]).toEqual([14.5, -9.5]);
    expect([champion(state, 3).x, champion(state, 3).y]).toEqual([-14.5, 9.5]);
  });
});

describe('rect obstacle', () => {
  it('slides along a face, then rounds the corner', () => {
    const state = createMatch(config2v2(), arena01, 1);
    // The rect at (-8, 0) is 1 x 3, so its west face is x = -8.5: contact at x = -9.
    place(state, 0, -9, -1);
    place(state, 1, -12, -8);
    place(state, 2, 12, 8);
    place(state, 3, 12, -8);
    const slide = BASE_MOVE_SPEED * Math.SQRT1_2 * DT;
    const startY = champion(state, 0).y;
    for (let i = 1; i <= 30; i++) {
      step(state, [input(1, 1, 0, 0)]);
      expect(checkInvariants(state)).toEqual([]);
      expect(champion(state, 0).x).toBeCloseTo(-9, 9);
      expect(champion(state, 0).y).toBeCloseTo(startY + i * slide, 9);
    }
    runChecked(state, [input(1, 1, 0, 0)], 120);
    expect(champion(state, 0).y).toBeGreaterThan(1.5);
    expect(champion(state, 0).x).toBeGreaterThan(-8.5);
  });

  it('pushes a champion whose centre is inside a rect out through the nearest face', () => {
    const state = openMatch([
      { type: 'rect', x: 0, y: 0, w: 4, h: 2, height: 1, blocksProjectiles: true },
    ]);
    place(state, 0, 0.5, 0.2);
    step(state, []);
    expect(checkInvariants(state)).toEqual([]);
    expect(champion(state, 0).y).toBe(1.5);
    expect(champion(state, 0).x).toBe(0.5);
  });
});

describe('circle obstacle', () => {
  it('deflects off an off-centre pillar contact', () => {
    const state = createMatch(config2v2(), arena01, 1);
    // The pillar at the origin has radius 1.5, so contact is at distance 2.
    place(state, 0, -3, 0.5);
    place(state, 1, -12, -8);
    place(state, 2, 12, 8);
    place(state, 3, 12, -8);
    let deflected = false;
    for (let i = 0; i < 180; i++) {
      step(state, [input(1, 0, 0, 0)]);
      expect(checkInvariants(state)).toEqual([]);
      if (champion(state, 0).y > 0.6) deflected = true;
    }
    expect(deflected).toBe(true);
    expect(champion(state, 0).x).toBeGreaterThan(2);
  });
});

describe('arena01 stress', () => {
  const targets: [string, number, number][] = [
    ...arena01.obstacles.map((o, i): [string, number, number] => [`obstacle ${i} centre`, o.x, o.y]),
    ['west wall', -100, 0],
    ['east wall', 100, 0],
    ['south wall', 0, -100],
    ['north wall', 0, 100],
    ['south-west corner', -100, -100],
    ['south-east corner', 100, -100],
    ['north-west corner', -100, 100],
    ['north-east corner', 100, 100],
  ];

  function steer(state: GameState, id: number, tx: number, ty: number): PlayerInput {
    const c = champion(state, id);
    const axis = (d: number): -1 | 0 | 1 => (d > 0.01 ? 1 : d < -0.01 ? -1 : 0);
    return input(axis(tx - c.x), axis(ty - c.y), Math.round(tx * 100), Math.round(ty * 100));
  }

  for (const [name, tx, ty] of targets) {
    it(`keeps every invariant while all champions drive at the ${name}`, () => {
      const state = createMatch(config2v2(), arena01, 7);
      for (let t = 0; t < 240; t++) {
        step(state, state.champions.map((c) => steer(state, c.id, tx, ty)));
        expect(checkInvariants(state)).toEqual([]);
      }
    });

    it(`keeps every invariant while one champion at a time drives at the ${name}`, () => {
      for (const driver of [0, 1, 2, 3]) {
        const state = createMatch(config2v2(), arena01, 7);
        for (let t = 0; t < 240; t++) {
          const inputs: (PlayerInput | undefined)[] = [];
          inputs[driver] = steer(state, driver, tx, ty);
          step(state, inputs);
          expect(checkInvariants(state)).toEqual([]);
        }
      }
    });
  }
});

describe('narrow gap', () => {
  it('never lets a champion into a gap narrower than its diameter', () => {
    const state = openMatch([
      { type: 'rect', x: 0, y: 0.95, w: 4, h: 1, height: 1, blocksProjectiles: true },
      { type: 'rect', x: 0, y: -0.95, w: 4, h: 1, height: 1, blocksProjectiles: true },
    ]);
    place(state, 0, -6, 0);
    runChecked(state, [input(1, 0, 0, 0)], 240);
    expect(champion(state, 0).x).toBeLessThan(-2);
  });
});

describe('champion against champion', () => {
  function parked(state: GameState): void {
    place(state, 1, -12, -8);
    place(state, 3, 12, -8);
  }

  it('stops two champions walking head-on at contact distance', () => {
    const state = openMatch();
    parked(state);
    place(state, 0, -2, 0);
    place(state, 2, 2, 0);
    for (let i = 0; i < 120; i++) {
      step(state, [input(1, 0), undefined, input(-1, 0)]);
      expect(pairDistance(state, 0, 2)).toBeGreaterThanOrEqual(1 - TOLERANCE);
      expect(checkInvariants(state)).toEqual([]);
    }
    expect(pairDistance(state, 0, 2)).toBeLessThan(1 + 2 * BASE_MOVE_SPEED * DT);
  });

  it('keeps a champion pinned against the wall while another pushes into it', () => {
    const state = openMatch();
    parked(state);
    place(state, 0, 12, 0);
    place(state, 2, 14.5, 0);
    for (let i = 0; i < 120; i++) {
      step(state, [input(1, 0), undefined, input(1, 0)]);
      expect(pairDistance(state, 0, 2)).toBeGreaterThanOrEqual(1 - TOLERANCE);
      expect(checkInvariants(state)).toEqual([]);
    }
    expect(champion(state, 2).x).toBe(14.5);
    expect(champion(state, 0).x).toBeCloseTo(13.5, 9);
  });

  it('does not let a champion shove another one', () => {
    const state = openMatch();
    parked(state);
    place(state, 0, 0, 0);
    place(state, 2, 1, 0);
    for (let i = 0; i < 60; i++) step(state, [input(1, 0)]);
    expect(champion(state, 2).x).toBe(1);
    expect(champion(state, 0).x).toBeCloseTo(0, 9);
  });

  it('slides a champion around an offset contact', () => {
    const state = openMatch();
    parked(state);
    place(state, 0, -2, 0);
    place(state, 2, 0, 0.5);
    for (let i = 0; i < 120; i++) {
      step(state, [input(1, 0)]);
      expect(pairDistance(state, 0, 2)).toBeGreaterThanOrEqual(1 - TOLERANCE);
      expect(checkInvariants(state)).toEqual([]);
    }
    expect(champion(state, 0).x).toBeGreaterThan(0.5);
    expect(champion(state, 0).y).toBeLessThan(0);
  });

  it('keeps three champions converging on one point apart', () => {
    const state = openMatch();
    place(state, 0, -3, 0);
    place(state, 1, 0, -3);
    place(state, 2, 3, 0);
    place(state, 3, 0, 3);
    const toward = (id: number): PlayerInput => {
      const c = champion(state, id);
      const axis = (d: number): -1 | 0 | 1 => (d > 0.01 ? 1 : d < -0.01 ? -1 : 0);
      return input(axis(-c.x), axis(-c.y));
    };
    for (let i = 0; i < 180; i++) {
      step(state, [toward(0), toward(1), toward(2), undefined]);
      expect(checkInvariants(state)).toEqual([]);
    }
  });
});

describe('resolveChampion result', () => {
  it('returns false when nothing pushed the champion', () => {
    const state = openMatch();
    expect(resolveChampion(state, champion(state, 0), -12, 2)).toBe(false);
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([-12, 2]);
  });

  it('returns true when a push moved the champion out of an obstacle', () => {
    const state = openMatch([{ type: 'circle', x: 0, y: 0, r: 1, height: 1, blocksProjectiles: true }]);
    place(state, 0, 1.2, 0);
    expect(resolveChampion(state, champion(state, 0), 3, 0)).toBe(true);
    expect(champion(state, 0).x).toBeCloseTo(1.5, 9);
  });

  it('returns true when it had to fall back to the previous position', () => {
    // The gap between the two walls is 0.6 m, narrower than a champion.
    const wall = (x: number): Obstacle => ({ type: 'rect', x, y: 0, w: 5, h: 10, height: 1, blocksProjectiles: true });
    const state = openMatch([wall(-2.8), wall(2.8)]);
    place(state, 0, 0, 0);
    expect(resolveChampion(state, champion(state, 0), 5, 5)).toBe(true);
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([5, 5]);
  });
});
