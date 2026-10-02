// Deterministic math for the sim.
//
// V8's `Math.atan2`, `Math.sin` and `Math.cos` call C++ code whose last bit differs between
// CPU architectures (compiler contraction of multiply-add), so the sim never uses them.
// This module ports fdlibm's `atan` (s_atan.c) and `atan2` (e_atan2.c), the same algorithms
// V8 uses, in plain TypeScript. It uses only `+ - * /` and comparisons, which JavaScript
// rounds correctly on every platform and V8 never fuses, so the results are identical
// everywhere by construction.
//
// The Sun notices of the two files this is ported from, preserved as in the fdlibm sources
// (FreeBSD msun copies), as the license requires.
//
// s_atan.c (`atan`):
//   ====================================================
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunPro, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//   ====================================================
//
// e_atan2.c (`atan2`):
//   ====================================================
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//   ====================================================

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

// Which half of the double is the high word depends on the machine, so find out once with a
// known value: 1.0 is 0x3ff00000, 0x00000000.
f64[0] = 1;
const HIGH = u32[1] === 0x3ff00000 ? 1 : 0;
const LOW = 1 - HIGH;

/** The high word as a signed 32-bit integer (sign, exponent and top 20 mantissa bits). */
function highWord(x: number): number {
  f64[0] = x;
  return (u32[HIGH] as number) | 0;
}

/** The low word as an unsigned 32-bit integer. */
function lowWord(x: number): number {
  f64[0] = x;
  return u32[LOW] as number;
}

function fabs(x: number): number {
  return Math.abs(x);
}

const atanhi: readonly [number, number, number, number] = [
  4.63647609000806093515e-1, // atan(0.5)hi 0x3FDDAC67, 0x0561BB4F
  7.85398163397448278999e-1, // atan(1.0)hi 0x3FE921FB, 0x54442D18
  9.82793723247329054082e-1, // atan(1.5)hi 0x3FEF730B, 0xD281F69B
  1.570796326794896558e0, // atan(inf)hi 0x3FF921FB, 0x54442D18
];

const atanlo: readonly [number, number, number, number] = [
  2.26987774529616870924e-17, // atan(0.5)lo 0x3C7A2B7F, 0x222F65E2
  3.06161699786838301793e-17, // atan(1.0)lo 0x3C81A626, 0x33145C07
  1.39033110312309984516e-17, // atan(1.5)lo 0x3C700788, 0x7AF0CBBD
  6.12323399573676603587e-17, // atan(inf)lo 0x3C91A626, 0x33145C07
];

const aT: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  3.33333333333329318027e-1,
  -1.99999999998764832476e-1,
  1.42857142725034663711e-1,
  -1.1111110405462355788e-1,
  9.09088713343650656196e-2,
  -7.69187620504482999495e-2,
  6.66107313738753120669e-2,
  -5.83357013379057348645e-2,
  4.97687799461593236017e-2,
  -3.65315727442169155270e-2,
  1.62858201153657823623e-2,
];

const one = 1.0;
const huge = 1.0e300;

/** The arc tangent of `x` in radians, the fdlibm algorithm. */
export function atan(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  let id: -1 | 0 | 1 | 2 | 3;
  if (ix >= 0x44100000) {
    // |x| >= 2^66, or x is infinite or NaN
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lowWord(x) !== 0)) return x + x;
    if (hx > 0) return atanhi[3] + atanlo[3];
    return -atanhi[3] - atanlo[3];
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) {
      // |x| < 2^-27
      if (huge + x > one) return x; // raise inexact
    }
    id = -1;
  } else {
    x = fabs(x);
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        // 7/16 <= |x| < 11/16
        id = 0;
        x = (2.0 * x - one) / (2.0 + x);
      } else {
        // 11/16 <= |x| < 19/16
        id = 1;
        x = (x - one) / (x + one);
      }
    } else if (ix < 0x40038000) {
      // |x| < 2.4375
      id = 2;
      x = (x - 1.5) / (one + 1.5 * x);
    } else {
      // 2.4375 <= |x| < 2^66
      id = 3;
      x = -1.0 / x;
    }
  }
  // end of argument reduction
  let z = x * x;
  const w = z * z;
  // break the sum from i=0 to 10 aT[i]z**(i+1) into odd and even poly
  const s1 =
    z *
    (aT[0] +
      w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
  const s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id === -1) return x - x * (s1 + s2);
  z = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
  return hx < 0 ? -z : z;
}

const tiny = 1.0e-300;
const zero = 0.0;
const pi_o_4 = 7.853981633974482790e-1; // 0x3FE921FB, 0x54442D18
const pi_o_2 = 1.570796326794896558e0; // 0x3FF921FB, 0x54442D18
const pi = 3.141592653589793116e0; // 0x400921FB, 0x54442D18
const pi_lo = 1.2246467991473532e-16; // 0x3CA1A626, 0x33145C07

/** The angle in radians of the point (x, y) from +x, in [-pi, pi], the fdlibm algorithm. */
export function atan2(y: number, x: number): number {
  const hx = highWord(x);
  const lx = lowWord(x);
  const ix = hx & 0x7fffffff;
  const hy = highWord(y);
  const ly = lowWord(y);
  const iy = hy & 0x7fffffff;
  // x or y is NaN
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0)) return x + y;
  if (iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) return x + y;
  if (hx === 0x3ff00000 && lx === 0) return atan(y); // x = 1.0
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2 * sign(x) + sign(y)

  // when y = 0
  if ((iy | ly) === 0) {
    if (m === 0 || m === 1) return y; // atan(+-0, +anything) = +-0
    if (m === 2) return pi + tiny; // atan(+0, -anything) = pi
    return -pi - tiny; // atan(-0, -anything) = -pi
  }
  // when x = 0
  if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;

  // when x is INF
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      if (m === 0) return pi_o_4 + tiny; // atan(+INF, +INF)
      if (m === 1) return -pi_o_4 - tiny; // atan(-INF, +INF)
      if (m === 2) return 3.0 * pi_o_4 + tiny; // atan(+INF, -INF)
      return -3.0 * pi_o_4 - tiny; // atan(-INF, -INF)
    }
    if (m === 0) return zero; // atan(+..., +INF)
    if (m === 1) return -zero; // atan(-..., +INF)
    if (m === 2) return pi + tiny; // atan(+..., -INF)
    return -pi - tiny; // atan(-..., -INF)
  }
  // when y is INF
  if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;

  // compute y / x
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    // |y / x| > 2^60
    z = pi_o_2 + 0.5 * pi_lo;
    m &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0.0; // 0 > |y| / x > -2^-60
  } else {
    z = atan(fabs(y / x)); // safe to do y / x
  }
  if (m === 0) return z; // atan(+, +)
  if (m === 1) return -z; // atan(-, +)
  if (m === 2) return pi - (z - pi_lo); // atan(+, -)
  return z - pi_lo - pi; // atan(-, -), (z - pi_lo) - pi
}
