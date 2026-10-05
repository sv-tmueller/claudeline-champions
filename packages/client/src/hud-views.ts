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

/**
 * The index of the score `a : b` in `scoreTexts(roundsToWin)`, or -1 for a score
 * past the rounds to win (the table has no entry there, so a caller falls back).
 */
export function scoreIndex(roundsToWin: number, a: number, b: number): number {
  if (a < 0 || b < 0 || a > roundsToWin || b > roundsToWin) return -1;
  return a * (roundsToWin + 1) + b;
}

/**
 * The text "a : b" of every score from 0 : 0 to `roundsToWin` : `roundsToWin`,
 * made once at startup and indexed by `scoreIndex`. The HUD and the result
 * screen share it, so writing a score builds no string.
 */
export function scoreTexts(roundsToWin: number): string[] {
  const texts: string[] = [];
  for (let a = 0; a <= roundsToWin; a++) {
    for (let b = 0; b <= roundsToWin; b++) texts.push(`${a} : ${b}`);
  }
  return texts;
}

/** The ring warning counts down from this many ticks before sudden death: 10 s (rules.md section 8). */
export const RING_COUNTDOWN_TICKS = 10 * TICK_RATE;

/** What the HUD shows of the ring, read from `state.match` and the local champion. */
export interface RingView {
  /** The countdown or the ring is showing: only in the round phase. */
  visible: boolean;
  /** Whole seconds until sudden death, 10 down to 1; 0 once the ring exists. */
  countdown: number;
  /** The ring radius in decimetres, 0 until the ring exists. */
  radiusDm: number;
  /** How far the local champion is from the ring edge in decimetres, 0 until the ring exists. */
  distanceDm: number;
  /** The local champion is alive and outside the ring: the sim's own test, `dx² + dy² > r²`. */
  outside: boolean;
}

export function createRingView(): RingView {
  return { visible: false, countdown: 0, radiusDm: 0, distanceDm: 0, outside: false };
}

/** What the ring view reads from a champion: the sim's own fields. */
export type RingSource = Pick<ChampionState, 'x' | 'y' | 'alive'>;

/**
 * Fills `out` for the champion `localId`. The warning shows only in the round
 * phase: as a countdown from `RING_COUNTDOWN_TICKS` ticks before the ring, and
 * from then on as the ring's radius with the local champion's distance to its
 * edge. A champion exactly on the radius is inside, as in the sim (flow.ts), and
 * a dead one is never outside. The radius is the ring's own, which falls in
 * sudden death, not the arena's starting radius. Allocates nothing.
 */
export function readRingView(
  state: { match?: MatchState; champions: readonly RingSource[] },
  localId: number,
  out: RingView,
): void {
  out.visible = false;
  out.countdown = 0;
  out.radiusDm = 0;
  out.distanceDm = 0;
  out.outside = false;
  const match = state.match;
  if (match === undefined || match.phase !== 'round') return;
  const ring = match.ring;
  if (ring === null) {
    const left = ROUND_TICKS - match.phaseTicks;
    if (left > RING_COUNTDOWN_TICKS) return;
    out.visible = true;
    // The sim creates the ring in the step that starts at ROUND_TICKS phase ticks, so a
    // frame can read 0 left with no ring yet: that tick still shows 1.
    out.countdown = Math.max(1, Math.ceil(left / TICK_RATE));
    return;
  }
  out.visible = true;
  out.radiusDm = Math.round(ring.radius * 10);
  const champion = state.champions[localId];
  if (champion === undefined || !champion.alive) return;
  const dx = champion.x - ring.x;
  const dy = champion.y - ring.y;
  const squared = dx * dx + dy * dy;
  out.outside = squared > ring.radius * ring.radius;
  out.distanceDm = Math.round(Math.abs(Math.sqrt(squared) - ring.radius) * 10);
}
