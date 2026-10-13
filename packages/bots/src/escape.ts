import { SLOTS } from '@claudeline/sim';
import type { ChampionState, GameState, KitDef, Slot } from '@claudeline/sim';
import { hasDash, hasStatus } from './casting';
import type { CastChoice, KitCache } from './casting';
import type { NavGrid } from './grid';
import type { Measure } from './hypot';
import { segmentClear } from './geometry';
import { awayFromInto, cellFree, kiteDirectionInto } from './kite';
import type { KiteScratch } from './kite';
import { lineOfSight } from './sight';
import type { SightScratch } from './sight';

// Escapes: the slots a bot presses to get out of reach (docs/architecture/bots.md, Openers and
// escapes). The trigger is the escape think of `computeCues` in casting.ts; the choice is
// `chooseEscape`; a teleport escape (Quillon's Skip, Skerrow's Vanish Step) needs a landing, which
// is `landingInto` and the search over the five kite directions in `findLanding`. A dash escape
// (Lumeth's Glide) has a landing too: the end of the dash, found by the same search.

/**
 * The scratch of a teleport landing, in fields that start as doubles. `dirX`, `dirY`, `range` and
 * `fixed` are the inputs of `landingInto`; `aimX` and `aimY` (whole centimetres, as an input
 * carries them) are its first output and the input of `teleportEndInto`; `x` and `y` are where
 * the sim's teleport puts the champion.
 */
export interface Landing {
  dirX: number;
  dirY: number;
  range: number;
  fixed: boolean;
  aimX: number;
  aimY: number;
  x: number;
  y: number;
}

export function createLanding(): Landing {
  return { dirX: 0.5, dirY: 0.5, range: 0.5, fixed: false, aimX: 0.5, aimY: 0.5, x: 0.5, y: 0.5 };
}

/**
 * The point the sim's teleport effect puts `me` at when it casts an ability with a teleport of
 * `land.range` (`land.fixed`: it goes the whole range whatever the aim distance) and the champion
 * aims at (`land.aimX`, `land.aimY`) centimetres, written into `land.x` and `land.y`. The
 * arithmetic is the sim's, operation for operation: `fireFrom` of cast.ts (the direction to the
 * aim is `direction` of geometry.ts, a divide by the larger axis and a square root, and the
 * team's forward direction when the aim is on the caster) and its teleport case. A teleport casts
 * before the champion moves, so the position the bot thinks on is the one the sim teleports from.
 * The differential test compares it with the sim bit for bit.
 */
export function teleportEndInto(land: Landing, me: ChampionState): void {
  const dx = land.aimX / 100 - me.x;
  const dy = land.aimY / 100 - me.y;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  let dirX: number;
  let dirY: number;
  let aimDistance: number;
  if (m === 0) {
    dirX = me.team === 'A' ? 1 : -1;
    dirY = 0;
    aimDistance = 0;
  } else {
    const ux = dx / m;
    const uy = dy / m;
    const l = Math.sqrt(ux * ux + uy * uy);
    dirX = ux / l + 0;
    dirY = uy / l + 0;
    aimDistance = m * l;
  }
  const reach = land.fixed ? land.range : Math.min(land.range, aimDistance);
  land.x = me.x + dirX * reach + 0;
  land.y = me.y + dirY * reach + 0;
}

/**
 * The landing of an escape teleport in the direction (`land.dirX`, `land.dirY`): the bot aims at
 * the point `range` metres off in whole centimetres, which is what an input can carry, and the
 * landing is worked out from that rounded aim by `teleportEndInto`. The rounding is `roundAim` of
 * aim.ts, with its `+ 0` written `+ 0.5 - 0.5` as in `aim` of bot.ts (see the comment there): the
 * same value, but a first -0 does not deoptimise the function in Maglev. Writes `land.aimX`,
 * `land.aimY`, `land.x` and `land.y`.
 */
export function landingInto(land: Landing, me: ChampionState): void {
  land.aimX = Math.round((me.x + land.dirX * land.range) * 100) + 0.5 - 0.5;
  land.aimY = Math.round((me.y + land.dirY * land.range) * 100) + 0.5 - 0.5;
  teleportEndInto(land, me);
}

/**
 * What the escape choice uses and writes instead of allocating: the landing, the kite points
 * (shared with the bot's own kite step, which never runs in the same call), the bit mask of the
 * slots it tried (read by `chooseCast` as `skip`) and whether the press carries a landing aim.
 */
export interface EscapeScratch {
  land: Landing;
  kite: KiteScratch;
  /** A bit per slot index: the escape slots `chooseEscape` tried on this think. */
  tried: number;
  /** True when the slot `chooseEscape` chose has a landing in `land`: the bot aims at it. */
  landed: boolean;
}

export function createEscapeScratch(kite: KiteScratch): EscapeScratch {
  return { land: createLanding(), kite, tried: 0, landed: false };
}

/**
 * The first of the five kite directions from the acted target (straight away from it, then +45,
 * -45, +90, -90 degrees) whose landing lies in a free grid cell and has a line of sight from the
 * champion: `lineOfSight` sees only the obstacles that block projectiles, as the sim's teleport
 * does, so a teleport may cross a low wall. A dash escape (`escapeDash`) needs a clear path
 * instead: `segmentClear` sees every obstacle, low walls too, which stop a dash. Its landing is the
 * end of a dash of the full distance along the aim, the same arithmetic as a fixed teleport's, so
 * `landingInto` gives it with `range` the dash distance. A body stops a dash early and the search
 * ignores champions. The landing is left in `scratch.land`, the point the sim moves to. False when
 * none passes.
 */
function findLanding(
  scratch: EscapeScratch,
  cache: KitCache,
  index: number,
  state: GameState,
  grid: NavGrid,
  sight: SightScratch,
  me: ChampionState,
  target: ChampionState,
  dist: Measure,
): boolean {
  const { land, kite } = scratch;
  const { away, dir, point } = kite;
  awayFromInto(away, me, target, dist);
  land.range = cache.escapeRange[index] as number;
  land.fixed = cache.escapeFixed[index] === 1;
  const dash = cache.escapeDash[index] === 1;
  for (let k = 0; k < 5; k++) {
    kiteDirectionInto(dir, away, k);
    land.dirX = dir.x;
    land.dirY = dir.y;
    landingInto(land, me);
    point.x = land.x;
    point.y = land.y;
    if (!cellFree(grid, point)) continue;
    if (dash ? segmentClear(grid, me, point) : lineOfSight(state, me, point, sight)) return true;
  }
  return false;
}

/**
 * On an escape think, the first slot of the escape order that passes its gates is chosen: the cast
 * delay run (an escape slot counts the trigger, see `updateRuns`), the cooldown at most 1, no
 * windup in progress unless it fires on this tick, no stun or silence, no root for a dash, and for
 * a teleport or a dash a landing. Writes the slot into `choice` (never an EX variant) and returns
 * true; the landing is in `scratch.land` with `scratch.landed` set. Every slot of the order is
 * marked in `scratch.tried`, so the main walk of `chooseCast` skips it: a teleport that found no
 * landing must not be pressed there, and the dash hold of `chooseCast` never reaches Glide.
 *
 * There is no energy gate, unlike `chooseCast`: every escape row costs nothing (a base press that
 * is not F), and a row with an EX variant or F would need the cost check added with its test.
 */
export function chooseEscape(
  choice: CastChoice,
  scratch: EscapeScratch,
  runs: readonly number[],
  castDelay: number,
  kit: KitDef,
  cache: KitCache,
  me: ChampionState,
  target: ChampionState,
  state: GameState,
  grid: NavGrid,
  sight: SightScratch,
  dist: Measure,
): boolean {
  scratch.tried = 0;
  scratch.landed = false;
  if (me.cast !== null && me.cast.windupLeft !== 1) return false;
  if (hasStatus(me, 'stun') || hasStatus(me, 'silence')) return false;
  const rooted = hasStatus(me, 'root');
  for (let n = 0; n < SLOTS.length; n++) {
    const i = cache.escapeOrder[n] as number;
    if (i < 0) break;
    scratch.tried |= 1 << i;
    if ((runs[i] as number) <= castDelay) continue;
    if ((me.cooldowns[i] as number) > 1) continue;
    const slot = SLOTS[i] as Slot;
    if (rooted && hasDash(kit.slots[slot])) continue;
    if ((cache.escapeRange[i] as number) > 0) {
      if (!findLanding(scratch, cache, i, state, grid, sight, me, target, dist)) continue;
      scratch.landed = true;
    }
    choice.slot = slot;
    choice.ex = false;
    return true;
  }
  return false;
}
