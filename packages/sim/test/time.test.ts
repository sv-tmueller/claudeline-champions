import { describe, expect, it } from 'vitest';
import {
  BASE_MOVE_SPEED,
  CHAMPION_RADIUS,
  DEFAULT_MAX_HEALTH,
  DT,
  TICK_RATE,
} from '../src/index';

describe('sim time constants', () => {
  it('runs at 60 ticks per second', () => {
    expect(TICK_RATE).toBe(60);
  });

  it('has a tick duration of one over the tick rate', () => {
    expect(DT).toBe(1 / TICK_RATE);
  });
});

describe('sim champion constants', () => {
  it('defines the champion radius, base speed and default health', () => {
    expect(CHAMPION_RADIUS).toBe(0.5);
    expect(BASE_MOVE_SPEED).toBe(5.5);
    expect(DEFAULT_MAX_HEALTH).toBe(120);
  });
});
