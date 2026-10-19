import type { GameState, SimEvent, TeamId } from '@claudeline/sim';
import {
  CAST_ATTACK,
  CAST_OTHER,
  triggerCast,
  triggerDash,
  triggerDeath,
  triggerHit,
  triggerInterrupt,
  triggerSnap,
  type ChampionAnim,
} from './champion-anim';
import { RING_TINT_ALLY, RING_TINT_ENEMY, RING_TINT_YELLOW, type ImpactRings, type RingTint } from './impact-rings';
import type { KillFeed } from './kill-feed';

/** A hit flash lasts this many sim ticks. */
export const FLASH_TICKS = 8;

export type ProjectileHitEvent = Extract<SimEvent, { type: 'projectileHit' }>;
export type ProjectileExpiredEvent = Extract<SimEvent, { type: 'projectileExpired' }>;
export type CastStartedEvent = Extract<SimEvent, { type: 'castStarted' }>;
export type CastInterruptedEvent = Extract<SimEvent, { type: 'castInterrupted' }>;

/**
 * Every handler gets the sim tick the events belong to, as `state.tick` after the step.
 * `hit`, `expire`, `cast` and `interrupt` get the sim's event record and read its fields: a
 * raw double passed to a call is boxed where V8 does not inline it (issue #89). The handlers
 * run cold, a few times per window, so they load no double field: `cast` and `interrupt`
 * read the champion id and the slot, and store integers.
 */
export interface FeedbackHandlers {
  damage(tick: number, targetId: number, sourceId: number): void;
  /** A cast began its windup. */
  cast(tick: number, event: CastStartedEvent): void;
  /** A cast in its windup was cut off. */
  interrupt(tick: number, event: CastInterruptedEvent): void;
  /** A champion's dash began (`active` 1) or ended (0). */
  dash(tick: number, championId: number, active: number): void;
  /** A round began: the champions stand at their spawns again. */
  roundStarted(tick: number): void;
  /** A round ended: the sim freezes a running dash and emits no dashEnded for it. */
  roundEnded(tick: number): void;
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
        handlers.damage(tick, event.targetId, event.sourceId);
        break;
      case 'castStarted':
        handlers.cast(tick, event);
        break;
      case 'castInterrupted':
        handlers.interrupt(tick, event);
        break;
      case 'dashStarted':
        handlers.dash(tick, event.championId, 1);
        break;
      case 'dashEnded':
        handlers.dash(tick, event.championId, 0);
        break;
      case 'roundStarted':
        handlers.roundStarted(tick);
        break;
      case 'roundEnded':
        handlers.roundEnded(tick);
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
        // Heal, area and the other spawn events have no feedback yet.
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

/**
 * Flash windows, hit and death counters, the impact rings, the kill feed and the triggers
 * of the champions' animations.
 */
export class CombatFeedback implements FeedbackHandlers {
  /** Running total of projectile hits. */
  hits = 0;
  /** Running total of deaths. */
  deaths = 0;
  /**
   * Match totals per champion id, for the scoreboard: the deaths of the champion and the kills it
   * got. A death counts for its victim always. A kill counts for the source only when the source
   * is another champion of the match, so the ring (`RING_SOURCE_ID`, -1) credits nobody. Never
   * reset: a page is one match, and Restart reloads it.
   */
  readonly killCounts: Int32Array;
  readonly deathCounts: Int32Array;
  /** Deaths that changed a count so far, so the scoreboard can skip its cells while it stands still. */
  tallyChanges = 0;
  private readonly flashEndTick: number[];

  /**
   * `champions` is the match's champion array (read for teams, so a hit's ring can tell a
   * heal bolt from a damage shot), `localTeam` the team whose projectiles are ally-coloured
   * and `anims` the animation record of each champion, which the handlers write the pending
   * triggers of (champion-anim.ts takes them in `draw`).
   */
  constructor(
    private readonly champions: readonly { readonly team: TeamId }[],
    private readonly localTeam: TeamId,
    private readonly rings: ImpactRings,
    private readonly killFeed: KillFeed,
    private readonly anims: readonly ChampionAnim[],
  ) {
    this.flashEndTick = Array.from({ length: champions.length }, () => 0);
    this.killCounts = new Int32Array(champions.length);
    this.deathCounts = new Int32Array(champions.length);
  }

  damage(tick: number, targetId: number, sourceId: number): void {
    if (targetId >= 0 && targetId < this.flashEndTick.length) {
      this.flashEndTick[targetId] = tick + FLASH_TICKS;
    }
    // The round's ring (`RING_SOURCE_ID`, -1) hurts but does not stagger.
    if (sourceId >= 0) {
      const anim = this.anims[targetId];
      if (anim !== undefined) triggerHit(anim);
    }
  }

  cast(_tick: number, event: CastStartedEvent): void {
    const anim = this.anims[event.championId];
    if (anim !== undefined) triggerCast(anim, event.slot === 'M1' ? CAST_ATTACK : CAST_OTHER);
  }

  interrupt(_tick: number, event: CastInterruptedEvent): void {
    const anim = this.anims[event.championId];
    if (anim !== undefined) triggerInterrupt(anim);
  }

  dash(_tick: number, championId: number, active: number): void {
    const anim = this.anims[championId];
    if (anim !== undefined) triggerDash(anim, active);
  }

  roundEnded(): void {
    for (let i = 0; i < this.anims.length; i++) triggerDash(this.anims[i] as ChampionAnim, 0);
  }

  roundStarted(): void {
    for (let i = 0; i < this.anims.length; i++) triggerSnap(this.anims[i] as ChampionAnim);
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
    this.tally(targetId, sourceId);
    this.killFeed.push(tick, sourceId, targetId);
    const anim = this.anims[targetId];
    if (anim !== undefined) triggerDeath(anim);
  }

  /** Integers only, like the handlers: a death is cold, and the counts are typed arrays. */
  private tally(targetId: number, sourceId: number): void {
    const count = this.deathCounts.length;
    if (targetId < 0 || targetId >= count) return;
    this.deathCounts[targetId] = (this.deathCounts[targetId] ?? 0) + 1;
    if (sourceId >= 0 && sourceId < count && sourceId !== targetId) {
      this.killCounts[sourceId] = (this.killCounts[sourceId] ?? 0) + 1;
    }
    this.tallyChanges += 1;
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
