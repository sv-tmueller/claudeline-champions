import { checksum } from '@claudeline/sim';
import type { KitDef } from '@claudeline/sim';
import {
  EXPECTED,
  RosterCoverage,
  SEEDS,
  decodeFixture,
  mirrorConfig,
  play,
  playUnderOracle,
  startMatch,
} from '../../packages/sim/test/roster-fixture.ts';
import type { Action, Checkpoint, Fixture, Segment } from '../../packages/sim/test/roster-fixture.ts';
import { TICKS, playAttempt } from './player.ts';

/** The default number of attempts: about 10 to 20 ms each. */
export const DEFAULT_MAX_ATTEMPTS = 1000;

export interface Tried<T> {
  /** What the attempt still misses of the coverage; empty when it covers everything. */
  missing: string[];
  value: T;
}

export type Covering<T> =
  | { found: true; attempt: number; value: T }
  | { found: false; best: { attempt: number; missing: string[] } | null };

/**
 * Tries attempts 1, 2, 3 and so on up to `maxAttempts` and stops at the first that misses nothing,
 * never trying the next. When none does, `best` is the attempt that missed the fewest items (the
 * earlier one on a tie), or null when no attempt was tried.
 */
export function firstCovering<T>(tryAttempt: (attempt: number) => Tried<T>, maxAttempts: number): Covering<T> {
  let best: { attempt: number; missing: string[] } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tried = tryAttempt(attempt);
    if (tried.missing.length === 0) return { found: true, attempt, value: tried.value };
    if (best === null || tried.missing.length < best.missing.length) best = { attempt, missing: tried.missing };
  }
  return { found: false, best };
}

export type Outcome<F> =
  | { ok: true; attempt: number; fixture: F }
  | { ok: false; reason: 'oracle'; attempt: number; problems: string[] }
  | { ok: false; reason: 'exhausted'; attempts: number; best: { attempt: number; missing: string[] } | null };

/**
 * The search: the first attempt that covers everything is replayed by `verify`, and an oracle
 * problem there ends the search with that attempt named, so no later attempt is tried. That is a
 * drop for the tuning rules, not a skip.
 */
export function settle<T, F>(
  tryAttempt: (attempt: number) => Tried<T>,
  verify: (value: T, attempt: number) => { problems: string[]; fixture: F },
  maxAttempts: number,
): Outcome<F> {
  const covering = firstCovering(tryAttempt, maxAttempts);
  if (!covering.found) return { ok: false, reason: 'exhausted', attempts: maxAttempts, best: covering.best };
  const { problems, fixture } = verify(covering.value, covering.attempt);
  if (problems.length > 0) return { ok: false, reason: 'oracle', attempt: covering.attempt, problems };
  return { ok: true, attempt: covering.attempt, fixture };
}

/**
 * The fixture of a script on the kit: the script is replayed with the shared loop for the oracle
 * problems, for what the coverage misses and for the checkpoints at every 100 ticks and the final
 * checksum, which are the values the roster fixture test compares.
 */
export function buildFixture(
  kit: KitDef,
  segments: Segment[],
  actions: Action[],
): { fixture: Fixture; missing: string[]; problems: string[] } {
  const expected = EXPECTED[kit.id];
  const seed = SEEDS[kit.id];
  if (expected === undefined || seed === undefined) throw new Error(`no EXPECTED or SEEDS entry for ${kit.id}`);
  const fixture: Fixture = {
    format: 1,
    arena: 'arena01',
    seed,
    config: mirrorConfig(kit.id),
    ticks: TICKS,
    segments,
    actions,
    checkpoints: [],
    checksum: 0,
  };
  const { problems } = playUnderOracle(fixture, startMatch(fixture, kit));
  const coverage = new RosterCoverage();
  const checkpoints: Checkpoint[] = [];
  const end = play(fixture, startMatch(fixture, kit), 0, {
    beforeStep: (s) => coverage.before(s),
    afterStep: (s) => {
      coverage.after(s);
      if (s.tick % 100 === 0) checkpoints.push({ tick: s.tick, checksum: checksum(s) });
    },
  });
  fixture.checkpoints = checkpoints;
  fixture.checksum = checksum(end);
  decodeFixture(fixture, kit.id);
  return { fixture, missing: coverage.missing(expected), problems };
}

/**
 * Searches for the scripted roster fixture of a kit: attempts 1, 2, 3 and so on of the seeded
 * player, the first that covers everything the roster fixture test requires, replayed for the
 * checkpoints. Throws when the kit has no EXPECTED or no SEEDS entry in roster-fixture.ts.
 */
export function searchFixture(kit: KitDef, options: { maxAttempts?: number } = {}): Outcome<Fixture> {
  if (EXPECTED[kit.id] === undefined) {
    throw new Error(`kit ${kit.id} has no EXPECTED entry; add it to packages/sim/test/roster-fixture.ts first`);
  }
  if (SEEDS[kit.id] === undefined) {
    throw new Error(`kit ${kit.id} has no SEEDS entry; add it to packages/sim/test/roster-fixture.ts first`);
  }
  return settle(
    (attempt) => {
      const played = playAttempt(kit, attempt);
      return { missing: played.missing, value: played };
    },
    (played, attempt) => {
      const built = buildFixture(kit, played.segments, played.actions);
      if (built.missing.length > 0) {
        throw new Error(
          `internal error: attempt ${attempt} covered everything live but its replay misses ${built.missing.join(', ')}`,
        );
      }
      return { problems: built.problems, fixture: built.fixture };
    },
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  );
}
