import type { ArenaDef } from './arena';
import type { Slot } from './input';

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
    };
export type AreaTargets = 'enemies' | 'allies' | 'all';
export type ProjectileEndReason = 'hit' | 'obstacle' | 'boundary' | 'lifetime';

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
  /** Applied in order to each champion hit. */
  effects: Effect[];
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
  | { type: 'dashEnded'; championId: number; x: number; y: number; reason: DashEndReason };

export interface DashState {
  /** Unit vector. */
  dirX: number;
  dirY: number;
  /** Meters moved each tick. */
  stepLength: number;
  /** Ticks of motion left, counting the next one. */
  ticksLeft: number;
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
}

export interface GameState {
  tick: number;
  /** mulberry32 state, a uint32. */
  rng: number;
  arena: ArenaDef;
  champions: ChampionState[];
  /** Next id for a projectile or area. Champions use 0 to n-1; ids are never reused. */
  nextEntityId: number;
  /** Ascending id order. */
  projectiles: ProjectileState[];
  areas: AreaState[];
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

// The sim's lib has no built-in deep clone, and state is plain JSON by contract.
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
