import { createBot } from '@claudeline/bots';
import type { Difficulty as BotsDifficulty } from '@claudeline/bots';
import { DIFFICULTIES } from '@claudeline/protocol';
import type { Difficulty as WireDifficulty } from '@claudeline/protocol';
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_UNIONS_MATCH } from '../src/difficulty';
import type { SameUnion } from '../src/difficulty';

// The compile-time rows are checked by `tsc -p tsconfig.tools.json`: Vitest does not typecheck, so
// a missing @ts-expect-error fails the typecheck, not this file. Each declaration below must be an
// error, because the unions differ.

// @ts-expect-error: the bots package grew a tier the wire does not name
export const extraBotsTier: SameUnion<BotsDifficulty | 'brutal', WireDifficulty> = true;
// @ts-expect-error: the wire lost a tier the bots still have
export const missingWireTier: SameUnion<BotsDifficulty, Exclude<WireDifficulty, 'hard'>> = true;
// The same unions are the one row that compiles.
export const sameUnions: SameUnion<BotsDifficulty, WireDifficulty> = true;

describe('the two Difficulty unions', () => {
  it('are the same union (the declaration in src/difficulty.ts compiles only then)', () => {
    expect(DIFFICULTY_UNIONS_MATCH).toBe(true);
  });

  it('give every wire tier a bot', () => {
    for (const tier of DIFFICULTIES) {
      expect(() => createBot(0, tier, 1)).not.toThrow();
    }
  });

  it('refuse a tier the bots do not have', () => {
    expect(() => createBot(0, 'brutal' as never, 1)).toThrow();
  });
});
