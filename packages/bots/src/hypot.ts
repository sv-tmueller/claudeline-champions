/**
 * `Math.hypot(x, y)` without its allocation: V8 builds an array from the rest arguments of every
 * call, about 32 bytes, which a think that measures a dozen distances cannot afford (see
 * packages/bots/test/allocation.test.ts). This is V8's algorithm for two arguments: scale both
 * by the larger magnitude, add the squares with Kahan compensation, take the square root and
 * scale back. Each step is an IEEE operation that rounds correctly on every platform, so the
 * result has the bits `Math.hypot` gives, and a test compares the two. It is not the sim's
 * `length` (`Math.sqrt(x * x + y * y)`), which differs in the last bit for some inputs: the
 * bots keep the numbers they always had.
 *
 * The body is kept short on purpose: V8 inlines a small function into its caller, and a double
 * passed to or returned from a call it does not inline is boxed (16 B). The long form of this
 * function, with the special values in line, was not inlined into `segmentClear` and cost about
 * 600 B per call there, and so did a call to a helper for the special values (zero, a NaN, an
 * infinity) from inside it: a call V8 does not inline boxes its arguments.
 */
export function hypot2(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const max = ax > ay ? ax : ay;
  // False for zero, NaN and Infinity in max, and for a NaN in the smaller one. Infinity beats NaN
  // beats 0, as in V8: with no Infinity, ax + ay is NaN when either is, and 0 when both are 0.
  if (!(max > 0 && max < Infinity && ax === ax && ay === ay)) {
    return ax === Infinity || ay === Infinity ? Infinity : ax + ay;
  }
  // V8 adds the two scaled squares with Kahan compensation; with two terms the first
  // compensation is exactly 0, so the sum is plain.
  const nx = ax / max;
  const ny = ay / max;
  return Math.sqrt(nx * nx + ny * ny) * max;
}

/** A number a function writes instead of returning, so it crosses no call boundary as a double. */
export interface Measure {
  metres: number;
}

/** A measure that starts as a double, like every scratch field of the think path. */
export function createMeasure(): Measure {
  return { metres: 0.5 };
}

/**
 * The distance from `a` to `b`, `hypot2` of the differences, written into `out`. A function that
 * returns a double boxes it (16 B) when V8 does not inline it, and the think measures a dozen
 * distances; a function that takes two objects and writes a field of a third boxes nothing,
 * inlined or not. The algorithm of `hypot2` is repeated here, not called: inside a think that
 * V8 has already filled with inlined code the call to it is not inlined and boxes its arguments
 * and its result, which a test under Vitest measured at 16 B per distance. A test compares this
 * with `Math.hypot` too.
 */
export function distanceInto(
  out: Measure,
  a: { x: number; y: number },
  b: { x: number; y: number },
): void {
  const ax = Math.abs(a.x - b.x);
  const ay = Math.abs(a.y - b.y);
  const max = ax > ay ? ax : ay;
  if (!(max > 0 && max < Infinity && ax === ax && ay === ay)) {
    out.metres = ax === Infinity || ay === Infinity ? Infinity : ax + ay;
    return;
  }
  const nx = ax / max;
  const ny = ay / max;
  out.metres = Math.sqrt(nx * nx + ny * ny) * max;
}
