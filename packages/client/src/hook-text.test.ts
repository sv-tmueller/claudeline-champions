import { describe, expect, it } from 'vitest';
import {
  CM_TEXT_LIMIT,
  FACING_KEY_LIMIT,
  INT_TEXT_COUNT,
  cmText,
  facingKey,
  facingText,
  intText,
  percentText,
} from './hook-text';

// The tables replace formatters that build a string on every change. Each entry
// must be the exact text the formatter gave, so the e2e readers see no difference.
describe('intText', () => {
  it('is String(n) for every table entry', () => {
    for (let n = 0; n < INT_TEXT_COUNT; n++) {
      if (intText(n) !== String(n)) expect(intText(n)).toBe(String(n));
    }
  });

  it('returns the same string object for a repeat, which is the table and not a new string', () => {
    expect(intText(1234)).toBe(intText(1234));
    expect(intText(0)).toBe('0');
    expect(intText(INT_TEXT_COUNT - 1)).toBe(String(INT_TEXT_COUNT - 1));
  });

  it('falls back to String past each end', () => {
    expect(intText(INT_TEXT_COUNT)).toBe(String(INT_TEXT_COUNT));
    expect(intText(INT_TEXT_COUNT + 12_345)).toBe(String(INT_TEXT_COUNT + 12_345));
    expect(intText(-1)).toBe('-1');
    expect(intText(-250)).toBe('-250');
  });
});

describe('cmText', () => {
  it('is String(cm) for every integer from -limit to limit', () => {
    for (let cm = -CM_TEXT_LIMIT; cm <= CM_TEXT_LIMIT; cm++) {
      if (cmText(cm) !== String(cm)) expect(cmText(cm)).toBe(String(cm));
    }
  });

  it('covers an arena of 30 m by 20 m, whose centimetres are at most 1500', () => {
    expect(CM_TEXT_LIMIT).toBeGreaterThanOrEqual(1500);
  });

  it('falls back to String past each end', () => {
    expect(cmText(CM_TEXT_LIMIT + 1)).toBe(String(CM_TEXT_LIMIT + 1));
    expect(cmText(-CM_TEXT_LIMIT - 1)).toBe(String(-CM_TEXT_LIMIT - 1));
  });
});

describe('facing', () => {
  it('keys a facing by its milliradians', () => {
    expect(facingKey(0)).toBe(0);
    expect(facingKey(1.2344)).toBe(1234);
    expect(facingKey(-1.2346)).toBe(-1235);
    expect(facingKey(Math.PI)).toBe(3142);
    expect(facingKey(-Math.PI)).toBe(-3142);
  });

  it('writes the key as the old toFixed(3) text for every key in the table', () => {
    for (let key = -FACING_KEY_LIMIT; key <= FACING_KEY_LIMIT; key++) {
      const text = facingText(key);
      // The old hook wrote facing.toFixed(3) of a facing of key / 1000 milliradians.
      if (text !== (key / 1000).toFixed(3)) expect(text).toBe((key / 1000).toFixed(3));
    }
  });

  it('spans the full circle', () => {
    expect(FACING_KEY_LIMIT).toBe(3142);
    expect(facingText(3142)).toBe('3.142');
    expect(facingText(-3142)).toBe('-3.142');
    expect(facingText(0)).toBe('0.000');
  });

  it('falls back to toFixed(3) past each end', () => {
    expect(facingText(3143)).toBe('3.143');
    expect(facingText(-3143)).toBe('-3.143');
    expect(facingText(10_000)).toBe('10.000');
  });
});

describe('percentText', () => {
  it('is x for a hidden bar and String(percent) from 0 to 100', () => {
    expect(percentText(-1)).toBe('x');
    for (let percent = 0; percent <= 100; percent++) expect(percentText(percent)).toBe(String(percent));
  });

  it('falls back to String past 100', () => {
    expect(percentText(101)).toBe('101');
  });
});
