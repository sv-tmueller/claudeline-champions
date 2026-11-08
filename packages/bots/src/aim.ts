import type { AbilitySpec } from '@claudeline/sim';
import type { Vec2 } from './grid';

/**
 * Metres per second. The lead of an ability with a projectile uses that projectile's own speed
 * from the kit; this value stands for a champion without a kit and for an ability with none.
 */
export const NOMINAL_PROJECTILE_SPEED = 20;

/**
 * The half of the area radius a one-hit aim-placed area caps the lead offset at (#187). The lead
 * of an ability with no projectile is the nominal 20 m/s intercept, which passes the area centre
 * over the target when the target keeps its velocity. A one-hit area fires a single pulse at the
 * centre, so the lead only pays when the pulse lands the target inside the circle; a full-radius
 * cap did gain on the re-measure (Firecracker 93.4 to 98.3 percent, Binding Sigil 95.6 to 96.4,
 * both clean sets) but half the radius gains more (99.3 and 97.3), because the circle covers the
 * whole walk of the target over the cast in one direction and half its width in the other. The
 * cap is measured from the target's position (the issue's "offset"), plain radius and not radius
 * plus `CHAMPION_RADIUS`. The lingering areas stay nominal: their pulses walk the circle over the
 * whole duration, so the nominal lead measured within a point of the best (#165, bots.md Aim).
 */
export const AREA_LEAD_CAP_FRACTION = 0.5;

/**
 * The cap a one-hit aim-placed area puts on the lead offset, or `Infinity` when the ability has
 * none. The placement restriction is load-bearing: a `self` or `ahead` area does not follow the
 * aim point, so capping the offset would move the recorded aim for no gain. The one-hit test is
 * `durationTicks <= intervalTicks` (rules.md 2.7: `ceil(duration/interval)` pulses).
 */
export function leadCapOf(spec: AbilitySpec | undefined): number {
  if (spec === undefined) return Number.POSITIVE_INFINITY;
  for (const effect of spec.effects) {
    if (
      effect.type === 'area' &&
      effect.placement.type === 'aim' &&
      effect.durationTicks <= effect.intervalTicks
    ) {
      return effect.radius * AREA_LEAD_CAP_FRACTION;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * `at` pulled toward `of` when their offset is farther than `cap`, the offset measured from `of`.
 * The clamp `aim` writes out over locals mirrors this, operation for operation: `sqrt` only on the
 * capped path, and no `Math.hypot` (it allocates in V8 by design).
 */
export function clampLead(at: Vec2, of: Vec2, cap: number): Vec2 {
  const dx = at.x - of.x;
  const dy = at.y - of.y;
  const dd = dx * dx + dy * dy;
  if (dd > cap * cap) {
    const k = cap / Math.sqrt(dd);
    return { x: of.x + dx * k, y: of.y + dy * k };
  }
  return { x: at.x, y: at.y };
}


/**
 * The time a projectile of the given speed needs to meet a target at offset d moving with
 * velocity v: the positive root of (v.v - s^2) t^2 + 2 (d.v) t + d.d = 0. Null when there is
 * no usable root: the target is on the shooter, is at least as fast as the projectile, or the
 * input is not finite.
 */
export function interceptTime(d: Vec2, v: Vec2, speed: number): number | null {
  const a = v.x * v.x + v.y * v.y - speed * speed;
  const b = 2 * (d.x * v.x + d.y * v.y);
  const c = d.x * d.x + d.y * d.y;
  if (c === 0 || !(a < 0)) return null;
  const root = Math.sqrt(b * b - 4 * a * c);
  // Two algebraically equal forms of the positive root; each avoids a cancelling subtraction.
  const t = b >= 0 ? (b + root) / (-2 * a) : (2 * c) / (root - b);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** Where to aim so a projectile launched now meets a target that keeps its velocity. */
export function leadPoint(shooter: Vec2, target: Vec2, velocity: Vec2, speed: number): Vec2 {
  const t = interceptTime({ x: target.x - shooter.x, y: target.y - shooter.y }, velocity, speed);
  if (t === null) return { x: target.x, y: target.y };
  return { x: target.x + velocity.x * t, y: target.y + velocity.y * t };
}

/**
 * Turns (dx, dy) by 2 atan(u) using the half-tangent identities, so the error needs no
 * trigonometry: cos = (1 - u^2) / (1 + u^2), sin = 2u / (1 + u^2).
 */
export function rotateByHalfTangent(dx: number, dy: number, u: number): Vec2 {
  const k = 1 + u * u;
  const cos = (1 - u * u) / k;
  const sin = (2 * u) / k;
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/** Metres to whole centimetres. The `+ 0` turns -0 into 0, which the sim would do anyway. */
export function roundAim(metres: number): number {
  return Math.round(metres * 100) + 0;
}
