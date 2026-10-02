import { describe, expect, it } from 'vitest';
import { createMatch } from '@claudeline/sim';
import type { AbilityEffect, AbilitySpec, Effect, ThenEffect } from '@claudeline/sim';
import { RANGE_MARGIN, abilityReach, inReach } from '../src/reach';
import { arena01, config2v2 } from './helpers';
import { hargrimKit, quietKit, quillonKit } from './kits';

const DAMAGE: Effect[] = [{ type: 'damage', amount: 1 }];

function ability(...effects: AbilityEffect[]): AbilitySpec {
  return { windupTicks: 0, movement: 'free', effects };
}

function bolt(speed: number, lifetimeTicks: number): AbilityEffect {
  return { type: 'projectile', speed, radius: 0.25, lifetimeTicks, pierce: false, effects: DAMAGE };
}

function arc(radius: number): ThenEffect {
  return { type: 'meleeArc', radius, cosHalfAngle: 0.643, effects: DAMAGE };
}

function area(
  placement: Extract<AbilityEffect, { type: 'area' }>['placement'],
  radius: number,
  targets: 'enemies' | 'allies' | 'all' = 'enemies',
): ThenEffect {
  return { type: 'area', placement, radius, durationTicks: 1, intervalTicks: 1, targets, effects: DAMAGE };
}

function dash(distance: number, ...then: ThenEffect[]): AbilityEffect {
  return { type: 'dash', distance, ticks: 10, then };
}

describe('abilityReach', () => {
  it('reads a projectile as speed times lifetime over 60, multiplied first: 21 x 40 is exactly 14', () => {
    expect(abilityReach(ability(bolt(21, 40)))).toEqual({ min: 0, max: 14 });
  });

  it('adds the champion radius to a melee arc', () => {
    expect(abilityReach(ability(arc(2.5)))).toEqual({ min: 0, max: 3 });
  });

  it('reads a self area against enemies or everyone as radius plus 0.5', () => {
    expect(abilityReach(ability(area({ type: 'self' }, 4, 'enemies')))).toEqual({ min: 0, max: 4.5 });
    expect(abilityReach(ability(area({ type: 'self' }, 4, 'all')))).toEqual({ min: 0, max: 4.5 });
  });

  it('gives an area of allies no reach', () => {
    expect(abilityReach(ability(area({ type: 'self' }, 4, 'allies')))).toBeNull();
  });

  it('reads an area ahead from its distance minus the radius to its distance plus the radius', () => {
    expect(abilityReach(ability(area({ type: 'ahead', distance: 2.5 }, 2)))).toEqual({ min: 0, max: 5 });
    expect(abilityReach(ability(area({ type: 'ahead', distance: 5 }, 1)))).toEqual({ min: 3.5, max: 6.5 });
  });

  it('reads an area at the aim as range plus radius plus 0.5', () => {
    expect(abilityReach(ability(area({ type: 'aim', range: 9 }, 1.5)))).toEqual({ min: 0, max: 11 });
  });

  it('reads a dash by what it fires at its end', () => {
    expect(abilityReach(ability(dash(6, area({ type: 'self' }, 3.5))))).toEqual({ min: 0, max: 10 });
  });

  it('gives a dash whose end effects are all self effects no reach', () => {
    expect(abilityReach(ability(dash(5)))).toBeNull();
    expect(abilityReach(ability(dash(5, area({ type: 'self' }, 3, 'allies'))))).toBeNull();
  });

  it('keeps offset 0 for an effect listed after a top-level dash', () => {
    expect(abilityReach(ability(dash(6), arc(2)))).toEqual({ min: 0, max: 2.5 });
  });

  it('adds a teleport range to the effects after it', () => {
    expect(abilityReach(ability({ type: 'teleport', range: 8, fixed: true }, arc(2)))).toEqual({
      min: 0,
      max: 10.5,
    });
  });

  it('gives a lone teleport no reach', () => {
    expect(abilityReach(ability({ type: 'teleport', range: 4, fixed: false }))).toBeNull();
  });

  it('gives shield, heal and status effects no reach', () => {
    expect(abilityReach(ability({ type: 'shield', absorb: 10, ticks: 60 }))).toBeNull();
    expect(abilityReach(ability({ type: 'heal', amount: 5 }))).toBeNull();
    expect(
      abilityReach(ability({ type: 'applyStatus', status: { type: 'haste', percent: 20, ticks: 60 } })),
    ).toBeNull();
  });

  it('takes the hull of the effects: the smallest min and the largest max', () => {
    expect(
      abilityReach(ability(area({ type: 'ahead', distance: 5 }, 1), arc(2), { type: 'heal', amount: 1 })),
    ).toEqual({ min: 0, max: 6.5 });
    expect(abilityReach(ability(arc(2), bolt(24, 45)))).toEqual({ min: 0, max: 18 });
    expect(
      abilityReach(ability(area({ type: 'ahead', distance: 5 }, 1), area({ type: 'ahead', distance: 9 }, 1))),
    ).toEqual({ min: 3.5, max: 10.5 });
  });

  it('gives the band of every slot of the test kits', () => {
    const hargrim = hargrimKit();
    const slots = hargrim.slots;
    expect(abilityReach(slots.M1)).toEqual({ min: 0, max: 3 });
    expect(abilityReach(slots.M2)).toEqual({ min: 0, max: 5 });
    expect(slots.M2.ex && abilityReach(slots.M2.ex)).toEqual({ min: 0, max: 5.75 });
    expect(abilityReach(slots.SPACE)).toBeNull();
    expect(slots.SPACE.ex && abilityReach(slots.SPACE.ex)).toEqual({ min: 0, max: 9 });
    expect(abilityReach(slots.Q)).toBeNull();
    expect(abilityReach(slots.R)).toBeNull();
    expect(abilityReach(slots.E)).toEqual({ min: 0, max: 9 });
    expect(abilityReach(slots.F)).toEqual({ min: 0, max: 10 });

    const q = quillonKit().slots;
    expect(abilityReach(q.M1)).toEqual({ min: 0, max: 14 });
    expect(abilityReach(q.M2)).toEqual({ min: 0, max: 12 });
    expect(q.M2.ex && abilityReach(q.M2.ex)).toEqual({ min: 0, max: 12 });
    expect(abilityReach(q.SPACE)).toBeNull();
    expect(abilityReach(q.Q)).toEqual({ min: 0, max: 10 });
    expect(abilityReach(q.E)).toEqual({ min: 0, max: 18 });
    expect(q.E.ex && abilityReach(q.E.ex)).toEqual({ min: 0, max: 18 });
    expect(abilityReach(q.R)).toBeNull();
    expect(abilityReach(q.F)).toEqual({ min: 0, max: 20 });
  });

  it('gives a quiet kit no band on any slot', () => {
    for (const spec of Object.values(quietKit('quiet').slots)) {
      expect(abilityReach(spec)).toBeNull();
      expect(spec.ex === undefined || abilityReach(spec.ex) === null).toBe(true);
    }
  });

  it('only reads kits that the sim accepts', () => {
    const config = config2v2();
    expect(() => createMatch(config, arena01, 1, [hargrimKit(), quillonKit()])).not.toThrow();
    expect(() => createMatch(config, arena01, 1, [quietKit('hargrim')])).not.toThrow();
  });
});

describe('RANGE_MARGIN and inReach', () => {
  it('pins the margin at 1 m', () => {
    expect(RANGE_MARGIN).toBe(1);
  });

  it('is inclusive at both ends of a 14 m band minus the margin', () => {
    const band = { min: 0, max: 14 };
    expect(inReach(band, 13)).toBe(true);
    expect(inReach(band, 13.01)).toBe(false);
    expect(inReach(band, 0)).toBe(true);
  });

  it('is inclusive at both ends of a band with a minimum', () => {
    const band = { min: 3.5, max: 6.5 };
    expect(inReach(band, 3.5)).toBe(true);
    expect(inReach(band, 5.5)).toBe(true);
    expect(inReach(band, 3.49)).toBe(false);
    expect(inReach(band, 5.51)).toBe(false);
  });
});
