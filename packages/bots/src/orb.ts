import { ORB_COLLECTIBLE_TICKS } from '@claudeline/sim';
import type { ChampionState, GameState } from '@claudeline/sim';
import type { Vec2 } from './grid';

// The energy orb (rules.md 3.3, spec section 6, bots.md The energy orb). Pure and allocation-free:
// each function reads the state and writes into a record the caller owns.

/**
 * Whether the orb is up, meaning collectible: a match in its round phase whose orb is not taken and
 * whose phaseTicks have reached `ORB_COLLECTIBLE_TICKS`, the tick from which the sim's next step
 * lets a champion take it. Writes the orb's point into `out` when it is, and leaves `out` alone
 * when it is not. The warning (tick 1020) is no reason to walk: there is no pre-positioning.
 */
export function orbUpInto(out: Vec2, state: GameState): boolean {
  const match = state.match;
  if (match === undefined || match.phase !== 'round') return false;
  const orb = match.orb;
  if (orb === undefined || orb.taken || match.phaseTicks < ORB_COLLECTIBLE_TICKS) return false;
  out.x = orb.x;
  out.y = orb.y;
  return true;
}

/**
 * Whether the bot is strictly nearer the point than every alive enemy, the centres compared by
 * squared distance. A tie is not nearer; allies and the dead are not counted.
 */
export function nearerThanEnemies(state: GameState, me: ChampionState, point: Vec2): boolean {
  const dx = me.x - point.x;
  const dy = me.y - point.y;
  const own = dx * dx + dy * dy;
  for (let i = 0; i < state.champions.length; i++) {
    const c = state.champions[i] as ChampionState;
    if (!c.alive || c.team === me.team) continue;
    const ex = c.x - point.x;
    const ey = c.y - point.y;
    if (!(own < ex * ex + ey * ey)) return false;
  }
  return true;
}
