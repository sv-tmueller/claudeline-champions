export interface Rng {
  /** A float in [0, 1). */
  next(): number;
}

// mulberry32, copied from the sim: the sim's generator is not exported, and a bot must own
// its PRNG so it never touches `state.rng`.
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
