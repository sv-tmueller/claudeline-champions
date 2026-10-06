import type { ArenaDef } from './arena';
import type { Slot } from './input';
import type { KitDef, ThenEffect } from './kit';

export type TeamId = 'A' | 'B';

export type StatusType =
  | 'stun'
  | 'root'
  | 'silence'
  | 'invulnerable'
  | 'slow'
  | 'haste'
  | 'shield'
  | 'dot'
  | 'hot'
  | 'knockback';
export type StatusEndReason = 'expired' | 'depleted' | 'stopped' | 'replaced' | 'death';
export type DashEndReason = 'complete' | 'blocked' | 'rooted' | 'stunned' | 'death' | 'replaced';
/** Stun, death and a round end interrupt a windup. */
export type CastInterruptReason = 'stun' | 'death' | 'roundEnd';

/** Who a status came from: the champion and the ability slot, null for a direct toolkit call. */
export interface StatusSource {
  sourceId: number;
  slot: Slot | null;
}

type StatusBase = StatusSource & { remainingTicks: number };

export type StatusInstance = StatusBase &
  (
    | { type: 'stun' | 'root' | 'silence' | 'invulnerable' }
    | { type: 'slow' | 'haste'; percent: number }
    | { type: 'shield'; absorb: number }
    | { type: 'dot' | 'hot'; perPulse: number; ticksToNextPulse: number }
    | {
        type: 'knockback';
        /** Unit vector. */
        dirX: number;
        dirY: number;
        /** Meters of push when the instance was applied, after the cap trim. */
        distance: number;
        /** Ticks the push was spread over; `remainingTicks` counts down from it. */
        totalTicks: number;
      }
  );

/** What `applyStatus` and the `applyStatus` effect take; shield and knockback have their own. */
export type StatusSpec =
  | { type: 'stun' | 'root' | 'silence' | 'invulnerable'; ticks: number }
  | { type: 'slow' | 'haste'; percent: number; ticks: number }
  | { type: 'dot' | 'hot'; perPulse: number; ticks: number };

export type Effect =
  | { type: 'damage'; amount: number }
  | { type: 'heal'; amount: number }
  | { type: 'applyStatus'; status: StatusSpec }
  | { type: 'shield'; absorb: number; ticks: number }
  | {
      type: 'knockback';
      distance: number;
      ticks: number;
      /** `away` points from the hit origin to the target, `toward` from the target to the owner. */
      direction: 'away' | 'toward';
    }
  /**
   * Extra energy for the caster on top of the table gain, when this hit qualifies for one. Only
   * `landHit` reads it, so `applyEffects` skips it.
   */
  | { type: 'energyGain'; amount: number };
export type AreaTargets = 'enemies' | 'allies' | 'all';
/** `roundEnd`: the round was decided, or a round started, with the projectile still in flight. */
export type ProjectileEndReason = 'hit' | 'obstacle' | 'boundary' | 'lifetime' | 'roundEnd';

export interface ProjectileState {
  id: number;
  ownerId: number;
  /** Copied from the owner at spawn. */
  team: TeamId;
  x: number;
  y: number;
  /** Velocity in m/s. */
  vx: number;
  vy: number;
  radius: number;
  /** Sweeps left, counting the next one. */
  remainingTicks: number;
  pierce: boolean;
  /** Champions already hit, in hit order. */
  hitIds: number[];
  /** Applied in order to each champion of the other team that it hits. */
  effects: Effect[];
  /**
   * Applied in order to each champion of the owner's team (never the owner) that it hits. The
   * key is missing, not undefined, when the projectile has none: `checksum` rejects undefined.
   * With it, a projectile with empty `effects` passes enemies.
   */
  allyEffects?: Effect[];
  /** The cast that spawned it, or null for a dev tool spawn, which earns no energy. */
  castId: number | null;
}

export interface AreaState {
  id: number;
  /** Cone and rect join the union later. */
  type: 'circle';
  ownerId: number;
  team: TeamId;
  x: number;
  y: number;
  radius: number;
  targets: AreaTargets;
  remainingTicks: number;
  intervalTicks: number;
  /** 0 means the area applies this tick. */
  ticksToNextApply: number;
  effects: Effect[];
  /** The cast that spawned it, or null for a dev tool spawn, which earns no energy. */
  castId: number | null;
}

// `amount` on damage and heal is what was actually removed or restored and `health` is
// the value afterwards. Hit and expired positions are the projectile centre at contact.
export type SimEvent =
  | {
      type: 'projectileSpawned';
      projectileId: number;
      ownerId: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
    }
  | {
      type: 'projectileHit';
      projectileId: number;
      ownerId: number;
      targetId: number;
      x: number;
      y: number;
    }
  | {
      type: 'projectileExpired';
      projectileId: number;
      reason: ProjectileEndReason;
      x: number;
      y: number;
    }
  | { type: 'areaSpawned'; areaId: number; ownerId: number; x: number; y: number; radius: number }
  | { type: 'areaTick'; areaId: number; targetIds: number[] }
  | { type: 'areaExpired'; areaId: number }
  | { type: 'damage'; targetId: number; sourceId: number; amount: number; health: number }
  | { type: 'heal'; targetId: number; sourceId: number; amount: number; health: number }
  | { type: 'death'; targetId: number; sourceId: number }
  | {
      type: 'statusApplied';
      targetId: number;
      sourceId: number;
      slot: Slot | null;
      status: StatusType;
      remainingTicks: number;
    }
  | {
      type: 'statusExpired';
      targetId: number;
      sourceId: number;
      slot: Slot | null;
      status: StatusType;
      reason: StatusEndReason;
    }
  | {
      type: 'shieldAbsorbed';
      targetId: number;
      sourceId: number;
      /** Absorbed by all shields in this one hit. */
      amount: number;
      /** Absorb left over all the target's shields afterwards. */
      absorbLeft: number;
    }
  | {
      type: 'meleeArc';
      ownerId: number;
      x: number;
      y: number;
      dirX: number;
      dirY: number;
      radius: number;
      cosHalfAngle: number;
      targetIds: number[];
    }
  | {
      type: 'teleport';
      championId: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      blocked: boolean;
    }
  | {
      type: 'dashStarted';
      championId: number;
      x: number;
      y: number;
      dirX: number;
      dirY: number;
      distance: number;
      ticks: number;
    }
  | { type: 'dashEnded'; championId: number; x: number; y: number; reason: DashEndReason }
  | {
      type: 'castStarted';
      championId: number;
      castId: number;
      slot: Slot;
      ex: boolean;
      windupTicks: number;
      /** Energy paid: 100 for F, 25 for an EX variant, else 0. */
      cost: number;
    }
  | { type: 'castFired'; championId: number; castId: number; slot: Slot; ex: boolean }
  | {
      type: 'castInterrupted';
      championId: number;
      castId: number;
      slot: Slot;
      ex: boolean;
      reason: CastInterruptReason;
    }
  | {
      type: 'energyGained';
      /** The caster who earned it. */
      championId: number;
      castId: number;
      /** The champion the hit or heal landed on. */
      targetId: number;
      /** Energy added, after the cap trimmed it; always above 0. */
      amount: number;
      /** The caster's energy afterwards. */
      energy: number;
    }
  | { type: 'roundStarted'; round: number }
  | {
      type: 'suddenDeathStarted';
      round: number;
      /** The ring radius it starts at. */
      radius: number;
    }
  | {
      type: 'roundEnded';
      round: number;
      /** The team that won the round, or null for a draw. */
      winner: TeamId | null;
      /** The score after this round counted. */
      scoreA: number;
      scoreB: number;
    }
  | { type: 'matchEnded'; winner: TeamId; scoreA: number; scoreB: number };

export interface DashState {
  /** Unit vector. */
  dirX: number;
  dirY: number;
  /** Meters moved each tick. */
  stepLength: number;
  /** Ticks of motion left, counting the next one. */
  ticksLeft: number;
  /** The cast that started it, or null for a direct `startDash`. */
  castId: number | null;
  /** Effects that fire where the dash ends, unless a stun, a death or a new dash ends it. */
  then: ThenEffect[];
}

/** A cast in its windup. A cast with no windup fires at once and is never stored. */
export interface CastState {
  castId: number;
  slot: Slot;
  /** Whether the EX variant is the one casting. */
  ex: boolean;
  windupTicks: number;
  /** Turns of the caster until the effects fire, from `windupTicks` down to 1. */
  windupLeft: number;
}

/**
 * What energy bookkeeping needs of a cast after it started: who cast it and which targets it has
 * already earned energy from. Kept while the champion's windup, a projectile, an area or a dash of
 * the cast still refers to it.
 */
export interface CastRecord {
  id: number;
  casterId: number;
  slot: Slot;
  ex: boolean;
  /** Champions this cast has already given energy for, in the order it did. */
  credited: number[];
}

export interface ChampionState {
  id: number;
  team: TeamId;
  championId: string;
  /** Position in meters. */
  x: number;
  y: number;
  /** Walk velocity in m/s, not the displacement left after collision. */
  vx: number;
  vy: number;
  /** Radians from atan2, 0 = +x. */
  facing: number;
  /** Last received aim in integer centimeters, kept for the missing-input rule. */
  aimX: number;
  aimY: number;
  health: number;
  maxHealth: number;
  energy: number;
  alive: boolean;
  /** In application order; see the Statuses section of simulation.md. */
  statuses: StatusInstance[];
  dash: DashState | null;
  /** Ticks left until each slot may cast, in `SLOTS` order. */
  cooldowns: number[];
  /** The windup in progress, or null. */
  cast: CastState | null;
}

/** `warmup` before round 1, `roundEnd` is the pause after a decided round, `matchEnd` is final. */
export type MatchPhase = 'warmup' | 'round' | 'roundEnd' | 'matchEnd';

/** The sudden death ring, centred on the arena centre. */
export interface RingState {
  x: number;
  y: number;
  radius: number;
  /** Damage a champion outside takes each tick. */
  damagePerTick: number;
}

/** Match flow, present only for a match created with `roundsToWin`; free play has no such key. */
export interface MatchState {
  phase: MatchPhase;
  /** Steps completed in this phase. */
  phaseTicks: number;
  /** 0 in warmup, then the current or last decided round, counting from 1. */
  round: number;
  roundsToWin: number;
  score: { A: number; B: number };
  /** From the first sudden death step until the next round starts. */
  ring: RingState | null;
}

export interface GameState {
  tick: number;
  /** mulberry32 state, a uint32. */
  rng: number;
  arena: ArenaDef;
  champions: ChampionState[];
  /** Next id for a projectile, area or cast. Champions use 0 to n-1; ids are never reused. */
  nextEntityId: number;
  /** Ascending id order. */
  projectiles: ProjectileState[];
  areas: AreaState[];
  /** The kits of the champions in this match, plain data, in the order `createMatch` got them. */
  kits: KitDef[];
  /** Casts something still refers to, in ascending id order; ids come from `nextEntityId`. */
  casts: CastRecord[];
  /** Rounds, score and sudden death. The key is missing in free play and is never undefined. */
  match?: MatchState;
  /**
   * Cleared at the start of each `step`. Toolkit calls between steps append to it, and the
   * next `step` drops them.
   */
  events: SimEvent[];
}

export interface PlayerConfig {
  championId: string;
  team: TeamId;
}

export interface MatchConfig {
  teamSize: 2 | 3;
  /** players[i] becomes champion id i. */
  players: PlayerConfig[];
  /**
   * Round wins that take the match (rules.md 1.3). Without it the match is free play: no warmup,
   * no round clock, no ring and no round end.
   */
  roundsToWin?: number;
}

export function nextId(state: GameState): number {
  const id = state.nextEntityId;
  state.nextEntityId = id + 1;
  return id;
}

/** Ends a champion's dash, if it has one, and reports it where the champion stands now. */
export function endDash(state: GameState, champion: ChampionState, reason: DashEndReason): void {
  if (!champion.dash) return;
  champion.dash = null;
  state.events.push({
    type: 'dashEnded',
    championId: champion.id,
    x: champion.x,
    y: champion.y,
    reason,
  });
}

/** Drops a champion's windup, if it has one, and reports it. Nothing is refunded. */
export function interruptCast(
  state: GameState,
  champion: ChampionState,
  reason: CastInterruptReason,
): void {
  const { cast } = champion;
  if (!cast) return;
  champion.cast = null;
  state.events.push({
    type: 'castInterrupted',
    championId: champion.id,
    castId: cast.castId,
    slot: cast.slot,
    ex: cast.ex,
    reason,
  });
}

// The sim's lib has no built-in deep clone, and state is plain JSON by contract.
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
