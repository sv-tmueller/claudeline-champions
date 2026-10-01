import { describe, expect, it } from 'vitest';
import { checksum, cloneState, createMatch } from '../src/index';
import type { GameState } from '../src/index';
import { fnv1a32 } from '../src/checksum';
import { arena01, config2v2 } from './helpers';

function fresh(): GameState {
  return createMatch(config2v2(), arena01, 1337);
}

describe('fnv1a32', () => {
  it('matches the published vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
});

describe('checksum', () => {
  it('returns a uint32', () => {
    const sum = checksum(fresh());
    expect(Number.isInteger(sum)).toBe(true);
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(sum).toBeLessThanOrEqual(0xffffffff);
  });

  it('is the same for equal states', () => {
    expect(checksum(fresh())).toBe(checksum(fresh()));
  });

  it('ignores object key order', () => {
    const state = fresh();
    const reordered = JSON.parse(JSON.stringify(state)) as GameState;
    reordered.champions = reordered.champions.map(
      (c) => Object.fromEntries(Object.entries(c).reverse()) as typeof c,
    );
    reordered.arena = Object.fromEntries(Object.entries(reordered.arena).reverse()) as typeof reordered.arena;
    expect(checksum(reordered)).toBe(checksum(state));
  });

  it('changes when a champion field changes', () => {
    const state = fresh();
    const before = checksum(state);
    const champion = state.champions[1];
    if (!champion) throw new Error('missing champion');
    champion.x += 1e-9;
    expect(checksum(state)).not.toBe(before);
  });

  it('changes when the tick, the rng or the arena changes', () => {
    const base = checksum(fresh());
    const tick = fresh();
    tick.tick = 1;
    expect(checksum(tick)).not.toBe(base);
    const rng = fresh();
    rng.rng += 1;
    expect(checksum(rng)).not.toBe(base);
    const arena = fresh();
    const obstacle = arena.arena.obstacles[0];
    if (!obstacle) throw new Error('missing obstacle');
    obstacle.height += 1;
    expect(checksum(arena)).not.toBe(base);
  });

  it('depends on array order', () => {
    const state = fresh();
    state.champions.reverse();
    expect(checksum(state)).not.toBe(checksum(fresh()));
  });

  it('throws on NaN and infinity', () => {
    const nan = fresh();
    const champion = nan.champions[0];
    if (!champion) throw new Error('missing champion');
    champion.vx = NaN;
    expect(() => checksum(nan)).toThrow('non-finite');
    champion.vx = Infinity;
    expect(() => checksum(nan)).toThrow('non-finite');
  });

  it('throws on values that are not plain JSON', () => {
    const state = fresh() as unknown as { champions: Record<string, unknown>[] };
    const champion = state.champions[0];
    if (!champion) throw new Error('missing champion');
    champion['extra'] = undefined;
    expect(() => checksum(state as unknown as GameState)).toThrow('undefined');
    champion['extra'] = () => 1;
    expect(() => checksum(state as unknown as GameState)).toThrow('function');
    champion['extra'] = 1n;
    expect(() => checksum(state as unknown as GameState)).toThrow('bigint');
  });
});

describe('cloneState', () => {
  it('returns an equal copy with an equal checksum', () => {
    const state = fresh();
    const copy = cloneState(state);
    expect(copy).toEqual(state);
    expect(copy).not.toBe(state);
    expect(checksum(copy)).toBe(checksum(state));
  });

  it('is independent of the original', () => {
    const state = fresh();
    const before = checksum(state);
    const copy = cloneState(state);
    const champion = copy.champions[0];
    const obstacle = copy.arena.obstacles[0];
    if (!champion || !obstacle) throw new Error('missing data');
    champion.x = 99;
    obstacle.x = 99;
    copy.tick = 99;
    copy.arena.spawns.teamA.length = 0;
    expect(checksum(state)).toBe(before);
  });
});
