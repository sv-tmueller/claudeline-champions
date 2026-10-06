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

/**
 * Pure scores in [0, 1]. Kite and retreat start at 0.6 on their own edge, which is the
 * engage score plus the hysteresis, and rise to 1 as the situation gets worse.
 * `d` is the distance to the target and `h` is health over maximum health.
 */
export function scoreIntents(d: number, h: number, rangeMin: number): Scores {
  const out: Scores = { engage: ENGAGE_SCORE, kite: 0, retreat: 0 };
  scoreIntentsInto(out, { metres: d }, { health: h, maxHealth: 1 }, { rangeMin });
  return out;
}

/**
 * `scoreIntents` written into `out`, for the think path: the distance comes in a box and the
 * health fraction from the champion, so no double is passed to a call V8 might not inline (16 B
 * each, and this is called across modules).
 */
export function scoreIntentsInto(
  out: Scores,
  distance: { metres: number },
  self: { health: number; maxHealth: number },
  profile: { rangeMin: number },
): void {
  const d = distance.metres;
  const h = self.health / self.maxHealth;
  const rangeMin = profile.rangeMin;
  out.engage = ENGAGE_SCORE;
  // Clamped to [0, 1] in line: a call to a helper boxed the double it returned (16 B).
  const kite = rangeMin > 0 ? 0.6 + (rangeMin - d) / rangeMin : 0;
  out.kite = kite <= 0 ? 0 : kite >= 1 ? 1 : kite;
  const retreat = 0.6 + (RETREAT_HEALTH - h) / RETREAT_HEALTH;
  out.retreat = retreat <= 0 ? 0 : retreat >= 1 ? 1 : retreat;
}

// Scan order for ties: the safer intent wins (retreat, then kite, then engage). The scan is written
// out because a loop that reads `scores[candidate]` by a computed key boxed the score it loaded
// (about 65 B per think, measured).

/**
 * Keeps the current intent unless the best other one scores more than the current score
 * plus the hysteresis. With these scores kite ends at 1.2 times rangeMin and retreat ends
 * at 36 percent health.
 */
export function chooseIntent(current: ScoredIntent, scores: Scores): ScoredIntent {
  let best: ScoredIntent = current;
  let bestScore = -Infinity;
  if (current !== 'retreat' && scores.retreat > bestScore) {
    best = 'retreat';
    bestScore = scores.retreat;
  }
  if (current !== 'kite' && scores.kite > bestScore) {
    best = 'kite';
    bestScore = scores.kite;
  }
  if (current !== 'engage' && scores.engage > bestScore) {
    best = 'engage';
    bestScore = scores.engage;
  }
  const currentScore =
    current === 'engage' ? scores.engage : current === 'kite' ? scores.kite : scores.retreat;
  return bestScore > currentScore + HYSTERESIS ? best : current;
}
