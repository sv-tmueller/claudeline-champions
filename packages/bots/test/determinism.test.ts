import { describe, expect, it } from 'vitest';
import { checksum } from '@claudeline/sim';
import type { Difficulty } from '../src/difficulty';
import { configMirror, configSkerrow, createRun, jsonKits, runMatch } from './helpers';
import { hargrimKit, quillonKit } from './kits';

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
    // One record per bot per tick: a stream of aliases would compare a few objects with themselves.
    expect(new Set(a.inputs.flat()).size).toBe(TICKS * 4);
    expect(new Set(b.inputs.flat()).size).toBe(TICKS * 4);
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

describe('bot determinism within one process, with kits', () => {
  const options = () => ({ config: configMirror(), kits: [hargrimKit(), quillonKit()] });
  const kitRun = (seeds: number[], tiers: Difficulty[], ticks: number, matchSeed = 7) =>
    runMatch(seeds, tiers, ticks, undefined, undefined, matchSeed, options());

  it('gives the same input stream, buttons included, and final checksum for the same seeds', () => {
    const a = kitRun(SEEDS, TIERS, TICKS);
    const b = kitRun(SEEDS, TIERS, TICKS);
    expect(a.inputs).toHaveLength(TICKS);
    expect(new Set(a.inputs.flat()).size).toBe(TICKS * 4);
    expect(new Set(b.inputs.flat()).size).toBe(TICKS * 4);
    expect(b.inputs).toEqual(a.inputs);
    expect(checksum(b.state)).toBe(checksum(a.state));
  });

  it('presses buttons, so the stream comparison is not vacuous', () => {
    const run = kitRun(SEEDS, TIERS, TICKS);
    const presses = run.inputs.flat().filter((input) => input.buttons !== 0).length;
    expect(presses).toBeGreaterThan(0);
  });

  it('is not disturbed by another match with another kit pair stepped in between', () => {
    const alone = kitRun(SEEDS, TIERS, TICKS);
    const otherSeeds = [5, 6, 7, 8];
    const otherTiers: Difficulty[] = ['hard', 'hard', 'easy', 'easy'];
    const swapped = () => ({ config: configMirror(), kits: [quillonKit(), hargrimKit()] });
    const otherAlone = runMatch(otherSeeds, otherTiers, TICKS, undefined, undefined, 7, swapped());

    const first = createRun(SEEDS, TIERS, 7, options());
    const second = createRun(otherSeeds, otherTiers, 7, swapped());
    for (let t = 0; t < TICKS; t++) {
      first.advance();
      second.advance();
    }
    expect(first.inputs).toEqual(alone.inputs);
    expect(second.inputs).toEqual(otherAlone.inputs);
    expect(checksum(first.state)).toBe(checksum(alone.state));
    expect(checksum(second.state)).toBe(checksum(otherAlone.state));
  });

  it('does not depend on the match seed through the bot itself', () => {
    // No ability of these kits draws from the sim's generator, and the bots never read it.
    const a = kitRun(SEEDS, TIERS, 1200, 7);
    const b = kitRun(SEEDS, TIERS, 1200, 99);
    expect(b.inputs).toEqual(a.inputs);
  });
});

describe('bot determinism within one process, with the shipped kits', () => {
  const options = () => ({ config: configMirror(), kits: jsonKits() });
  const jsonRun = (seeds: number[], tiers: Difficulty[], ticks: number, matchSeed = 7) =>
    runMatch(seeds, tiers, ticks, undefined, undefined, matchSeed, options());

  it('gives the same input stream, buttons included, and final checksum for the same seeds', () => {
    const a = jsonRun(SEEDS, TIERS, TICKS);
    const b = jsonRun(SEEDS, TIERS, TICKS);
    expect(a.inputs).toHaveLength(TICKS);
    expect(new Set(a.inputs.flat()).size).toBe(TICKS * 4);
    expect(b.inputs).toEqual(a.inputs);
    expect(checksum(b.state)).toBe(checksum(a.state));
    const presses = a.inputs.flat().filter((input) => input.buttons !== 0).length;
    expect(presses, 'the comparison presses buttons').toBeGreaterThan(0);
  });

  it('is not disturbed by a match on the test kits stepped in between', () => {
    const alone = jsonRun(SEEDS, TIERS, TICKS);
    const otherSeeds = [5, 6, 7, 8];
    const otherTiers: Difficulty[] = ['hard', 'hard', 'easy', 'easy'];
    const testKits = () => ({ config: configMirror(), kits: [hargrimKit(), quillonKit()] });
    const otherAlone = runMatch(otherSeeds, otherTiers, TICKS, undefined, undefined, 7, testKits());

    // The two matches are stepped in turn, and the same two bot objects of each stay in their match.
    const first = createRun(SEEDS, TIERS, 7, options());
    const second = createRun(otherSeeds, otherTiers, 7, testKits());
    for (let t = 0; t < TICKS; t++) {
      first.advance();
      second.advance();
    }
    expect(first.inputs).toEqual(alone.inputs);
    expect(second.inputs).toEqual(otherAlone.inputs);
    expect(checksum(first.state)).toBe(checksum(alone.state));
    expect(checksum(second.state)).toBe(checksum(otherAlone.state));
  });

  it('does not depend on the match seed through the bot itself', () => {
    const a = jsonRun(SEEDS, TIERS, 1200, 7);
    const b = jsonRun(SEEDS, TIERS, 1200, 99);
    expect(b.inputs).toEqual(a.inputs);
  });
});

describe('bot determinism within one process, with Skerrow', () => {
  const options = () => ({ config: configSkerrow(), kits: jsonKits() });
  const skerrowRun = (seeds: number[], tiers: Difficulty[], ticks: number, matchSeed = 7) =>
    runMatch(seeds, tiers, ticks, undefined, undefined, matchSeed, options());
  const NORMAL: Difficulty[] = ['normal', 'normal', 'normal', 'normal'];

  it('gives the same input stream, buttons included, and final checksum for the same seeds', () => {
    const a = skerrowRun(SEEDS, NORMAL, TICKS);
    const b = skerrowRun(SEEDS, NORMAL, TICKS);
    expect(a.inputs).toHaveLength(TICKS);
    // One record per bot per tick, so the comparison is not of a few aliased objects.
    expect(new Set(a.inputs.flat()).size).toBe(TICKS * 4);
    expect(new Set(b.inputs.flat()).size).toBe(TICKS * 4);
    expect(b.inputs).toEqual(a.inputs);
    expect(checksum(b.state)).toBe(checksum(a.state));
    const presses = a.inputs.flat().filter((input) => input.buttons !== 0).length;
    expect(presses, 'the comparison presses buttons').toBeGreaterThan(0);
  });

  it('is not disturbed by a match on the test kits stepped in between', () => {
    const alone = skerrowRun(SEEDS, NORMAL, TICKS);
    const otherSeeds = [5, 6, 7, 8];
    const otherTiers: Difficulty[] = ['hard', 'hard', 'easy', 'easy'];
    const testKits = () => ({ config: configMirror(), kits: [hargrimKit(), quillonKit()] });
    const otherAlone = runMatch(otherSeeds, otherTiers, TICKS, undefined, undefined, 7, testKits());

    const first = createRun(SEEDS, NORMAL, 7, options());
    const second = createRun(otherSeeds, otherTiers, 7, testKits());
    for (let t = 0; t < TICKS; t++) {
      first.advance();
      second.advance();
    }
    expect(first.inputs).toEqual(alone.inputs);
    expect(second.inputs).toEqual(otherAlone.inputs);
    expect(checksum(first.state)).toBe(checksum(alone.state));
    expect(checksum(second.state)).toBe(checksum(otherAlone.state));
  });

  it('does not depend on the match seed through the bot itself', () => {
    const a = skerrowRun(SEEDS, NORMAL, TICKS, 7);
    const b = skerrowRun(SEEDS, NORMAL, TICKS, 99);
    expect(b.inputs).toEqual(a.inputs);
  });
});
