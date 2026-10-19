import { describe, expect, it } from 'vitest';
import type { KitDef } from '@claudeline/sim';
import { EXPECTED, SEEDS } from '../../packages/sim/test/roster-fixture.ts';
import { loadKit } from './files.ts';
import { playAttempt } from './player.ts';
import { buildFixture, firstCovering, searchFixture, settle } from './search.ts';

/** An attempt that misses the given items, or nothing when the list is empty. */
function attempt(missing: string[]) {
  return { missing, value: `value of ${missing.join('+') || 'cover'}` };
}

describe('firstCovering', () => {
  it('returns the first attempt that misses nothing, starting at 1, and never tries the next', () => {
    const tried: number[] = [];
    const found = firstCovering((n) => {
      tried.push(n);
      return attempt(n < 3 ? ['castFired M1/false'] : []);
    }, 10);
    expect(found).toEqual({ found: true, attempt: 3, value: 'value of cover' });
    expect(tried).toEqual([1, 2, 3]);
  });

  it('takes attempt 1 when it covers', () => {
    const tried: number[] = [];
    const found = firstCovering((n) => {
      tried.push(n);
      return attempt([]);
    }, 10);
    expect(found).toMatchObject({ found: true, attempt: 1 });
    expect(tried).toEqual([1]);
  });

  it('reports the attempt that missed the fewest items when none covers, the earlier one on a tie', () => {
    const misses = [['a', 'b', 'c'], ['a', 'b'], ['d'], ['e']];
    const found = firstCovering((n) => attempt(misses[n - 1] ?? []), 4);
    expect(found).toEqual({ found: false, best: { attempt: 3, missing: ['d'] } });
  });

  it('tries exactly maxAttempts attempts', () => {
    const tried: number[] = [];
    const found = firstCovering((n) => {
      tried.push(n);
      return attempt(['x']);
    }, 5);
    expect(tried).toEqual([1, 2, 3, 4, 5]);
    expect(found).toEqual({ found: false, best: { attempt: 1, missing: ['x'] } });
  });

  it('finds nothing and no best attempt when the limit is zero', () => {
    expect(firstCovering(() => attempt([]), 0)).toEqual({ found: false, best: null });
  });
});

describe('settle', () => {
  it('replays the first covering attempt and returns its fixture', () => {
    const verified: string[] = [];
    const outcome = settle(
      (n) => attempt(n < 2 ? ['x'] : []),
      (value) => {
        verified.push(value);
        return { problems: [], fixture: `fixture of ${value}` };
      },
      10,
    );
    expect(outcome).toEqual({ ok: true, attempt: 2, fixture: 'fixture of value of cover' });
    expect(verified).toEqual(['value of cover']);
  });

  it('fails on an oracle problem of the covering attempt, names it and tries no later one', () => {
    const tried: number[] = [];
    const outcome = settle(
      (n) => {
        tried.push(n);
        return attempt(n < 2 ? ['x'] : []);
      },
      () => ({ problems: ['tick 5: energy 101', 'tick 9: negative cooldown'], fixture: 'unused' }),
      10,
    );
    expect(outcome).toEqual({
      ok: false,
      reason: 'oracle',
      attempt: 2,
      problems: ['tick 5: energy 101', 'tick 9: negative cooldown'],
    });
    expect(tried).toEqual([1, 2]);
  });

  it('fails with the best attempt when none covers within the limit', () => {
    const outcome = settle(
      (n) => attempt(n === 2 ? ['only one'] : ['one', 'two']),
      () => ({ problems: [], fixture: 'unused' }),
      3,
    );
    expect(outcome).toEqual({
      ok: false,
      reason: 'exhausted',
      attempts: 3,
      best: { attempt: 2, missing: ['only one'] },
    });
  });

  it('never replays an attempt that does not cover', () => {
    let replays = 0;
    settle(
      () => attempt(['x']),
      () => {
        replays++;
        return { problems: [], fixture: 'unused' };
      },
      4,
    );
    expect(replays).toBe(0);
  });
});

describe('searchFixture', () => {
  it('throws for a kit with no EXPECTED entry and names the file to edit', () => {
    expect(() => searchFixture({ id: 'nobody' } as KitDef, { maxAttempts: 1 })).toThrow(/nobody.*roster-fixture\.ts/s);
  });

  it('throws for a kit with an EXPECTED entry and no SEEDS entry', () => {
    EXPECTED.probe = { fired: [], gains: [], thens: [], statuses: [] };
    try {
      expect(SEEDS.probe).toBeUndefined();
      expect(() => searchFixture({ id: 'probe' } as KitDef, { maxAttempts: 1 })).toThrow(/SEEDS.*roster-fixture\.ts/s);
    } finally {
      delete EXPECTED.probe;
    }
  });

  it('throws for a kit with a SEEDS entry and no EXPECTED entry', () => {
    SEEDS.probe = 1;
    try {
      expect(() => searchFixture({ id: 'probe' } as KitDef, { maxAttempts: 1 })).toThrow(/EXPECTED.*roster-fixture\.ts/s);
    } finally {
      delete SEEDS.probe;
    }
  });

  it('reports exhaustion with the best attempt when the limit is too low', () => {
    const outcome = searchFixture(loadKit('quillon'), { maxAttempts: 3 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== 'exhausted') throw new Error('expected exhaustion');
    expect(outcome.attempts).toBe(3);
    expect(outcome.best?.missing.length).toBeGreaterThan(0);
  });
});

describe('the live run and the replay agree on the coverage', () => {
  // The tool reuses the shared RosterCoverage and EXPECTED rather than copying them; this pins that
  // the live run of the player misses exactly what the replay of its output misses.
  it.each([1, 2, 3, 4])('quillon attempt %i', (n) => {
    const kit = loadKit('quillon');
    const live = playAttempt(kit, n);
    expect(live.missing.length).toBeGreaterThan(0);
    expect(buildFixture(kit, live.segments, live.actions).missing).toEqual(live.missing);
  });
});
