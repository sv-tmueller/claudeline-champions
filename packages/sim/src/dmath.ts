// Deterministic math for the sim.
//
// V8's `Math.atan2`, `Math.sin` and `Math.cos` call C++ code whose last bit differs between
// CPU architectures (compiler contraction of multiply-add), so the sim never uses them; lint
// bans them in sim source. This module ports fdlibm's `atan` (s_atan.c), `atan2` (e_atan2.c),
// `sin` (s_sin.c, k_sin.c), `cos` (s_cos.c, k_cos.c) and the argument reduction
// `__ieee754_rem_pio2` (e_rem_pio2.c) in plain TypeScript. It uses only `+ - * /`, comparisons,
// bit-word reads and `Math.abs`, which JavaScript rounds correctly on every platform and V8
// never fuses, so the results are identical everywhere by construction.
//
// Source: the FreeBSD msun copies of the fdlibm files, commit
// 0dd5a5603e7a33d976f8e6015620bbc79839c609.
//
// The Sun notices of the files this is ported from, preserved as in those sources, as the
// license requires.
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
//
// k_sin.c (`kernelSin`):
//   ====================================================
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//   ====================================================
//
// k_cos.c (`kernelCos`):
//   ====================================================
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//   ====================================================
//
// s_sin.c (`sin`):
//   ====================================================
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunPro, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//   ====================================================
//
// s_cos.c (`cos`):
//   ====================================================
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunPro, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//   ====================================================
//
// e_rem_pio2.c (`remPio2`):
//   ====================================================
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//   ====================================================
//
//   Optimized by Bruce D. Evans.

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

const half = 5.0e-1; // 0x3FE00000, 0x00000000
const S1 = -1.66666666666666324348e-1; // 0xBFC55555, 0x55555549
const S2 = 8.33333333332248946124e-3; // 0x3F811111, 0x1110F8A6
const S3 = -1.98412698298579493134e-4; // 0xBF2A01A0, 0x19C161D5
const S4 = 2.75573137070700676789e-6; // 0x3EC71DE3, 0x57B1FE7D
const S5 = -2.50507602534068634195e-8; // 0xBE5AE5E6, 0x8A2B9CEB
const S6 = 1.58969099521155010221e-10; // 0x3DE5D93A, 0x5ACFD57C

/**
 * The sine of `x + y` on about [-pi/4, pi/4], where `y` is the tail of `x`. `iy` is 0 when
 * `y` is 0. The callers return sin(-0) = -0 themselves: the polynomial does not keep the sign.
 */
function kernelSin(x: number, y: number, iy: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (half * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-2; // 0x3FA55555, 0x5555554C
const C2 = -1.38888888888741095749e-3; // 0xBF56C16C, 0x16C15177
const C3 = 2.48015872894767294178e-5; // 0x3EFA01A0, 0x19CB1590
const C4 = -2.75573143513906633035e-7; // 0xBE927E4F, 0x809C52AD
const C5 = 2.08757232129817482790e-9; // 0x3E21EE9E, 0xBDB4B1C4
const C6 = -1.13596475577881948265e-11; // 0xBDA8FAE9, 0xBE8838D4

/** The cosine of `x + y` on about [-pi/4, pi/4], where `y` is the tail of `x`. */
function kernelCos(x: number, y: number): number {
  const z = x * x;
  let w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  w = one - hz;
  return w + (((one - w) - hz) + (z * r - x * y));
}

const invpio2 = 6.36619772367581382433e-1; // 0x3FE45F30, 0x6DC9C883 (53 bits of 2/pi)
const pio2_1 = 1.57079632673412561417e0; // 0x3FF921FB, 0x54400000 (first 33 bits of pi/2)
const pio2_1t = 6.07710050650619224932e-11; // 0x3DD0B461, 0x1A626331 (pi/2 - pio2_1)
const pio2_2 = 6.07710050630396597660e-11; // 0x3DD0B461, 0x1A600000 (second 33 bits of pi/2)
const pio2_2t = 2.02226624879595063154e-21; // 0x3BA3198A, 0x2E037073 (pi/2 - (pio2_1 + pio2_2))
const pio2_3 = 2.02226624871116645580e-21; // 0x3BA3198A, 0x2E000000 (third 33 bits of pi/2)
const pio2_3t = 8.47842766036889956997e-32; // 0x397B839A, 0x252049C1 (pi/2 - (pio2_1 + pio2_2 + pio2_3))

// The two parts of the reduced argument, written by remPio2. A module-level slot pair keeps the
// reduction free of allocation.
let y0 = 0;
let y1 = 0;

/**
 * Reduces `x` to y0 + y1 = x - n * pi/2 in about [-pi/4, pi/4] and returns n. The caller has
 * handled |x| <= pi/4, infinity and NaN. Only the paths up to the medium size are ported:
 * upstream continues with `__kernel_rem_pio2` for |x| >= 2^20 * pi/2, which is not needed for
 * angles, so those arguments throw instead.
 */
function remPio2(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  // The branches that return are the cheap reductions by 1 to 4 multiples of pi/2. When an
  // argument is close to a multiple of pi/2 they would cancel badly, so those fall through to
  // the medium case below (upstream's `goto medium`).
  if (ix <= 0x400f6a7a) {
    // |x| ~<= 5pi/4
    if ((ix & 0xfffff) !== 0x921fb) {
      // not |x| ~= pi/2 or 2pi/2
      if (ix <= 0x4002d97c) {
        // |x| ~<= 3pi/4
        if (hx > 0) {
          const z = x - pio2_1; // one round good to 85 bits
          y0 = z - pio2_1t;
          y1 = (z - y0) - pio2_1t;
          return 1;
        }
        const z = x + pio2_1;
        y0 = z + pio2_1t;
        y1 = (z - y0) + pio2_1t;
        return -1;
      }
      if (hx > 0) {
        const z = x - 2 * pio2_1;
        y0 = z - 2 * pio2_1t;
        y1 = (z - y0) - 2 * pio2_1t;
        return 2;
      }
      const z = x + 2 * pio2_1;
      y0 = z + 2 * pio2_1t;
      y1 = (z - y0) + 2 * pio2_1t;
      return -2;
    }
  } else if (ix <= 0x401c463b) {
    // |x| ~<= 9pi/4
    if (ix <= 0x4015fdbc) {
      // |x| ~<= 7pi/4
      if (ix !== 0x4012d97c) {
        // not |x| ~= 3pi/2
        if (hx > 0) {
          const z = x - 3 * pio2_1;
          y0 = z - 3 * pio2_1t;
          y1 = (z - y0) - 3 * pio2_1t;
          return 3;
        }
        const z = x + 3 * pio2_1;
        y0 = z + 3 * pio2_1t;
        y1 = (z - y0) + 3 * pio2_1t;
        return -3;
      }
    } else if (ix !== 0x401921fb) {
      // not |x| ~= 4pi/2
      if (hx > 0) {
        const z = x - 4 * pio2_1;
        y0 = z - 4 * pio2_1t;
        y1 = (z - y0) - 4 * pio2_1t;
        return 4;
      }
      const z = x + 4 * pio2_1;
      y0 = z + 4 * pio2_1t;
      y1 = (z - y0) + 4 * pio2_1t;
      return -4;
    }
  } else if (ix >= 0x413921fb) {
    // |x| >= 2^20 * (pi/2): upstream's large-argument path, not ported
    throw new RangeError(`dmath: sin and cos need |x| < 1647099, got ${x}`);
  }
  // medium size: |x| ~< 2^20 * (pi/2)
  const fn = (x * invpio2 + 6755399441055744.0) - 6755399441055744.0; // rnint(x * invpio2)
  const n = fn | 0;
  let r = x - fn * pio2_1;
  let w = fn * pio2_1t; // 1st round good to 85 bits
  const j = ix >> 20;
  y0 = r - w;
  let i = j - ((highWord(y0) >>> 20) & 0x7ff);
  if (i > 16) {
    // 2nd iteration needed, good to 118 bits
    let t = r;
    w = fn * pio2_2;
    r = t - w;
    w = fn * pio2_2t - ((t - r) - w);
    y0 = r - w;
    i = j - ((highWord(y0) >>> 20) & 0x7ff);
    if (i > 49) {
      // 3rd iteration needed, 151 bits accuracy; covers all possible cases
      t = r;
      w = fn * pio2_3;
      r = t - w;
      w = fn * pio2_3t - ((t - r) - w);
      y0 = r - w;
    }
  }
  y1 = (r - y0) - w;
  return n;
}

/**
 * The sine of `x` in radians, the fdlibm algorithm. For angles: it needs |x| < 1647099 (just
 * under 2^20 * pi/2) and throws a RangeError for larger finite arguments. Infinity and NaN
 * give NaN.
 */
export function sin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  // |x| ~< pi/4
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e500000) {
      // |x| < 2^-26
      if ((x | 0) === 0) return x;
    }
    return kernelSin(x, 0, 0);
  }
  // sin(Inf or NaN) is NaN
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelSin(y0, y1, 1);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, 1);
    default:
      return -kernelCos(y0, y1);
  }
}

/**
 * The cosine of `x` in radians, the fdlibm algorithm. For angles: it needs |x| < 1647099
 * (just under 2^20 * pi/2) and throws a RangeError for larger finite arguments. Infinity and
 * NaN give NaN.
 */
export function cos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  // |x| ~< pi/4
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e46a09e) {
      // |x| < 2^-27 * sqrt(2)
      if ((x | 0) === 0) return 1.0;
    }
    return kernelCos(x, 0);
  }
  // cos(Inf or NaN) is NaN
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, 1);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, 1);
  }
}
