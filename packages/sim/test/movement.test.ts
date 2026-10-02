import { describe, expect, it } from 'vitest';
import { BASE_MOVE_SPEED, DT, createMatch, step } from '../src/index';
import type { GameState, PlayerInput } from '../src/index';
import { atan2 } from '../src/dmath';
import { champion, config2v2, input, openArena } from './helpers';

function open(): GameState {
  return createMatch(config2v2(), openArena(), 1);
}

function run(state: GameState, inputs: (PlayerInput | undefined)[], ticks: number): void {
  for (let i = 0; i < ticks; i++) step(state, inputs);
}

describe('movement', () => {
  it('moves W+D 5.5 m in one second, not 5.5 times root two', () => {
    const state = open();
    const [x0, y0] = [champion(state, 0).x, champion(state, 0).y];
    run(state, [input(1, 1, 0, 0)], 60);
    const c = champion(state, 0);
    expect(Math.hypot(c.x - x0, c.y - y0)).toBeCloseTo(5.5, 9);
    expect(c.x - x0).toBeCloseTo(5.5 * Math.SQRT1_2, 9);
    expect(c.y - y0).toBeCloseTo(5.5 * Math.SQRT1_2, 9);
  });

  it('moves a straight move 5.5 m in one second', () => {
    const state = open();
    const [x0, y0] = [champion(state, 1).x, champion(state, 1).y];
    run(state, [undefined, input(1, 0, 0, 0)], 60);
    const c = champion(state, 1);
    expect(c.x - x0).toBeCloseTo(5.5, 9);
    expect(c.y).toBe(y0);
  });

  it('stores the walk velocity', () => {
    const state = open();
    step(state, [input(1, 1, 0, 0)]);
    const c = champion(state, 0);
    expect(Math.hypot(c.vx, c.vy)).toBeCloseTo(BASE_MOVE_SPEED, 12);
    expect(c.vx).toBeCloseTo(BASE_MOVE_SPEED * Math.SQRT1_2, 12);
    step(state, [input(-1, 0, 0, 0)]);
    expect(champion(state, 0).vx).toBe(-BASE_MOVE_SPEED);
    expect(champion(state, 0).vy).toBe(0);
  });

  it('advances one DT of travel per tick', () => {
    const state = open();
    const x0 = champion(state, 0).x;
    step(state, [input(1, 0, 0, 0)]);
    expect(champion(state, 0).x).toBe(x0 + BASE_MOVE_SPEED * DT);
  });

  it('keeps a zero move vector at zero', () => {
    const state = open();
    step(state, [input(0, 0, 0, 0)]);
    expect(champion(state, 0).vx).toBe(0);
    expect(champion(state, 0).vy).toBe(0);
  });

  it('points the facing at the aim point', () => {
    const state = open();
    // Champion 0 stands at (-12, 2). Aim straight north of it, then straight west.
    step(state, [input(0, 0, -1200, 300)]);
    expect(champion(state, 0).facing).toBe(Math.PI / 2);
    step(state, [input(0, 0, -1300, 200)]);
    expect(champion(state, 0).facing).toBe(Math.PI);
    step(state, [input(0, 0, -1200, 100)]);
    expect(champion(state, 0).facing).toBe(-Math.PI / 2);
  });

  it('uses the position after the move for the facing', () => {
    const state = open();
    step(state, [input(1, 0, -1100, 300)]);
    const c = champion(state, 0);
    expect(c.facing).toBe(atan2(3 - c.y, -11 - c.x));
  });

  it('keeps the old facing when the aim is exactly on the champion', () => {
    const state = open();
    step(state, [input(0, 0, -1200, 300)]);
    step(state, [input(0, 0, -1200, 200)]);
    expect(champion(state, 0).facing).toBe(Math.PI / 2);
  });

  it('treats a missing input as no movement, no buttons and the aim unchanged', () => {
    const state = open();
    step(state, [input(1, 1, -500, 700, 255)]);
    const moved = { ...champion(state, 0) };
    expect(moved.aimX).toBe(-500);
    expect(moved.aimY).toBe(700);

    step(state, [undefined]);
    const c = champion(state, 0);
    expect([c.vx, c.vy]).toEqual([0, 0]);
    expect([c.x, c.y]).toEqual([moved.x, moved.y]);
    expect([c.aimX, c.aimY]).toEqual([-500, 700]);

    step(state, []);
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([moved.x, moved.y]);
  });

  it('moves every champion from its own input slot', () => {
    const state = open();
    const before = state.champions.map((c) => [c.x, c.y]);
    step(state, [input(0, 1), input(0, -1), input(1, 0), input(-1, 0)]);
    const after = state.champions.map((c) => [c.x, c.y]);
    expect(after[0]?.[1]).toBeGreaterThan(before[0]?.[1] ?? Infinity);
    expect(after[1]?.[1]).toBeLessThan(before[1]?.[1] ?? -Infinity);
    expect(after[2]?.[0]).toBeGreaterThan(before[2]?.[0] ?? Infinity);
    expect(after[3]?.[0]).toBeLessThan(before[3]?.[0] ?? -Infinity);
  });

  it('increments the tick and clears the events at the start of each tick', () => {
    const state = open();
    (state.events as unknown[]).push('leftover');
    step(state, []);
    expect(state.events).toEqual([]);
    expect(state.tick).toBe(1);
    step(state, []);
    expect(state.tick).toBe(2);
  });
});
