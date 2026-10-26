import type { Difficulty as BotsDifficulty } from '@claudeline/bots';
import type { Difficulty as WireDifficulty } from '@claudeline/protocol';

// protocol cannot import bots, so it declares its own difficulty union (online design section 3).
// One-way assignment would miss a new bots tier. The server sees both packages, so it pins them
// together: the declaration below compiles only while each union is assignable to the other.

/**
 * `true` only when A and B are the same union. Each side is wrapped in a one-element tuple: a bare
 * `A extends B` is distributive over a union, gives `boolean` when only some members match, and
 * `true` would still compile.
 */
export type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const DIFFICULTY_UNIONS_MATCH: SameUnion<BotsDifficulty, WireDifficulty> = true;
