import { describe, expect, it } from 'vitest';
import type { ArenaDef, Obstacle } from '@claudeline/sim';
import { pointBlocked, segmentClear } from '../src/geometry';
import { buildNavGrid } from '../src/grid';
import { arena01, arena02, clearanceAt } from './helpers';
import { THINKS, sceneOf, walks } from './scenes';

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

// The four stalls of issue #129 (the Hargrim and Quillon tuning candidates of #124, found by
// lumeth.test.ts's no-stall clause) were this state: a champion rested one ulp inside an inflated
// obstacle, at the corner of a rectangle in three of them and on a circle in the fourth. They ran
// 123 to 6003 ticks on the bots before the tolerance and are gone with it; the dodge alone left
// them. Each row is a recorded state: the point the champion rested at, the champion that chases
// an enemy standing there (the goal side: the target's cell is blocked, so the follower needs
// `nearestFreeCell` from the goal point) and the champion that stands at the point and chases an
// enemy at the chaser's position (the start side: it needs a plan out of its cell). `clearanceAt`
// is the test's own oracle and has no tolerance, so a clearance below 0 and above -1e-15 is "one
// ulp inside".

interface Recorded {
  name: string;
  arena: ArenaDef;
  point: { x: number; y: number };
  /** The goal side: this champion chases an enemy standing at the point. */
  chaser: { id: string; x: number; y: number };
  /** The start side: this champion (the dummy has no kit) stands at the point and chases the chaser. */
  at: string;
}

const RECORDED: Recorded[] = [
  {
    name: 'Maul Swing 16, arena02: the SW corner of the rect (5, 0)',
    arena: arena02,
    point: { x: 4.155350116569735, y: -2.3622381231338085 },
    chaser: { id: 'quillon', x: 10.1861924205491, y: -2.590019221304095 },
    at: 'hargrim',
  },
  {
    name: 'Rod Bolt reach, arena01: the SE corner of the rect (-8, 0)',
    arena: arena01,
    point: { x: -7.0714242088719095, y: -1.7575321169464715 },
    chaser: { id: 'quillon', x: 1.678172526618351, y: 1.8904279822340928 },
    at: 'dummy',
  },
  {
    name: 'Rod Bolt damage 9, arena02: the SW corner of the rect (5, 0)',
    arena: arena02,
    point: { x: 4.242581209067601, y: -2.428643868584285 },
    // Not the Quillon at (-4.41, -2.74) of the run: it stands in range with a clear shot, a stand.
    chaser: { id: 'hargrim', x: 2.9834462561201573, y: 0.6962892274266953 },
    at: 'dummy',
  },
  {
    name: 'Hook cooldown 360, arena02: the circle (0, -7.5), radius 0.75',
    arena: arena02,
    point: { x: -0.8884132222799374, y: -8.379330396653145 },
    chaser: { id: 'hargrim', x: 7.527158130341933, y: -3.629163345652116 },
    at: 'hargrim',
  },
];

describe.each(RECORDED)('the #129 state, $name', (row) => {
  const grid = buildNavGrid(row.arena);

  it('rests one ulp inside the inflated obstacle: the oracle clearance is below 0 and above -1e-15', () => {
    const clearance = clearanceAt(row.arena, row.point.x, row.point.y);
    expect(clearance).toBeLessThan(0);
    expect(clearance).toBeGreaterThan(-1e-15);
  });

  it('is not blocked for the bots: the tolerance reads it as touching', () => {
    expect(pointBlocked(grid, row.point)).toBe(false);
  });

  it('walks on the goal side: a bot chases an enemy standing there', () => {
    const goal = sceneOf(row.chaser.id, 0, {
      arena: row.arena,
      me: [row.chaser.x, row.chaser.y],
      enemy: [row.point.x, row.point.y],
    });
    expect(walks(goal, 'hard', 1, THINKS)).toBe(true);
  });

  it('walks on the start side: a bot standing there chases an enemy', () => {
    const start = sceneOf(row.at, 0, {
      arena: row.arena,
      me: [row.point.x, row.point.y],
      enemy: [row.chaser.x, row.chaser.y],
      enemyId: row.chaser.id,
    });
    expect(walks(start, 'hard', 1, THINKS)).toBe(true);
  });
});
