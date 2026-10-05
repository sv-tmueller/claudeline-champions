import { describe, expect, it } from 'vitest';
import { step } from '@claudeline/sim';
import { checkInvariants, createRun, createStallTracker, validInput } from './helpers';

const TICKS = 3600;

describe('stalls in a headless 2v2 match of bots', () => {
  it('no bot stalls for more than 120 ticks after a corner start', () => {
    const run = createRun([101, 102, 103, 104], ['easy', 'normal', 'hard', 'normal']);
    const { state, bots } = run;
    const lumeth = state.champions[2];
    const hargrim = state.champions[0];
    if (lumeth === undefined || hargrim === undefined) throw new Error('no champions');
    // Lumeth (hard, ranged) in the north-east corner, Hargrim 2.83 m away at the diagonal.
    lumeth.x = 14.4;
    lumeth.y = 9.4;
    hargrim.x = 12.4;
    hargrim.y = 7.4;
    const tracker = createStallTracker(state, bots);
    let farthest = 0;

    for (let t = 0; t < TICKS; t++) {
      const inputs = bots.map((bot) => bot.think(state));
      for (const input of inputs) expect(validInput(input), `tick ${t}`).toBe(true);
      tracker.observe(inputs);
      step(state, inputs);
      expect(checkInvariants(state)).toEqual([]);
      farthest = Math.max(farthest, Math.hypot(lumeth.x - 14.4, lumeth.y - 9.4));
      // The setup is live: the cornered bot acts on a kite decision once the delay has passed.
      if (t === 7) expect(bots[2]?.inspect().intent).toBe('kite');
    }

    // A bot that dithers on the spot never has a zero-move input: it has to leave the corner too.
    expect(farthest, 'distance Lumeth got from the corner').toBeGreaterThan(5);
    // It also ends away from the corner, not back in it.
    expect(
      Math.hypot(lumeth.x - 14.4, lumeth.y - 9.4),
      'final distance of Lumeth from the corner',
    ).toBeGreaterThan(5);
    const worst = tracker.worst();
    expect(
      worst.length,
      `champion ${worst.id} stalled from tick ${worst.from} for ${worst.length} ticks in ${worst.intent}`,
    ).toBeLessThanOrEqual(120);
  }, 30_000);
});
