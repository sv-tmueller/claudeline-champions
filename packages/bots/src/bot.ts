import { SLOTS } from '@claudeline/sim';
import type { ChampionState, GameState, KitDef, PlayerInput } from '@claudeline/sim';
import { NOMINAL_PROJECTILE_SPEED, leadPoint, roundAim, rotateByHalfTangent } from './aim';
import { abilityFor, buttonsOf, chooseCast, findKit, projectileSpeed, updateRuns } from './casting';
import type { CastChoice } from './casting';
import { TIERS } from './difficulty';
import type { Difficulty } from './difficulty';
import { createFollower, followPath } from './follow';
import { segmentClear } from './geometry';
import { buildNavGrid, cellCenter, cellIndexAt } from './grid';
import type { NavGrid, Vec2 } from './grid';
import { chooseIntent, scoreIntents } from './intent';
import type { Intent, ScoredIntent } from './intent';
import { profileFor } from './profile';
import type { BotProfile } from './profile';
import { createRng } from './rng';
import { SIGHT_CLEARANCE, clearShot, nearestSightCell } from './sight';
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

/** What the path follower is walking to: the target, the bot's own spawn or a cell that sees the target. */
type FollowGoal = 'target' | 'spawn' | 'sight';

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

/**
 * The nearest alive enemy within `rangeMax` with a clear shot whose health fraction is at most
 * `health`, the bot's own; a tie in distance goes to the lower id. Undefined when there is none.
 */
function finisher(
  state: GameState,
  me: ChampionState,
  profile: BotProfile,
  health: number,
): ChampionState | undefined {
  let best: ChampionState | undefined;
  let bestDistance = Infinity;
  for (const c of state.champions) {
    if (!c.alive || c.team === me.team || c.health / c.maxHealth > health) continue;
    const d = distanceBetween(me, c);
    if (d > profile.rangeMax || d >= bestDistance) continue;
    if (!clearShot(state, me, c, SIGHT_CLEARANCE)) continue;
    best = c;
    bestDistance = d;
  }
  return best;
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
 * cell and is reached by a clear straight segment. Null when all five fail: the bot is cornered.
 */
function kiteStep(grid: NavGrid, me: ChampionState, target: ChampionState): MoveCommand | null {
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
  return null;
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
  // The kind of goal the follower served on the previous think and on this one. Null after a
  // think that did not call followPath, so a follower never carries a plan across a gap.
  let previousGoal: FollowGoal | null = null;
  let currentGoal: FollowGoal | null = null;
  // True when the previous think was a cornered kiter's escape, and on this one. The escape
  // goes on while the bot is closer than rangeMin: without it, one step along the wall frees a
  // kite candidate, the step back into the corner blocks all five again, and the bot dithers.
  let wasEscaping = false;
  let escaping = false;
  let grid: NavGrid | undefined;
  let gridArena: GameState['arena'] | undefined;
  let aimU = 0;
  let aimAge = 0;
  // Per slot (in SLOTS order), the consecutive thinks the acted target was in sight and in reach
  // of the ability the slot would cast. Allocated once; see casting.ts.
  const runs: number[] = SLOTS.map(() => 0);

  function navGrid(state: GameState): NavGrid {
    if (grid === undefined || gridArena !== state.arena) {
      grid = buildNavGrid(state.arena);
      gridArena = state.arena;
      follower = createFollower();
    }
    return grid;
  }

  function decide(state: GameState, me: ChampionState, profile: BotProfile): void {
    const targetId = chooseTarget(state, me, decided.targetId);
    const target = state.champions[targetId];
    if (targetId < 0 || target === undefined) {
      decided = { intent: 'idle', targetId: -1 };
      return;
    }
    const current: ScoredIntent = decided.intent === 'idle' ? 'engage' : decided.intent;
    const health = me.health / me.maxHealth;
    const scores = scoreIntents(distanceBetween(me, target), health, profile.rangeMin);
    const intent = chooseIntent(current, scores);
    if (intent === 'retreat') {
      // A finisher: an enemy in reach with a clear shot and no more health than the bot has. The
      // bot does not retreat from it: it engages or kites it instead, and it is the target.
      const weak = finisher(state, me, profile, health);
      if (weak !== undefined) {
        const against = scoreIntents(distanceBetween(me, weak), health, profile.rangeMin);
        against.retreat = 0;
        decided = {
          intent: chooseIntent(current === 'retreat' ? 'engage' : current, against),
          targetId: weak.id,
        };
        return;
      }
    }
    decided = { intent, targetId };
  }

  /** Path following with a fresh follower when the goal kind differs from the previous think's. */
  function follow(kind: FollowGoal, g: NavGrid, me: ChampionState, goal: Vec2): MoveCommand {
    if (kind !== previousGoal) follower = createFollower();
    currentGoal = kind;
    return followPath(g, follower, me, goal);
  }

  function move(
    state: GameState,
    me: ChampionState,
    acted: Decision,
    profile: BotProfile,
  ): MoveCommand {
    const target = enemyAlive(state, me, acted.targetId);
    if (acted.intent === 'idle' || target === undefined) return { moveX: 0, moveY: 0 };
    const d = distanceBetween(me, target);
    const g = navGrid(state);
    switch (acted.intent) {
      case 'engage':
        if (d <= profile.rangeMax && clearShot(state, me, target, SIGHT_CLEARANCE)) {
          return { moveX: 0, moveY: 0 };
        }
        return follow('target', g, me, target);
      case 'kite': {
        if (d < profile.rangeMin) {
          if (!wasEscaping) {
            const stepAway = kiteStep(g, me, target);
            if (stepAway !== null) return stepAway;
          }
          // Cornered: leave along the path to the own spawn. The escape counts only while the
          // path gives a move: at the spawn, or with no path, the bot stands for this think and
          // tries the kite steps again on the next.
          const spawn = ownSpawn(state, me);
          if (spawn === undefined) return { moveX: 0, moveY: 0 };
          const leave = follow('spawn', g, me, spawn);
          escaping = leave.moveX !== 0 || leave.moveY !== 0;
          return leave;
        }
        if (clearShot(state, me, target, SIGHT_CLEARANCE)) return { moveX: 0, moveY: 0 };
        const cell = nearestSightCell(g, state, me, target, profile.rangeMin, profile.rangeMax);
        return cell >= 0
          ? follow('sight', g, me, cellCenter(g, cell))
          : follow('target', g, me, target);
      }
      case 'retreat': {
        const spawn = ownSpawn(state, me);
        return spawn === undefined ? { moveX: 0, moveY: 0 } : follow('spawn', g, me, spawn);
      }
    }
  }

  function aim(
    me: ChampionState,
    target: ChampionState,
    speed: number,
  ): { aimX: number; aimY: number } {
    if (aimAge === 0) aimU = (2 * rng.next() - 1) * tier.maxU;
    aimAge = (aimAge + 1) % AIM_ERROR_HOLD;
    const lead = leadPoint(me, target, { x: target.vx, y: target.vy }, speed);
    const turned = rotateByHalfTangent(lead.x - me.x, lead.y - me.y, aimU);
    const aimX = roundAim(me.x + turned.x);
    const aimY = roundAim(me.y + turned.y);
    return Number.isFinite(aimX) && Number.isFinite(aimY)
      ? { aimX, aimY }
      : { aimX: me.aimX, aimY: me.aimY };
  }

  /**
   * The speed the aim leads with: the first projectile of the ability winding up, or else of the
   * one pressed on this think, or else the nominal speed.
   */
  function aimSpeed(kit: KitDef | undefined, me: ChampionState, choice: CastChoice | null): number {
    if (kit !== undefined) {
      const spec =
        me.cast !== null
          ? abilityFor(kit, me.cast.slot, me.cast.ex)
          : choice !== null
            ? abilityFor(kit, choice.slot, choice.ex)
            : undefined;
      const speed = spec === undefined ? undefined : projectileSpeed(spec);
      if (speed !== undefined) return speed;
    }
    return NOMINAL_PROJECTILE_SPEED;
  }

  return {
    think(state: GameState): PlayerInput {
      previousGoal = currentGoal;
      currentGoal = null;
      wasEscaping = escaping;
      escaping = false;
      const me = state.champions[playerId];
      if (me === undefined) return fail(`no champion ${playerId} in the state`);
      if (!me.alive) {
        runs.fill(0);
        return { moveX: 0, moveY: 0, aimX: me.aimX, aimY: me.aimY, buttons: 0 };
      }

      const kit = findKit(state, me.championId);
      const profile = profileFor(me.championId, kit);
      decide(state, me, profile);

      const delayed = ring[ringIndex];
      ring[ringIndex] = { intent: decided.intent, targetId: decided.targetId };
      ringIndex = (ringIndex + 1) % tier.delay;
      let acted: Decision = delayed ?? { intent: 'idle', targetId: -1 };

      const target = enemyAlive(state, me, acted.targetId);
      if (target === undefined) acted = { intent: 'idle', targetId: -1 };
      if (acted.intent !== lastActed.intent || acted.targetId !== lastActed.targetId) {
        follower = createFollower();
      }
      if (acted.targetId !== lastActed.targetId) runs.fill(0);
      lastActed = acted;

      const command = move(state, me, acted, profile);
      if (acted.intent === 'idle' || target === undefined) {
        runs.fill(0);
        return {
          moveX: command.moveX,
          moveY: command.moveY,
          aimX: me.aimX,
          aimY: me.aimY,
          buttons: 0,
        };
      }
      let choice: CastChoice | null = null;
      if (kit !== undefined) {
        updateRuns(runs, state, kit, me, target);
        choice = chooseCast(runs, tier.castDelay, kit, me);
      } else {
        runs.fill(0);
      }
      const { aimX, aimY } = aim(me, target, aimSpeed(kit, me, choice));
      return {
        moveX: command.moveX,
        moveY: command.moveY,
        aimX,
        aimY,
        buttons: choice === null ? 0 : buttonsOf(choice),
      };
    },

    inspect(): { intent: Intent; targetId: number } {
      return { intent: lastActed.intent, targetId: lastActed.targetId };
    },
  };
}
