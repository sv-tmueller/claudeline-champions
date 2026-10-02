import { describe, expect, it } from 'vitest';
import { MAX_MAGNITUDE, MAX_STATUS_TICKS, createMatch, step } from '../src/index';
import type { Effect, GameState } from '../src/index';
import { applyDamage, applyEffects, applyHeal, copyEffects } from '../src/health';
import { applyShield, applyStatus } from '../src/status';
import { champion, config2v2, input, openArena, place } from './helpers';

function open(): GameState {
  return createMatch(config2v2(), openArena(), 1);
}

function kill(state: GameState, id: number): void {
  applyDamage(state, id, 1000, 0);
  state.events.length = 0;
}

describe('applyDamage', () => {
  it('removes health, returns the amount and emits a damage event with it', () => {
    const state = open();
    expect(applyDamage(state, 2, 30, 0)).toBe(30);
    expect(champion(state, 2).health).toBe(90);
    expect(state.events).toEqual([
      { type: 'damage', targetId: 2, sourceId: 0, amount: 30, health: 90 },
    ]);
  });

  it('clamps overkill at 0 and reports the health actually removed', () => {
    const state = open();
    champion(state, 2).health = 10;
    expect(applyDamage(state, 2, 25, 0)).toBe(10);
    expect(champion(state, 2).health).toBe(0);
    expect(state.events[0]).toEqual({
      type: 'damage',
      targetId: 2,
      sourceId: 0,
      amount: 10,
      health: 0,
    });
  });

  it('kills once: alive false, velocity zeroed, death right after the damage event', () => {
    const state = open();
    champion(state, 2).vx = 3;
    champion(state, 2).vy = -2;
    applyDamage(state, 2, 500, 1);
    const c = champion(state, 2);
    expect(c.alive).toBe(false);
    expect([c.vx, c.vy]).toEqual([0, 0]);
    expect(state.events.map((e) => e.type)).toEqual(['damage', 'death']);
    expect(state.events[1]).toEqual({ type: 'death', targetId: 2, sourceId: 1 });
  });

  it('does nothing to a dead champion', () => {
    const state = open();
    kill(state, 2);
    expect(applyDamage(state, 2, 10, 0)).toBe(0);
    expect(state.events).toEqual([]);
    expect(champion(state, 2).health).toBe(0);
  });

  it('is a no-op for an amount of 0', () => {
    const state = open();
    expect(applyDamage(state, 2, 0, 0)).toBe(0);
    expect(state.events).toEqual([]);
    expect(champion(state, 2).health).toBe(120);
  });

  it.each([NaN, Infinity, -Infinity, -1])('throws on an amount of %s', (amount) => {
    const state = open();
    expect(() => applyDamage(state, 2, amount, 0)).toThrow('Invalid damage');
    expect(() => applyHeal(state, 2, amount, 0)).toThrow('Invalid heal');
    expect(champion(state, 2).health).toBe(120);
  });

  it('throws on an unknown target', () => {
    expect(() => applyDamage(open(), 9, 5, 0)).toThrow('Invalid damage');
  });

  it('emits nothing when the amount is too small to change the health', () => {
    const state = open();
    champion(state, 2).health = 50;
    expect(applyDamage(state, 2, 1e-20, 0)).toBe(0);
    expect(champion(state, 2).health).toBe(50);
    expect(state.events).toEqual([]);
  });
});

describe('applyHeal', () => {
  it('clamps at max health and reports the health actually restored', () => {
    const state = open();
    champion(state, 2).health = 100;
    expect(applyHeal(state, 2, 50, 0)).toBe(20);
    expect(champion(state, 2).health).toBe(120);
    expect(state.events).toEqual([
      { type: 'heal', targetId: 2, sourceId: 0, amount: 20, health: 120 },
    ]);
  });

  it('emits no event at full health', () => {
    const state = open();
    expect(applyHeal(state, 2, 10, 0)).toBe(0);
    expect(state.events).toEqual([]);
  });

  it('emits nothing when the amount is too small to change the health', () => {
    const state = open();
    champion(state, 2).health = 50;
    expect(applyHeal(state, 2, 1e-20, 0)).toBe(0);
    expect(champion(state, 2).health).toBe(50);
    expect(state.events).toEqual([]);
  });

  it('does not revive a dead champion', () => {
    const state = open();
    kill(state, 2);
    expect(applyHeal(state, 2, 50, 0)).toBe(0);
    expect(champion(state, 2).health).toBe(0);
    expect(champion(state, 2).alive).toBe(false);
    expect(state.events).toEqual([]);
  });

  it('is a no-op for an amount of 0', () => {
    const state = open();
    champion(state, 2).health = 50;
    expect(applyHeal(state, 2, 0, 0)).toBe(0);
    expect(state.events).toEqual([]);
  });
});

describe('applyEffects', () => {
  it('applies the effects in order', () => {
    const state = open();
    applyEffects(
      state,
      0,
      2,
      [
        { type: 'damage', amount: 50 },
        { type: 'heal', amount: 20 },
      ],
      { x: 0, y: 0 },
    );
    expect(champion(state, 2).health).toBe(90);
    expect(state.events.map((e) => e.type)).toEqual(['damage', 'heal']);
  });
});

describe('dead champions in the step loop', () => {
  it('ignores 60 ticks of input: no move, aim or facing change', () => {
    const state = open();
    kill(state, 0);
    const before = { ...champion(state, 0) };
    for (let i = 0; i < 60; i++) step(state, [input(1, 1, 5000, 4000, 1)]);
    const c = champion(state, 0);
    expect([c.x, c.y, c.aimX, c.aimY, c.facing]).toEqual([
      before.x,
      before.y,
      before.aimX,
      before.aimY,
      before.facing,
    ]);
    expect([c.vx, c.vy]).toEqual([0, 0]);
  });

  it('lets an alive champion walk through the spot of a dead one', () => {
    const state = open();
    place(state, 0, -3, 0);
    place(state, 1, -2, 0);
    kill(state, 1);
    for (let i = 0; i < 60; i++) step(state, [input(1, 0)]);
    expect(champion(state, 0).x).toBeCloseTo(-3 + 5.5, 9);
    expect(champion(state, 0).y).toBe(0);
  });

  it('still stops at a living champion', () => {
    const state = open();
    place(state, 0, -3, 0);
    place(state, 1, -2, 0);
    for (let i = 0; i < 60; i++) step(state, [input(1, 0)]);
    expect(champion(state, 0).x).toBeCloseTo(-3, 9);
  });
});

const SRC = (sourceId: number) => ({ sourceId, slot: null });

describe('damage and shields', () => {
  it('absorbs part of a hit, keeps the rest of the shield and emits no damage', () => {
    const state = open();
    applyShield(state, 2, { absorb: 50, ticks: 200 }, SRC(2));
    state.events.length = 0;
    expect(applyDamage(state, 2, 20, 0)).toBe(0);
    expect(champion(state, 2).health).toBe(120);
    expect(champion(state, 2).statuses).toMatchObject([{ type: 'shield', absorb: 30 }]);
    expect(state.events).toEqual([
      { type: 'shieldAbsorbed', targetId: 2, sourceId: 0, amount: 20, absorbLeft: 30 },
    ]);
  });

  it('ends a used-up shield as depleted and sends the rest to health', () => {
    const state = open();
    applyShield(state, 2, { absorb: 20, ticks: 200 }, SRC(2));
    state.events.length = 0;
    expect(applyDamage(state, 2, 30, 0)).toBe(10);
    expect(champion(state, 2).health).toBe(110);
    expect(champion(state, 2).statuses).toEqual([]);
    expect(state.events).toEqual([
      { type: 'shieldAbsorbed', targetId: 2, sourceId: 0, amount: 20, absorbLeft: 0 },
      { type: 'statusExpired', targetId: 2, sourceId: 2, slot: null, status: 'shield', reason: 'depleted' },
      { type: 'damage', targetId: 2, sourceId: 0, amount: 10, health: 110 },
    ]);
  });

  it('depletes a shield that exactly matches the hit and emits no damage', () => {
    const state = open();
    applyShield(state, 2, { absorb: 20, ticks: 200 }, SRC(2));
    state.events.length = 0;
    expect(applyDamage(state, 2, 20, 0)).toBe(0);
    expect(state.events.map((e) => e.type)).toEqual(['shieldAbsorbed', 'statusExpired']);
  });

  it('uses shields in array order, oldest first, with one absorb event per hit', () => {
    const state = open();
    applyShield(state, 2, { absorb: 10, ticks: 200 }, SRC(0));
    applyShield(state, 2, { absorb: 30, ticks: 100 }, SRC(1));
    state.events.length = 0;
    expect(applyDamage(state, 2, 25, 3)).toBe(0);
    expect(champion(state, 2).statuses).toMatchObject([{ sourceId: 1, absorb: 15 }]);
    expect(state.events).toEqual([
      { type: 'shieldAbsorbed', targetId: 2, sourceId: 3, amount: 25, absorbLeft: 15 },
      { type: 'statusExpired', targetId: 2, sourceId: 0, slot: null, status: 'shield', reason: 'depleted' },
    ]);
  });

  it('uses the refreshed shield last', () => {
    const state = open();
    applyShield(state, 2, { absorb: 10, ticks: 200 }, SRC(0));
    applyShield(state, 2, { absorb: 10, ticks: 200 }, SRC(1));
    applyShield(state, 2, { absorb: 10, ticks: 200 }, SRC(0));
    applyDamage(state, 2, 15, 3);
    expect(champion(state, 2).statuses).toMatchObject([{ sourceId: 0, absorb: 5 }]);
  });

  it('spends several shields and then health', () => {
    const state = open();
    applyShield(state, 2, { absorb: 10, ticks: 200 }, SRC(0));
    applyShield(state, 2, { absorb: 10, ticks: 200 }, SRC(1));
    state.events.length = 0;
    expect(applyDamage(state, 2, 35, 3)).toBe(15);
    expect(state.events.map((e) => e.type)).toEqual([
      'shieldAbsorbed',
      'statusExpired',
      'statusExpired',
      'damage',
    ]);
    expect(state.events[0]).toMatchObject({ amount: 20, absorbLeft: 0 });
  });

  it('leaves shields alone for a zero amount', () => {
    const state = open();
    applyShield(state, 2, { absorb: 20, ticks: 200 }, SRC(2));
    state.events.length = 0;
    applyDamage(state, 2, 0, 0);
    expect(champion(state, 2).statuses).toMatchObject([{ absorb: 20 }]);
    expect(state.events).toEqual([]);
  });

  it('still throws for a bad amount or target', () => {
    const state = open();
    applyShield(state, 2, { absorb: 20, ticks: 200 }, SRC(2));
    expect(() => applyDamage(state, 2, -1, 0)).toThrow('Invalid damage');
    expect(() => applyDamage(state, 9, 1, 0)).toThrow('Invalid damage: unknown target 9');
    expect(champion(state, 2).statuses).toMatchObject([{ absorb: 20 }]);
  });
});

describe('invulnerable', () => {
  it('takes no damage: 0 back, no event, shields and health untouched', () => {
    const state = open();
    applyShield(state, 2, { absorb: 20, ticks: 200 }, SRC(2));
    applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, SRC(2));
    state.events.length = 0;
    expect(applyDamage(state, 2, 50, 0)).toBe(0);
    expect(champion(state, 2).health).toBe(120);
    expect(champion(state, 2).statuses).toMatchObject([{ absorb: 20 }, { type: 'invulnerable' }]);
    expect(state.events).toEqual([]);
  });

  it('still takes a heal', () => {
    const state = open();
    champion(state, 2).health = 50;
    applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, SRC(2));
    expect(applyHeal(state, 2, 20, 0)).toBe(20);
  });

  it('still throws for a bad amount', () => {
    const state = open();
    applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, SRC(2));
    expect(() => applyDamage(state, 2, NaN, 0)).toThrow('Invalid damage');
  });
});

describe('death', () => {
  it('ends every status in application order, then the dash, after the death event', () => {
    const state = open();
    applyStatus(state, 2, { type: 'slow', percent: 30, ticks: 60 }, SRC(0));
    applyShield(state, 2, { absorb: 5, ticks: 200 }, SRC(1));
    applyStatus(state, 2, { type: 'stun', ticks: 60 }, SRC(0));
    champion(state, 2).dash = { dirX: 1, dirY: 0, stepLength: 0.1, ticksLeft: 4 };
    champion(state, 2).health = 10;
    state.events.length = 0;
    applyDamage(state, 2, 100, 0);
    expect(state.events).toEqual([
      { type: 'shieldAbsorbed', targetId: 2, sourceId: 0, amount: 5, absorbLeft: 0 },
      { type: 'statusExpired', targetId: 2, sourceId: 1, slot: null, status: 'shield', reason: 'depleted' },
      { type: 'damage', targetId: 2, sourceId: 0, amount: 10, health: 0 },
      { type: 'death', targetId: 2, sourceId: 0 },
      { type: 'statusExpired', targetId: 2, sourceId: 0, slot: null, status: 'slow', reason: 'death' },
      { type: 'statusExpired', targetId: 2, sourceId: 0, slot: null, status: 'stun', reason: 'death' },
      { type: 'dashEnded', championId: 2, x: 12, y: 2, reason: 'death' },
    ]);
    expect(champion(state, 2).statuses).toEqual([]);
    expect(champion(state, 2).dash).toBeNull();
  });
});

describe('applyEffects with the toolkit effects', () => {
  const hit = { x: 0, y: 0 };

  it('applies a status effect from the source with no slot', () => {
    const state = open();
    applyEffects(state, 0, 2, [{ type: 'applyStatus', status: { type: 'slow', percent: 30, ticks: 60 } }], hit);
    expect(champion(state, 2).statuses).toEqual([
      { type: 'slow', sourceId: 0, slot: null, remainingTicks: 60, percent: 30 },
    ]);
  });

  it('applies a shield effect to the target', () => {
    const state = open();
    applyEffects(state, 0, 2, [{ type: 'shield', absorb: 30, ticks: 120 }], hit);
    expect(champion(state, 2).statuses).toEqual([
      { type: 'shield', sourceId: 0, slot: null, remainingTicks: 120, absorb: 30 },
    ]);
  });

  it('pushes a target away from the hit origin', () => {
    const state = open();
    place(state, 2, 5, 0);
    applyEffects(state, 0, 2, [{ type: 'knockback', distance: 3, ticks: 10, direction: 'away' }], { x: 5, y: -4 });
    expect(champion(state, 2).statuses).toMatchObject([
      { type: 'knockback', dirX: 0, dirY: 1, distance: 3, totalTicks: 10 },
    ]);
  });

  it('pulls a target toward the owner with toward', () => {
    const state = open();
    place(state, 0, 0, 0);
    place(state, 2, 3, 4);
    applyEffects(state, 0, 2, [{ type: 'knockback', distance: 3, ticks: 10, direction: 'toward' }], { x: 99, y: 99 });
    const k = champion(state, 2).statuses[0] as { dirX: number; dirY: number };
    expect(k.dirX).toBeCloseTo(-0.6, 15);
    expect(k.dirY).toBeCloseTo(-0.8, 15);
  });

  it('gives no push when the vector is zero', () => {
    const state = open();
    place(state, 2, 5, 5);
    applyEffects(state, 0, 2, [{ type: 'knockback', distance: 3, ticks: 10, direction: 'away' }], { x: 5, y: 5 });
    place(state, 0, 5, 5);
    applyEffects(state, 0, 2, [{ type: 'knockback', distance: 3, ticks: 10, direction: 'toward' }], hit);
    expect(champion(state, 2).statuses).toEqual([]);
  });
});

describe('copyEffects', () => {
  const reject = (problem: string): never => {
    throw new Error(`Rejected: ${problem}`);
  };

  it('copies the new effect types so the caller keeps no alias', () => {
    const status = { type: 'slow' as const, percent: 30, ticks: 60 };
    const effects: Effect[] = [
      { type: 'applyStatus', status },
      { type: 'shield', absorb: 20, ticks: 100 },
      { type: 'knockback', distance: 2, ticks: 8, direction: 'away' },
    ];
    const copy = copyEffects(effects, reject);
    expect(copy).toEqual(effects);
    status.percent = 99;
    expect(copy[0]).toMatchObject({ status: { percent: 30 } });
    expect(copy[1]).not.toBe(effects[1]);
  });

  it('rejects a bad new effect with the reject callback', () => {
    const bad: unknown[] = [
      { type: 'applyStatus', status: { type: 'burn', ticks: 5 } },
      { type: 'applyStatus', status: { type: 'slow', percent: 0, ticks: 5 } },
      { type: 'applyStatus' },
      { type: 'shield', absorb: 0, ticks: 100 },
      { type: 'shield', absorb: 20, ticks: 1.5 },
      { type: 'knockback', distance: 0, ticks: 8, direction: 'away' },
      { type: 'knockback', distance: 2, ticks: 0, direction: 'away' },
      { type: 'knockback', distance: 2, ticks: 8, direction: 'sideways' },
      { type: 'knockback', distance: 2, ticks: 8 },
    ];
    for (const effect of bad) {
      expect(() => copyEffects([effect as Effect], reject), JSON.stringify(effect)).toThrow(/^Rejected: /);
    }
  });

  it('accepts ticks and magnitudes at the bounds and rejects one past them', () => {
    const atBound: Effect[] = [
      { type: 'applyStatus', status: { type: 'stun', ticks: MAX_STATUS_TICKS } },
      { type: 'applyStatus', status: { type: 'dot', perPulse: MAX_MAGNITUDE, ticks: MAX_STATUS_TICKS } },
      { type: 'shield', absorb: MAX_MAGNITUDE, ticks: MAX_STATUS_TICKS },
      { type: 'knockback', distance: MAX_MAGNITUDE, ticks: MAX_STATUS_TICKS, direction: 'away' },
    ];
    expect(copyEffects(atBound, reject)).toEqual(atBound);
    const past: Effect[] = [
      { type: 'applyStatus', status: { type: 'root', ticks: MAX_STATUS_TICKS + 1 } },
      { type: 'applyStatus', status: { type: 'hot', perPulse: MAX_MAGNITUDE + 1, ticks: 60 } },
      { type: 'shield', absorb: MAX_MAGNITUDE + 1, ticks: 60 },
      { type: 'shield', absorb: 20, ticks: MAX_STATUS_TICKS + 1 },
      { type: 'knockback', distance: MAX_MAGNITUDE + 1, ticks: 8, direction: 'away' },
      { type: 'knockback', distance: 2, ticks: MAX_STATUS_TICKS + 1, direction: 'toward' },
      { type: 'knockback', distance: 1, ticks: 1e200, direction: 'away' },
    ];
    for (const effect of past) {
      expect(() => copyEffects([effect], reject), JSON.stringify(effect)).toThrow(/^Rejected: /);
    }
  });

  it('keeps the existing messages for the old types', () => {
    expect(() => copyEffects([{ type: 'burn' } as never], reject)).toThrow('Rejected: unknown effect type burn');
    expect(() => copyEffects([{ type: 'damage', amount: 0 }], reject)).toThrow(
      'Rejected: effect amount 0 is not a number above 0',
    );
    expect(() => copyEffects('x' as never, reject)).toThrow('Rejected: effects must be an array');
  });
});
