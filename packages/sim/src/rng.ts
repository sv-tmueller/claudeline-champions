// mulberry32. The state is a wrapped uint32 so it survives a JSON round trip.
export function nextRandom(holder: { rng: number }): number {
  const a = (holder.rng + 0x6d2b79f5) >>> 0;
  holder.rng = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
