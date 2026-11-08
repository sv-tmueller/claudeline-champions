import type { ChampionState, TeamId } from '@claudeline/sim';
import { Group, Sprite, SpriteMaterial } from 'three';
import type { Pose } from './interpolate';

// Colours per rules.md section 8: green for allies, red for enemies.
export const ALLY_BAR_COLOUR = '#3ddc84';
export const ENEMY_BAR_COLOUR = '#ff4d4f';
export const BAR_BACK_COLOUR = '#0d1117';
export const BAR_WIDTH = 1.3;
export const BAR_HEIGHT = 0.18;
/** Above the head of the placeholder champion. */
export const BAR_Y = 2.1;
/** One pip of the on-hit counter row, and the gap between two. */
export const PIP_SIZE = 0.16;
export const PIP_GAP = 0.06;
/** The centre line of the pip row: just below the bar's bottom edge. */
export const PIP_Y = BAR_Y - BAR_HEIGHT / 2 - PIP_GAP;
const BACK_ORDER = 3;
const FILL_ORDER = 4;
const PIP_ORDER = 5;
const BACK_OPACITY = 0.75;
// The back is a little larger than the fill, so it shows as a border.
const BORDER = 0.04;

function barMaterial(color: string, opacity: number): SpriteMaterial {
  // No depth test: a bar is never hidden by an obstacle or a champion in front.
  // Always transparent, so back and fill share a pass and renderOrder decides which is on top.
  return new SpriteMaterial({ color, transparent: true, opacity, depthTest: false });
}

/**
 * Two sprites per champion, back then fill, in champion id order, then one pooled pip
 * sprite row per champion whose kit declares a counter (rules.md section 2.6). The
 * `caps` hold that champion's pip slots, 0 or less for a champion without a counter,
 * which gets no sprites at all. Built once: the frame path only flips `visible` and
 * swaps between the two materials that already exist. The camera never yaws, so world
 * +x is screen right and a fill anchored at its left edge shrinks towards the left.
 */
export class HealthBars {
  readonly group = new Group();
  private readonly percents: number[];
  // 1 for a champion whose percent changed in the latest update, else 0.
  private readonly changes: number[];
  // The count shown by the pip row in the latest update, -1 when the row is hidden or
  // the champion has no counter, and 1 for a champion whose count changed, else 0.
  private readonly counts: number[];
  private readonly counterChanges: number[];
  private readonly fills: Sprite[] = [];
  private readonly backs: Sprite[] = [];
  // One row per champion, in id order, empty for a champion without a counter.
  private readonly pips: Sprite[][];
  // The cap of each row, so `update` walks its own slots with no scan of the kits.
  private readonly caps: number[];

  constructor(champions: readonly { team: TeamId }[], localTeam: TeamId, caps: readonly number[] = []) {
    const back = barMaterial(BAR_BACK_COLOUR, BACK_OPACITY);
    const ally = barMaterial(ALLY_BAR_COLOUR, 1);
    const enemy = barMaterial(ENEMY_BAR_COLOUR, 1);
    this.percents = champions.map(() => -2);
    this.changes = champions.map(() => 0);
    this.counts = champions.map(() => -2);
    this.counterChanges = champions.map(() => 0);
    this.caps = champions.map((_, id) => caps[id] ?? 0);
    // The bars come first, back then fill per champion, so `children[id * 2]` and
    // `children[id * 2 + 1]` stay the back and the fill of champion `id`.
    for (const champion of champions) {
      const backSprite = new Sprite(back);
      backSprite.renderOrder = BACK_ORDER;
      backSprite.scale.set(BAR_WIDTH + 2 * BORDER, BAR_HEIGHT + 2 * BORDER, 1);
      const fillSprite = new Sprite(champion.team === localTeam ? ally : enemy);
      fillSprite.renderOrder = FILL_ORDER;
      fillSprite.center.set(0, 0.5);
      fillSprite.scale.set(BAR_WIDTH, BAR_HEIGHT, 1);
      this.group.add(backSprite, fillSprite);
      this.backs.push(backSprite);
      this.fills.push(fillSprite);
    }
    // Then the pip rows, in champion id order, one row per champion with a counter.
    this.pips = [];
    for (let id = 0; id < champions.length; id++) {
      const row: Sprite[] = [];
      const cap = this.caps[id] as number;
      for (let slot = 0; slot < cap; slot++) {
        // An empty slot starts on the bar back; a filled one takes the champion's material.
        const pip = new Sprite(back);
        pip.renderOrder = PIP_ORDER;
        pip.scale.set(PIP_SIZE, PIP_SIZE, 1);
        pip.visible = false;
        this.group.add(pip);
        row.push(pip);
      }
      this.pips.push(row);
    }
  }

  /**
   * Moves and scales the bars to the champions' health and drawn poses, and fills the
   * pip rows from the counters (rules.md section 2.6). Returns true when a reported
   * percent changed, and `changed(i)` says which ones did in this update; the counts
   * follow the same way through `counterChanged(i)`. Allocates nothing.
   */
  update(champions: readonly ChampionState[], poses: readonly Pose[]): boolean {
    let changed = false;
    for (let i = 0; i < champions.length; i++) {
      this.changes[i] = 0;
      this.counterChanges[i] = 0;
      const champion = champions[i];
      const pose = poses[i];
      const back = this.backs[i];
      const fill = this.fills[i];
      if (!champion || !pose || !back || !fill) continue;
      back.visible = champion.alive;
      fill.visible = champion.alive;
      const percent = champion.alive ? Math.round((100 * champion.health) / champion.maxHealth) : -1;
      if (percent !== this.percents[i]) {
        this.percents[i] = percent;
        this.changes[i] = 1;
        changed = true;
      }
      if (this.updatePips(i, champion, pose)) changed = true;
      if (!champion.alive) continue;
      back.position.set(pose.x, BAR_Y, -pose.y);
      fill.position.set(pose.x - BAR_WIDTH / 2, BAR_Y, -pose.y);
      fill.scale.x = (BAR_WIDTH * champion.health) / champion.maxHealth;
    }
    return changed;
  }

  /**
   * The pip row of `i`: shown iff the champion is alive and the kit declares a counter,
   * filled from the left up to the count. A champion without a counter or a dead one
   * hides its row and reads -1, like the bar. The row follows the drawn pose every
   * frame like the bar does; only the shown count is cached, so `counterChanged(i)`
   * reports the frame a pip moved. Returns true when the shown count changed this
   * update; a position write allocates nothing. Allocates nothing.
   */
  private updatePips(i: number, champion: ChampionState, pose: Pose): boolean {
    const row = this.pips[i];
    if (row === undefined || row.length === 0) {
      // No row at all for a champion without a counter: it reads -1, like a hidden bar,
      // and the change flag stays 0, since there is no count to have changed.
      this.counts[i] = -1;
      return false;
    }
    const back = this.backs[i] as Sprite;
    const count = champion.alive ? Math.min(champion.counter?.count ?? 0, row.length) : -1;
    const changed = count !== this.counts[i];
    this.counts[i] = count;
    if (!champion.alive) {
      for (let slot = 0; slot < row.length; slot++) (row[slot] as Sprite).visible = false;
      if (changed) this.counterChanges[i] = 1;
      return changed;
    }
    // The row is centred under the bar, one slot after the other.
    const width = row.length * PIP_SIZE + (row.length - 1) * PIP_GAP;
    const step = PIP_SIZE + PIP_GAP;
    const first = pose.x - width / 2 + PIP_SIZE / 2;
    const fill = this.fills[i] as Sprite;
    for (let slot = 0; slot < row.length; slot++) {
      const pip = row[slot] as Sprite;
      pip.visible = true;
      pip.position.set(first + slot * step, PIP_Y, -pose.y);
      // Swapping the material costs nothing: both were made in the constructor.
      pip.material = slot < count ? fill.material : back.material;
    }
    if (changed) this.counterChanges[i] = 1;
    return changed;
  }

  /** The fill percent of champion `i` in the latest update, -1 for a hidden bar. */
  percent(i: number): number {
    return this.percents[i] ?? -1;
  }

  /** True when champion `i`'s percent changed in the latest `update`. */
  changed(i: number): boolean {
    return this.changes[i] === 1;
  }

  /** The count of champion `i`'s pip row in the latest update, -1 for a hidden row. */
  counterCount(i: number): number {
    return this.counts[i] ?? -1;
  }

  /** True when champion `i`'s counter changed in the latest `update`. */
  counterChanged(i: number): boolean {
    return this.counterChanges[i] === 1;
  }
}

export function createHealthBars(
  champions: readonly { team: TeamId }[],
  localTeam: TeamId,
  caps: readonly number[] = [],
): HealthBars {
  return new HealthBars(champions, localTeam, caps);
}
