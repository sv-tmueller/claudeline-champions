// The text of the canvas data hooks and of the HUD, made once at startup. A change
// write that builds its string (String(n), a template, toFixed) leaves garbage on
// the frame path, which the heap probes of e2e/combat.spec.ts (a steady state) and
// e2e/live-probe.spec.ts (the live match, where the hooks change in every window)
// count. Each table here replaces such a formatter, and each function falls back to
// the formatter past the end of its table, so a value outside the range is only
// slower, never wrong. hook-text.test.ts checks every entry against the formatter
// it replaces.

/** The integer table covers 0 to this minus 1: ten minutes of ticks. */
export const INT_TEXT_COUNT = 36_000;
const INT_TEXT: string[] = [];
for (let n = 0; n < INT_TEXT_COUNT; n++) INT_TEXT.push(String(n));

/** The text of an integer: the tick, the round and the counts. */
export function intText(n: number): string {
  return INT_TEXT[n] ?? String(n);
}

/** The signed centimetre table covers -limit to limit, a 40 m arena either way. */
export const CM_TEXT_LIMIT = 2000;
const CM_TEXT: string[] = [];
for (let cm = -CM_TEXT_LIMIT; cm <= CM_TEXT_LIMIT; cm++) CM_TEXT.push(String(cm));

/** The text of a position in whole centimetres. */
export function cmText(cm: number): string {
  return CM_TEXT[cm + CM_TEXT_LIMIT] ?? String(cm);
}

/** A facing in milliradians: pi is 3142 of them. */
export const FACING_KEY_LIMIT = 3142;
const FACING_TEXT: string[] = [];
for (let key = -FACING_KEY_LIMIT; key <= FACING_KEY_LIMIT; key++) FACING_TEXT.push((key / 1000).toFixed(3));

/** The key a facing is guarded and tabled by: whole milliradians. */
export function facingKey(facing: number): number {
  return Math.round(facing * 1000);
}

/** The text of a facing key, in radians with three decimals. */
export function facingText(key: number): string {
  return FACING_TEXT[key + FACING_KEY_LIMIT] ?? (key / 1000).toFixed(3);
}

// Hidden is index 0 and 0 to 100 percent follow.
const PERCENT_TEXT: string[] = ['x'];
for (let percent = 0; percent <= 100; percent++) PERCENT_TEXT.push(String(percent));

/** The text of a bar's fill percent: "x" for a hidden bar (any negative percent). */
export function percentText(percent: number): string {
  if (percent < 0) return PERCENT_TEXT[0] as string;
  return PERCENT_TEXT[percent + 1] ?? String(percent);
}

/** The decimetre table covers 0 to this minus 1: a ring or a distance up to 99.9 m. */
export const DM_TEXT_COUNT = 1000;
const DM_TEXT: string[] = [];
for (let dm = 0; dm < DM_TEXT_COUNT; dm++) DM_TEXT.push(`${(dm / 10).toFixed(1)} m`);

/** The text of a length in whole decimetres, in metres with one decimal: "12.4 m". */
export function dmText(dm: number): string {
  return DM_TEXT[dm] ?? `${(dm / 10).toFixed(1)} m`;
}
