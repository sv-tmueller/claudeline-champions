import { describe, expect, it } from 'vitest';
import {
  ENERGY_GAIN_M1,
  ENERGY_GAIN_SKILL,
  ENERGY_GAIN_ULTIMATE,
  EX_ENERGY_COST,
  HASTE_CAP_PERCENT,
  KNOCKBACK_CAP_METERS,
  MAX_ARENA_METERS,
  MAX_DASH_DISTANCE,
  MAX_ENERGY,
  MAX_MAGNITUDE,
  MAX_STATUS_TICKS,
  MAX_TELEPORT_METERS,
  MIN_DASH_DISTANCE,
  MOTION_SUBSTEP_METERS,
  SLOWED_WINDUP_FACTOR,
  SLOW_CAP_PERCENT,
  STATUS_PULSE_TICKS,
  STUN_CAP_TICKS,
  ULTIMATE_ENERGY_COST,
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

  it('holds the bounds on dash and teleport specs', () => {
    expect(MAX_DASH_DISTANCE).toBe(1000);
    expect(MIN_DASH_DISTANCE).toBe(1e-6);
    expect(MAX_TELEPORT_METERS).toBe(1e9);
  });

  it('holds the bound on arena dimensions and coordinates', () => {
    expect(MAX_ARENA_METERS).toBe(1e6);
  });

  it('holds the energy rules of rules.md sections 2 and 3', () => {
    expect(EX_ENERGY_COST).toBe(25);
    expect(ULTIMATE_ENERGY_COST).toBe(100);
    expect(MAX_ENERGY).toBe(100);
    expect(SLOWED_WINDUP_FACTOR).toBe(0.5);
    expect(ENERGY_GAIN_M1).toBe(5);
    expect(ENERGY_GAIN_SKILL).toBe(10);
    expect(ENERGY_GAIN_ULTIMATE).toBe(15);
  });
});
