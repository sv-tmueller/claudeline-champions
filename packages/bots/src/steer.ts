import type { MoveAxis } from '@claudeline/sim';
import type { Vec2 } from './grid';
import { hypot2 } from './hypot';

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
 * ternaries on purpose: Math.sign can return -0. The ternaries keep -0 out of the MoveCommand
 * itself (Object.is checks, recorded inputs); the sim's sanitizeAxis would map -0 to 0 anyway.
 */
export function steerToward(
  position: Vec2,
  target: Vec2,
  arrivalRadius: number = ARRIVAL_RADIUS,
): MoveCommand {
  const out: MoveCommand = { moveX: 0, moveY: 0 };
  steerTowardInto(out, position, target, arrivalRadius);
  return out;
}

/** `steerToward` written into `out` field by field, for the think path. */
export function steerTowardInto(
  out: MoveCommand,
  position: Vec2,
  target: Vec2,
  arrivalRadius: number = ARRIVAL_RADIUS,
): void {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const distance = hypot2(dx, dy);
  if (!Number.isFinite(distance) || distance <= arrivalRadius) {
    out.moveX = 0;
    out.moveY = 0;
    return;
  }
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  out.moveX = ax >= SECTOR * ay ? (dx > 0 ? 1 : -1) : 0;
  out.moveY = ay >= SECTOR * ax ? (dy > 0 ? 1 : -1) : 0;
}
