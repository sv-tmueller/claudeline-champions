import { Button, CHAMPION_RADIUS, EX_ENERGY_COST, SLOTS, ULTIMATE_ENERGY_COST } from '@claudeline/sim';
import type { AbilitySpec, ChampionState, GameState, KitDef, Slot, StatusType } from '@claudeline/sim';
import { abilityReach, inReach } from './reach';
import { clearShot } from './sight';

// Casting: which slot a bot presses on a think. The gates copy steps 3b to 3d of the sim's `step`
// (cooldowns count down, then a windup fires at 1, then a new cast may start), read on the state
// the bot thinks on. Not named `cast.ts`: the sim has one.

/** A slot to press and whether to hold SHIFT for its EX variant. */
export interface CastChoice {
  slot: Slot;
  ex: boolean;
}

/** The kit of a champion, found by its champion id on every think; undefined when it has none. */
export function findKit(state: GameState, championId: string): KitDef | undefined {
  const { kits } = state;
  for (let i = 0; i < kits.length; i++) {
    const kit = kits[i] as KitDef;
    if (kit.id === championId) return kit;
  }
  return undefined;
}

function hasStatus(me: ChampionState, type: StatusType): boolean {
  for (let i = 0; i < me.statuses.length; i++) {
    if ((me.statuses[i] as { type: StatusType }).type === type) return true;
  }
  return false;
}

function hasDash(ability: AbilitySpec): boolean {
  for (let i = 0; i < ability.effects.length; i++) {
    if ((ability.effects[i] as { type: string }).type === 'dash') return true;
  }
  return false;
}

/**
 * The ability the slot would cast on this think: the EX variant when the slot is listed in
 * `kit.ex`, the champion has the energy and the variant has a reach band, else the base ability.
 * F never has one.
 */
function ability(kit: KitDef, me: ChampionState, slot: Slot): { spec: AbilitySpec; ex: boolean } {
  const base = kit.slots[slot];
  const variant = base.ex;
  if (
    variant !== undefined &&
    slot !== 'F' &&
    kit.ex.includes(slot) &&
    me.energy >= EX_ENERGY_COST &&
    abilityReach(variant) !== null
  ) {
    return { spec: variant, ex: true };
  }
  return { spec: base, ex: false };
}

/**
 * The width of the shot of an ability: the radius of its first top-level projectile, or the
 * champion radius when it has none.
 */
export function clearanceOf(spec: AbilitySpec): number {
  for (let i = 0; i < spec.effects.length; i++) {
    const effect = spec.effects[i];
    if (effect !== undefined && effect.type === 'projectile') return effect.radius;
  }
  return CHAMPION_RADIUS;
}

/**
 * Counts, per slot, the consecutive thinks on which the target was inside the band of the ability
 * the slot would cast, with a clear shot of that ability's width, this think included. Anything
 * else puts the count back to 0. It ignores cooldown, energy, status and windup, so a slot that
 * comes off cooldown while the target stays in reach is pressed on the first tick the sim would
 * cast it.
 */
export function updateRuns(
  runs: number[],
  state: GameState,
  kit: KitDef,
  me: ChampionState,
  target: ChampionState,
): void {
  const d = Math.hypot(me.x - target.x, me.y - target.y);
  for (let i = 0; i < SLOTS.length; i++) {
    const spec = ability(kit, me, SLOTS[i] as Slot).spec;
    const band = abilityReach(spec);
    runs[i] =
      band !== null && inReach(band, d) && clearShot(state, me, target, clearanceOf(spec))
        ? (runs[i] as number) + 1
        : 0;
  }
}

/**
 * The slot to press, or null. The first of F, R, E, Q, SPACE, M2, M1 (the sim's own order) whose
 * run is over `castDelay` and that passes the sim's gates: no windup in progress unless it fires
 * on this tick (windupLeft 1), the cooldown at most 1 (it counts down first), the energy for the
 * cost (100 for F, 25 for an EX variant), no stun or silence, and no root for a dash. Run `updateRuns` first.
 */
export function chooseCast(
  runs: readonly number[],
  castDelay: number,
  kit: KitDef,
  me: ChampionState,
): CastChoice | null {
  if (me.cast !== null && me.cast.windupLeft !== 1) return null;
  if (hasStatus(me, 'stun') || hasStatus(me, 'silence')) return null;
  const rooted = hasStatus(me, 'root');
  for (let i = SLOTS.length - 1; i >= 0; i--) {
    if ((runs[i] as number) <= castDelay) continue;
    if ((me.cooldowns[i] as number) > 1) continue;
    const slot = SLOTS[i] as Slot;
    const { spec, ex } = ability(kit, me, slot);
    const cost = slot === 'F' ? ULTIMATE_ENERGY_COST : ex ? EX_ENERGY_COST : 0;
    if (me.energy < cost) continue;
    if (rooted && hasDash(spec)) continue;
    return { slot, ex };
  }
  return null;
}

/** The `buttons` of a choice: its slot bit, and SHIFT for an EX variant. */
export function buttonsOf(choice: CastChoice): number {
  return Button[choice.slot] | (choice.ex ? Button.SHIFT : 0);
}

/** The ability a slot casts, with its EX variant when `ex` and the slot has one. */
export function abilityFor(kit: KitDef, slot: Slot, ex: boolean): AbilitySpec {
  const base = kit.slots[slot];
  return ex && base.ex !== undefined ? base.ex : base;
}

/** The speed of the first top-level projectile of an ability, or undefined when it has none. */
export function projectileSpeed(spec: AbilitySpec): number | undefined {
  for (let i = 0; i < spec.effects.length; i++) {
    const effect = spec.effects[i];
    if (effect !== undefined && effect.type === 'projectile') return effect.speed;
  }
  return undefined;
}
