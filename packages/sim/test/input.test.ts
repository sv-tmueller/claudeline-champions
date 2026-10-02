import { describe, expect, it } from 'vitest';
import { Button, checksum, cloneState, createMatch, step } from '../src/index';
import { SLOTS, resolveInput } from '../src/input';
import type { GameState, PlayerInput } from '../src/index';
import { champion, config2v2, input, openArena } from './helpers';

function open(): GameState {
  return createMatch(config2v2(), openArena(), 1);
}

/** Builds an input from untrusted values, as a network peer could send. */
function raw(fields: Record<string, unknown>): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    buttons: 0,
    ...fields,
  } as unknown as PlayerInput;
}

function walk(fields: Record<string, unknown>, ticks = 60): GameState {
  const state = open();
  for (let i = 0; i < ticks; i++) step(state, [raw(fields)]);
  return state;
}

describe('input sanitizing', () => {
  const start = champion(open(), 0);

  it.each([
    ['0.5', 0.5],
    ['5', 5],
    ['-5', -5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['the string "1"', '1'],
    ['null', null],
  ])('treats a moveX of %s as no movement', (_name, value) => {
    const state = walk({ moveX: value });
    const c = champion(state, 0);
    expect(c.x).toBe(start.x);
    expect(c.y).toBe(start.y);
    expect(() => checksum(state)).not.toThrow();
  });

  it.each([
    ['0.5', 0.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['the string "1"', '1'],
  ])('treats a moveY of %s as no movement', (_name, value) => {
    const state = walk({ moveY: value });
    const c = champion(state, 0);
    expect(c.x).toBe(start.x);
    expect(c.y).toBe(start.y);
    expect(() => checksum(state)).not.toThrow();
  });

  it('zeroes only the invalid axis and keeps the valid one', () => {
    const state = walk({ moveX: 1, moveY: NaN });
    const c = champion(state, 0);
    expect(c.x - start.x).toBeCloseTo(5.5, 9);
    expect(c.y).toBe(start.y);
  });

  it('keeps the stored aim and facing for a non-finite aim', () => {
    const state = open();
    step(state, [raw({ aimX: 1000, aimY: 500 })]);
    const before = { ...champion(state, 0) };
    step(state, [raw({ aimX: NaN, aimY: Infinity })]);
    const c = champion(state, 0);
    expect(c.aimX).toBe(before.aimX);
    expect(c.aimY).toBe(before.aimY);
    expect(c.facing).toBe(before.facing);
    expect(Number.isFinite(c.facing)).toBe(true);
    expect(() => checksum(state)).not.toThrow();
  });

  it('keeps the stored value only for the non-finite aim coordinate', () => {
    const state = open();
    step(state, [raw({ aimX: 1000, aimY: 500 })]);
    step(state, [raw({ aimX: 2000, aimY: NaN })]);
    const c = champion(state, 0);
    expect(c.aimX).toBe(2000);
    expect(c.aimY).toBe(500);
  });

  it('masks buttons to the eight defined bits', () => {
    const all = Object.values(Button).reduce((a, b) => a | b, 0);
    expect(resolveInput(raw({ buttons: 256 }), 0, 0).buttons).toBe(0);
    expect(resolveInput(raw({ buttons: 256 + Button.Q }), 0, 0).buttons).toBe(Button.Q);
    expect(resolveInput(raw({ buttons: all }), 0, 0).buttons).toBe(all);
  });

  it.each([
    ['-1', -1],
    ['1.5', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['the string "4"', '4'],
  ])('treats buttons of %s as 0', (_name, value) => {
    expect(resolveInput(raw({ buttons: value }), 0, 0).buttons).toBe(0);
  });

  it('passes a valid input through unchanged', () => {
    const valid: PlayerInput = {
      moveX: -1,
      moveY: 1,
      aimX: 123,
      aimY: -45,
      buttons: 5,
    };
    expect(resolveInput(valid, 9, 9)).toEqual(valid);
  });

  it('normalizes a -0 aim so the state survives a JSON round trip', () => {
    const state = open();
    // At y = +0 a westward aim makes atan2 depend on the sign of the aim's zero.
    champion(state, 0).y = 0;
    step(state, [raw({ aimX: -1000, aimY: -0 })]);
    expect(Object.is(champion(state, 0).aimY, -0)).toBe(false);
    expect(Object.is(champion(state, 0).aimX, -0)).toBe(false);
    const clone = cloneState(state);
    step(state, []);
    step(clone, []);
    expect(checksum(clone)).toBe(checksum(state));
  });

  it('normalizes a -0 aimX as well', () => {
    expect(Object.is(resolveInput(raw({ aimX: -0 }), 5, 5).aimX, -0)).toBe(false);
  });
});

describe('malformed input entries', () => {
  it('treats a null entry as a missing input without throwing', () => {
    const state = open();
    const before = state.champions.map((c) => ({ ...c }));
    const tick = state.tick;
    expect(() => step(state, [null as unknown as PlayerInput])).not.toThrow();
    expect(state.tick).toBe(tick + 1);
    state.champions.forEach((c, i) => {
      expect(c.x).toBe(before[i]?.x);
      expect(c.y).toBe(before[i]?.y);
      expect(c.aimX).toBe(before[i]?.aimX);
      expect(c.aimY).toBe(before[i]?.aimY);
    });
  });

  it('moves the other champions normally around a null entry', () => {
    const state = open();
    const start = state.champions.map((c) => ({ x: c.x, y: c.y }));
    const entries = [input(1, 0), null, input(0, 1), input(-1, 0)] as unknown as PlayerInput[];
    for (let i = 0; i < 30; i++) step(state, entries);
    expect(champion(state, 1).x).toBe(start[1]?.x);
    expect(champion(state, 1).y).toBe(start[1]?.y);
    expect(champion(state, 0).x).toBeGreaterThan(start[0]?.x ?? 0);
    expect(champion(state, 2).y).toBeGreaterThan(start[2]?.y ?? 0);
    expect(champion(state, 3).x).toBeLessThan(start[3]?.x ?? 0);
  });

  it.each([
    ['a number', 5],
    ['a string', 'move'],
    ['an array', [1, 0, 0, 0, 0]],
    ['a boolean', true],
  ])('treats %s as a missing input', (_name, value) => {
    const state = open();
    const before = { ...champion(state, 0) };
    expect(() => step(state, [value as unknown as PlayerInput])).not.toThrow();
    const c = champion(state, 0);
    expect(c.x).toBe(before.x);
    expect(c.y).toBe(before.y);
    expect(c.aimX).toBe(before.aimX);
    expect(c.aimY).toBe(before.aimY);
  });
});

describe('aim rounding', () => {
  it.each([
    [0.5, 1],
    [-0.5, 0],
    [1234.4, 1234],
    [-1234.6, -1235],
    [1e-320, 0],
  ])('rounds an aim of %s to the integer %s', (value, expected) => {
    const aim = resolveInput(raw({ aimX: value, aimY: value }), 9, 9);
    expect(Object.is(aim.aimX, expected)).toBe(true);
    expect(Object.is(aim.aimY, expected)).toBe(true);
  });
});

describe('an input entry that throws on read', () => {
  it('makes step throw and leaves the state unchanged', () => {
    const state = open();
    step(state, [input(1, 0, 500, 100)]);
    const before = JSON.stringify(state);
    const poisoned = {
      moveX: 1,
      moveY: 0,
      get aimX(): number {
        throw new Error('poisoned');
      },
      aimY: 0,
      buttons: 0,
    } as unknown as PlayerInput;
    const inputs = [input(1, 0), input(0, 1), input(-1, 0), poisoned];
    expect(() => step(state, inputs)).toThrow('poisoned');
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('SLOTS', () => {
  it('lists the slots in Button bit order, so the index is the bit position', () => {
    expect(SLOTS).toEqual(['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F']);
    SLOTS.forEach((slot, i) => expect(Button[slot]).toBe(1 << i));
  });
});
