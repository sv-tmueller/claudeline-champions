// Tests for the deterministic math port.
//
// How the committed bit patterns were generated: author `fixtures/dmath-atan2.json`,
// `fixtures/dmath-sin.json` and `fixtures/dmath-cos.json` as empty arrays, run
// `npx vitest run --project sim packages/sim/test/dmath.test.ts`, write the patterns the
// failing fixture assertions report (the same LCG and inputs, the function under test from the
// port), and rerun until it is green. There is no writer script. Every CI run on another CPU
// then proves the port gives the same bits there, which V8's `Math` functions do not.
//
// Comparing against `Math.atan2`, `Math.atan`, `Math.sin` and `Math.cos` is allowed in this
// file only: they are the accuracy reference, never a source of expected bits.
import { describe, expect, it } from 'vitest';
import atan2BitsJson from './fixtures/dmath-atan2.json';
import cosBitsJson from './fixtures/dmath-cos.json';
import sinBitsJson from './fixtures/dmath-sin.json';
import { atan, atan2, cos, sin } from '../src/dmath';

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

const SIGN = 1n << 63n;

/** Position of a double on the number line, counted in ulps (so -0 and 0 are both 0n). */
function ordinal(value: number): bigint {
  f64[0] = value;
  const raw = u64[0] ?? 0n;
  return raw & SIGN ? -(raw & ~SIGN) : raw;
}

/** How many representable doubles apart `a` and `b` are. */
function ulpDistance(a: number, b: number): bigint {
  const d = ordinal(a) - ordinal(b);
  return d < 0n ? -d : d;
}

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

describe('ulpDistance', () => {
  it('counts representable doubles, also near zero and across its sign', () => {
    expect(ulpDistance(1, 1)).toBe(0n);
    expect(ulpDistance(1, 1 + 3 * Number.EPSILON)).toBe(3n);
    expect(ulpDistance(0.5, 0.5 + 3 * Number.EPSILON)).toBe(6n);
    expect(ulpDistance(-1, -(1 + 2 * Number.EPSILON))).toBe(2n);
    expect(ulpDistance(0, -0)).toBe(0n);
    expect(ulpDistance(Number.MIN_VALUE, -Number.MIN_VALUE)).toBe(2n);
  });
});

describe('atan2 bit patterns', () => {
  it('matches the committed bit patterns on every input', () => {
    const actual = inputs().map(([y, x]) => bits(atan2(y, x)));
    expect(actual.length).toBe(COUNT);
    expect(actual).toEqual(atan2BitsJson);
  });

  it('stays within 2 ulps of Math.atan2', () => {
    for (const [y, x] of inputs()) {
      const reference = Math.atan2(y, x);
      expect(ulpDistance(atan2(y, x), reference)).toBeLessThanOrEqual(2n);
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

  it('stays within 2 ulps of Math.atan on every reduction range', () => {
    const next = lcg(7);
    for (let i = 0; i < 1000; i++) {
      const x = (next() * 2 - 1) * 10 ** (next() * 6 - 3);
      const reference = Math.atan(x);
      expect(ulpDistance(atan(x), reference)).toBeLessThanOrEqual(2n);
    }
  });
});

function fromBits(pattern: bigint): number {
  u64[0] = pattern;
  return f64[0] ?? 0;
}

/** 2^k for an integer k, by repeated doubling or halving (exact, no `**`). */
function pow2(k: number): number {
  let value = 1;
  for (let i = 0; i < Math.abs(k); i++) value = k < 0 ? value / 2 : value * 2;
  return value;
}

const BOUND = 1647099; // dmath accepts |x| below this, just under 2^20 * (pi / 2)
const BOUND_BITS = 0x413921fb00000000n;

// Three strata with exact operations only, so every CPU builds the same inputs: A is uniform
// over four full turns, B spans the magnitudes from 2^-30 to 2^20 and C sits on multiples of
// pi / 2, where argument reduction cancels the most. The first eight C multiples are 1 to 8, so
// the reduction branches pinned to pi/2, pi, 3pi/2 and 2pi are certain to run.
function trigInputs(): number[] {
  const next = lcg(20261002);
  const out: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    if (i < 800) {
      out.push((next() * 2 - 1) * (4 * Math.PI));
    } else if (i < 1600) {
      const k = Math.floor(next() * 50) - 30;
      const magnitude = (1 + next()) * pow2(k);
      out.push(next() < 0.5 ? -magnitude : magnitude);
    } else {
      const j = i - 1600;
      const k = j < 8 ? j + 1 : 1 + Math.floor(next() * 2 ** 19);
      const value = k * (Math.PI / 2);
      out.push(next() < 0.5 ? -value : value);
    }
  }
  return out;
}

const trig = [
  { name: 'sin', fn: sin, reference: Math.sin, fixture: sinBitsJson as string[] },
  { name: 'cos', fn: cos, reference: Math.cos, fixture: cosBitsJson as string[] },
];

describe('trigInputs', () => {
  it('stays below the bound', () => {
    const values = trigInputs();
    expect(values.length).toBe(COUNT);
    expect(Math.max(...values.map(Math.abs))).toBeLessThan(BOUND);
  });
});

describe.each(trig)('$name', ({ fn, reference, fixture }) => {
  it('matches the committed bit patterns on every input', () => {
    const actual = trigInputs().map((x) => bits(fn(x)));
    expect(actual.length).toBe(COUNT);
    expect(actual).toEqual(fixture);
  });

  it('stays within 2 ulps of the V8 function on every fixture input', () => {
    for (const x of trigInputs()) {
      expect(ulpDistance(fn(x), reference(x))).toBeLessThanOrEqual(2n);
    }
  });

  it('stays within 2 ulps on multiples of pi / 2 and on large arguments', () => {
    const inputs = [1e5, 1.6e6];
    for (let k = 3; k <= 8; k++) inputs.push(k * (Math.PI / 2));
    inputs.push(1e5 * (Math.PI / 2));
    for (const x of inputs) {
      expect(ulpDistance(fn(x), reference(x))).toBeLessThanOrEqual(2n);
      expect(ulpDistance(fn(-x), reference(-x))).toBeLessThanOrEqual(2n);
    }
  });

  it('returns NaN for NaN and the infinities', () => {
    expect(fn(NaN)).toBeNaN();
    expect(fn(Infinity)).toBeNaN();
    expect(fn(-Infinity)).toBeNaN();
  });

  it('throws at the bound, its negative and beyond, and accepts the double below it', () => {
    const atBound = fromBits(BOUND_BITS);
    expect(Math.trunc(atBound)).toBe(BOUND);
    expect(() => fn(atBound)).toThrow(RangeError);
    expect(() => fn(-atBound)).toThrow(RangeError);
    expect(() => fn(2e6)).toThrow(RangeError);
    expect(() => fn(1e300)).toThrow(`dmath: sin and cos need |x| < 1647099, got ${1e300}`);
    const below = fromBits(BOUND_BITS - 1n);
    expect(ulpDistance(fn(below), reference(below))).toBeLessThanOrEqual(2n);
  });
});

describe('sin', () => {
  it('is odd, bit for bit', () => {
    for (const x of trigInputs()) {
      expect(bits(sin(-x))).toBe(bits(-sin(x)));
    }
  });

  it('gives the exact values at the anchors', () => {
    expect(Object.is(sin(0), 0)).toBe(true);
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(sin(1e-300)).toBe(1e-300);
    expect(sin(Math.PI)).toBe(1.2246467991473532e-16);
    expect(sin(-Math.PI)).toBe(-1.2246467991473532e-16);
    expect(sin(Math.PI / 2)).toBe(1);
    expect(sin(2 * Math.PI)).toBe(-2.4492935982947064e-16);
  });
});

describe('cos', () => {
  it('is even, bit for bit', () => {
    for (const x of trigInputs()) {
      expect(bits(cos(-x))).toBe(bits(cos(x)));
    }
  });

  it('gives the exact values at the anchors', () => {
    expect(cos(0)).toBe(1);
    expect(cos(-0)).toBe(1);
    expect(cos(1e-300)).toBe(1);
    expect(cos(Math.PI)).toBe(-1);
    expect(cos(Math.PI / 2)).toBe(6.123233995736766e-17);
    expect(cos(2 * Math.PI)).toBe(1);
  });
});
