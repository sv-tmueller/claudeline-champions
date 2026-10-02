import type { ArenaDef } from './arena';

export type TeamId = 'A' | 'B';

// The status union is defined with abilities in milestone 3.
export type StatusInstance = never;

export type Effect = { type: 'damage'; amount: number } | { type: 'heal'; amount: number };
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
  | { type: 'death'; targetId: number; sourceId: number };

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
  statuses: StatusInstance[];
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

// The sim's lib has no built-in deep clone, and state is plain JSON by contract.
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
