import { describe, expect, it } from 'vitest';
import { createMatch, step } from '../src/index';
import type { GameState } from '../src/index';
import { applyDamage, applyEffects, applyHeal } from '../src/health';
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
    applyEffects(state, 0, 2, [
      { type: 'damage', amount: 50 },
      { type: 'heal', amount: 20 },
    ]);
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
