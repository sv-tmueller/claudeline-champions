import { describe, expect, it } from 'vitest';
import { createMeasure, distanceInto, hypot2 } from '../src/hypot';
import { createRng } from '../src/rng';

// `Math.hypot(a, b)` allocates about 32 bytes per call in V8 (its rest arguments), so the think
// path cannot call it. `hypot2` is V8's own algorithm for two arguments (scale by the larger, Kahan
// sum of squares, square root, scale back), written with plain doubles. Every operation is IEEE
// correctly rounded, so it gives the bits `Math.hypot` gives. The bots' decisions stay what they
// were, and no bot output depends on the CPU through it.
//
// The reference is the `Math.hypot` of the V8 these tests run on (Node 22). If an upgrade to Node
// 24 or later fails them, V8 has changed `Math.hypot`: that is a decision to make (follow it or
// keep these bits), not a bug in the bots.

function same(a: number, b: number): boolean {
  return Object.is(a, b);
}

describe('hypot2', () => {
  it('gives the bits Math.hypot gives on random pairs of every magnitude', () => {
    const rng = createRng(12345);
    const value = () => {
      const sign = rng.next() < 0.5 ? -1 : 1;
      // Magnitudes from 1e-12 to 1e12, so the scaling runs on both sides of 1.
      return sign * rng.next() * 10 ** Math.floor(rng.next() * 25 - 12);
    };
    for (let i = 0; i < 200000; i++) {
      const x = value();
      const y = value();
      if (!same(hypot2(x, y), Math.hypot(x, y))) {
        expect(hypot2(x, y), `hypot2(${x}, ${y})`).toBe(Math.hypot(x, y));
      }
    }
  });

  it('gives the bits Math.hypot gives on game-sized coordinates', () => {
    const rng = createRng(99);
    for (let i = 0; i < 200000; i++) {
      const x = (rng.next() - 0.5) * 40;
      const y = (rng.next() - 0.5) * 40;
      if (!same(hypot2(x, y), Math.hypot(x, y))) {
        expect(hypot2(x, y), `hypot2(${x}, ${y})`).toBe(Math.hypot(x, y));
      }
    }
  });

  it('gives the bits Math.hypot gives on the special values', () => {
    const specials = [
      0, -0, 1, -1, 3, 4, 0.1, 0.3, 0.4, 0.5, 1e-310, 5e-324, 1e-200, 1e200, 1.7976931348623157e308,
      Infinity, -Infinity, NaN,
    ];
    for (const x of specials) {
      for (const y of specials) {
        expect(same(hypot2(x, y), Math.hypot(x, y)), `hypot2(${x}, ${y})`).toBe(true);
      }
    }
  });
});

describe('distanceInto', () => {
  it('writes the bits Math.hypot gives for the differences, on random points and special values', () => {
    const out = createMeasure();
    const rng = createRng(2024);
    const value = () => (rng.next() - 0.5) * 60;
    for (let i = 0; i < 100000; i++) {
      const a = { x: value(), y: value() };
      const b = { x: value(), y: value() };
      distanceInto(out, a, b);
      const expected = Math.hypot(a.x - b.x, a.y - b.y);
      if (!same(out.metres, expected)) {
        expect(out.metres, `from ${a.x}, ${a.y} to ${b.x}, ${b.y}`).toBe(expected);
      }
    }
    const specials = [0, -0, 1, 3, 0.1, 1e-310, 1e200, Infinity, -Infinity, NaN];
    for (const dx of specials) {
      for (const dy of specials) {
        distanceInto(out, { x: dx, y: dy }, { x: 0, y: 0 });
        expect(same(out.metres, Math.hypot(dx, dy)), `distance (${dx}, ${dy})`).toBe(true);
      }
    }
  });
});
