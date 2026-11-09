import { createMatch, parseArenaDef, type ChampionState } from '@claudeline/sim';
import type { Sprite, SpriteMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import {
  ALLY_BAR_COLOUR,
  BAR_BACK_COLOUR,
  BAR_HEIGHT,
  BAR_WIDTH,
  BAR_Y,
  ENEMY_BAR_COLOUR,
  PIP_GAP,
  PIP_SIZE,
  PIP_Y,
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

/** A cap per champion: `0` for the champions with no counter, which is the default. */
function capList(length: number, entries: readonly (readonly [number, number])[] = []): number[] {
  const caps = new Array<number>(length).fill(0);
  for (const [id, cap] of entries) caps[id] = cap;
  return caps;
}

/** Writes the on-hit counter of champion `id`, the key `createMatch` adds for a counter kit. */
function setCounter(champions: readonly ChampionState[], id: number, count: number, lastHitTick = 0): void {
  (champions[id] as ChampionState).counter = { count, lastHitTick };
}

/**
 * The pip sprite rows of `group`, in champion id order: the bars occupy the first `2 * n`
 * children, then each champion with a counter adds `cap` pips. A champion with no counter
 * gets an empty row, since it has no sprites at all.
 */
function pipRows(group: { children: readonly unknown[] }, caps: readonly number[]): Sprite[][] {
  const all = sprites(group);
  const rows: Sprite[][] = [];
  let at = caps.length * 2;
  for (const cap of caps) {
    rows.push(cap > 0 ? all.slice(at, at + cap) : []);
    at += Math.max(cap, 0);
  }
  return rows;
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

describe('world counter pips', () => {
  const CAPS_2V2 = capList(4, [
    [0, 3],
    [1, 0],
    [2, 0],
    [3, 0],
  ]);

  /** The four champions with the counter key of champion 0, which its kit would add. */
  function fourWithCounters(): ChampionState[] {
    const champions = four();
    setCounter(champions, 0, 0);
    return champions;
  }

  it('makes one pip sprite per slot of the cap, and none for a champion without a counter', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    // 8 bar sprites and 3 pips for champion 0 alone.
    expect(sprites(bars.group)).toHaveLength(11);
    expect(pipRows(bars.group, CAPS_2V2).map((row) => row.length)).toEqual([3, 0, 0, 0]);
  });

  it('makes the sprites once and reuses the bar back colour and the champion team material', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    const [pips] = pipRows(bars.group, CAPS_2V2) as [Sprite[]];
    // An empty slot shares the bar back; a filled one the champion's own team material.
    expect(pips[0]?.material).toBe(backOf(bars.group, 0).material);
    bars.update(champions, poses(champions));
    for (const pip of pips) {
      expect((pip.material as SpriteMaterial).transparent).toBe(true);
      expect((pip.material as SpriteMaterial).depthTest).toBe(false);
      expect(pip.renderOrder).toBeGreaterThan(backOf(bars.group, 0).renderOrder);
      expect(pip.scale.x).toBeCloseTo(PIP_SIZE, 12);
      expect(pip.scale.y).toBeCloseTo(PIP_SIZE, 12);
      expect(pip.position.y).toBeCloseTo(PIP_Y, 12);
    }
    // Running the frame adds nothing to the group.
    bars.update(champions, poses(champions));
    bars.update(champions, poses(champions));
    expect(sprites(bars.group)).toHaveLength(11);
  });

  it('uses the team material in the team colour of an enemy row', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', capList(4, [[2, 2]]));
    const [pips] = pipRows(bars.group, capList(4, [[2, 2]])).slice(2, 3) as [Sprite[]];
    setCounter(champions, 2, 2);
    bars.update(champions, poses(champions));
    for (const pip of pips) expect(hex(pip)).toBe(ENEMY_BAR_COLOUR);
  });

  it('fills the pips from the left and keeps the row under the bar', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    setCounter(champions, 0, 2);
    bars.update(champions, poses(champions));
    const [pips] = pipRows(bars.group, CAPS_2V2) as [Sprite[]];
    expect(pips.map((pip) => hex(pip))).toEqual([ALLY_BAR_COLOUR, ALLY_BAR_COLOUR, BAR_BACK_COLOUR]);
    const champion = champions[0] as ChampionState;
    expect(pips[0]?.position.z).toBeCloseTo(-champion.y, 12);
    // Just below the bar's bottom edge.
    expect(pips[0]?.position.y).toBeCloseTo(BAR_Y - BAR_HEIGHT / 2 - PIP_GAP, 12);
  });

  it('lines the slots up left to right across the bar, evenly spaced', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    bars.update(champions, poses(champions));
    const [pips] = pipRows(bars.group, CAPS_2V2) as [Sprite[]];
    const step = PIP_SIZE + PIP_GAP;
    const first = (pips[0] as Sprite).position.x;
    expect((pips[1] as Sprite).position.x - first).toBeCloseTo(step, 12);
    expect((pips[2] as Sprite).position.x - first).toBeCloseTo(2 * step, 12);
  });

  it('shows the whole row of a living champion with a counter, all empty at 0 of the cap', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    setCounter(champions, 0, 0);
    bars.update(champions, poses(champions));
    const [pips] = pipRows(bars.group, CAPS_2V2) as [Sprite[]];
    for (const pip of pips) expect(pip.visible).toBe(true);
    expect(bars.counterCount(0)).toBe(0);
  });

  it('fills the first count pips and empties the rest, for every count of the cap', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    const [pips] = pipRows(bars.group, CAPS_2V2) as [Sprite[]];
    for (const count of [0, 1, 2, 3]) {
      setCounter(champions, 0, count);
      bars.update(champions, poses(champions));
      expect(bars.counterCount(0)).toBe(count);
      expect(pips.map((pip) => hex(pip)), `count ${count}`).toEqual(
        [0, 1, 2].map((i) => (i < count ? ALLY_BAR_COLOUR : BAR_BACK_COLOUR)),
      );
    }
  });

  it('reads a cap of 5 as five slots, the most a kit may declare', () => {
    const champions = fourWithCounters();
    const caps = capList(4, [[0, 5]]);
    const bars = createHealthBars(champions, 'A', caps);
    setCounter(champions, 0, 5);
    bars.update(champions, poses(champions));
    const [pips] = pipRows(bars.group, caps) as [Sprite[]];
    expect(pips).toHaveLength(5);
    for (const pip of pips) expect(hex(pip)).toBe(ALLY_BAR_COLOUR);
  });

  it('hides the row of a dead champion like the bar', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    setCounter(champions, 0, 2);
    bars.update(champions, poses(champions));
    const dead = champions[0] as ChampionState;
    dead.health = 0;
    dead.alive = false;
    bars.update(champions, poses(champions));
    const [pips] = pipRows(bars.group, CAPS_2V2) as [Sprite[]];
    for (const pip of pips) expect(pip.visible).toBe(false);
    expect(bars.counterCount(0)).toBe(-1);
  });

  it('keeps the row in place when health changes, since the pips do not follow it', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    setCounter(champions, 0, 1);
    const drawn = poses(champions);
    bars.update(champions, drawn);
    const [pips] = pipRows(bars.group, CAPS_2V2) as [Sprite[]];
    const before = (pips[0] as Sprite).position.x;
    (champions[0] as ChampionState).health = 40;
    bars.update(champions, drawn);
    // The fill shrank; the pip row did not move or change.
    expect((pips[0] as Sprite).position.x).toBeCloseTo(before, 12);
    expect(pips.map((pip) => hex(pip))).toEqual([ALLY_BAR_COLOUR, BAR_BACK_COLOUR, BAR_BACK_COLOUR]);
    // The row follows the drawn pose, like the bar does: it stays centred under it.
    (drawn[0] as Pose).x = 7;
    bars.update(champions, drawn);
    const center = (pips[0] as Sprite).position.x + (pips[1] as Sprite).position.x + (pips[2] as Sprite).position.x;
    expect(center / 3).toBeCloseTo(7, 12);
  });

  it('reports no row and no change for a champion without a counter', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    bars.update(champions, poses(champions));
    for (const id of [1, 2, 3]) {
      expect(bars.counterCount(id)).toBe(-1);
      expect(bars.counterChanged(id)).toBe(false);
    }
  });

  it('flips the pip in the very update that first sees the count', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    setCounter(champions, 0, 2);
    bars.update(champions, poses(champions));
    const [pips] = pipRows(bars.group, CAPS_2V2) as [Sprite[]];
    // A build landed in this step: the read is of the count the step left.
    setCounter(champions, 0, 3);
    bars.update(champions, poses(champions));
    expect(pips.map((pip) => hex(pip))).toEqual([ALLY_BAR_COLOUR, ALLY_BAR_COLOUR, ALLY_BAR_COLOUR]);
    expect(bars.counterCount(0)).toBe(3);
    expect(bars.counterChanged(0)).toBe(true);
    // A decay in 6d shows the same way.
    setCounter(champions, 0, 0);
    bars.update(champions, poses(champions));
    expect(pips.map((pip) => hex(pip))).toEqual([BAR_BACK_COLOUR, BAR_BACK_COLOUR, BAR_BACK_COLOUR]);
    expect(bars.counterCount(0)).toBe(0);
  });

  it('flags which champion changed in the latest update only', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    setCounter(champions, 0, 2);
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3].map((id) => bars.counterChanged(id))).toEqual([true, false, false, false]);
    bars.update(champions, poses(champions));
    expect([0, 1, 2, 3].map((id) => bars.counterChanged(id))).toEqual([false, false, false, false]);
    setCounter(champions, 0, 3);
    bars.update(champions, poses(champions));
    expect(bars.counterChanged(0)).toBe(true);
    bars.update(champions, poses(champions));
    expect(bars.counterChanged(0)).toBe(false);
  });

  it('makes a cap of 5 the widest row it ever builds, no sprites beyond it', () => {
    const champions = fourWithCounters();
    const caps = capList(4, [[0, 5]]);
    const bars = createHealthBars(champions, 'A', caps);
    for (const count of [0, 1, 2, 3, 4, 5]) {
      setCounter(champions, 0, count);
      bars.update(champions, poses(champions));
      expect(bars.counterCount(0)).toBe(count);
    }
    expect(sprites(bars.group)).toHaveLength(8 + 5);
  });

  it('returns true from update on the frame a pip row first appears or changes', () => {
    const champions = fourWithCounters();
    const bars = createHealthBars(champions, 'A', CAPS_2V2);
    // The first update reports a change: the row appears even at 0 of the cap.
    expect(bars.update(champions, poses(champions))).toBe(true);
    expect(bars.update(champions, poses(champions))).toBe(false);
    setCounter(champions, 0, 1);
    expect(bars.update(champions, poses(champions))).toBe(true);
    expect(bars.update(champions, poses(champions))).toBe(false);
  });
});
