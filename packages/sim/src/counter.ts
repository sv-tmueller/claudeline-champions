import type { Slot } from './input';
import type { KitDef } from './kit';
import type { ChampionState, GameState } from './state';

// The on-hit counter (rules.md section 2.6, v3 design section 4.4a). A kit declares it in its data;
// `buildCounter` adds to it when a qualifying hit lands (called from `landHit`), `stepCounters`
// resets it when its window has run out (step 6d), and `resetAbilityState` clears it at a round
// start. It emits no event: every build follows from a `damage` event of the `from` slot, and every
// decay from the window.
//
// This module holds no arrow functions and allocates nothing: it uses indexed loops and writes into
// the records that exist. It does not import `cast.ts` (cast, projectile, energy, counter would be
// a cycle), so it looks the kit up itself.

/** The kit of a champion, found by its champion id, or undefined for a champion without one. */
function kitOf(state: GameState, champion: ChampionState): KitDef | undefined {
  const { kits } = state;
  for (let i = 0; i < kits.length; i++) {
    const kit = kits[i] as KitDef;
    if (kit.id === champion.championId) return kit;
  }
  return undefined;
}

/**
 * Adds one to the caster's counter, up to its cap, and stores the tick of this step, when `slot` is
 * the slot the caster's kit declares. A hit at the cap adds nothing but still restarts the window.
 * Does nothing for a kit with no counter or for another slot. The caller has decided that the hit
 * qualifies (an enemy that is alive and not invulnerable, a list that holds `damage`, a living
 * caster); an EX variant counts as its slot.
 */
export function buildCounter(state: GameState, caster: ChampionState, slot: Slot): void {
  const kit = kitOf(state, caster);
  const spec = kit === undefined ? undefined : kit.counter;
  const counter = caster.counter;
  if (spec === undefined || counter === undefined || spec.from !== slot) return;
  if (counter.count < spec.cap) counter.count += 1;
  counter.lastHitTick = state.tick;
}

/**
 * Step 6d. Resets every counter whose window has run out: `windowTicks` or more ticks since the last
 * qualifying hit. Dead champions are included. A counter at 0 is left alone, so its `lastHitTick`
 * stays 0. A hit in step T keeps the count through step T + `windowTicks` - 1 and the count is 0 at
 * the end of step T + `windowTicks`, unless a hit lands in that step first (hits land in steps 3 to
 * 5, before this one). The locked phases never get here, so the count is frozen through them.
 */
export function stepCounters(state: GameState): void {
  const { champions, tick } = state;
  for (let i = 0; i < champions.length; i++) {
    const champion = champions[i] as ChampionState;
    const counter = champion.counter;
    if (counter === undefined || counter.count <= 0) continue;
    const kit = kitOf(state, champion);
    if (kit === undefined || kit.counter === undefined) continue;
    if (tick - counter.lastHitTick >= kit.counter.windowTicks) {
      counter.count = 0;
      counter.lastHitTick = 0;
    }
  }
}
