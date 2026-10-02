import { describe, expect, it } from 'vitest';
import {
  HASTE_CAP_PERCENT,
  KNOCKBACK_CAP_METERS,
  MAX_MAGNITUDE,
  MAX_STATUS_TICKS,
  MOTION_SUBSTEP_METERS,
  SLOW_CAP_PERCENT,
  STATUS_PULSE_TICKS,
  STUN_CAP_TICKS,
} from '../src/index';

describe('status and motion constants', () => {
  it('holds the rules.md caps and the sim-level step sizes', () => {
    expect(STUN_CAP_TICKS).toBe(120);
    expect(SLOW_CAP_PERCENT).toBe(70);
    expect(HASTE_CAP_PERCENT).toBe(50);
    expect(KNOCKBACK_CAP_METERS).toBe(6);
    expect(STATUS_PULSE_TICKS).toBe(30);
    expect(MOTION_SUBSTEP_METERS).toBe(0.25);
  });

  it('holds the bounds on status, shield and knockback specs', () => {
    expect(MAX_STATUS_TICKS).toBe(36000);
    expect(MAX_MAGNITUDE).toBe(1e6);
  });
});
