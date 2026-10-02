import { hasLineOfSight } from '@claudeline/sim';
import type { ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import { NOMINAL_PROJECTILE_SPEED, leadPoint, roundAim, rotateByHalfTangent } from './aim';
import { TIERS } from './difficulty';
import type { Difficulty } from './difficulty';
import { createFollower, followPath } from './follow';
import { segmentClear } from './geometry';
import { buildNavGrid, cellIndexAt } from './grid';
import type { NavGrid, Vec2 } from './grid';
import { chooseIntent, scoreIntents } from './intent';
import type { Intent, ScoredIntent } from './intent';
import { profileFor } from './profile';
import { createRng } from './rng';
import { steerToward } from './steer';
import type { MoveCommand } from './steer';

export interface Bot {
  /** Call once per tick, before `step`. Never mutates the state. */
  think(state: GameState): PlayerInput;
  /** The intent and target the bot is acting on now, as a fresh copy. For tests and tools. */
  inspect(): { intent: Intent; targetId: number };
}

/** A target stays the target unless another enemy is more than this much nearer, in metres. */
export const TARGET_SWITCH_MARGIN = 1;
/** How far a kiting bot looks for a free step, in metres. */
export const KITE_STEP = 1;
/** Thinks for which one aim error draw is kept. */
export const AIM_ERROR_HOLD = 15;

interface Decision {
  intent: Intent;
  targetId: number;
}

function fail(problem: string): never {
  throw new Error(`Invalid bot: ${problem}`);
}

function distanceBetween(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function enemyAlive(state: GameState, me: ChampionState, id: number): ChampionState | undefined {
  const c = id >= 0 ? state.champions[id] : undefined;
  return c !== undefined && c.alive && c.team !== me.team ? c : undefined;
}

/** Keep the current target unless another enemy is more than the margin nearer. */
function chooseTarget(state: GameState, me: ChampionState, currentId: number): number {
  let nearest: ChampionState | undefined;
  let nearestDistance = Infinity;
  for (const c of state.champions) {
    if (!c.alive || c.team === me.team) continue;
    const d = distanceBetween(me, c);
    if (d < nearestDistance) {
      nearest = c;
      nearestDistance = d;
    }
  }
  if (nearest === undefined) return -1;
  const current = enemyAlive(state, me, currentId);
  if (current !== undefined && distanceBetween(me, current) - nearestDistance <= TARGET_SWITCH_MARGIN) {
    return current.id;
  }
  return nearest.id;
}

/** The spawn point of the bot's slot: its rank among its teammates by id, as createMatch places them. */
function ownSpawn(state: GameState, me: ChampionState): Vec2 | undefined {
  let slot = 0;
  for (const c of state.champions) if (c.team === me.team && c.id < me.id) slot++;
  const spawn = (me.team === 'A' ? state.arena.spawns.teamA : state.arena.spawns.teamB)[slot];
  return spawn === undefined ? undefined : { x: spawn[0], y: spawn[1] };
}

/** True when the grid cell holding p is free, the cell the path follower would plan to. */
function cellFree(grid: NavGrid, p: Vec2): boolean {
  const cell = cellIndexAt(grid, p);
  return cell >= 0 && grid.blocked[cell] === false;
}

/** Turns the unit vector by 45 degrees (sign 1 or -1) with exact constants, no trigonometry. */
function turn45(v: Vec2, sign: 1 | -1): Vec2 {
  const c = Math.SQRT1_2;
  const s = sign * Math.SQRT1_2;
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * The first of straight away, +45, -45, +90, -90 degrees whose point 1 m off lies in a free grid
 * cell and is reached by a clear straight segment. Stands when all five fail.
 */
function kiteMove(grid: NavGrid, me: ChampionState, target: ChampionState): MoveCommand {
  const d = distanceBetween(me, target);
  const away: Vec2 = d === 0 ? { x: 1, y: 0 } : { x: (me.x - target.x) / d, y: (me.y - target.y) / d };
  const directions: Vec2[] = [
    away,
    turn45(away, 1),
    turn45(away, -1),
    { x: -away.y, y: away.x },
    { x: away.y, y: -away.x },
  ];
  for (const dir of directions) {
    const p = { x: me.x + dir.x * KITE_STEP, y: me.y + dir.y * KITE_STEP };
    if (cellFree(grid, p) && segmentClear(grid, me, p)) return steerToward(me, p);
  }
  return { moveX: 0, moveY: 0 };
}

export function createBot(playerId: number, difficulty: Difficulty, seed: number): Bot {
  if (!Number.isInteger(playerId) || playerId < 0) fail('playerId must be a non-negative integer');
  if (typeof difficulty !== 'string' || !Object.hasOwn(TIERS, difficulty)) {
    fail('difficulty must be easy, normal or hard');
  }
  if (!Number.isInteger(seed)) fail('seed must be an integer');

  const tier = TIERS[difficulty];
  const rng = createRng(seed >>> 0);
  // The delay line: what was decided `delay` thinks ago is what the bot acts on now.
  const ring: Decision[] = [];
  for (let i = 0; i < tier.delay; i++) ring.push({ intent: 'idle', targetId: -1 });
  let ringIndex = 0;
  let decided: Decision = { intent: 'engage', targetId: -1 };
  let lastActed: Decision = { intent: 'idle', targetId: -1 };
  let follower = createFollower();
  let grid: NavGrid | undefined;
  let gridArena: GameState['arena'] | undefined;
  let aimU = 0;
  let aimAge = 0;

  function navGrid(state: GameState): NavGrid {
    if (grid === undefined || gridArena !== state.arena) {
      grid = buildNavGrid(state.arena);
      gridArena = state.arena;
      follower = createFollower();
    }
    return grid;
  }

  function decide(state: GameState, me: ChampionState): void {
    const targetId = chooseTarget(state, me, decided.targetId);
    const target = state.champions[targetId];
    if (targetId < 0 || target === undefined) {
      decided = { intent: 'idle', targetId: -1 };
      return;
    }
    const current: ScoredIntent = decided.intent === 'idle' ? 'engage' : decided.intent;
    const scores = scoreIntents(
      distanceBetween(me, target),
      me.health / me.maxHealth,
      profileFor(me.championId).rangeMin,
    );
    decided = { intent: chooseIntent(current, scores), targetId };
  }

  function move(state: GameState, me: ChampionState, acted: Decision): MoveCommand {
    const target = enemyAlive(state, me, acted.targetId);
    if (acted.intent === 'idle' || target === undefined) return { moveX: 0, moveY: 0 };
    const profile = profileFor(me.championId);
    const d = distanceBetween(me, target);
    const g = navGrid(state);
    switch (acted.intent) {
      case 'engage':
        if (d <= profile.rangeMax && hasLineOfSight(state, me, target)) return { moveX: 0, moveY: 0 };
        return followPath(g, follower, me, target);
      case 'kite':
        return d >= profile.rangeMin ? { moveX: 0, moveY: 0 } : kiteMove(g, me, target);
      case 'retreat': {
        const spawn = ownSpawn(state, me);
        return spawn === undefined ? { moveX: 0, moveY: 0 } : followPath(g, follower, me, spawn);
      }
    }
  }

  function aim(me: ChampionState, target: ChampionState): { aimX: number; aimY: number } {
    if (aimAge === 0) aimU = (2 * rng.next() - 1) * tier.maxU;
    aimAge = (aimAge + 1) % AIM_ERROR_HOLD;
    const lead = leadPoint(me, target, { x: target.vx, y: target.vy }, NOMINAL_PROJECTILE_SPEED);
    const turned = rotateByHalfTangent(lead.x - me.x, lead.y - me.y, aimU);
    const aimX = roundAim(me.x + turned.x);
    const aimY = roundAim(me.y + turned.y);
    return Number.isFinite(aimX) && Number.isFinite(aimY)
      ? { aimX, aimY }
      : { aimX: me.aimX, aimY: me.aimY };
  }

  return {
    think(state: GameState): PlayerInput {
      const me = state.champions[playerId];
      if (me === undefined) return fail(`no champion ${playerId} in the state`);
      if (!me.alive) return { moveX: 0, moveY: 0, aimX: me.aimX, aimY: me.aimY, buttons: 0 };

      decide(state, me);

      const delayed = ring[ringIndex];
      ring[ringIndex] = { intent: decided.intent, targetId: decided.targetId };
      ringIndex = (ringIndex + 1) % tier.delay;
      let acted: Decision = delayed ?? { intent: 'idle', targetId: -1 };

      const target = enemyAlive(state, me, acted.targetId);
      if (target === undefined) acted = { intent: 'idle', targetId: -1 };
      if (acted.intent !== lastActed.intent || acted.targetId !== lastActed.targetId) {
        follower = createFollower();
      }
      lastActed = acted;

      const command = move(state, me, acted);
      const { aimX, aimY } =
        acted.intent === 'idle' || target === undefined
          ? { aimX: me.aimX, aimY: me.aimY }
          : aim(me, target);
      return { moveX: command.moveX, moveY: command.moveY, aimX, aimY, buttons: 0 };
    },

    inspect(): { intent: Intent; targetId: number } {
      return { intent: lastActed.intent, targetId: lastActed.targetId };
    },
  };
}
