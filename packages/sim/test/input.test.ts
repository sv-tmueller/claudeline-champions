import { describe, expect, it } from 'vitest';
import { Button, checksum, createMatch, step } from '../src/index';
import { resolveInput } from '../src/input';
import type { GameState, PlayerInput } from '../src/index';
import { champion, config2v2, openArena } from './helpers';

function open(): GameState {
  return createMatch(config2v2(), openArena(), 1);
}

/** Builds an input from untrusted values, as a network peer could send. */
function raw(fields: Record<string, unknown>): PlayerInput {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0, ...fields } as unknown as PlayerInput;
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
    const valid: PlayerInput = { moveX: -1, moveY: 1, aimX: 123, aimY: -45, buttons: 5 };
    expect(resolveInput(valid, 9, 9)).toEqual(valid);
  });
});
