import { describe, expect, it } from 'vitest';
import { DT, TICK_RATE } from '../src/index';

describe('sim time constants', () => {
  it('runs at 60 ticks per second', () => {
    expect(TICK_RATE).toBe(60);
  });

  it('has a tick duration of one over the tick rate', () => {
    expect(DT).toBe(1 / TICK_RATE);
  });
});
