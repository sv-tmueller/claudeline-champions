import {
  ENERGY_GAIN_M1,
  ENERGY_GAIN_SKILL,
  ENERGY_GAIN_ULTIMATE,
  MAX_ENERGY,
} from './constants';
import type { Point } from './geometry';
import { applyEffects } from './health';
import type { Slot } from './input';
import type { CastRecord, ChampionState, Effect, GameState } from './state';
import { hasStatus } from './status';

/** Whatever lands a hit: a projectile, an area or a melee arc. */
export interface HitSource {
  ownerId: number;
  /** The cast that made it, or null for a dev tool spawn, which earns no energy. */
  castId: number | null;
}

/** What a qualifying hit or heal gives before `energyGain`: F 15, an EX variant 10, M1 5, else 10. */
function tableGain(slot: Slot, ex: boolean): number {
  if (slot === 'F') return ENERGY_GAIN_ULTIMATE;
  if (ex) return ENERGY_GAIN_SKILL;
  return slot === 'M1' ? ENERGY_GAIN_M1 : ENERGY_GAIN_SKILL;
}

function isSupport(state: GameState, champion: ChampionState): boolean {
  for (const kit of state.kits) if (kit.id === champion.championId) return kit.support;
  return false;
}

function findCast(state: GameState, castId: number): CastRecord {
  for (const record of state.casts) if (record.id === castId) return record;
  throw new Error(`Invalid hit: unknown cast ${castId}`);
}

/**
 * Applies a hit's effects to one champion and gives the caster energy for it. Energy is earned
 * only by a hit that lands on an enemy, or for a support kit by a heal that restores health to an
 * ally other than the caster, and at most once per target per cast. An enemy counts when, before
 * the effects, it is alive and not invulnerable and the list holds `damage`: a hit that a shield
 * absorbs completely still counts, and a status, a shield or a push alone does not. An ally counts
 * when this application's heals restored more than 0. The gain is the table value plus every
 * `energyGain` in the list, cut to the room under `MAX_ENERGY`; a target that qualifies is marked
 * even when the cap trims its gain to 0, and then no event is emitted. A dead caster earns
 * nothing. A source with no cast earns nothing and applies its statuses with no slot. Damage over
 * time and heal over time pulses never come through here, so they give nothing. Throws
 * `Invalid hit: ...` for a cast the state does not hold.
 */
export function landHit(
  state: GameState,
  source: HitSource,
  targetId: number,
  effects: readonly Effect[],
  origin: Point,
): void {
  const { ownerId, castId } = source;
  const record = castId === null ? null : findCast(state, castId);
  const caster = state.champions[ownerId];
  const target = state.champions[targetId];
  const enemy =
    caster !== undefined && target !== undefined && caster.team !== target.team;
  // Whether the hit qualifies depends on the target as it is before the effects.
  const damaging =
    enemy &&
    target !== undefined &&
    target.alive &&
    !hasStatus(target, 'invulnerable') &&
    effects.some((e) => e.type === 'damage');

  const restored = applyEffects(state, ownerId, targetId, effects, origin, record ? record.slot : null);

  if (!record || !caster || !caster.alive || record.credited.includes(targetId)) return;
  const healing =
    !enemy && targetId !== ownerId && restored > 0 && isSupport(state, caster);
  if (!damaging && !healing) return;

  record.credited.push(targetId);
  let gain = tableGain(record.slot, record.ex);
  for (const effect of effects) if (effect.type === 'energyGain') gain += effect.amount;
  const energy = Math.min(MAX_ENERGY, caster.energy + gain);
  const amount = energy - caster.energy;
  if (amount <= 0) return;
  caster.energy = energy;
  state.events.push({
    type: 'energyGained',
    championId: ownerId,
    castId: record.id,
    targetId,
    amount,
    energy,
  });
}
