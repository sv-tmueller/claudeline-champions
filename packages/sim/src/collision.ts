import type { RectObstacle } from './arena';
import { CHAMPION_RADIUS } from './constants';
import { clamp, length } from './geometry';
import type { ChampionState, GameState } from './state';

// Penetration below EPS is treated as contact. A push moves to exact contact.
const EPS = 1e-9;
const MAX_PASSES = 4;

interface Point {
  x: number;
  y: number;
}

/** Pushes p out of a static circle so that their centres are at least `minDist` apart. */
export function pushOutOfCircle(p: Point, cx: number, cy: number, minDist: number): boolean {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dist = length(dx, dy);
  if (minDist - dist <= EPS) return false;
  if (dist > 0) {
    p.x = cx + (dx * minDist) / dist;
    p.y = cy + (dy * minDist) / dist;
  } else {
    // Exactly on the centre: any direction works, +x keeps it deterministic.
    p.x = cx + minDist;
    p.y = cy;
  }
  return true;
}

/** Pushes the circle at p, of radius r, out of an axis-aligned rect. */
export function pushOutOfRect(p: Point, rect: RectObstacle, r: number): boolean {
  const minX = rect.x - rect.w / 2;
  const maxX = rect.x + rect.w / 2;
  const minY = rect.y - rect.h / 2;
  const maxY = rect.y + rect.h / 2;
  const qx = clamp(p.x, minX, maxX);
  const qy = clamp(p.y, minY, maxY);
  const dx = p.x - qx;
  const dy = p.y - qy;
  const dist = length(dx, dy);
  if (r - dist <= EPS) return false;
  if (dist > 0) {
    p.x = qx + (dx * r) / dist;
    p.y = qy + (dy * r) / dist;
    return true;
  }
  // The centre is inside the box: leave through the nearest face. Ties break in
  // the order -x, +x, -y, +y.
  const toMinX = p.x - minX;
  const toMaxX = maxX - p.x;
  const toMinY = p.y - minY;
  const toMaxY = maxY - p.y;
  const nearest = Math.min(toMinX, toMaxX, toMinY, toMaxY);
  if (nearest === toMinX) p.x = minX - r;
  else if (nearest === toMaxX) p.x = maxX + r;
  else if (nearest === toMinY) p.y = minY - r;
  else p.y = maxY + r;
  return true;
}

function clampToBoundary(p: Point, width: number, height: number, r: number): boolean {
  const x = clamp(p.x, -width / 2 + r, width / 2 - r);
  const y = clamp(p.y, -height / 2 + r, height / 2 - r);
  const moved = x !== p.x || y !== p.y;
  p.x = x;
  p.y = y;
  return moved;
}

/**
 * One resolution pass for the circle at p: pushes it out of every other champion, every
 * obstacle and finally the boundary. Returns whether anything moved it.
 */
function pushOutPass(state: GameState, p: Point, selfId: number): boolean {
  let pushed = false;
  for (const other of state.champions) {
    if (other.id === selfId || !other.alive) continue;
    if (pushOutOfCircle(p, other.x, other.y, 2 * CHAMPION_RADIUS)) pushed = true;
  }
  for (const o of state.arena.obstacles) {
    const hit =
      o.type === 'circle'
        ? pushOutOfCircle(p, o.x, o.y, o.r + CHAMPION_RADIUS)
        : pushOutOfRect(p, o, CHAMPION_RADIUS);
    if (hit) pushed = true;
  }
  // The boundary goes last so the playable-rectangle rule always holds exactly.
  const { width, height } = state.arena.size;
  if (clampToBoundary(p, width, height, CHAMPION_RADIUS)) pushed = true;
  return pushed;
}

/**
 * Resolves one champion right after it moved. Every other champion is a static
 * circle at its current position. If the passes cannot clear the champion, it
 * goes back to where it started the tick, which was valid, so the "never
 * overlap" guarantee does not depend on the pass count.
 */
export function resolveChampion(
  state: GameState,
  champion: ChampionState,
  prevX: number,
  prevY: number,
): void {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (!pushOutPass(state, champion, champion.id)) return;
  }
  // One more pass on a probe tells whether the champion is still penetrating.
  if (pushOutPass(state, { x: champion.x, y: champion.y }, champion.id)) {
    champion.x = prevX;
    champion.y = prevY;
  }
}
