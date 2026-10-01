import arena01Json from '../../../data/arenas/arena01.json';
import { CHAMPION_RADIUS, parseArenaDef } from '@claudeline/sim';
import type { ArenaDef, MatchConfig } from '@claudeline/sim';

export const arena01: ArenaDef = parseArenaDef(arena01Json);

// A copy of the sim's test helper: bots tests must not reach into sim tests.
export function config2v2(): MatchConfig {
  return {
    teamSize: 2,
    players: [
      { championId: 'hargrim', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'lumeth', team: 'B' },
      { championId: 'skerrow', team: 'B' },
    ],
  };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * An independent oracle for the grid and path rules. It deliberately does not import
 * src/geometry. Returns how far the circle of a champion centred at (x, y) is from touching
 * the nearest obstacle or boundary: negative means penetrating, zero means touching.
 */
export function clearanceAt(arena: ArenaDef, x: number, y: number): number {
  const r = CHAMPION_RADIUS;
  const { width, height } = arena.size;
  let best = Math.min(
    x + width / 2 - r,
    width / 2 - r - x,
    y + height / 2 - r,
    height / 2 - r - y,
  );
  for (const o of arena.obstacles) {
    if (o.type === 'circle') {
      best = Math.min(best, Math.hypot(x - o.x, y - o.y) - (o.r + r));
    } else {
      const nearestX = Math.min(Math.max(x, o.x - o.w / 2), o.x + o.w / 2);
      const nearestY = Math.min(Math.max(y, o.y - o.h / 2), o.y + o.h / 2);
      best = Math.min(best, Math.hypot(x - nearestX, y - nearestY) - r);
    }
  }
  return best;
}

export function oracleBlocked(arena: ArenaDef, x: number, y: number): boolean {
  return clearanceAt(arena, x, y) < 0;
}

/** True when a champion walking a to b penetrates anything, sampled every 0.01 m. */
export function oracleSegmentViolates(arena: ArenaDef, a: Point, b: Point): boolean {
  const tolerance = 1e-9;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = Math.max(1, Math.ceil(length / 0.01));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (clearanceAt(arena, x, y) < -tolerance) return true;
  }
  return false;
}
