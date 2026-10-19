import { describe, expect, it } from 'vitest';
import { checksum, step } from '@claudeline/sim';
import type { Intent } from '../src/intent';
import { checkInvariants, createRun, createStallTracker, stallMessage, validInput } from './helpers';

const TICKS = 3600;
const LOW_HEALTH_TICK = 1800;

describe('headless 2v2 match of bots', () => {
  it('runs 3600 ticks with every invariant intact and every bot active', () => {
    const run = createRun([101, 102, 103, 104], ['easy', 'normal', 'hard', 'normal']);
    const { state, bots } = run;
    const spawns = state.champions.map((c) => ({ x: c.x, y: c.y }));
    const travelled = state.champions.map(() => 0);
    const farthest = state.champions.map(() => 0);
    const lastIntent: Intent[] = bots.map(() => 'idle');
    const seen = bots.map(() => new Set<Intent>());
    let intentChanges = 0;
    const tracker = createStallTracker(state, bots);

    for (let t = 0; t < TICKS; t++) {
      if (t === LOW_HEALTH_TICK) {
        for (const id of [1, 2]) {
          const c = state.champions[id];
          if (c) c.health = 0.2 * c.maxHealth;
        }
      }
      const before = checksum(state);
      const inputs = bots.map((bot) => {
        const input = bot.think(state);
        expect(checksum(state), `tick ${t}`).toBe(before);
        return input;
      });
      for (const input of inputs) expect(validInput(input), `tick ${t}`).toBe(true);
      tracker.observe(inputs);

      const previous = state.champions.map((c) => ({ x: c.x, y: c.y }));
      step(state, inputs);

      expect(checkInvariants(state)).toEqual([]);
      expect(Number.isFinite(checksum(state))).toBe(true);
      state.champions.forEach((c, i) => {
        const p = previous[i];
        const s = spawns[i];
        if (!p || !s) return;
        travelled[i] = (travelled[i] ?? 0) + Math.hypot(c.x - p.x, c.y - p.y);
        farthest[i] = Math.max(farthest[i] ?? 0, Math.hypot(c.x - s.x, c.y - s.y));
      });
      bots.forEach((bot, i) => {
        const intent = bot.inspect().intent;
        seen[i]?.add(intent);
        const was = lastIntent[i];
        if (was !== undefined && was !== 'idle' && intent !== 'idle' && intent !== was) {
          intentChanges++;
        }
        lastIntent[i] = intent;
      });
    }

    state.champions.forEach((c, i) => {
      expect(travelled[i], `champion ${c.id} travelled`).toBeGreaterThan(3);
      expect(farthest[i], `champion ${c.id} left its spawn`).toBeGreaterThan(1);
      const intents = seen[i];
      expect(intents?.size, `champion ${c.id} intents`).toBeGreaterThan(0);
      expect([...(intents ?? [])].some((intent) => intent !== 'idle')).toBe(true);
    });
    expect(intentChanges).toBeGreaterThanOrEqual(2);
    expect(seen[1]?.has('retreat')).toBe(true);
    expect(seen[2]?.has('retreat')).toBe(true);
    expect(state.tick).toBe(TICKS);
    const worst = tracker.worst();
    expect(
      worst.length,
      stallMessage(worst),
    ).toBeLessThanOrEqual(120);
  }, 30_000);
});
