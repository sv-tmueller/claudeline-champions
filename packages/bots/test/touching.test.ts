import { describe, expect, it } from 'vitest';
import type { Obstacle } from '@claudeline/sim';
import { pointBlocked, segmentClear } from '../src/geometry';
import { buildNavGrid } from '../src/grid';
import { arena02 } from './helpers';
import { sceneOf, walks } from './scenes';

// The sim's collision push leaves a champion at the edge of an inflated obstacle with rounding
// noise: a Hargrim pushed off the pillar of arena02 at (9, -6), radius 1, rests at distance
// 1.4999999999999998 against the limit of 1.5 (a stall of 211 ticks in the Lumeth 2v2 seeded run,
// found when the dodge's sidesteps pushed it there). The bots' tests are strict ("touching counts
// as free"), so that champion read as inside: its cell and its point were blocked, no segment from
// it was clear, the follower found no plan and the bot stood for good. A tolerance of 1e-9 in
// `overlapsObstacle` and in the limits of `obstacleShapes` reads it as touching.

const PILLAR = { x: 9, y: -6 };
/** Where the Hargrim rested: 1.4999999999999998 m from the pillar's centre. */
const RESTING = { x: 7.537453453523269, y: -6.333102986160417 };

describe('a champion one ulp inside the inflated pillar', () => {
  const grid = buildNavGrid(arena02);

  it('rests where the stall was found: the distance is one ulp under the limit', () => {
    expect(Math.hypot(RESTING.x - PILLAR.x, RESTING.y - PILLAR.y)).toBe(1.4999999999999998);
  });

  it('is not blocked, and a clear segment leaves it', () => {
    expect(pointBlocked(grid, RESTING)).toBe(false);
    expect(segmentClear(grid, RESTING, { x: 5.5, y: -7.5 })).toBe(true);
  });

  it('still blocks a point 1e-6 m inside, and a segment through the pillar', () => {
    const inside = { x: PILLAR.x - 1.5 + 1e-6, y: PILLAR.y };
    expect(pointBlocked(grid, inside)).toBe(true);
    expect(segmentClear(grid, { x: 6, y: -6 }, { x: 12, y: -6 })).toBe(false);
  });

  it('walks to an enemy behind the pillar instead of standing for good', () => {
    // The dummy stands 6 m from its enemy with the pillar between them: no clear shot, so it
    // follows the path around.
    const pillar = arena02.obstacles.find((o: Obstacle) => o.type === 'circle' && o.x === 9 && o.y === -6);
    expect(pillar).toBeDefined();
    const state = sceneOf('dummy', 6, {
      arena: arena02,
      me: [RESTING.x, RESTING.y],
      enemy: [13.29, -8.12],
    });
    expect(walks(state, 'hard', 1, 60)).toBe(true);
  });
});
