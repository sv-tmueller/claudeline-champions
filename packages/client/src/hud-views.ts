import { SLOTS, TICK_RATE } from '@claudeline/sim';

// Numbers from rules.md sections 1 to 3. The kit framework exports its own
// copies; those replace these when the HUD is wired to it.
/** Energy at which an EX variant can be cast. */
export const EX_MARK = 25;
/** Energy the ultimate costs. */
export const ULTIMATE_COST = 100;
export const MAX_ENERGY = 100;
/** A round lasts 90 s. */
export const ROUND_TICKS = 5400;
export const ROUNDS_TO_WIN = 3;

/** The slot that is the ultimate, F. */
const ULTIMATE_INDEX = SLOTS.length - 1;

/**
 * What the HUD reads from a champion. `cooldowns` holds one remaining-tick
 * entry per slot in `SLOTS` order and `cast` is non-null during a windup.
 * Both are optional, so a champion without them reads as ready.
 */
export interface SlotSource {
  energy: number;
  cooldowns?: readonly number[];
  cast?: unknown;
}

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
  const windup = source.cast != null;
  for (let i = 0; i < out.length; i++) {
    const view = out[i] as SlotView;
    const ticks = cooldowns?.[i] ?? 0;
    view.seconds = ticks > 0 ? Math.ceil(ticks / TICK_RATE) : 0;
    view.windup = windup;
    // Only the ultimate has an energy gate to show; silence arrives with the kits.
    view.blocked = i === ULTIMATE_INDEX && source.energy < ULTIMATE_COST;
  }
}

/** Placeholder until match flow exists: no round wins yet, a 90 s timer from the tick. */
export interface RoundView {
  scoreA: number;
  scoreB: number;
  /** Whole seconds left, 0 to 90. */
  secondsLeft: number;
}

export function createRoundView(): RoundView {
  return { scoreA: 0, scoreB: 0, secondsLeft: ROUND_TICKS / TICK_RATE };
}

export function readRoundView(state: { tick: number }, out: RoundView): void {
  out.scoreA = 0;
  out.scoreB = 0;
  const left = ROUND_TICKS - state.tick;
  out.secondsLeft = left > 0 ? Math.ceil(left / TICK_RATE) : 0;
}

/** The text m:ss of every whole second from 0 to 90, made once at startup. */
export const TIMER_TEXT: readonly string[] = (() => {
  const text: string[] = [];
  for (let seconds = 0; seconds <= ROUND_TICKS / TICK_RATE; seconds++) {
    const rest = seconds % 60;
    text.push(`${Math.floor(seconds / 60)}:${rest < 10 ? '0' : ''}${rest}`);
  }
  return text;
})();
