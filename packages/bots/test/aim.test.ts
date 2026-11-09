import { describe, expect, it } from 'vitest';
import { BASE_MOVE_SPEED, createMatch, debug, step } from '@claudeline/sim';
import type { AbilitySpec, GameState, MoveAxis } from '@claudeline/sim';
import {
  NOMINAL_PROJECTILE_SPEED,
  clampLead,
  interceptTime,
  leadCapOf,
  leadPoint,
  roundAim,
  rotateByHalfTangent,
} from '../src/aim';
import { arena01, config2v2 } from './helpers';

const S = NOMINAL_PROJECTILE_SPEED;

describe('leadPoint', () => {
  it('aims at the target when it stands still', () => {
    const lead = leadPoint({ x: -5, y: 1 }, { x: 4, y: -3 }, { x: 0, y: 0 }, S);
    expect(lead).toEqual({ x: 4, y: -3 });
  });

  it('falls back to the target when it stands on the shooter', () => {
    expect(leadPoint({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 }, S)).toEqual({ x: 1, y: 1 });
  });

  it('falls back to the target when it outruns the projectile', () => {
    expect(leadPoint({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 25, y: 0 }, S)).toEqual({ x: 5, y: 0 });
    expect(leadPoint({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 20, y: 0 }, S)).toEqual({ x: 5, y: 0 });
  });

  it('falls back to the target for non-finite input', () => {
    expect(leadPoint({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: Number.NaN, y: 0 }, S)).toEqual({
      x: 5,
      y: 0,
    });
  });

  it('solves the intercept equation to 1e-9 relative', () => {
    const cases = [
      { d: { x: 10, y: 0 }, v: { x: 0, y: 5.5 } },
      { d: { x: 8, y: -6 }, v: { x: -3.889087, y: 3.889087 } },
      { d: { x: -9, y: 2 }, v: { x: 5.5, y: 0 } },
      { d: { x: 3, y: 11 }, v: { x: 0, y: -5.5 } },
      { d: { x: 0.01, y: 0.02 }, v: { x: 5.5, y: 0 } },
    ];
    for (const { d, v } of cases) {
      const t = interceptTime(d, v, S);
      if (t === null) throw new Error('no intercept');
      expect(t).toBeGreaterThan(0);
      const miss = Math.hypot(d.x + v.x * t, d.y + v.y * t);
      expect(Math.abs(miss - S * t) / (S * t)).toBeLessThan(1e-9);
    }
  });

  it('is stable when the target moves toward the shooter fast', () => {
    const t = interceptTime({ x: 100, y: 0 }, { x: -19.999, y: 0 }, S);
    if (t === null) throw new Error('no intercept');
    expect(t).toBeCloseTo(100 / (S + 19.999), 9);
  });
});

describe('lead against the real projectile sweep', () => {
  const open = { ...arena01, obstacles: [] };

  function hitsAfterAim(
    start: { x: number; y: number },
    move: { moveX: MoveAxis; moveY: MoveAxis },
    aimAt: (state: GameState) => { x: number; y: number },
  ): boolean {
    const state = createMatch(config2v2(), open, 1);
    const shooter = state.champions[0];
    const target = state.champions[2];
    if (!shooter || !target) throw new Error('missing champions');
    for (const c of state.champions) if (c.id !== 0 && c.id !== 2) c.alive = false;
    shooter.x = -5;
    shooter.y = 0;
    target.x = start.x;
    target.y = start.y;
    const targetInput = { ...move, aimX: 0, aimY: 0, buttons: 0 };
    step(state, [undefined, undefined, targetInput]);

    const aim = aimAt(state);
    const aimX = roundAim(aim.x);
    const aimY = roundAim(aim.y);
    debug.spawnProjectile(state, {
      ownerId: 0,
      x: shooter.x,
      y: shooter.y,
      dirX: aimX / 100 - shooter.x,
      dirY: aimY / 100 - shooter.y,
      speed: S,
      radius: 0.2,
      lifetimeTicks: 120,
      pierce: false,
      effects: [{ type: 'damage', amount: 1 }],
    });
    for (let i = 0; i < 60; i++) {
      step(state, [undefined, undefined, targetInput]);
      if (state.events.some((e) => e.type === 'projectileHit')) return true;
    }
    return false;
  }

  const lead = (state: GameState) => {
    const shooter = state.champions[0];
    const target = state.champions[2];
    if (!shooter || !target) throw new Error('missing champions');
    return leadPoint(shooter, target, { x: target.vx, y: target.vy }, S);
  };
  const current = (state: GameState) => {
    const target = state.champions[2];
    if (!target) throw new Error('missing champion 2');
    return { x: target.x, y: target.y };
  };

  const cases: [string, { x: number; y: number }, { moveX: MoveAxis; moveY: MoveAxis }, boolean][] =
    [
      ['crossing', { x: 5, y: 0 }, { moveX: 0, moveY: 1 }, true],
      ['crossing the other way', { x: 5, y: 0 }, { moveX: 0, moveY: -1 }, true],
      ['diagonal', { x: 4, y: -3 }, { moveX: -1, moveY: 1 }, false],
      ['approaching', { x: 5, y: 0 }, { moveX: -1, moveY: 0 }, false],
      ['receding', { x: 3, y: 0 }, { moveX: 1, moveY: 0 }, false],
    ];

  for (const [name, start, move, crossing] of cases) {
    it(`hits a ${name} target at 8 to 12 m`, () => {
      expect(hitsAfterAim(start, move, lead)).toBe(true);
      if (crossing) expect(hitsAfterAim(start, move, current)).toBe(false);
    });
  }

  it('uses the walk speed the oracle assumes', () => {
    expect(BASE_MOVE_SPEED).toBeLessThan(S);
  });
});

describe('rotateByHalfTangent', () => {
  it('is exact for u = 0', () => {
    expect(rotateByHalfTangent(3, -4, 0)).toEqual({ x: 3, y: -4 });
  });

  it('keeps the length and turns by 2 atan(u)', () => {
    for (const u of [-0.105, -0.05, 0.017, 0.0524, 0.105]) {
      const r = rotateByHalfTangent(6, 2.5, u);
      expect(Math.hypot(r.x, r.y)).toBeCloseTo(Math.hypot(6, 2.5), 12);
      const turned = Math.atan2(r.y, r.x) - Math.atan2(2.5, 6);
      expect(turned).toBeCloseTo(2 * Math.atan(u), 12);
    }
  });
});

describe('roundAim', () => {
  it('rounds to whole centimetres and never returns -0', () => {
    expect(roundAim(1.234)).toBe(123);
    expect(roundAim(-1.236)).toBe(-124);
    expect(Object.is(roundAim(-0.001), 0)).toBe(true);
    expect(Object.is(roundAim(-0), 0)).toBe(true);
  });
});

describe('leadCapOf', () => {
  const areaEffect = (
    radius: number,
    durationTicks: number,
    intervalTicks: number,
    placement: unknown,
  ) => ({
    type: 'area' as const,
    placement,
    radius,
    durationTicks,
    intervalTicks,
    targets: 'enemies' as const,
    effects: [{ type: 'damage' as const, amount: 1 }],
  });
  const spec = (effects: unknown[]) =>
    ({ windupTicks: 0, movement: 'free' as const, effects }) as unknown as AbilitySpec;

  it('caps a one-hit aim-placed area at half its radius', () => {
    const s = spec([areaEffect(2, 1, 1, { type: 'aim', range: 9 })]);
    expect(leadCapOf(s)).toBe(1);
  });

  it('caps at zero for a zero-radius area', () => {
    const s = spec([areaEffect(0, 1, 1, { type: 'aim', range: 9 })]);
    expect(leadCapOf(s)).toBe(0);
  });

  it('does not cap a lingering area', () => {
    const s = spec([areaEffect(4, 300, 60, { type: 'aim', range: 8 })]);
    expect(leadCapOf(s)).toBe(Number.POSITIVE_INFINITY);
  });

  it('does not cap a self-placed or ahead-placed one-hit area', () => {
    expect(leadCapOf(spec([areaEffect(3.5, 1, 1, { type: 'self' })]))).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(leadCapOf(spec([areaEffect(3.5, 1, 1, { type: 'ahead', distance: 4 })]))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('reads Infinity for a spec with no area, and for none', () => {
    expect(leadCapOf(spec([{ type: 'dash', distance: 4, ticks: 6, then: [] }]))).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(leadCapOf(undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads the first one-hit aim area, not a later one', () => {
    const s = spec([
      { type: 'dash', distance: 4, ticks: 6, then: [] },
      areaEffect(2, 1, 1, { type: 'aim', range: 9 }),
      areaEffect(8, 1, 1, { type: 'aim', range: 9 }),
    ]);
    expect(leadCapOf(s)).toBe(1);
  });
});

describe('clampLead', () => {
  it('leaves an offset inside the cap alone', () => {
    expect(clampLead({ x: 4, y: 3 }, { x: 0, y: 0 }, 10)).toEqual({ x: 4, y: 3 });
  });

  it('leaves an offset exactly at the cap alone', () => {
    expect(clampLead({ x: 10, y: 0 }, { x: 0, y: 0 }, 10)).toEqual({ x: 10, y: 0 });
    expect(clampLead({ x: 30, y: 40 }, { x: 0, y: 0 }, 50)).toEqual({ x: 30, y: 40 });
  });

  it('scales an offset past the cap to the cap', () => {
    const at = clampLead({ x: 20, y: 0 }, { x: 0, y: 0 }, 10);
    expect(at.x).toBeCloseTo(10, 12);
    expect(at.y).toBe(0);
    expect(Math.hypot(at.x, at.y)).toBeCloseTo(10, 12);
  });

  it('measures the offset from the subject, not the origin', () => {
    const at = clampLead({ x: 13, y: 4 }, { x: 3, y: 4 }, 5);
    expect(Math.hypot(at.x - 3, at.y - 4)).toBeCloseTo(5, 12);
    expect(at.x - 3).toBeCloseTo(5, 12);
    expect(at.y).toBeCloseTo(4, 12);
  });

  it('leaves an infinite cap alone', () => {
    expect(clampLead({ x: 1000, y: -2000 }, { x: 5, y: 5 }, Number.POSITIVE_INFINITY)).toEqual({
      x: 1000,
      y: -2000,
    });
  });

  it('leaves a zero offset alone at any cap, including zero', () => {
    expect(clampLead({ x: 3, y: 4 }, { x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
  });
});
