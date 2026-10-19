import { SLOTS } from '@claudeline/sim';
import type { ChampionState, GameState, KitDef, PlayerInput } from '@claudeline/sim';
import { NOMINAL_PROJECTILE_SPEED } from './aim';
import {
  abilityFor,
  buttonsOf,
  chooseCast,
  computeCues,
  createCastCues,
  createKitCache,
  findKit,
  refreshKitCache,
  updateRuns,
  waitsFor,
} from './casting';
import type { CastChoice } from './casting';
import { TIERS } from './difficulty';
import type { Difficulty } from './difficulty';
import { clearDodgeMemo, createDodgeScratch, dodgeInto } from './dodge';
import { chooseEscape, createEscapeScratch } from './escape';
import { createFollower, followPathInto } from './follow';
import { buildNavGrid, cellCenterInto } from './grid';
import type { NavGrid, Vec2 } from './grid';
import { createMeasure, distanceInto } from './hypot';
import type { Measure } from './hypot';
import { chooseIntent, scoreIntentsInto } from './intent';
import type { Intent, ScoredIntent, Scores } from './intent';
import { KITE_STEP, createKiteScratch, kiteStepInto } from './kite';
import type { BotProfile } from './profile';
import {
  SIGHT_CLEARANCE,
  SIGHT_RADIUS,
  clearShot,
  clearShotWith,
  createSightScratch,
  nearestSightCellIn,
} from './sight';
import type { SightScratch } from './sight';
import type { MoveCommand } from './steer';

export { KITE_STEP };

export interface Bot {
  /**
   * Call once per tick, before `step`. Never mutates the state. Returns the bot's own record,
   * which its next `think` overwrites: a caller that keeps the input longer copies it.
   */
  think(state: GameState): PlayerInput;
  /** The intent and target the bot is acting on now, as a fresh copy. For tests and tools. */
  inspect(): { intent: Intent; targetId: number };
}

/** A target stays the target unless another enemy is more than this much nearer, in metres. */
export const TARGET_SWITCH_MARGIN = 1;
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

function enemyAlive(state: GameState, me: ChampionState, id: number): ChampionState | undefined {
  const c = id >= 0 ? state.champions[id] : undefined;
  return c !== undefined && c.alive && c.team !== me.team ? c : undefined;
}

/** Keep the current target unless another enemy is more than the margin nearer. */
function chooseTarget(
  state: GameState,
  me: ChampionState,
  currentId: number,
  dist: Measure,
): number {
  let nearest: ChampionState | undefined;
  let nearestDistance = Infinity;
  for (let i = 0; i < state.champions.length; i++) {
    const c = state.champions[i] as ChampionState;
    if (!c.alive || c.team === me.team) continue;
    distanceInto(dist, me, c);
    const d = dist.metres;
    if (d < nearestDistance) {
      nearest = c;
      nearestDistance = d;
    }
  }
  if (nearest === undefined) return -1;
  const current = enemyAlive(state, me, currentId);
  if (current !== undefined) {
    distanceInto(dist, me, current);
    if (dist.metres - nearestDistance <= TARGET_SWITCH_MARGIN) return current.id;
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
  sight: SightScratch,
  dist: Measure,
): ChampionState | undefined {
  const health = me.health / me.maxHealth;
  let best: ChampionState | undefined;
  let bestDistance = Infinity;
  for (let i = 0; i < state.champions.length; i++) {
    const c = state.champions[i] as ChampionState;
    if (!c.alive || c.team === me.team || c.health / c.maxHealth > health) continue;
    distanceInto(dist, me, c);
    const d = dist.metres;
    if (d > profile.rangeMax || d >= bestDistance) continue;
    if (!clearShot(state, me, c, SIGHT_CLEARANCE, sight)) continue;
    best = c;
    bestDistance = d;
  }
  return best;
}

/**
 * Whether the bot's team is ahead: the sum of health over maximum health of its alive champions,
 * the bot included, is more than the same sum of the enemy's alive champions. Summed in id order,
 * so the result is the same on every platform; equal sums are not ahead.
 */
function teamAhead(state: GameState, me: ChampionState): boolean {
  let own = 0;
  let enemy = 0;
  for (let i = 0; i < state.champions.length; i++) {
    const c = state.champions[i] as ChampionState;
    if (!c.alive) continue;
    if (c.team === me.team) own += c.health / c.maxHealth;
    else enemy += c.health / c.maxHealth;
  }
  return own > enemy;
}

/** Whether an alive enemy is within `rangeMax` of the bot with a clear shot of 0.5 m. */
function enemyInReach(
  state: GameState,
  me: ChampionState,
  profile: BotProfile,
  sight: SightScratch,
  dist: Measure,
): boolean {
  for (let i = 0; i < state.champions.length; i++) {
    const c = state.champions[i] as ChampionState;
    if (!c.alive || c.team === me.team) continue;
    distanceInto(dist, me, c);
    if (dist.metres > profile.rangeMax) continue;
    if (clearShot(state, me, c, SIGHT_CLEARANCE, sight)) return true;
  }
  return false;
}

/**
 * The spawn point of the bot's slot, written into `out`: its rank among its teammates by id, as
 * createMatch places them. False, with `out` untouched, when the arena has no such spawn.
 */
function ownSpawnInto(out: Vec2, state: GameState, me: ChampionState): boolean {
  let slot = 0;
  for (let i = 0; i < state.champions.length; i++) {
    const c = state.champions[i] as ChampionState;
    if (c.team === me.team && c.id < me.id) slot++;
  }
  const spawn = (me.team === 'A' ? state.arena.spawns.teamA : state.arena.spawns.teamB)[slot];
  if (spawn === undefined) return false;
  out.x = spawn[0];
  out.y = spawn[1];
  return true;
}

export function createBot(playerId: number, difficulty: Difficulty, seed: number): Bot {
  if (!Number.isInteger(playerId) || playerId < 0) fail('playerId must be a non-negative integer');
  if (typeof difficulty !== 'string' || !Object.hasOwn(TIERS, difficulty)) {
    fail('difficulty must be easy, normal or hard');
  }
  if (!Number.isInteger(seed)) fail('seed must be an integer');

  const tier = TIERS[difficulty];
  // The state of the bot's own generator, mulberry32 (rng.ts is the reference): one 32-bit word in
  // a typed array, which `aim` advances. A closure variable or an object field would box it.
  const rngState = new Uint32Array(1);
  rngState[0] = seed >>> 0;
  // Every record a think reads or writes is made here, once, and rewritten field by field: the
  // steady state allocates nothing (packages/bots/test/allocation.test.ts). A plan (its path
  // only), a fresh follower after a goal or intent change, and `inspect()` allocate by design.
  // Fields that hold doubles start as doubles (0.5), as the sim's geometry does, so no field
  // changes representation and boxes a number.
  //
  // The delay line: what was decided `delay` thinks ago is what the bot acts on now.
  const ring: Decision[] = [];
  for (let i = 0; i < tier.delay; i++) ring.push({ intent: 'idle', targetId: -1 });
  let ringIndex = 0;
  const decided: Decision = { intent: 'engage', targetId: -1 };
  const acted: Decision = { intent: 'idle', targetId: -1 };
  const lastActed: Decision = { intent: 'idle', targetId: -1 };
  const scores: Scores = { engage: 0.5, kite: 0.5, retreat: 0.5 };
  const command: MoveCommand = { moveX: 0, moveY: 0 };
  const choice: CastChoice = { slot: 'M1', ex: false };
  const input: PlayerInput = { moveX: 0, moveY: 0, aimX: 0.5, aimY: 0.5, buttons: 0 };
  const sight: SightScratch = createSightScratch();
  const spawnPoint: Vec2 = { x: 0.5, y: 0.5 };
  const goalPoint: Vec2 = { x: 0.5, y: 0.5 };
  const kiteScratch = createKiteScratch();
  const dodgeScratch = createDodgeScratch(tier.dodgeChance, tier.castDelay);
  const kitCache = createKitCache();
  const cues = createCastCues(kiteScratch);
  const escapeScratch = createEscapeScratch(kiteScratch);
  const dist = createMeasure();
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
  // True while a retreating bot advances on its target instead of walking to its spawn (see the
  // retreat case of `move`), and the target it advances on. Cleared when the acted intent is not
  // retreat, when the acted target is another one, when the team gets ahead and when the bot dies.
  let advancing = false;
  let advanceTargetId = -1;
  let grid: NavGrid | undefined;
  let gridArena: GameState['arena'] | undefined;
  // The aim error of the last draw, in a field: V8's Maglev tier boxed (16 B) every number
  // written to a variable of this closure, in the engines measured (see aim below).
  const aimError = { aimU: 0.5 };
  let aimAge = 0;
  // The id of the ally a bolt is aimed at through its windup, or -1 (see `think`). An integer in a
  // field: no double is held.
  const aimHold = { allyAim: -1 };
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
    const targetId = chooseTarget(state, me, decided.targetId, dist);
    const target = state.champions[targetId];
    if (targetId < 0 || target === undefined) {
      decided.intent = 'idle';
      decided.targetId = -1;
      return;
    }
    const current: ScoredIntent = decided.intent === 'idle' ? 'engage' : decided.intent;
    distanceInto(dist, me, target);
    scoreIntentsInto(scores, dist, me, profile);
    const intent = chooseIntent(current, scores);
    if (intent === 'retreat') {
      // A finisher: an enemy in reach with a clear shot and no more health than the bot has. The
      // bot does not retreat from it: it engages or kites it instead, and it is the target.
      const weak = finisher(state, me, profile, sight, dist);
      if (weak !== undefined) {
        distanceInto(dist, me, weak);
        scoreIntentsInto(scores, dist, me, profile);
        scores.retreat = 0;
        decided.intent = chooseIntent(current === 'retreat' ? 'engage' : current, scores);
        decided.targetId = weak.id;
        return;
      }
    }
    decided.intent = intent;
    decided.targetId = targetId;
  }

  /**
   * Whether a stand has a clear shot: of `sight.standClearance`, a champion's 0.5 m unless the bot
   * could press a wider ultimate on this think (see computeCues in casting.ts).
   */
  function standShot(state: GameState, me: ChampionState, target: ChampionState): boolean {
    sight.clearance = sight.standClearance;
    return clearShotWith(state, me, target, sight);
  }

  /** Path following with a fresh follower when the goal kind differs from the previous think's. */
  function follow(kind: FollowGoal, g: NavGrid, me: ChampionState, goal: Vec2): void {
    if (kind !== previousGoal) follower = createFollower();
    currentGoal = kind;
    followPathInto(command, g, follower, me, goal);
  }

  function stand(): void {
    command.moveX = 0;
    command.moveY = 0;
  }

  /**
   * The sight logic of a bot that wants a shot at its target, the one a kite uses beyond rangeMin:
   * stand while the target has a clear shot (and, with `requireRange`, is within rangeMax), else
   * walk to the nearest cell that has one at a distance in [rangeMin, rangeMax], else along the
   * path to the target, which ends in line of sight. Reads the distance to the target from `dist`.
   */
  function seekShot(
    state: GameState,
    g: NavGrid,
    me: ChampionState,
    target: ChampionState,
    profile: BotProfile,
    requireRange: boolean,
  ): void {
    if (
      (!requireRange || dist.metres <= profile.rangeMax) &&
      standShot(state, me, target)
    ) {
      return stand();
    }
    sight.rangeMin = profile.rangeMin;
    sight.rangeMax = profile.rangeMax;
    const cell = nearestSightCellIn(g, state, me, target, SIGHT_RADIUS, sight);
    if (cell < 0) return follow('target', g, me, target);
    cellCenterInto(goalPoint, g, cell);
    return follow('sight', g, me, goalPoint);
  }

  /** The move of the acted intent, written into `command`. */
  function move(state: GameState, me: ChampionState, profile: BotProfile): void {
    if (acted.intent !== 'retreat') advancing = false;
    const target = enemyAlive(state, me, acted.targetId);
    if (acted.intent === 'idle' || target === undefined) return stand();
    distanceInto(dist, me, target);
    const d = dist.metres;
    const g = navGrid(state);
    switch (acted.intent) {
      case 'engage':
        if (d <= profile.rangeMax && standShot(state, me, target)) {
          return stand();
        }
        // The wait of a champion for its opener to come off cooldown (Skerrow's Lunge).
        if (waitsFor(kitCache, me, dist) && standShot(state, me, target)) return stand();
        return follow('target', g, me, target);
      case 'kite': {
        if (d < profile.rangeMin) {
          if (!wasEscaping && kiteStepInto(command, kiteScratch, g, me, target, dist)) return;
          // Cornered: leave along the path to the own spawn. The escape counts only while the
          // path gives a move: at the spawn, or with no path, the bot stands for this think and
          // tries the kite steps again on the next.
          if (!ownSpawnInto(spawnPoint, state, me)) return stand();
          follow('spawn', g, me, spawnPoint);
          escaping = command.moveX !== 0 || command.moveY !== 0;
          return;
        }
        return seekShot(state, g, me, target, profile, false);
      }
      case 'retreat': {
        // The deadlock rule: a retreating bot advances on its target when no enemy is in its reach
        // and its team is not ahead. Without it every champion of a match at low health walks to
        // its spawn and stands there for good. The advance is latched: once begun it goes on, and
        // it stands in reach to cast, until the intent leaves retreat, the target changes or the
        // team gets ahead. Without the latch a bot at the edge of its reach steps back out of it,
        // so its cast run starts over on every other think and nothing lands.
        const ahead = teamAhead(state, me);
        if (advancing && (acted.targetId !== advanceTargetId || ahead)) advancing = false;
        if (!advancing && !ahead && !enemyInReach(state, me, profile, sight, dist)) {
          advancing = true;
          advanceTargetId = acted.targetId;
        }
        if (advancing) {
          // enemyInReach measured other enemies: measure the target again.
          distanceInto(dist, me, target);
          return seekShot(state, g, me, target, profile, true);
        }
        if (!ownSpawnInto(spawnPoint, state, me)) return stand();
        return follow('spawn', g, me, spawnPoint);
      }
    }
  }

  /**
   * Writes the aim into `input`, at `subject`: the acted target, or the ally a bolt is pressed at
   * or winds up for. The aim draw of a think is here (a dodge coin, dodge.ts, follows it). The
   * lead and the error turn are `leadPoint` and `rotateByHalfTangent` of aim.ts written out over
   * locals, with the same operations in the same order (the tests compare the two bit for bit): a
   * call with a double argument that V8 does not inline boxes it, and the aim made a dozen of
   * them. The finite tests are `x - x === 0`, true for a finite x only: in the Chromium of
   * Playwright 1.63 and in V8 14.6 (Node 26) the Maglev tier calls `Number.isFinite` with its
   * argument boxed, one allocation a think; Node 22's V8 12.4 does not reproduce that. The
   * `bots-heap-maglev` project of vitest.heap.config.ts checks it (allocation.test.ts; see
   * bots.md, Allocation, In the browser).
   */
  function aim(
    me: ChampionState,
    subject: ChampionState,
    kit: KitDef | undefined,
    pressed: boolean,
  ): void {
    if (aimAge === 0) {
      // The draw of createRng(seed).next() of rng.ts, operation for operation (a test compares
      // the two over thousands of thinks): `next` runs once in 15 thinks, so V8 never optimised
      // it, and in the interpreter its double result and every int32 above the Smi range boxed
      // (about 30 B a draw). Written out here it runs in the compiled code of `aim`.
      const state = ((rngState[0] as number) + 0x6d2b79f5) >>> 0;
      rngState[0] = state;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      aimError.aimU = (2 * (((t ^ (t >>> 14)) >>> 0) / 4294967296) - 1) * tier.maxU;
    }
    const u = aimError.aimU;
    aimAge = (aimAge + 1) % AIM_ERROR_HOLD;

    // The speed the aim leads with: the first projectile of the ability winding up, or else of
    // the one pressed on this think, or else the nominal speed.
    let speed = NOMINAL_PROJECTILE_SPEED;
    if (kit !== undefined) {
      const spec =
        me.cast !== null
          ? abilityFor(kit, me.cast.slot, me.cast.ex)
          : pressed
            ? abilityFor(kit, choice.slot, choice.ex)
            : undefined;
      if (spec !== undefined) {
        for (let i = 0; i < spec.effects.length; i++) {
          const effect = spec.effects[i];
          if (effect !== undefined && effect.type === 'projectile') {
            speed = effect.speed;
            break;
          }
        }
      }
    }

    // leadPoint: the time a projectile of this speed needs to meet the target.
    const dx = subject.x - me.x;
    const dy = subject.y - me.y;
    const vx = subject.vx;
    const vy = subject.vy;
    const a = vx * vx + vy * vy - speed * speed;
    const b = 2 * (dx * vx + dy * vy);
    const c = dx * dx + dy * dy;
    let leadX = subject.x;
    let leadY = subject.y;
    if (!(c === 0 || !(a < 0))) {
      const root = Math.sqrt(b * b - 4 * a * c);
      const t = b >= 0 ? (b + root) / (-2 * a) : (2 * c) / (root - b);
      if (t - t === 0 && t > 0) {
        leadX = subject.x + vx * t;
        leadY = subject.y + vy * t;
      }
    }

    // rotateByHalfTangent: the vector to the lead point turns by 2 atan(u).
    const k = 1 + u * u;
    const cos = (1 - u * u) / k;
    const sin = (2 * u) / k;
    const lx = leadX - me.x;
    const ly = leadY - me.y;
    // roundAim: whole centimetres, with -0 turned into 0 by `+ 0.5 - 0.5` where roundAim has `+ 0`:
    // the same value for every aim in the arena (a whole number below 2^52 survives the two
    // additions, and -0 + 0.5 is 0.5). A `+ 0` after Math.round has int32 feedback (every earlier
    // value was a whole number in a Smi), and the first aim point in [-0.5, 0) cm made Maglev
    // deoptimize `aim` there ("not int32"); it then ran in the interpreter, 65 KB a window in the
    // live scene, until it was optimized again. A double constant gives the sum number feedback
    // from its first run, so -0 is no new case.
    const aimX = Math.round((me.x + (lx * cos - ly * sin)) * 100) + 0.5 - 0.5;
    const aimY = Math.round((me.y + (lx * sin + ly * cos)) * 100) + 0.5 - 0.5;
    if (aimX - aimX === 0 && aimY - aimY === 0) {
      input.aimX = aimX;
      input.aimY = aimY;
    } else {
      input.aimX = me.aimX;
      input.aimY = me.aimY;
    }
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
        advancing = false;
        runs.fill(0);
        input.moveX = 0;
        input.moveY = 0;
        input.aimX = me.aimX;
        input.aimY = me.aimY;
        input.buttons = 0;
        return input;
      }

      const kit = findKit(state, me.championId);
      // A rebuild means another kit or champion id: the ally held for the windup of the old one is
      // an id in another match, and must not be aimed at.
      if (refreshKitCache(kitCache, kit, me.championId)) {
        aimHold.allyAim = -1;
        clearDodgeMemo(dodgeScratch);
      }
      const profile = kitCache.profile;
      decide(state, me, profile);

      const slot = ring[ringIndex] as Decision;
      acted.intent = slot.intent;
      acted.targetId = slot.targetId;
      slot.intent = decided.intent;
      slot.targetId = decided.targetId;
      ringIndex = (ringIndex + 1) % tier.delay;

      const target = enemyAlive(state, me, acted.targetId);
      if (target === undefined) {
        acted.intent = 'idle';
        acted.targetId = -1;
      }
      if (acted.intent !== lastActed.intent || acted.targetId !== lastActed.targetId) {
        follower = createFollower();
      }
      if (acted.targetId !== lastActed.targetId) runs.fill(0);
      lastActed.intent = acted.intent;
      lastActed.targetId = acted.targetId;

      if (kit !== undefined && target !== undefined && acted.intent !== 'idle') {
        const g = navGrid(state);
        computeCues(cues, kitCache, profile, acted.intent, state, me, target, sight, dist, g);
      } else {
        cues.reserve = false;
        cues.escapeThink = false;
        cues.escapeReady = false;
        cues.nearAlly = false;
        cues.allyFor.fill(-1);
        sight.standClearance = SIGHT_CLEARANCE;
      }
      move(state, me, profile);
      input.moveX = command.moveX;
      input.moveY = command.moveY;
      if (acted.intent === 'idle' || target === undefined) {
        runs.fill(0);
        input.aimX = me.aimX;
        input.aimY = me.aimY;
        input.buttons = 0;
        return input;
      }
      let pressed = false;
      escapeScratch.tried = 0;
      escapeScratch.landed = false;
      if (kit !== undefined) {
        // On an escape think (see computeCues) the escape slots count the trigger as their run,
        // and are chosen before the others.
        updateRuns(runs, state, kitCache, me, target, sight, dist, cues);
        if (cues.escapeThink && kitCache.escapeOrder[0] !== -1) {
          pressed = chooseEscape(
            choice,
            escapeScratch,
            runs,
            tier.castDelay,
            kit,
            kitCache,
            me,
            target,
            state,
            navGrid(state),
            sight,
            dist,
          );
        }
        if (!pressed) {
          pressed = chooseCast(
            choice,
            runs,
            tier.castDelay,
            kit,
            kitCache,
            me,
            cues,
            escapeScratch.tried,
          );
        }
      } else {
        runs.fill(0);
      }
      // The subject of the aim. A bolt (kind 1 of the ally slots, never herself) is aimed at the ally
      // it is pressed at, and `aimHold` keeps that ally for every think of its windup: the sim fires
      // at the aim of the firing tick. A cast in progress holds its own ally, or the target when the
      // ally has died; with none in progress the hold is cleared. The areas (R, F) keep the target,
      // since an aim at her own centre is a zero-length vector.
      if (me.cast === null) aimHold.allyAim = -1;
      let subject = target;
      if (aimHold.allyAim >= 0) {
        const held = state.champions[aimHold.allyAim];
        if (held !== undefined && held.alive) subject = held;
        else aimHold.allyAim = -1;
      }
      let allyId = -1;
      if (pressed && !choice.ex) {
        const index = SLOTS.indexOf(choice.slot);
        if (kitCache.allyKind[index] === 1) allyId = cues.allyFor[index] as number;
      }
      // A press at an ally while no cast is in progress starts the hold on this think; a press
      // that fires a cast on this very tick (windupLeft 1) aims for the cast it fires.
      if (allyId >= 0 && me.cast === null) subject = state.champions[allyId] as ChampionState;
      // aim() runs on every think, an escape press included, so the draw cadence of the aim error
      // does not change; a teleport or dash press (an escape with a landing) then overwrites the aim
      // with its landing, with no error, whatever ally the aim was held on.
      aim(me, subject, kit, pressed);
      // The dodge, after the aim draw: a coin is one more draw of the same generator (dodge.ts). It
      // rewrites the move alone, so the intent, the target, the follower, the casts and the aim
      // stand as decided; a step the bot cannot take leaves the move of the intent.
      if (dodgeInto(command, dodgeScratch, rngState, state, me, navGrid(state), sight)) {
        input.moveX = command.moveX;
        input.moveY = command.moveY;
      }
      // The press starts the next cast: it holds its ally, or none.
      if (pressed) aimHold.allyAim = allyId;
      if (pressed && escapeScratch.landed) {
        input.aimX = escapeScratch.land.aimX;
        input.aimY = escapeScratch.land.aimY;
      }
      input.buttons = pressed ? buttonsOf(choice) : 0;
      return input;
    },

    inspect(): { intent: Intent; targetId: number } {
      return { intent: lastActed.intent, targetId: lastActed.targetId };
    },
  };
}
