import type { GameState, SimEvent, TeamId } from '@claudeline/sim';
import { RING_TINT_ALLY, RING_TINT_ENEMY, RING_TINT_YELLOW, type ImpactRings, type RingTint } from './impact-rings';
import type { KillFeed } from './kill-feed';

/** A hit flash lasts this many sim ticks. */
export const FLASH_TICKS = 8;

export type ProjectileHitEvent = Extract<SimEvent, { type: 'projectileHit' }>;
export type ProjectileExpiredEvent = Extract<SimEvent, { type: 'projectileExpired' }>;

/**
 * Every handler gets the sim tick the events belong to, as `state.tick` after the step.
 * `hit` and `expire` get the sim's event record and read its fields: a raw double passed
 * to a call is boxed where V8 does not inline it (issue #89).
 */
export interface FeedbackHandlers {
  damage(tick: number, targetId: number): void;
  /** A projectile touched a champion. */
  hit(tick: number, event: ProjectileHitEvent): void;
  /** A projectile ended on an obstacle, the boundary or its lifetime. */
  expire(tick: number, event: ProjectileExpiredEvent): void;
  death(tick: number, targetId: number, sourceId: number): void;
}

/**
 * Call after every `step`: the sim clears `state.events` at the start of the
 * next one. Indexed loop and no allocation, since it runs in the frame loop.
 */
export function routeEvents(state: GameState, handlers: FeedbackHandlers): void {
  const events = state.events;
  const tick = state.tick;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;
    switch (event.type) {
      case 'damage':
        handlers.damage(tick, event.targetId);
        break;
      case 'projectileHit':
        handlers.hit(tick, event);
        break;
      case 'projectileExpired':
        // The 'hit' expiry repeats the position of the projectileHit before it. A 'roundEnd'
        // expiry is a shot cut off by the round's end or start, where nothing was hit.
        if (event.reason !== 'hit' && event.reason !== 'roundEnd') handlers.expire(tick, event);
        break;
      case 'death':
        handlers.death(tick, event.targetId, event.sourceId);
        break;
      default:
        // Heal, area and spawn events have no feedback yet.
        break;
    }
  }
}

/** Ids from a flash mask, comma separated. Allocates, so call it only when the mask changed. */
export function flashText(mask: number): string {
  const ids: number[] = [];
  for (let id = 0; mask >>> id !== 0; id++) if ((mask >>> id) & 1) ids.push(id);
  return ids.join(',');
}

/**
 * The flash text of every mask of `championCount` champions, indexed by mask.
 * Made once at startup, so writing the flash hook builds no string.
 */
export function flashTexts(championCount: number): string[] {
  const texts: string[] = [];
  for (let mask = 0; mask < 2 ** championCount; mask++) texts.push(flashText(mask));
  return texts;
}

/** Flash windows, hit and death counters, the impact rings and the kill feed. */
export class CombatFeedback implements FeedbackHandlers {
  /** Running total of projectile hits. */
  hits = 0;
  /** Running total of deaths. */
  deaths = 0;
  private readonly flashEndTick: number[];

  /**
   * `champions` is the match's champion array (read for teams, so a hit's ring can tell a
   * heal bolt from a damage shot) and `localTeam` the team whose projectiles are ally-coloured.
   */
  constructor(
    private readonly champions: readonly { readonly team: TeamId }[],
    private readonly localTeam: TeamId,
    private readonly rings: ImpactRings,
    private readonly killFeed: KillFeed,
  ) {
    this.flashEndTick = Array.from({ length: champions.length }, () => 0);
  }

  damage(tick: number, targetId: number): void {
    if (targetId >= 0 && targetId < this.flashEndTick.length) {
      this.flashEndTick[targetId] = tick + FLASH_TICKS;
    }
  }

  hit(tick: number, event: ProjectileHitEvent): void {
    this.hits += 1;
    // A hit on the owner's own team is a heal bolt: its ring has the colour of the owner
    // team's projectiles. Any other hit is yellow, and so is one that names an unknown champion.
    const owner = this.champions[event.ownerId];
    const target = this.champions[event.targetId];
    let tint: RingTint = RING_TINT_YELLOW;
    if (owner !== undefined && target !== undefined && owner.team === target.team) {
      tint = owner.team === this.localTeam ? RING_TINT_ALLY : RING_TINT_ENEMY;
    }
    this.rings.spawn(event, tick, tint);
  }

  expire(tick: number, event: ProjectileExpiredEvent): void {
    this.rings.spawn(event, tick);
  }

  death(tick: number, targetId: number, sourceId: number): void {
    this.deaths += 1;
    this.killFeed.push(tick, sourceId, targetId);
  }

  isFlashing(id: number, tick: number): boolean {
    return tick < (this.flashEndTick[id] ?? 0);
  }

  /** Bit i is set while champion i flashes. Three or four champions per team fit easily. */
  flashMask(tick: number): number {
    let mask = 0;
    for (let id = 0; id < this.flashEndTick.length; id++) {
      if (this.isFlashing(id, tick)) mask |= 1 << id;
    }
    return mask;
  }
}
