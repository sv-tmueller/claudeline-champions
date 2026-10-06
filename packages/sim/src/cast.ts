import { spawnArea } from './area';
import { EX_ENERGY_COST, ULTIMATE_ENERGY_COST } from './constants';
import { direction } from './geometry';
import { applyHeal } from './health';
import { Button, SLOTS } from './input';
import type { Slot } from './input';
import type { AbilityEffect, AbilitySpec, AreaPlacement, KitDef } from './kit';
import { meleeArc } from './melee';
import { startDash, teleport } from './motion';
import { spawnProjectile } from './projectile';
import { nextId } from './state';
import type {
  AreaState,
  CastRecord,
  ChampionState,
  DashState,
  GameState,
  ProjectileState,
} from './state';
import { applyShield, applyStatus, hasStatus } from './status';

// Casting: cooldowns, windups, the cost of a cast and what its effects do. `step` calls these in
// steps 3b to 3d and after 3f; everything here is reachable only from `step` and the tests.
//
// This module never imports the dev tool entry point (the `debug` module), which wraps the spawns
// with a cast id of null.

/** The kit of a champion, found by its champion id, or undefined for a champion without one. */
export function findKit(state: GameState, champion: ChampionState): KitDef | undefined {
  const { kits } = state;
  for (let i = 0; i < kits.length; i++) {
    const kit = kits[i] as KitDef;
    if (kit.id === champion.championId) return kit;
  }
  return undefined;
}

/** The ability a slot casts: its EX variant when `ex` and the slot has one, else the slot itself. */
export function abilityOf(kit: KitDef, slot: Slot, ex: boolean): AbilitySpec {
  const spec = kit.slots[slot];
  return ex && spec.ex !== undefined ? spec.ex : spec;
}

/** The seven slot buttons of `Button`, without SHIFT. */
const ALL_SLOT_BUTTONS =
  Button.M1 | Button.M2 | Button.SPACE | Button.Q | Button.E | Button.R | Button.F;

/** Step 3b: every cooldown above 0 drops by 1. */
export function tickCooldowns(champion: ChampionState): void {
  const { cooldowns } = champion;
  for (let i = 0; i < cooldowns.length; i++) {
    if ((cooldowns[i] as number) > 0) cooldowns[i] = (cooldowns[i] as number) - 1;
  }
}

/** The caster's position now and the direction its effects take. */
interface Fire {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** Distance from the position to the aim point. */
  aimDistance: number;
}

/**
 * Each top-level effect builds its own context when it runs, from where the caster stands then:
 * `direction(aim - position)`, falling back to the team's forward direction (+x for A, -x for B)
 * when the aim is on the caster. `fixed` is the direction of a finished dash, which a `then`
 * effect takes in place of the aim direction.
 */
function fireFrom(champion: ChampionState, fixed: { x: number; y: number } | null): Fire {
  const toAim = direction(champion.aimX / 100 - champion.x, champion.aimY / 100 - champion.y);
  const forward = champion.team === 'A' ? { x: 1, y: 0 } : { x: -1, y: 0 };
  const dir = fixed ?? toAim ?? forward;
  return {
    x: champion.x,
    y: champion.y,
    dirX: dir.x,
    dirY: dir.y,
    aimDistance: toAim ? toAim.length : 0,
  };
}

function placeArea(placement: AreaPlacement, fire: Fire): { x: number; y: number } {
  if (placement.type === 'self') return { x: fire.x, y: fire.y };
  const reach =
    placement.type === 'ahead' ? placement.distance : Math.min(placement.range, fire.aimDistance);
  return { x: fire.x + fire.dirX * reach + 0, y: fire.y + fire.dirY * reach + 0 };
}

interface CastRef {
  castId: number;
  slot: Slot;
}

/**
 * Runs an ability's effects in list order. `then` is set while running the effects a dash fires
 * where it ends: they take the dash direction, and a dash cannot appear among them. A top-level
 * dash only starts the dash, which moves the caster in step 3f, so the effects listed after it
 * still act where the caster stands now; `then` is how an effect acts at the dash end. A rooted
 * caster skips the dash and fires its `then` effects at once.
 */
function runEffects(
  state: GameState,
  champion: ChampionState,
  cast: CastRef,
  effects: readonly AbilityEffect[],
  then: { x: number; y: number } | null,
): void {
  const source = { sourceId: champion.id, slot: cast.slot };
  for (const effect of effects) {
    switch (effect.type) {
      case 'projectile': {
        const fire = fireFrom(champion, then);
        spawnProjectile(
          state,
          {
            ownerId: champion.id,
            x: fire.x,
            y: fire.y,
            dirX: fire.dirX,
            dirY: fire.dirY,
            speed: effect.speed,
            radius: effect.radius,
            lifetimeTicks: effect.lifetimeTicks,
            pierce: effect.pierce,
            effects: effect.effects,
            // The key goes into the spec only when the effect has the list.
            ...(effect.allyEffects === undefined ? {} : { allyEffects: effect.allyEffects }),
          },
          cast.castId,
        );
        break;
      }
      case 'area': {
        const at = placeArea(effect.placement, fireFrom(champion, then));
        spawnArea(
          state,
          {
            ownerId: champion.id,
            x: at.x,
            y: at.y,
            radius: effect.radius,
            durationTicks: effect.durationTicks,
            intervalTicks: effect.intervalTicks,
            targets: effect.targets,
            effects: effect.effects,
          },
          cast.castId,
        );
        break;
      }
      case 'meleeArc': {
        const fire = fireFrom(champion, then);
        meleeArc(state, {
          ownerId: champion.id,
          x: fire.x,
          y: fire.y,
          dirX: fire.dirX,
          dirY: fire.dirY,
          radius: effect.radius,
          cosHalfAngle: effect.cosHalfAngle,
          effects: effect.effects,
          castId: cast.castId,
        });
        break;
      }
      case 'dash': {
        // `validateKit` keeps a dash out of `then`; one that got in anyway is skipped.
        if (then) break;
        const fire = fireFrom(champion, null);
        if (hasStatus(champion, 'root')) {
          runEffects(state, champion, cast, effect.then, { x: fire.dirX, y: fire.dirY });
        } else {
          startDash(
            state,
            champion.id,
            { dirX: fire.dirX, dirY: fire.dirY, distance: effect.distance, ticks: effect.ticks },
            { castId: cast.castId, then: effect.then },
          );
        }
        break;
      }
      case 'teleport': {
        const fire = fireFrom(champion, then);
        const reach = effect.fixed ? effect.range : Math.min(effect.range, fire.aimDistance);
        teleport(
          state,
          champion.id,
          fire.x + fire.dirX * reach + 0,
          fire.y + fire.dirY * reach + 0,
        );
        break;
      }
      case 'applyStatus':
        applyStatus(state, champion.id, effect.status, source);
        break;
      case 'shield':
        applyShield(state, champion.id, effect, source);
        break;
      case 'heal':
        applyHeal(state, champion.id, effect.amount, champion.id);
        break;
    }
  }
}

/** The cast fires: the windup is over (or there was none), so it is no longer in progress. */
function fire(state: GameState, champion: ChampionState, cast: CastRef & { ex: boolean }): void {
  const kit = findKit(state, champion);
  state.events.push({
    type: 'castFired',
    championId: champion.id,
    castId: cast.castId,
    slot: cast.slot,
    ex: cast.ex,
  });
  if (!kit) return;
  runEffects(state, champion, cast, abilityOf(kit, cast.slot, cast.ex).effects, null);
}

/** Step 3c: a windup in progress loses a turn and fires at 0. */
export function advanceWindup(state: GameState, champion: ChampionState): void {
  const { cast } = champion;
  if (!cast) return;
  cast.windupLeft -= 1;
  if (cast.windupLeft > 0) return;
  champion.cast = null;
  fire(state, champion, cast);
}

/** Whether a dash is among the effects; a plain loop, so no closure is made on the casting path. */
function holdsDash(effects: readonly AbilityEffect[]): boolean {
  for (let i = 0; i < effects.length; i++) {
    if ((effects[i] as AbilityEffect).type === 'dash') return true;
  }
  return false;
}

/**
 * Step 3d: starts at most one cast from the held buttons. Nothing starts while a windup is in
 * progress or while the champion is stunned or silenced (silence includes SPACE). The slots are
 * tried in the order F, R, E, Q, SPACE, M2, M1; with SHIFT a slot that has an EX variant uses
 * it. A slot is passed over when its cooldown is above 0, when the energy is below the cost (100
 * for F, 25 for an EX variant, else 0: there is no fallback from an EX to the normal ability), or
 * when the champion is rooted and the ability holds a dash. The first slot that passes pays its
 * cost, sets its cooldown, starts, and fires at once when its windup is 0. Rejections emit nothing.
 */
export function startCast(
  state: GameState,
  champion: ChampionState,
  kit: KitDef,
  buttons: number,
): void {
  if (champion.cast !== null || (buttons & ALL_SLOT_BUTTONS) === 0) return;
  if (hasStatus(champion, 'stun') || hasStatus(champion, 'silence')) return;
  const shift = (buttons & Button.SHIFT) !== 0;
  const rooted = hasStatus(champion, 'root');
  for (let i = SLOTS.length - 1; i >= 0; i--) {
    const slot = SLOTS[i] as Slot;
    if ((buttons & Button[slot]) === 0) continue;
    const spec = kit.slots[slot];
    const ex = shift && spec.ex !== undefined;
    const ability = abilityOf(kit, slot, ex);
    const cost = slot === 'F' ? ULTIMATE_ENERGY_COST : ex ? EX_ENERGY_COST : 0;
    if ((champion.cooldowns[i] as number) > 0 || champion.energy < cost) continue;
    if (rooted && holdsDash(ability.effects)) continue;

    champion.energy -= cost;
    champion.cooldowns[i] = spec.cooldownTicks;
    const castId = nextId(state);
    state.casts.push({ id: castId, casterId: champion.id, slot, ex, credited: [] });
    state.events.push({
      type: 'castStarted',
      championId: champion.id,
      castId,
      slot,
      ex,
      windupTicks: ability.windupTicks,
      cost,
    });
    if (ability.windupTicks === 0) {
      fire(state, champion, { castId, slot, ex });
    } else {
      champion.cast = {
        castId,
        slot,
        ex,
        windupTicks: ability.windupTicks,
        windupLeft: ability.windupTicks,
      };
    }
    return;
  }
}

/**
 * After step 3f: a dash that ended as `complete`, `blocked` or `rooted` fires its `then`
 * effects from where the champion is now, along the dash direction, with that tick's aim. The
 * stunned, death and replaced ends never get here because they drop the dash record.
 */
export function fireDashThen(state: GameState, champion: ChampionState, dash: DashState): void {
  if (!champion.alive || dash.then.length === 0 || dash.castId === null) return;
  const castId = dash.castId;
  const { casts } = state;
  for (let i = 0; i < casts.length; i++) {
    const record = casts[i] as CastRecord;
    if (record.id !== castId) continue;
    runEffects(state, champion, { castId, slot: record.slot }, dash.then, {
      x: dash.dirX,
      y: dash.dirY,
    });
    return;
  }
}

/** Whether a windup, a dash, a projectile or an area of the champions and entities holds the cast. */
function isReferenced(state: GameState, id: number): boolean {
  const { champions, projectiles, areas } = state;
  for (let i = 0; i < champions.length; i++) {
    const champion = champions[i] as ChampionState;
    if (champion.cast !== null && champion.cast.castId === id) return true;
    if (champion.dash !== null && champion.dash.castId === id) return true;
  }
  for (let i = 0; i < projectiles.length; i++) {
    if ((projectiles[i] as ProjectileState).castId === id) return true;
  }
  for (let i = 0; i < areas.length; i++) {
    if ((areas[i] as AreaState).castId === id) return true;
  }
  return false;
}

/**
 * Step 7: drops the cast records nothing refers to: no windup, projectile, area or dash. It runs
 * every tick, also for a match with no kits, so it holds no closure: a closure over `state` would
 * make V8 allocate a context on every call, before the early return, and the combat e2e counts
 * those bytes.
 */
export function dropUnusedCasts(state: GameState): void {
  const { casts } = state;
  let unused = false;
  for (let i = 0; i < casts.length; i++) {
    if (!isReferenced(state, (casts[i] as CastRecord).id)) {
      unused = true;
      break;
    }
  }
  if (!unused) return;
  const kept: CastRecord[] = [];
  for (let i = 0; i < casts.length; i++) {
    const record = casts[i] as CastRecord;
    if (isReferenced(state, record.id)) kept.push(record);
  }
  state.casts = kept;
}

/**
 * The ability part of the round reset: every champion's energy and cooldowns go to 0, its windup
 * and dash are dropped and its statuses removed, the cast records are emptied, and the projectiles
 * and areas still alive forget their cast. Emits nothing: `startRound` in `flow.ts` calls it and
 * wraps it in `roundStarted`. Not in the index.
 */
export function resetAbilityState(state: GameState): void {
  for (const champion of state.champions) {
    champion.energy = 0;
    champion.cooldowns = champion.cooldowns.map(() => 0);
    champion.cast = null;
    champion.dash = null;
    champion.statuses = [];
  }
  state.casts = [];
  for (const projectile of state.projectiles) projectile.castId = null;
  for (const area of state.areas) area.castId = null;
}
