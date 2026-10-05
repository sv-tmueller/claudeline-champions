import {
  ROUND_TICKS,
  SLOTS,
  TICK_RATE,
  ULTIMATE_ENERGY_COST,
  type ChampionState,
  type MatchState,
} from '@claudeline/sim';

/** The slot that is the ultimate, F. */
const ULTIMATE_INDEX = SLOTS.length - 1;

/**
 * What the HUD reads from a champion: the sim's own fields, so a rename there
 * breaks the build. `cooldowns` holds one remaining-tick entry per slot in
 * `SLOTS` order and `cast` is non-null during a windup.
 */
export type SlotSource = Pick<ChampionState, 'energy' | 'cooldowns' | 'cast'>;

export interface SlotView {
  /** Whole seconds of cooldown left, 0 when the slot is ready. */
  seconds: number;
  /** A windup is running, so no cast can start. */
  windup: boolean;
  /** The slot cannot be used for lack of energy. */
  blocked: boolean;
}

/** Seven views in `SLOTS` order, made once and filled in place by `readSlotViews`. */
export function createSlotViews(): SlotView[] {
  return SLOTS.map(() => ({ seconds: 0, windup: false, blocked: false }));
}

/** Fills `out` from the champion. Allocates nothing. */
export function readSlotViews(source: SlotSource, out: readonly SlotView[]): void {
  const cooldowns = source.cooldowns;
  const windup = source.cast !== null;
  for (let i = 0; i < out.length; i++) {
    const view = out[i] as SlotView;
    const ticks = cooldowns[i] ?? 0;
    view.seconds = ticks > 0 ? Math.ceil(ticks / TICK_RATE) : 0;
    view.windup = windup;
    // Only the ultimate has an energy gate to show; silence is not built yet.
    view.blocked = i === ULTIMATE_INDEX && source.energy < ULTIMATE_ENERGY_COST;
  }
}

/** What the HUD shows of the round, read from `state.match`. */
export interface RoundView {
  scoreA: number;
  scoreB: number;
  /** Whole seconds left, 0 to 90. */
  secondsLeft: number;
  /** The ring exists: the timer shows the sudden death text. */
  suddenDeath: boolean;
  /** The timer follows the state. False after a round and after the match, where it keeps its last text. */
  live: boolean;
}

export function createRoundView(): RoundView {
  return { scoreA: 0, scoreB: 0, secondsLeft: ROUND_TICKS / TICK_RATE, suddenDeath: false, live: true };
}

/**
 * Fills `out` from the match. The warmup shows the full round, since the round
 * clock has not started. In a round the timer counts down `phaseTicks`, and once
 * the ring exists it is sudden death (rules.md section 8). A state without
 * match flow reads as 0 : 0 and a full round. Allocates nothing.
 */
export function readRoundView(state: { match?: MatchState }, out: RoundView): void {
  const match = state.match;
  if (match === undefined) {
    out.scoreA = 0;
    out.scoreB = 0;
    out.secondsLeft = ROUND_TICKS / TICK_RATE;
    out.suddenDeath = false;
    out.live = true;
    return;
  }
  out.scoreA = match.score.A;
  out.scoreB = match.score.B;
  out.live = match.phase === 'warmup' || match.phase === 'round';
  out.suddenDeath = match.phase === 'round' && match.ring !== null;
  const left = match.phase === 'round' ? ROUND_TICKS - match.phaseTicks : ROUND_TICKS;
  out.secondsLeft = left > 0 ? Math.ceil(left / TICK_RATE) : 0;
}

/** The timer text once the ring exists. */
export const SUDDEN_DEATH_TEXT = 'Sudden death';

/** The text m:ss of every whole second from 0 to 90, made once at startup. */
export const TIMER_TEXT: readonly string[] = (() => {
  const text: string[] = [];
  for (let seconds = 0; seconds <= ROUND_TICKS / TICK_RATE; seconds++) {
    const rest = seconds % 60;
    text.push(`${Math.floor(seconds / 60)}:${rest < 10 ? '0' : ''}${rest}`);
  }
  return text;
})();
