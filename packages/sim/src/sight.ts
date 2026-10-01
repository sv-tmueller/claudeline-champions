import { sweepCircle, sweepRect } from './geometry';
import type { Point } from './geometry';
import type { GameState } from './state';

/**
 * Whether the segment from `from` to `to` clears every obstacle that blocks projectiles.
 * Touching an obstacle counts as blocked. The boundary is irrelevant: the arena is convex.
 */
export function hasLineOfSight(state: GameState, from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (const o of state.arena.obstacles) {
    if (!o.blocksProjectiles) continue;
    const t =
      o.type === 'circle'
        ? sweepCircle(from, dx, dy, o.x, o.y, o.r)
        : sweepRect(from, dx, dy, o, 0);
    if (t <= 1) return false;
  }
  return true;
}
