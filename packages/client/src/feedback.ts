import type { GameState } from '@claudeline/sim';
import type { ImpactRings } from './impact-rings';

/** A hit flash lasts this many sim ticks. */
export const FLASH_TICKS = 8;

/** Every handler gets the sim tick the events belong to, as `state.tick` after the step. */
export interface FeedbackHandlers {
  damage(tick: number, targetId: number): void;
  /** A projectile touched a champion. */
  hit(tick: number, x: number, y: number): void;
  /** A projectile ended on an obstacle, the boundary or its lifetime. */
  expire(tick: number, x: number, y: number): void;
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
        handlers.hit(tick, event.x, event.y);
        break;
      case 'projectileExpired':
        // The 'hit' expiry repeats the position of the projectileHit before it.
        if (event.reason !== 'hit') handlers.expire(tick, event.x, event.y);
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

/** Flash windows, hit and death counters, and the impact rings. */
export class CombatFeedback implements FeedbackHandlers {
  /** Running total of projectile hits. */
  hits = 0;
  /** Running total of deaths. The kill feed arrives with the HUD. */
  deaths = 0;
  private readonly flashEndTick: number[];

  constructor(
    championCount: number,
    private readonly rings: ImpactRings,
  ) {
    this.flashEndTick = Array.from({ length: championCount }, () => 0);
  }

  damage(tick: number, targetId: number): void {
    if (targetId >= 0 && targetId < this.flashEndTick.length) {
      this.flashEndTick[targetId] = tick + FLASH_TICKS;
    }
  }

  hit(tick: number, x: number, y: number): void {
    this.hits += 1;
    this.rings.spawn(x, y, tick);
  }

  expire(tick: number, x: number, y: number): void {
    this.rings.spawn(x, y, tick);
  }

  death(): void {
    this.deaths += 1;
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
