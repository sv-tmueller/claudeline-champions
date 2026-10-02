import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/difficulty';
import type { Difficulty } from '../src/difficulty';
import {
  ENGAGE_SCORE,
  HYSTERESIS,
  RETREAT_HEALTH,
  chooseIntent,
  scoreIntents,
} from '../src/intent';
import type { ScoredIntent } from '../src/intent';
import { profileFor } from '../src/profile';

const RANGE_MIN = 6;

/** The intent the rules settle on from `start` after seeing each (d, h) in turn. */
function settle(start: ScoredIntent, samples: [number, number][]): ScoredIntent {
  let intent = start;
  for (const [d, h] of samples) intent = chooseIntent(intent, scoreIntents(d, h, RANGE_MIN));
  return intent;
}

describe('scoreIntents', () => {
  it('scores engage 0.5 always', () => {
    expect(ENGAGE_SCORE).toBe(0.5);
    expect(scoreIntents(1, 1, RANGE_MIN).engage).toBe(0.5);
    expect(scoreIntents(50, 0.1, RANGE_MIN).engage).toBe(0.5);
  });

  it('scores kite from how far inside the minimum range the target is', () => {
    expect(scoreIntents(RANGE_MIN, 1, RANGE_MIN).kite).toBe(0.6);
    expect(scoreIntents(4, 1, RANGE_MIN).kite).toBeCloseTo(0.6 + 2 / 6, 12);
    expect(scoreIntents(0, 1, RANGE_MIN).kite).toBe(1);
    expect(scoreIntents(12, 1, RANGE_MIN).kite).toBe(0);
  });

  it('scores kite 0 for a melee profile', () => {
    expect(scoreIntents(0.5, 1, 0).kite).toBe(0);
  });

  it('scores retreat from how far health is below 30 percent', () => {
    expect(RETREAT_HEALTH).toBe(0.3);
    expect(scoreIntents(5, 0.3, RANGE_MIN).retreat).toBe(0.6);
    expect(scoreIntents(5, 0.2, RANGE_MIN).retreat).toBeCloseTo(0.6 + 0.1 / 0.3, 12);
    expect(scoreIntents(5, 0, RANGE_MIN).retreat).toBe(1);
    expect(scoreIntents(5, 1, RANGE_MIN).retreat).toBe(0);
  });

  it('keeps every score inside [0, 1]', () => {
    for (const d of [0, 1, 6, 30, 1000]) {
      for (const h of [0, 0.2, 0.5, 1]) {
        const s = scoreIntents(d, h, RANGE_MIN);
        for (const v of [s.engage, s.kite, s.retreat]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('chooseIntent thresholds', () => {
  it('starts kiting only once the target is inside the minimum range', () => {
    expect(HYSTERESIS).toBe(0.1);
    expect(settle('engage', [[RANGE_MIN, 1]])).toBe('engage');
    expect(settle('engage', [[RANGE_MIN + 0.5, 1]])).toBe('engage');
    expect(settle('engage', [[RANGE_MIN - 0.1, 1]])).toBe('kite');
  });

  it('stops kiting only beyond 1.2 times the minimum range', () => {
    expect(settle('kite', [[1.2 * RANGE_MIN - 0.1, 1]])).toBe('kite');
    expect(settle('kite', [[1.2 * RANGE_MIN + 0.1, 1]])).toBe('engage');
  });

  it('starts retreating only below 30 percent health', () => {
    expect(settle('engage', [[8, 0.3]])).toBe('engage');
    expect(settle('engage', [[8, 0.31]])).toBe('engage');
    expect(settle('engage', [[8, 0.29]])).toBe('retreat');
  });

  it('stops retreating only above 36 percent health', () => {
    expect(settle('retreat', [[8, 0.35]])).toBe('retreat');
    expect(settle('retreat', [[8, 0.37]])).toBe('engage');
  });

  it('prefers retreat, then kite, then engage on equal scores', () => {
    expect(chooseIntent('engage', { engage: 0.5, kite: 0.9, retreat: 0.9 })).toBe('retreat');
    expect(chooseIntent('retreat', { engage: 0.9, kite: 0.9, retreat: 0.5 })).toBe('kite');
    expect(chooseIntent('kite', { engage: 0.9, kite: 0.5, retreat: 0.9 })).toBe('retreat');
  });

  it('needs a margin over the current score, not just a higher one', () => {
    expect(chooseIntent('engage', { engage: 0.5, kite: 0.6, retreat: 0 })).toBe('engage');
    expect(chooseIntent('engage', { engage: 0.5, kite: 0.61, retreat: 0 })).toBe('kite');
  });

  it('does not flicker when the distance oscillates around the minimum range', () => {
    let intent: ScoredIntent = 'engage';
    let changes = 0;
    for (let i = 0; i < 200; i++) {
      const d = RANGE_MIN + (i % 2 === 0 ? -0.05 : 0.05);
      const next = chooseIntent(intent, scoreIntents(d, 1, RANGE_MIN));
      if (next !== intent) changes++;
      intent = next;
    }
    expect(changes).toBe(1);
    expect(intent).toBe('kite');
  });

  it('does not flicker when health oscillates around 30 percent', () => {
    let intent: ScoredIntent = 'engage';
    let changes = 0;
    for (let i = 0; i < 200; i++) {
      const h = 0.3 + (i % 2 === 0 ? -0.01 : 0.01);
      const next = chooseIntent(intent, scoreIntents(8, h, RANGE_MIN));
      if (next !== intent) changes++;
      intent = next;
    }
    expect(changes).toBe(1);
    expect(intent).toBe('retreat');
  });
});

describe('profileFor', () => {
  it('returns the ranges per champion', () => {
    expect(profileFor('hargrim')).toEqual({ rangeMin: 0, rangeMax: 3 });
    expect(profileFor('quillon')).toEqual({ rangeMin: 6, rangeMax: 13 });
    expect(profileFor('lumeth')).toEqual({ rangeMin: 6, rangeMax: 10 });
    expect(profileFor('skerrow')).toEqual({ rangeMin: 0, rangeMax: 2.5 });
  });

  it('returns the default for an unknown id, including names on the prototype', () => {
    const fallback = { rangeMin: 4, rangeMax: 8 };
    expect(profileFor('nobody')).toEqual(fallback);
    expect(profileFor('constructor')).toEqual(fallback);
    expect(profileFor('__proto__')).toEqual(fallback);
    expect(profileFor('toString')).toEqual(fallback);
  });

  it('keeps every maximum range above one metre', () => {
    for (const id of ['hargrim', 'quillon', 'lumeth', 'skerrow', 'other']) {
      expect(profileFor(id).rangeMax).toBeGreaterThan(1);
    }
  });
});

describe('TIERS', () => {
  const expected: [Difficulty, number, number][] = [
    ['easy', 30, 12],
    ['normal', 15, 6],
    ['hard', 6, 2],
  ];

  for (const [tier, delay, degrees] of expected) {
    it(`${tier}: delay ${delay} ticks, error ${degrees} degrees`, () => {
      const t = TIERS[tier];
      expect(t.delay).toBe(delay);
      expect(t.errorDegrees).toBe(degrees);
      // The aim turns by 2 atan(u), so the largest u is tan(half the error).
      expect(t.maxU).toBeCloseTo(Math.tan(((degrees / 2) * Math.PI) / 180), 15);
    });
  }
});
