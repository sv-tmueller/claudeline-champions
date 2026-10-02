import type { MoveAxis } from '@claudeline/sim';
import type { Vec2 } from './grid';

export interface MoveCommand {
  moveX: MoveAxis;
  moveY: MoveAxis;
}

/** Above one tick of walking (BASE_MOVE_SPEED * DT is about 0.092), so a bot always stops. */
export const ARRIVAL_RADIUS = 0.1;

// tan(22.5 degrees). An axis is on when it is at least this share of the other axis, which
// splits the circle into eight 45 degree sectors without trigonometry.
const SECTOR = Math.SQRT2 - 1;

/**
 * The eight-direction move toward target, or no move within the arrival radius. Signs use
 * ternaries on purpose: Math.sign can return -0, which the sim would see as a different value.
 */
export function steerToward(
  position: Vec2,
  target: Vec2,
  arrivalRadius: number = ARRIVAL_RADIUS,
): MoveCommand {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= arrivalRadius) return { moveX: 0, moveY: 0 };
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const moveX: MoveAxis = ax >= SECTOR * ay ? (dx > 0 ? 1 : -1) : 0;
  const moveY: MoveAxis = ay >= SECTOR * ax ? (dy > 0 ? 1 : -1) : 0;
  return { moveX, moveY };
}
