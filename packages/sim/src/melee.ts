import { CHAMPION_RADIUS } from './constants';
import { direction, length } from './geometry';
import { applyEffects, copyEffects } from './health';
import type { Effect, GameState } from './state';

export interface MeleeArcSpec {
  ownerId: number;
  /** The arc origin; kits pass the caster's position. */
  x: number;
  y: number;
  /** The centre line of the arc; it is normalized here, so it must not be zero. */
  dirX: number;
  dirY: number;
  radius: number;
  /** Cosine of the half-angle, in [-1, 1]; -1 is a full circle. Stored as data, never computed. */
  cosHalfAngle: number;
  effects: readonly Effect[];
}

function fail(problem: string): never {
  throw new Error(`Invalid melee arc: ${problem}`);
}

/**
 * Hits every alive enemy of the owner whose body overlaps the circle of `radius` around (x, y),
 * `dist <= radius + 0.5` inclusive, and whose centre lies inside the arc: `dot(dir, d) >= cos *
 * |d|`, inclusive, with a target exactly at the origin always inside. A cosine of -1 or less
 * is a full circle. Obstacles are ignored. Emits `meleeArc` with the target list, built before any
 * effect applies, then applies the effects to each target in id order. Returns the target ids.
 * A dead owner may still swing.
 */
export function meleeArc(state: GameState, spec: MeleeArcSpec): number[] {
  const owner = state.champions[spec.ownerId];
  if (!owner) return fail(`unknown owner ${spec.ownerId}`);
  for (const key of ['x', 'y', 'dirX', 'dirY', 'radius', 'cosHalfAngle'] as const) {
    if (!Number.isFinite(spec[key])) return fail(`${key} is not a finite number`);
  }
  const dir = direction(spec.dirX, spec.dirY);
  if (!dir) return fail('direction is zero');
  if (spec.radius <= 0) return fail('radius must be above 0');
  if (spec.cosHalfAngle < -1 || spec.cosHalfAngle > 1) {
    return fail('cosHalfAngle must be from -1 to 1');
  }
  const effects = copyEffects(spec.effects, fail);

  const reach = spec.radius + CHAMPION_RADIUS;
  const targetIds: number[] = [];
  for (const c of state.champions) {
    if (!c.alive || c.team === owner.team) continue;
    const dx = c.x - spec.x;
    const dy = c.y - spec.y;
    const dist = length(dx, dy);
    if (dist > reach) continue;
    const inAngle =
      spec.cosHalfAngle <= -1 ||
      dist === 0 ||
      dir.x * dx + dir.y * dy >= spec.cosHalfAngle * dist;
    if (inAngle) targetIds.push(c.id);
  }

  state.events.push({
    type: 'meleeArc',
    ownerId: spec.ownerId,
    x: spec.x + 0,
    y: spec.y + 0,
    dirX: dir.x,
    dirY: dir.y,
    radius: spec.radius,
    cosHalfAngle: spec.cosHalfAngle + 0,
    targetIds: [...targetIds],
  });
  const origin = { x: spec.x + 0, y: spec.y + 0 };
  for (const targetId of targetIds) applyEffects(state, spec.ownerId, targetId, effects, origin);
  return targetIds;
}
