// Tests for the deterministic math port.
//
// How the committed bit patterns were generated: author `fixtures/dmath-atan2.json` as an
// empty array, run `npx vitest run --project sim packages/sim/test/dmath.test.ts`, write the
// patterns the failing fixture assertion reports (the same LCG and inputs, `atan2` from the
// port), and rerun until it is green. There is no writer script. Every CI run on another CPU
// then proves the port gives the same bits there, which `Math.atan2` does not.
//
// Comparing against `Math.atan2` and `Math.atan` is allowed in this file only: they are the
// accuracy reference, never a source of expected bits.
import { describe, expect, it } from 'vitest';
import bitsJson from './fixtures/dmath-atan2.json';
import { atan, atan2 } from '../src/dmath';

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

function bits(value: number): string {
  f64[0] = value;
  return (u64[0] ?? 0n).toString(16).padStart(16, '0');
}

/** A 53-bit uniform value in [0, 1) from two draws of a 32-bit LCG (Numerical Recipes). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  const draw = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  return () => {
    const high = draw() >>> 5;
    const low = draw() >>> 6;
    return (high * 2 ** 26 + low) / 2 ** 53;
  };
}

const COUNT = 2000;
const RANGE = 30; // meters, wider than the arena so the aim vector covers every direction

function inputs(): [number, number][] {
  const next = lcg(20260705);
  const out: [number, number][] = [];
  for (let i = 0; i < COUNT; i++) {
    const y = (next() * 2 - 1) * RANGE;
    const x = (next() * 2 - 1) * RANGE;
    out.push([y, x]);
  }
  return out;
}

describe('atan2 bit patterns', () => {
  it('matches the committed bit patterns on every input', () => {
    const actual = inputs().map(([y, x]) => bits(atan2(y, x)));
    expect(actual.length).toBe(COUNT);
    expect(actual).toEqual(bitsJson);
  });

  it('stays within two ulps of Math.atan2', () => {
    for (const [y, x] of inputs()) {
      const reference = Math.atan2(y, x);
      const tolerance = 2 * Number.EPSILON * Math.max(1, Math.abs(reference));
      expect(Math.abs(atan2(y, x) - reference)).toBeLessThanOrEqual(tolerance);
    }
  });
});

describe('atan2 special values', () => {
  it('handles zero arguments with their signs', () => {
    expect(Object.is(atan2(0, 1), 0)).toBe(true);
    expect(Object.is(atan2(-0, 1), -0)).toBe(true);
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(-0, -1)).toBe(-Math.PI);
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(Object.is(atan2(0, 0), 0)).toBe(true);
    expect(Object.is(atan2(-0, 0), -0)).toBe(true);
    expect(atan2(0, -0)).toBe(Math.PI);
    expect(atan2(-0, -0)).toBe(-Math.PI);
  });

  it('handles infinities', () => {
    const inf = Infinity;
    expect(atan2(1, inf)).toBe(0);
    expect(Object.is(atan2(-1, inf), -0)).toBe(true);
    expect(atan2(1, -inf)).toBe(Math.PI);
    expect(atan2(-1, -inf)).toBe(-Math.PI);
    expect(atan2(inf, inf)).toBe(Math.PI / 4);
    expect(atan2(-inf, inf)).toBe(-Math.PI / 4);
    expect(atan2(inf, -inf)).toBe(3 * (Math.PI / 4));
    expect(atan2(-inf, -inf)).toBe(-3 * (Math.PI / 4));
    expect(atan2(inf, 1)).toBe(Math.PI / 2);
    expect(atan2(-inf, 1)).toBe(-Math.PI / 2);
    expect(atan2(inf, -1)).toBe(Math.PI / 2);
    expect(atan2(-inf, 0)).toBe(-Math.PI / 2);
  });

  it('returns NaN when either argument is NaN', () => {
    expect(atan2(NaN, 1)).toBeNaN();
    expect(atan2(1, NaN)).toBeNaN();
    expect(atan2(NaN, NaN)).toBeNaN();
    expect(atan2(Infinity, NaN)).toBeNaN();
    expect(atan2(NaN, -Infinity)).toBeNaN();
  });

  it('handles ratios beyond 2^60 and tiny negative-x ratios', () => {
    expect(atan2(1e30, 1e-30)).toBe(Math.PI / 2);
    expect(atan2(-1e30, 1e-30)).toBe(-Math.PI / 2);
    expect(atan2(1e-30, -1e30)).toBe(Math.PI);
    expect(atan2(-1e-30, -1e30)).toBe(-Math.PI);
  });
});

describe('atan', () => {
  it('handles the exact anchors', () => {
    expect(Object.is(atan(0), 0)).toBe(true);
    expect(Object.is(atan(-0), -0)).toBe(true);
    expect(atan(1)).toBe(Math.PI / 4);
    expect(atan(-1)).toBe(-Math.PI / 4);
    expect(atan(Infinity)).toBe(Math.PI / 2);
    expect(atan(-Infinity)).toBe(-Math.PI / 2);
    expect(atan(NaN)).toBeNaN();
  });

  it('returns a tiny argument unchanged', () => {
    expect(atan(1e-20)).toBe(1e-20);
    expect(atan(-1e-20)).toBe(-1e-20);
  });

  it('stays within two ulps of Math.atan on every reduction range', () => {
    const next = lcg(7);
    for (let i = 0; i < 1000; i++) {
      const x = (next() * 2 - 1) * 10 ** (next() * 6 - 3);
      const reference = Math.atan(x);
      const tolerance = 2 * Number.EPSILON * Math.max(1, Math.abs(reference));
      expect(Math.abs(atan(x) - reference)).toBeLessThanOrEqual(tolerance);
    }
  });
});
