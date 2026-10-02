export type ScoredIntent = 'engage' | 'kite' | 'retreat';
export type Intent = ScoredIntent | 'idle';

export interface Scores {
  engage: number;
  kite: number;
  retreat: number;
}

export const ENGAGE_SCORE = 0.5;
/** A rival intent must beat the current one by this much, which stops flicker at the edges. */
export const HYSTERESIS = 0.1;
export const RETREAT_HEALTH = 0.3;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Pure scores in [0, 1]. Kite and retreat start at 0.6 on their own edge, which is the
 * engage score plus the hysteresis, and rise to 1 as the situation gets worse.
 * `d` is the distance to the target and `h` is health over maximum health.
 */
export function scoreIntents(d: number, h: number, rangeMin: number): Scores {
  return {
    engage: ENGAGE_SCORE,
    kite: clamp01(rangeMin > 0 ? 0.6 + (rangeMin - d) / rangeMin : 0),
    retreat: clamp01(0.6 + (RETREAT_HEALTH - h) / RETREAT_HEALTH),
  };
}

// Scan order for ties: the safer intent wins.
const SCAN: readonly ScoredIntent[] = ['retreat', 'kite', 'engage'];

/**
 * Keeps the current intent unless the best other one scores more than the current score
 * plus the hysteresis. With these scores kite ends at 1.2 times rangeMin and retreat ends
 * at 36 percent health.
 */
export function chooseIntent(current: ScoredIntent, scores: Scores): ScoredIntent {
  let best: ScoredIntent = current;
  let bestScore = -Infinity;
  for (const candidate of SCAN) {
    if (candidate === current) continue;
    if (scores[candidate] > bestScore) {
      best = candidate;
      bestScore = scores[candidate];
    }
  }
  return bestScore > scores[current] + HYSTERESIS ? best : current;
}
