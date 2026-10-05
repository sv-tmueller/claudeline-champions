import { CHAMPION_RADIUS, hasLineOfSight } from '@claudeline/sim';
import type { GameState } from '@claudeline/sim';
import { cellCenter, cellIndexAt } from './grid';
import type { NavGrid, Vec2 } from './grid';

/** The width of the shot a stand and a sight cell must clear: a champion, 0.5 m either side. */
export const SIGHT_CLEARANCE = CHAMPION_RADIUS;

/**
 * Whether a shot of radius `clearance` from `from` to `to` clears every obstacle that blocks
 * projectiles: the sim's line of sight along the centre segment and along two segments shifted
 * sideways by `clearance`, one on each side. A pure function of the state. A position on the
 * edge of a shadow has a line of sight but no clear shot, and a bolt aimed from it with the
 * smallest error hits the obstacle. A zero-length shot has only the centre segment.
 */
export function clearShot(state: GameState, from: Vec2, to: Vec2, clearance: number): boolean {
  if (!hasLineOfSight(state, from, to)) return false;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(length > 0) || !(clearance > 0)) return true;
  const px = (-(to.y - from.y) / length) * clearance;
  const py = ((to.x - from.x) / length) * clearance;
  return (
    hasLineOfSight(state, { x: from.x + px, y: from.y + py }, { x: to.x + px, y: to.y + py }) &&
    hasLineOfSight(state, { x: from.x - px, y: from.y - py }, { x: to.x - px, y: to.y - py })
  );
}

/**
 * How far, in cells, a bot looks for a cell that sees its target: 8 cells, or 4 m. That
 * reaches the far side of the shadow an arena01 obstacle casts when a bot is left within about
 * 3 m sideways of the kite band.
 */
export const SIGHT_RADIUS = 8;

/**
 * The free cell nearest to p, within `radius` cells of p's own cell, whose centre has line of
 * a clear shot of the width of a champion to the target at a distance in [rangeMin, rangeMax]; -1 when there is none or p is off
 * the grid or not finite. The bot's own cell never counts. The scan runs in index order and
 * keeps the smallest squared distance from p to the cell centre, so a tie goes to the lower
 * index. No segment test: the path follower routes to the cell.
 */
export function nearestSightCell(
  grid: NavGrid,
  state: GameState,
  p: Vec2,
  target: Vec2,
  rangeMin: number,
  rangeMax: number,
  radius: number = SIGHT_RADIUS,
): number {
  const home = cellIndexAt(grid, p);
  if (home < 0) return -1;
  const homeCol = home % grid.cols;
  const homeRow = Math.floor(home / grid.cols);
  const rowMin = Math.max(0, homeRow - radius);
  const rowMax = Math.min(grid.rows - 1, homeRow + radius);
  const colMin = Math.max(0, homeCol - radius);
  const colMax = Math.min(grid.cols - 1, homeCol + radius);

  let best = -1;
  let bestDistance = Infinity;
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const index = row * grid.cols + col;
      if (index === home || grid.blocked[index] !== false) continue;
      const c = cellCenter(grid, index);
      const toTarget = Math.hypot(c.x - target.x, c.y - target.y);
      if (toTarget < rangeMin || toTarget > rangeMax) continue;
      const distance = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
      // Strict, and the scan runs in index order, so a tie keeps the lower index.
      if (distance >= bestDistance) continue;
      // The clear shot sweep runs last: it is the costly filter.
      if (!clearShot(state, c, target, SIGHT_CLEARANCE)) continue;
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
