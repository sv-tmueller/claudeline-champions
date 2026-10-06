import { describe, expect, it } from 'vitest';
import { arena01 } from './helpers';
import { sceneOf, walks } from './scenes';

// Skerrow waits for her opening: from 6 to 8 m with a clear shot, while Lunge has 2 to 90 ticks of
// cooldown left, an engaging Skerrow stands instead of walking in (and shoots her bolts from there).
// Past 90 ticks she walks in, so the stand stays inside the stall bound of 120 ticks; at a cooldown
// of 1 or 0 Lunge is ready and she closes to its band of 5 to 6 m. The edges are inclusive.
describe('the wait of Skerrow for Lunge', () => {
  const lunge = (distance: number, cooldown: number, options: Parameters<typeof sceneOf>[2] = {}) =>
    sceneOf('skerrow', distance, { ready: [], cooldown: { SPACE: cooldown }, ...options });

  it('stands from 6 to 8 m, edges included, and walks at 5.95 and 8.05 m', () => {
    for (const d of [6, 6.5, 7, 7.5, 8]) expect(walks(lunge(d, 50)), `at ${d} m`).toBe(false);
    for (const d of [5.95, 8.05]) expect(walks(lunge(d, 50)), `at ${d} m`).toBe(true);
  });

  it('stands at a Lunge cooldown of 2 to 90 ticks, edges included, and walks at 0, 1 and 91', () => {
    for (const cooldown of [2, 3, 45, 89, 90]) {
      expect(walks(lunge(7, cooldown)), `cooldown ${cooldown}`).toBe(false);
    }
    for (const cooldown of [0, 1, 91]) {
      expect(walks(lunge(7, cooldown)), `cooldown ${cooldown}`).toBe(true);
    }
  });

  it('walks in with a pillar between the champions, where the stand has no clear shot', () => {
    // 7 m apart along y = 0 with the pillar of arena01 (radius 1.5 at the origin) in between.
    const state = lunge(7, 50, { arena: arena01, me: [-3.5, 0], enemy: [3.5, 0] });
    expect(walks(state)).toBe(true);
    // The same distance on a clear lane stands.
    expect(walks(lunge(7, 50, { arena: arena01, me: [-3.5, 3], enemy: [3.5, 3] }))).toBe(false);
  });

  it('is a rule of Skerrow: a Hargrim, who also walks in at 7 m, does not stand with SPACE cooling down', () => {
    expect(walks(sceneOf('hargrim', 7, { ready: [], cooldown: { SPACE: 50 } }))).toBe(true);
  });

  it('is a stand of the engage intent only: a retreating Skerrow does not wait', () => {
    expect(walks(lunge(7, 50, { health: 0.2 }))).toBe(true);
  });

  it('walks at 3 m, which no stand covers: past rangeMax and short of the band', () => {
    expect(walks(lunge(3, 50))).toBe(true);
  });
});
