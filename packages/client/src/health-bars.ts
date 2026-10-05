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
const BACK_ORDER = 3;
const FILL_ORDER = 4;
const BACK_OPACITY = 0.75;
// The back is a little larger than the fill, so it shows as a border.
const BORDER = 0.04;

function barMaterial(color: string, opacity: number): SpriteMaterial {
  // No depth test: a bar is never hidden by an obstacle or a champion in front.
  // Always transparent, so back and fill share a pass and renderOrder decides which is on top.
  return new SpriteMaterial({ color, transparent: true, opacity, depthTest: false });
}

/**
 * Two sprites per champion, back then fill, in champion id order. The camera
 * never yaws, so world +x is screen right and a fill anchored at its left
 * edge shrinks towards the left.
 */
export class HealthBars {
  readonly group = new Group();
  private readonly percents: number[];
  // 1 for a champion whose percent changed in the latest update, else 0.
  private readonly changes: number[];
  private readonly fills: Sprite[] = [];
  private readonly backs: Sprite[] = [];

  constructor(champions: readonly { team: TeamId }[], localTeam: TeamId) {
    const back = barMaterial(BAR_BACK_COLOUR, BACK_OPACITY);
    const ally = barMaterial(ALLY_BAR_COLOUR, 1);
    const enemy = barMaterial(ENEMY_BAR_COLOUR, 1);
    this.percents = champions.map(() => -2);
    this.changes = champions.map(() => 0);
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
  }

  /**
   * Moves and scales the bars to the champions' health and drawn poses.
   * Returns true when a reported percent changed, and `changed(i)` says which
   * ones did in this update. Allocates nothing.
   */
  update(champions: readonly ChampionState[], poses: readonly Pose[]): boolean {
    let changed = false;
    for (let i = 0; i < champions.length; i++) {
      this.changes[i] = 0;
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
      if (!champion.alive) continue;
      back.position.set(pose.x, BAR_Y, -pose.y);
      fill.position.set(pose.x - BAR_WIDTH / 2, BAR_Y, -pose.y);
      fill.scale.x = (BAR_WIDTH * champion.health) / champion.maxHealth;
    }
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
}

export function createHealthBars(
  champions: readonly { team: TeamId }[],
  localTeam: TeamId,
): HealthBars {
  return new HealthBars(champions, localTeam);
}
