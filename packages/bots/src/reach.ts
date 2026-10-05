import { CHAMPION_RADIUS, TICK_RATE } from '@claudeline/sim';
import type { AbilityEffect, AbilitySpec, ThenEffect } from '@claudeline/sim';

/** Centre distances, in metres, at which an ability can hit a champion. */
export interface Reach {
  min: number;
  max: number;
}

/** A target must be this far inside the top of a band, in metres: it can walk away during a windup. */
export const RANGE_MARGIN = 1;

/** True when the centre distance d lies in the band with the margin taken off the top; both ends count. */
export function inReach(band: Reach, d: number): boolean {
  return band.min <= d && d <= band.max - RANGE_MARGIN;
}

/** The band of one effect, with `offset` metres already travelled by teleports before it. */
function effectReach(effect: AbilityEffect | ThenEffect, offset: number): Reach | null {
  switch (effect.type) {
    case 'projectile':
      // Multiplied first: 21 x 40 / 60 is exactly 14, while 21 x (40 / 60) is not.
      return { min: 0, max: offset + (effect.speed * effect.lifetimeTicks) / TICK_RATE };
    case 'meleeArc':
      return { min: 0, max: offset + effect.radius + CHAMPION_RADIUS };
    case 'area': {
      if (effect.targets === 'allies') return null;
      const { placement, radius } = effect;
      if (placement.type === 'ahead') {
        const min = offset > 0 ? 0 : Math.max(0, placement.distance - radius - CHAMPION_RADIUS);
        return { min, max: offset + placement.distance + radius + CHAMPION_RADIUS };
      }
      const centre = placement.type === 'aim' ? placement.range : 0;
      return { min: 0, max: offset + centre + radius + CHAMPION_RADIUS };
    }
    case 'dash':
      // A dash stops at the first body it touches, so what it fires at its end can land next to
      // a target nearer than the dash distance.
      return hull(effect.then, offset + effect.distance);
    case 'teleport':
    case 'applyStatus':
    case 'shield':
    case 'heal':
      return null;
  }
}

/** The smallest min and the largest max of the effects' bands, walked in order; null with none. */
function hull(effects: readonly (AbilityEffect | ThenEffect)[], start: number): Reach | null {
  let offset = start;
  let result: Reach | null = null;
  for (const effect of effects) {
    const band = effectReach(effect, offset);
    if (band !== null) {
      result =
        result === null
          ? band
          : { min: Math.min(result.min, band.min), max: Math.max(result.max, band.max) };
    }
    // A teleport moves the caster before the effects after it; a dash only starts moving it.
    if (effect.type === 'teleport') offset += effect.range;
  }
  return result;
}

/**
 * The centre distances at which an ability can hit a champion, read from its effects; null when
 * no effect reaches an enemy (a self or ally ability). The effects after a teleport start from its
 * range. A top-level dash does not move the effects listed after it.
 */
export function abilityReach(ability: AbilitySpec): Reach | null {
  return hull(ability.effects, 0);
}
