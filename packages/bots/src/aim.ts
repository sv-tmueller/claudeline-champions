import type { Vec2 } from './grid';

/**
 * Metres per second. The lead of an ability with a projectile uses that projectile's own speed
 * from the kit; this value stands for a champion without a kit and for an ability with none.
 */
export const NOMINAL_PROJECTILE_SPEED = 20;

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
