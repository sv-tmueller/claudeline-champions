import type { ArenaDef } from './arena';

export type TeamId = 'A' | 'B';

// The event and status unions are defined with abilities in milestone 3.
export type SimEvent = never;
export type StatusInstance = never;

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

// structuredClone is not in the sim's lib, and state is plain JSON by contract.
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
