import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/index';
import { arena01, champion, config2v2, legacyState } from './helpers';

describe('legacyState', () => {
  it('drops the dash field and leaves the original state alone', () => {
    const state = createMatch(config2v2(), arena01, 1);
    const projected = legacyState(state);
    for (const c of projected.champions) expect('dash' in c).toBe(false);
    expect(state.champions.every((c) => c.dash === null)).toBe(true);
  });

  it('rejects a state where a dropped field is not neutral', () => {
    const dashing = createMatch(config2v2(), arena01, 1);
    champion(dashing, 1).dash = { dirX: 1, dirY: 0, stepLength: 0.1, ticksLeft: 3 };
    expect(() => legacyState(dashing)).toThrow('champion 1 has a dash');

    const stunned = createMatch(config2v2(), arena01, 1);
    champion(stunned, 2).statuses.push({
      type: 'stun',
      sourceId: 0,
      slot: null,
      remainingTicks: 5,
    });
    expect(() => legacyState(stunned)).toThrow('champion 2 has statuses');
  });
});
