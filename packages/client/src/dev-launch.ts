/** The largest `?timescale` the dev launch honours. */
export const MAX_TIME_SCALE = 200;

/** What the page address asks for beyond the match, in a dev build only. */
export interface DevLaunch {
  /** How many sim ticks run per tick's worth of wall time, 1 to `MAX_TIME_SCALE`. */
  timeScale: number;
}

const PLAIN_INTEGER = /^[1-9][0-9]*$/;

/**
 * Reads the dev-only parameters of the address. `?timescale=<n>` runs the sim
 * `n` times faster, so an e2e spec plays a whole match in a few dozen frames.
 * Only a plain integer from 1 to `MAX_TIME_SCALE` counts; anything else reads
 * as 1. `main.ts` calls this only as `import.meta.env.DEV ? readDevLaunch(...)`,
 * so a production build drops the module and has no time scale.
 */
export function readDevLaunch(search: string): DevLaunch {
  const asked = new URLSearchParams(search).get('timescale') ?? '';
  const scale = PLAIN_INTEGER.test(asked) ? Number(asked) : 1;
  return { timeScale: scale <= MAX_TIME_SCALE ? scale : 1 };
}

/**
 * The keys of the address that start a match without the pre-match select, in
 * a dev build only: `?scene=sandbox` and `?timescale=<n>`. The names live here,
 * not in launch.ts, so the string never reaches a production file.
 * `main.ts` passes this list to `opensSelect` as
 * `import.meta.env.DEV ? DEV_LAUNCH_KEYS : []`.
 */
export const DEV_LAUNCH_KEYS: readonly string[] = ['scene', 'timescale'];
