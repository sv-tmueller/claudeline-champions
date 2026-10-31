import type { ArenaDef } from './arena';
import {
  CHAMPION_RADIUS,
  MAX_ENERGY,
  ORB_COLLECTIBLE_TICKS,
  ORB_ENERGY,
  ORB_RADIUS,
  ORB_WARNING_TICKS,
} from './constants';
import { clamp } from './geometry';
import { nextRandom } from './rng';
import type { ChampionState, GameState, MatchState, OrbPoint } from './state';

// The energy orb (rules.md section 3.3). Its point comes from the config; the table at
// `data/orbs.json` is read by the callers with `orbPointFor`, because the sim does no I/O.
//
// `stepOrb` holds no arrow function and, in the steady state, allocates nothing (flow.ts header).

/**
 * Why `point` cannot be an orb point on `arena`, or undefined when it can: two finite numbers, on
 * the mirror axis (x = 0), a disc of `ORB_RADIUS` inside the ring's end circle and inside the
 * playable rectangle, and overlapping no obstacle. Every obstacle blocks walking, so
 * `blocksProjectiles` does not matter; touching an obstacle is allowed.
 */
export function checkOrbPoint(point: unknown, arena: ArenaDef): string | undefined {
  if (typeof point !== 'object' || point === null || Array.isArray(point)) {
    return 'expected an object with x and y';
  }
  const { x, y } = point as Record<string, unknown>;
  if (typeof x !== 'number' || !Number.isFinite(x)) return 'x must be a finite number';
  if (typeof y !== 'number' || !Number.isFinite(y)) return 'y must be a finite number';
  if (x !== 0) return 'x must be 0, on the mirror axis';
  if (Math.abs(y) + ORB_RADIUS > arena.ring.endRadius) {
    return 'the orb must lie inside the ring end circle';
  }
  const { width, height } = arena.size;
  if (Math.abs(x) + ORB_RADIUS > width / 2 || Math.abs(y) + ORB_RADIUS > height / 2) {
    return 'the orb must lie inside the arena boundary';
  }
  for (let i = 0; i < arena.obstacles.length; i++) {
    const o = arena.obstacles[i] as ArenaDef['obstacles'][number];
    let dx: number;
    let dy: number;
    let reach: number;
    if (o.type === 'circle') {
      dx = x - o.x;
      dy = y - o.y;
      reach = o.r + ORB_RADIUS;
    } else {
      dx = x - clamp(x, o.x - o.w / 2, o.x + o.w / 2);
      dy = y - clamp(y, o.y - o.h / 2, o.y + o.h / 2);
      reach = ORB_RADIUS;
    }
    if (dx * dx + dy * dy < reach * reach) return `the orb overlaps obstacle ${i}`;
  }
  return undefined;
}

/**
 * The orb point of `arena` from a table keyed by arena id (`data/orbs.json`), or undefined when
 * the table has no row for it. A row is a copy, never the table's own object. Throws
 * `Invalid orb table: ...` for a table that is not an object or a row that is not a valid point.
 */
export function orbPointFor(table: unknown, arena: ArenaDef): OrbPoint | undefined {
  if (typeof table !== 'object' || table === null || Array.isArray(table)) {
    throw new Error('Invalid orb table: expected an object keyed by arena id');
  }
  if (!Object.hasOwn(table, arena.id)) return undefined;
  const row = (table as Record<string, unknown>)[arena.id];
  const problem = checkOrbPoint(row, arena);
  if (problem !== undefined) throw new Error(`Invalid orb table: ${arena.id}: ${problem}`);
  const { x, y } = row as OrbPoint;
  return { x: x + 0, y: y + 0 };
}

/**
 * Step 6a of a round phase step, after the entities expired and before the sudden death and the
 * decision. At `ORB_WARNING_TICKS` with the orb up it emits `orbSpawn`. From `ORB_COLLECTIBLE_TICKS`
 * the living champions whose circle touches the orb (touching exactly counts) compete: one takes
 * it with no draw, and for two or more one `nextRandom` draw picks the k-th in id order, with k
 * the number of j in 1..n-1 with r * n >= j, a counting form with no rounding call. The taker gains `ORB_ENERGY`, cut
 * to the room under `MAX_ENERGY`; `orbTaken` always follows, with an amount that may be 0.
 */
export function stepOrb(state: GameState, match: MatchState): void {
  const orb = match.orb;
  if (orb === undefined || orb.taken) return;
  const ticks = match.phaseTicks;
  if (ticks === ORB_WARNING_TICKS) {
    state.events.push({ type: 'orbSpawn', round: match.round, x: orb.x, y: orb.y });
  }
  if (ticks < ORB_COLLECTIBLE_TICKS) return;

  const { champions } = state;
  const reach = CHAMPION_RADIUS + ORB_RADIUS;
  let touching = 0;
  let first = -1;
  for (let i = 0; i < champions.length; i++) {
    const champion = champions[i] as ChampionState;
    if (!champion.alive) continue;
    const dx = champion.x - orb.x;
    const dy = champion.y - orb.y;
    if (dx * dx + dy * dy <= reach * reach) {
      if (touching === 0) first = i;
      touching++;
    }
  }
  if (touching === 0) return;

  let pick = 0;
  if (touching > 1) {
    const r = nextRandom(state);
    for (let j = 1; j < touching; j++) if (r * touching >= j) pick++;
  }
  let taker = first;
  if (pick > 0) {
    let seen = 0;
    for (let i = 0; i < champions.length; i++) {
      const champion = champions[i] as ChampionState;
      if (!champion.alive) continue;
      const dx = champion.x - orb.x;
      const dy = champion.y - orb.y;
      if (dx * dx + dy * dy <= reach * reach) {
        if (seen === pick) {
          taker = i;
          break;
        }
        seen++;
      }
    }
  }

  const champion = champions[taker] as ChampionState;
  const amount = Math.min(ORB_ENERGY, MAX_ENERGY - champion.energy);
  champion.energy += amount;
  orb.taken = true;
  state.events.push({
    type: 'orbTaken',
    round: match.round,
    championId: champion.id,
    amount,
    energy: champion.energy,
  });
}
