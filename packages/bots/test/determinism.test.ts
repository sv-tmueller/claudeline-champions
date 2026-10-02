import { describe, expect, it } from 'vitest';
import { checksum } from '@claudeline/sim';
import type { Difficulty } from '../src/difficulty';
import { createRun, runMatch } from './helpers';

// No fixture and no checksum literal: bot output is only promised to be repeatable in one
// process (batch #32 decision 1). Everything here compares runs against each other in memory.
const TICKS = 1200;
const SEEDS = [101, 102, 103, 104];
const TIERS: Difficulty[] = ['easy', 'normal', 'hard', 'normal'];

describe('bot determinism within one process', () => {
  it('gives the same input stream and final checksum for the same seeds', () => {
    const a = runMatch(SEEDS, TIERS, TICKS);
    const b = runMatch(SEEDS, TIERS, TICKS);
    expect(a.inputs).toHaveLength(TICKS);
    expect(b.inputs).toEqual(a.inputs);
    expect(checksum(b.state)).toBe(checksum(a.state));
  });

  it('is not disturbed by another match stepped in between', () => {
    const alone = runMatch(SEEDS, TIERS, TICKS);
    const otherSeeds = [5, 6, 7, 8];
    const otherTiers: Difficulty[] = ['hard', 'hard', 'easy', 'easy'];
    const alsoAlone = runMatch(otherSeeds, otherTiers, TICKS);

    const first = createRun(SEEDS, TIERS);
    const second = createRun(otherSeeds, otherTiers);
    for (let t = 0; t < TICKS; t++) {
      first.advance();
      second.advance();
    }
    expect(first.inputs).toEqual(alone.inputs);
    expect(second.inputs).toEqual(alsoAlone.inputs);
    expect(checksum(first.state)).toBe(checksum(alone.state));
    expect(checksum(second.state)).toBe(checksum(alsoAlone.state));
  });

  it('gives different aim streams for different bot seeds', () => {
    const a = runMatch(SEEDS, TIERS, 600);
    const b = runMatch([201, 202, 203, 204], TIERS, 600);
    const aims = (inputs: typeof a.inputs) => inputs.map((tick) => tick.map((i) => [i.aimX, i.aimY]));
    expect(aims(b.inputs)).not.toEqual(aims(a.inputs));
  });

  it('does not depend on the match seed through the bot itself', () => {
    // The bots never read state.rng, so the same bots in a match with another seed make the
    // same decisions while the sim state is identical (no ability uses the rng yet).
    const a = runMatch(SEEDS, TIERS, 600, undefined, undefined, 7);
    const b = runMatch(SEEDS, TIERS, 600, undefined, undefined, 99);
    expect(b.inputs).toEqual(a.inputs);
  });
});
