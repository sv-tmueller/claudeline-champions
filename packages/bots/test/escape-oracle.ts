import { Button, cloneState, hasLineOfSight, step } from '@claudeline/sim';
import type { ChampionState, GameState, PlayerInput, Slot } from '@claudeline/sim';
import { oracleBlocked, oracleSegmentViolates } from './helpers';

// An independent oracle for the escape presses of the headless runs. It does not import src: the
// trigger and the first-of-five landing are written here from docs/architecture/bots.md (Openers
// and escapes), and the point a teleport lands on is read from the sim itself (a cloned state
// stepped with the one press), not computed by a copy of the formula the bot uses.
//
// That clone gives no other champion an input, and the sim skips a champion with none, so it sees
// every other champion standing. In the real step the champions with a lower id take their turn
// first and may walk or die before the caster's cast (step 3d), and the teleport then pushes its
// end out of where they now stand. `teleportAfterWalksAhead` reads that end from a clone of the
// state before the step stepped with the real inputs of the champions ahead of the caster and the
// caster's own press, and nothing else: it models the walks that land before the cast (#146).

/** An escape think: a retreat with the target within this many metres, inclusive. */
export const ESCAPE_REACH = 6;

/** The rangeMin of each champion's profile, literal: a kite closer than this is an escape think. */
export const RANGE_MIN: Record<string, number> = {
  hargrim: 0,
  quillon: 6,
  skerrow: 0,
  ondrel: 5,
  brimwick: 7,
};

/**
 * The champions with a trigger of their own, literal, in metres: any acted intent but idle with
 * the target within this distance, inclusive, is an escape think, and the common trigger does not
 * apply to them (the roster: Lumeth's "an enemy inside 3 m").
 */
export const WITHIN: Record<string, number> = { lumeth: 3 };

/**
 * One escape slot: the range of the teleport it starts with, and the teleport slot that goes
 * first when it is ready and has a landing.
 */
export interface EscapeRow {
  slot: Slot;
  teleport: number | null;
  /** The distance of a dash escape (Glide), which has a landing of its own, or absent. */
  dash?: number;
  /**
   * The slot that goes first when it is ready (a cooldown of 1 or less) and, with a `teleport`
   * range, has a landing; a null `teleport` needs no landing, so ready is enough. With a `dash` the
   * first slot is a dash escape: it needs a dash landing too and a champion that is not rooted
   * (Reed Step, ahead of Reed Screen).
   */
  after: { slot: Slot; teleport: number | null; dash?: number } | null;
}

/** Why the acted intent and distance are not an escape think; empty when they are. */
export function triggerProblems(
  c: ChampionState,
  target: ChampionState,
  intent: string,
): string[] {
  const d = Math.hypot(c.x - target.x, c.y - target.y);
  const within = WITHIN[c.championId];
  if (within !== undefined) {
    return intent !== 'idle' && d <= within
      ? []
      : [`not an escape think: ${intent} at ${d} m (within ${within})`];
  }
  const rangeMin = RANGE_MIN[c.championId] ?? 0;
  const retreat = intent === 'retreat' && d <= ESCAPE_REACH;
  const kite = intent === 'kite' && d < rangeMin;
  return retreat || kite
    ? []
    : [`not an escape think: ${intent} at ${d} m (rangeMin ${rangeMin}, reach ${ESCAPE_REACH})`];
}

/**
 * The first of the five directions from the target (the same order as `oracleLanding`) in which a
 * dash of `distance` metres from `c` ends in a free grid cell and a straight walk there touches
 * nothing, low walls included: `oracleSegmentViolates`, the sampled walk. The aim is the point
 * `distance` metres off in whole centimetres, as an input carries it. `x` and `y` are where the
 * dash ends when no body stops it: the sim's dash goes `distance` metres along the direction of
 * that aim, worked out here with `Math.hypot`. Null when none passes.
 */
export function oracleDashLanding(
  state: GameState,
  c: ChampionState,
  target: ChampionState,
  distance: number,
): OracleLanding | null {
  const d = Math.hypot(c.x - target.x, c.y - target.y);
  const ax = d === 0 ? 1 : (c.x - target.x) / d;
  const ay = d === 0 ? 0 : (c.y - target.y) / d;
  const s = Math.SQRT1_2;
  const directions = [
    { x: ax, y: ay },
    { x: ax * s - ay * s, y: ax * s + ay * s },
    { x: ax * s + ay * s, y: -ax * s + ay * s },
    { x: -ay, y: ax },
    { x: ay, y: -ax },
  ];
  for (let k = 0; k < directions.length; k++) {
    const dir = directions[k] as { x: number; y: number };
    const aimX = Math.round((c.x + dir.x * distance) * 100) + 0;
    const aimY = Math.round((c.y + dir.y * distance) * 100) + 0;
    const vx = aimX / 100 - c.x;
    const vy = aimY / 100 - c.y;
    const length = Math.hypot(vx, vy);
    const end = { x: c.x + (vx / length) * distance, y: c.y + (vy / length) * distance };
    if (freeCell(state, end) && !oracleSegmentViolates(state.arena, c, end)) {
      return { k, aimX, aimY, x: end.x, y: end.y };
    }
  }
  return null;
}

export interface OracleLanding {
  /** Which of the five directions: 0 straight away, then +45, -45, +90, -90 degrees. */
  k: number;
  aimX: number;
  aimY: number;
  x: number;
  y: number;
}

/**
 * The first of the five directions from the target (straight away, then +45, -45, +90, -90
 * degrees) whose landing is in a free grid cell, by the clearance of the cell centre, and has a
 * line of sight from the champion. The landing of a direction is the point the sim teleports the
 * champion to for the aim `range` metres off in whole centimetres: it is read from a clone of the
 * state in which only this champion casts `slot`. The bot tests the point the teleport aims at,
 * before the sim's collision pushes a champion off a wall or an obstacle, so a direction whose
 * point (`rawLanding`) is not a free cell is skipped even where the sim would push the champion
 * clear into one: the bot is the more careful, and a match played to its end has such a landing
 * (a Quillon at the south wall, a Skip that ends 2 cm into it). Null when none passes.
 */
export function oracleLanding(
  state: GameState,
  c: ChampionState,
  target: ChampionState,
  slot: Slot,
  range: number,
): OracleLanding | null {
  const d = Math.hypot(c.x - target.x, c.y - target.y);
  const ax = d === 0 ? 1 : (c.x - target.x) / d;
  const ay = d === 0 ? 0 : (c.y - target.y) / d;
  const s = Math.SQRT1_2;
  const directions = [
    { x: ax, y: ay },
    { x: ax * s - ay * s, y: ax * s + ay * s },
    { x: ax * s + ay * s, y: -ax * s + ay * s },
    { x: -ay, y: ax },
    { x: ay, y: -ax },
  ];
  for (let k = 0; k < directions.length; k++) {
    const dir = directions[k] as { x: number; y: number };
    const aimX = Math.round((c.x + dir.x * range) * 100) + 0;
    const aimY = Math.round((c.y + dir.y * range) * 100) + 0;
    const at = teleportOf(state, c, slot, aimX, aimY);
    if (
      at !== null &&
      freeCell(state, rawLanding(state, c, slot, range, aimX, aimY)) &&
      freeCell(state, at) &&
      hasLineOfSight(state, c, at)
    ) {
      return { k, aimX, aimY, x: at.x, y: at.y };
    }
  }
  return null;
}

/**
 * The point the first teleport of `slot` aims at, before any collision: the champion's own point
 * moved along the aim by the range (a fixed teleport) or by `min(range, aim distance)`. Written
 * out from the kit and the aim with `Math.hypot`, not by the bot's arithmetic.
 */
function rawLanding(
  state: GameState,
  c: ChampionState,
  slot: Slot,
  range: number,
  aimX: number,
  aimY: number,
): { x: number; y: number } {
  const kit = state.kits.find((k) => k.id === c.championId);
  const first = kit?.slots[slot].effects[0];
  const fixed = first !== undefined && first.type === 'teleport' && first.fixed;
  const vx = aimX / 100 - c.x;
  const vy = aimY / 100 - c.y;
  const aimDistance = Math.hypot(vx, vy);
  if (aimDistance === 0) return { x: c.x, y: c.y };
  const reach = fixed ? range : Math.min(range, aimDistance);
  return { x: c.x + (vx / aimDistance) * reach, y: c.y + (vy / aimDistance) * reach };
}

/** Where the sim puts champion `c` when it casts `slot` aimed at the centimetres; null if it does not move. */
function teleportOf(
  state: GameState,
  c: ChampionState,
  slot: Slot,
  aimX: number,
  aimY: number,
): { x: number; y: number } | null {
  const clone = cloneState(state);
  const me = clone.champions[c.id] as ChampionState;
  // Only this champion acts, ready to cast: no cooldown, no cast in progress, no status.
  me.cooldowns.fill(0);
  me.cast = null;
  me.statuses = [];
  const input: PlayerInput = { moveX: 0, moveY: 0, aimX, aimY, buttons: Button[slot] };
  const inputs: (PlayerInput | undefined)[] = [];
  inputs[c.id] = input;
  step(clone, inputs);
  const event = clone.events.find((e) => e.type === 'teleport' && e.championId === c.id);
  if (event === undefined || event.type !== 'teleport' || event.blocked) return null;
  return { x: event.toX, y: event.toY };
}

/** The teleport end of a caster in the turn order of the real step, and whether a champion ahead moved. */
export interface TurnOrderTeleport {
  x: number;
  y: number;
  /**
   * A champion other than the caster has another alive flag after the clone's whole step: any
   * death in the step, a cast of a champion ahead before the caster's turn, or a projectile, an
   * area or damage over time after it too. Or one with a lower id than the caster's has another
   * point: a champion ahead that walked.
   */
  aheadMoved: boolean;
}

/**
 * Where the sim puts champion `caster` when it casts in the real turn order: `before` is a clone of
 * the state the bots thought on (taken before the real step) and `inputs` are the real inputs of
 * that tick. It is stepped with a copy of the input of every champion with an id up to the caster's
 * (the lower ids take their turn first, so they may walk or die before the cast, and the caster's
 * input is its real press, whose aim the caller has checked against the landing) and none for the
 * rest, which act after the caster's cast and so cannot move it. The bot cannot see the inputs of
 * the champions ahead; only the oracle models their turns. Null when the sim does not move the
 * caster or blocks it.
 */
export function teleportAfterWalksAhead(
  before: GameState,
  caster: number,
  inputs: readonly (PlayerInput | undefined)[],
): TurnOrderTeleport | null {
  const clone = cloneState(before);
  const ahead: (PlayerInput | undefined)[] = [];
  for (let id = 0; id <= caster; id++) {
    const input = inputs[id];
    ahead[id] = input === undefined ? undefined : { ...input };
  }
  step(clone, ahead);
  const event = clone.events.find((e) => e.type === 'teleport' && e.championId === caster);
  if (event === undefined || event.type !== 'teleport' || event.blocked) return null;
  const aheadMoved = before.champions.some((o) => {
    if (o.id === caster) return false;
    const now = clone.champions[o.id] as ChampionState;
    return now.alive !== o.alive || (o.id < caster && (now.x !== o.x || now.y !== o.y));
  });
  return { x: event.toX, y: event.toY, aheadMoved };
}

/**
 * Whether `target` is cornered as seen from `from`: none of the five points 1 m off the target
 * (straight away from `from`, then +45, -45, +90, -90 degrees) is in a free grid cell that a
 * straight walk from the target reaches without touching anything. Written here from the
 * definition, with the sampled walk of `oracleSegmentViolates`, not from the code of the bot.
 */
export function oracleCornered(
  state: GameState,
  target: ChampionState,
  from: ChampionState,
): boolean {
  const d = Math.hypot(target.x - from.x, target.y - from.y);
  const ax = d === 0 ? 1 : (target.x - from.x) / d;
  const ay = d === 0 ? 0 : (target.y - from.y) / d;
  const s = Math.SQRT1_2;
  const directions = [
    { x: ax, y: ay },
    { x: ax * s - ay * s, y: ax * s + ay * s },
    { x: ax * s + ay * s, y: -ax * s + ay * s },
    { x: -ay, y: ax },
    { x: ay, y: -ax },
  ];
  for (const dir of directions) {
    const point = { x: target.x + dir.x, y: target.y + dir.y };
    if (freeCell(state, point) && !oracleSegmentViolates(state.arena, target, point)) return false;
  }
  return true;
}

/** Whether the 0.5 m grid cell holding p is free: its centre does not penetrate anything. */
function freeCell(state: GameState, p: { x: number; y: number }): boolean {
  const { width, height } = state.arena.size;
  const col = Math.floor((p.x + width / 2) / 0.5);
  const row = Math.floor((p.y + height / 2) / 0.5);
  if (col < 0 || row < 0 || col >= Math.ceil(width / 0.5) || row >= Math.ceil(height / 0.5)) {
    return false;
  }
  const cx = -width / 2 + (col + 0.5) * 0.5;
  const cy = -height / 2 + (row + 0.5) * 0.5;
  return !oracleBlocked(state.arena, cx, cy);
}
