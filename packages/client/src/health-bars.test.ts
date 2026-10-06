import { createMatch, parseArenaDef, type ChampionState } from '@claudeline/sim';
import type { Sprite, SpriteMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import {
  ALLY_BAR_COLOUR,
  BAR_BACK_COLOUR,
  BAR_WIDTH,
  BAR_Y,
  ENEMY_BAR_COLOUR,
  createHealthBars,
} from './health-bars';
import type { Pose } from './interpolate';

/** The four champions of a fresh match, ids 0 and 1 on team A and 2 and 3 on team B. */
function four(): ChampionState[] {
  return createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'lumeth', team: 'B' },
        { championId: 'skerrow', team: 'B' },
      ],
    },
    parseArenaDef(arena01Json),
    1,
  ).champions;
}

/** The six champions of a fresh 3v3, ids 0 to 2 on team A and 3 to 5 on team B. */
function six(): ChampionState[] {
  return createMatch(
    {
      teamSize: 3,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'hargrim', team: 'B' },
        { championId: 'quillon', team: 'B' },
        { championId: 'quillon', team: 'B' },
      ],
    },
    parseArenaDef(arena01Json),
    1,
  ).champions;
}

function poses(champions: readonly ChampionState[]): Pose[] {
  return champions.map((c) => ({ x: c.x, y: c.y, facing: 0 }));
}

function sprites(group: { children: readonly unknown[] }): Sprite[] {
  return group.children as Sprite[];
}

function fillOf(group: { children: readonly unknown[] }, id: number): Sprite {
  return sprites(group)[id * 2 + 1] as Sprite;
}

function backOf(group: { children: readonly unknown[] }, id: number): Sprite {
  return sprites(group)[id * 2] as Sprite;
}

function hex(sprite: Sprite): string {
  return `#${(sprite.material as SpriteMaterial).color.getHexString()}`;
}

describe('health bars', () => {
  it('makes a back and a fill sprite per champion', () => {
    const bars = createHealthBars(four(), 'A');
    expect(sprites(bars.group)).toHaveLength(8);
    expect(hex(backOf(bars.group, 0))).toBe(BAR_BACK_COLOUR);
    expect(backOf(bars.group, 0).renderOrder).toBe(3);
    expect(fillOf(bars.group, 0).renderOrder).toBe(4);
    expect((fillOf(bars.group, 0).material as SpriteMaterial).depthTest).toBe(false);
  });

  it('draws back and fill in the transparent pass, so the render order puts the fill on top', () => {
    const bars = createHealthBars(four(), 'A');
    // An opaque fill would be drawn before the transparent back and be tinted by it.
    for (const sprite of sprites(bars.group)) {
      expect((sprite.material as SpriteMaterial).transparent).toBe(true);
    }
  });

  it('scales the fill by health and keeps its left edge in place', () => {
    const champions = four();
    const bars = createHealthBars(champions, 'A');
    const target = champions[2] as ChampionState;
    bars.update(champions, poses(champions));
    const full = fillOf(bars.group, 2);
    expect(full.scale.x).toBeCloseTo(BAR_WIDTH, 12);
    expect(full.center.x).toBe(0);
    const leftEdge = target.x - BAR_WIDTH / 2;
    expect(full.position.x).toBeCloseTo(leftEdge, 12);

    target.health = 30;
    bars.update(champions, poses(champions));
    expect(full.scale.x).toBeCloseTo(BAR_WIDTH * 0.25, 12);
    expect(full.position.x).toBeCloseTo(leftEdge, 12);
    expect(full.position.y).toBe(BAR_Y);
    expect(full.position.z).toBeCloseTo(-target.y, 12);
  });

  it('follows the interpolated pose, not the sim position', () => {
    const champions = four();
    const bars = createHealthBars(champions, 'A');
    const drawn = poses(champions);
    (drawn[1] as Pose).x = 10;
    (drawn[1] as Pose).y = 5;
    bars.update(champions, drawn);
    // The back is centred on the champion, the fill starts half a bar to the left.
    expect(backOf(bars.group, 1).position.x).toBeCloseTo(10, 12);
    expect(fillOf(bars.group, 1).position.x).toBeCloseTo(10 - BAR_WIDTH / 2, 12);
    expect(backOf(bars.group, 1).position.z).toBeCloseTo(-5, 12);
  });

  it('colours the local champion and its ally green and enemies red, with shared materials', () => {
    const bars = createHealthBars(four(), 'A');
    expect([0, 1, 2, 3].map((id) => hex(fillOf(bars.group, id)))).toEqual([
      ALLY_BAR_COLOUR,
      ALLY_BAR_COLOUR,
      ENEMY_BAR_COLOUR,
      ENEMY_BAR_COLOUR,
    ]);
    expect(fillOf(bars.group, 0).material).toBe(fillOf(bars.group, 1).material);
    expect(fillOf(bars.group, 2).material).toBe(fillOf(bars.group, 3).material);

    const flipped = createHealthBars(four(), 'B');
    expect(hex(fillOf(flipped.group, 0))).toBe(ENEMY_BAR_COLOUR);
    expect(hex(fillOf(flipped.group, 3))).toBe(ALLY_BAR_COLOUR);
  });

  it('hides both sprites of a dead champion', () => {
    const champions = four();
    const bars = createHealthBars(champions, 'A');
    bars.update(champions, poses(champions));
    const dead = champions[2] as ChampionState;
    dead.health = 0;
    dead.alive = false;
    bars.update(champions, poses(champions));
    expect(backOf(bars.group, 2).visible).toBe(false);
    expect(fillOf(bars.group, 2).visible).toBe(false);
    expect(fillOf(bars.group, 3).visible).toBe(true);
  });

  it('reports the fill percent per champion, -1 when hidden', () => {
    const champions = four();
    const bars = createHealthBars(champions, 'A');
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3].map((id) => bars.percent(id))).toEqual([100, 100, 100, 100]);
    (champions[2] as ChampionState).health = 90;
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3].map((id) => bars.percent(id))).toEqual([100, 100, 75, 100]);
    (champions[2] as ChampionState).health = 0;
    (champions[2] as ChampionState).alive = false;
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3].map((id) => bars.percent(id))).toEqual([100, 100, -1, 100]);
  });

  it('flags which champion changed in the latest update only', () => {
    const champions = four();
    const bars = createHealthBars(champions, 'A');
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3].map((id) => bars.changed(id))).toEqual([true, true, true, true]);
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3].map((id) => bars.changed(id))).toEqual([false, false, false, false]);
    (champions[2] as ChampionState).health = 90;
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3].map((id) => bars.changed(id))).toEqual([false, false, true, false]);
    // A health change that rounds to the same percent is not a change.
    (champions[2] as ChampionState).health = 89.9;
    bars.update(champions, poses(champions));
    expect(bars.changed(2)).toBe(false);
    expect(bars.percent(2)).toBe(75);
    bars.update(champions, poses(champions));
    expect(bars.changed(2)).toBe(false);
  });

  it('says whether the reported percents changed', () => {
    const champions = four();
    const bars = createHealthBars(champions, 'A');
    expect(bars.update(champions, poses(champions))).toBe(true);
    expect(bars.update(champions, poses(champions))).toBe(false);
    (champions[0] as ChampionState).health = 60;
    expect(bars.update(champions, poses(champions))).toBe(true);
    expect(bars.update(champions, poses(champions))).toBe(false);
  });
});

describe('health bars of a 3v3', () => {
  it('makes a back and a fill sprite for each of the six champions', () => {
    expect(sprites(createHealthBars(six(), 'A').group)).toHaveLength(12);
  });

  it('colours ids 0 to 2 green and 3 to 5 red for team A, and the other way round for team B', () => {
    const bars = createHealthBars(six(), 'A');
    expect([0, 1, 2, 3, 4, 5].map((id) => hex(fillOf(bars.group, id)))).toEqual([
      ALLY_BAR_COLOUR,
      ALLY_BAR_COLOUR,
      ALLY_BAR_COLOUR,
      ENEMY_BAR_COLOUR,
      ENEMY_BAR_COLOUR,
      ENEMY_BAR_COLOUR,
    ]);
    const flipped = createHealthBars(six(), 'B');
    expect([0, 1, 2, 3, 4, 5].map((id) => hex(fillOf(flipped.group, id)))).toEqual([
      ENEMY_BAR_COLOUR,
      ENEMY_BAR_COLOUR,
      ENEMY_BAR_COLOUR,
      ALLY_BAR_COLOUR,
      ALLY_BAR_COLOUR,
      ALLY_BAR_COLOUR,
    ]);
  });

  it('reports the percent and the change of ids 4 and 5', () => {
    const champions = six();
    const bars = createHealthBars(champions, 'A');
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3, 4, 5].map((id) => bars.percent(id))).toEqual([100, 100, 100, 100, 100, 100]);
    expect([0, 1, 2, 3, 4, 5].map((id) => bars.changed(id))).toEqual([true, true, true, true, true, true]);
    const fifth = champions[4] as ChampionState;
    fifth.health = fifth.maxHealth / 2;
    const sixth = champions[5] as ChampionState;
    sixth.health = 0;
    sixth.alive = false;
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3, 4, 5].map((id) => bars.percent(id))).toEqual([100, 100, 100, 100, 50, -1]);
    expect([0, 1, 2, 3, 4, 5].map((id) => bars.changed(id))).toEqual([false, false, false, false, true, true]);
    expect(fillOf(bars.group, 5).visible).toBe(false);
    expect(fillOf(bars.group, 4).scale.x).toBeCloseTo(BAR_WIDTH * 0.5, 12);
  });
});
