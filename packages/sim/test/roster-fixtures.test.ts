// Scripted roster fixtures: one per kit, `scripted-roster-hargrim-arena01-2v2.json`,
// `scripted-roster-quillon-arena01-2v2.json`, `scripted-roster-skerrow-arena01-2v2.json` and
// `scripted-roster-lumeth-arena01-2v2.json`.
//
// Each fixture runs 2400 ticks on arena01 with the kit of `data/kits/<id>.json` for all four
// champions (a mirror: two on team A, two on team B), so one kit meets itself in every exchange.
// Its inputs are in the format of the ability fixture: a segment holds its inputs for `ticks` ticks,
// and an entry is [moveX, moveY, aimX, aimY, buttons], or null for a missing input. The only
// `actions` are `setEnergy` (`championId`, `energy`), run when `state.tick === tick`, before that
// tick's step: energy cannot be earned fast enough to reach an EX variant or an F at chosen moments,
// and it is the one thing the script writes outside `step`, in a test only. `checkpoints` hold the
// checksum of the whole state, `state.kits` included, after the step that makes `state.tick` equal
// to `tick`; `checksum` is the one after the last tick. There is no `legacyState` projection: these
// fixtures are new, so a change to a kit file moves every checkpoint from the first one a cast
// reaches.
//
// How the committed scripts were generated: a seeded random player (the policy of
// `scripted-abilities-arena01-2v2.json`, see the header of `abilities.test.ts`) tried one attempt
// after another until a run satisfied every item of the coverage test below with no oracle problem.
// The search script is not committed; the script it produced is the data. It used mulberry32 seeded
// with the attempt number (1, 2, 3 and so on) and ran the mirror config of the fixture for 2400
// ticks. Match seed 5555 for Hargrim, 5556 for Quillon, 5557 for Lumeth and 5558 for Skerrow.
// Attempt 1 was the first to cover everything for Hargrim, attempt 23 the first for Quillon,
// attempt 6 the first for Skerrow and attempt 2 the first for Lumeth (attempts 1 to 22, 1 to 5 and
// 1 each missed an item of the coverage test, and none had an oracle problem); each one's output is
// that fixture's segments and actions exactly.
//
// The player. The abilities header leaves draw-level detail open, so this is the order the
// committed Hargrim, Quillon and Skerrow fixtures fix. The player was written again from that
// header (the original script is not committed either, nor is the rebuild: it lives in a
// git-ignored directory), and it reproduces Hargrim attempt 1, Quillon attempt 23 and Skerrow
// attempt 6 byte for byte, the whole file, which is what makes this record exact. The Lumeth search
// ran that player unchanged. At the start of a tick, for each champion in id order (a dead one too)
// whose window ran out, from the state before that tick's step, it draws in this order: (1) the
// length, 5 + floor(rnd * 14) ticks; (2) a flag, where below 0.3 the target is a random living
// enemy and otherwise the nearest one (a tie goes to the lower id); (3) the random enemy index,
// floor(rnd * living enemies), drawn in every window and used only when the flag was below 0.3; (4)
// the random ally index, floor(rnd * living allies other than the champion), drawn in every window
// and used only by an ally aim; (5) the aim kind, where below 0.6 aims at the target, below 0.8 at
// the ally, below 0.92 at a uniform point (two more draws, x = -14 + 28 * rnd and then
// y = -9 + 18 * rnd, in meters) and otherwise at the champion itself; a kind with nobody to aim at
// (no living enemy, no living ally) falls through to the next one that applies, so an ally kind
// with no living ally becomes the uniform point; the aim is then rounded to whole centimeters as
// Math.round(meters * 100), which takes no draw; (6) the walk: one draw, where below 0.45 walks
// along the axes toward the aim point (away from it when within 3.5 m, per axis only when more than
// 0.5 m off, with no more draws), below 0.70 takes a uniform axis in each of x and y (two more
// draws, floor(rnd * 3) - 1, x first) and otherwise stands, with no more draws; (7) seven button
// draws for M1, M2, SPACE, Q, E, R, F against 0.5, 0.3, 0.2, 0.3, 0.3, 0.15, 0.3, then one for
// SHIFT against 0.3; (8) one draw for a `setEnergy` action against 0.2, and when it is taken the
// champion, floor(rnd * 4), and then the energy, [0, 24, 25, 98, 99, 100, 60][floor(rnd * 7)], both
// at the current tick. Three details the steps leave open, as the rebuilt player does them: (a) a
// segment starts at every tick where any window starts, and a segment whose inputs equal the one
// before it is merged into it; of the three earlier fixtures, only Skerrow's shows this, at tick
// 352, where champion 3's window restarts at 355 with the same inputs, so cuts of 3 and 2 ticks
// make one segment of 5; Hargrim and Quillon reproduce with or without merging, but a player that
// never merges misses Skerrow by one segment; (b) "within 3.5 m" is the Euclidean distance from the
// champion to the rounded aim point, strictly below 3.5; a Manhattan distance fails all three
// fixtures, but the rounded or unrounded aim point and a bound of below or at 3.5 each reproduce
// all three, so they cannot tell those readings apart, and the Lumeth search used the rounded point
// and the strict bound; (c) the enemy and ally indices count living champions in id order, and
// counting the dead too or counting in reverse fails all three. Flipping any one of these choices
// (the order of the uniform point, centimeter rounding, allies including the champion, the energy
// order, the ally threshold, a walk that always draws its axes) changes the winning Skerrow
// segments within the first 90 ticks.
//
// The checksums were then generated as for the other fixtures: set every checksum to 0, run
// `npx vitest run --project sim packages/sim/test/roster-fixtures.test.ts`, copy the actual values
// from the failing checkpoint and checksum assertions into the fixture, and rerun until it is green.
// Changing a number in `data/kits/<id>.json` on purpose means changing `docs/design/roster-v1.md`
// and regenerating that kit's checksums the same way in the same change (the search need not run
// again unless the coverage test fails).
//
// "Replay once in a separate process" is met by the committed checksums, which the authoring run
// produced, plus every CI run that replays them again, on Linux x86 as well as on a Mac.
import { describe, expect, it } from 'vitest';
import hargrimFixtureJson from './fixtures/scripted-roster-hargrim-arena01-2v2.json';
import quillonFixtureJson from './fixtures/scripted-roster-quillon-arena01-2v2.json';
import skerrowFixtureJson from './fixtures/scripted-roster-skerrow-arena01-2v2.json';
import lumethFixtureJson from './fixtures/scripted-roster-lumeth-arena01-2v2.json';
import hargrimJson from '../../../data/kits/hargrim.json';
import quillonJson from '../../../data/kits/quillon.json';
import skerrowJson from '../../../data/kits/skerrow.json';
import lumethJson from '../../../data/kits/lumeth.json';
import { checksum, cloneState } from '../src/index';
import type { GameState } from '../src/index';
import { validateKit } from '../src/kit';
import {
  EXPECTED,
  RosterCoverage,
  SEEDS,
  decodeFixture,
  play as playFixture,
  playUnderOracle,
  startMatch,
} from './roster-fixture';
import type { Checkpoint, Expected, Fixture, Observer } from './roster-fixture';

interface Subject {
  name: string;
  kit: ReturnType<typeof validateKit>;
  fixture: Fixture;
}

const SUBJECTS: Subject[] = [
  { name: 'hargrim', kit: validateKit(hargrimJson), fixture: decodeFixture(hargrimFixtureJson, 'hargrim') },
  { name: 'quillon', kit: validateKit(quillonJson), fixture: decodeFixture(quillonFixtureJson, 'quillon') },
  { name: 'skerrow', kit: validateKit(skerrowJson), fixture: decodeFixture(skerrowFixtureJson, 'skerrow') },
  { name: 'lumeth', kit: validateKit(lumethJson), fixture: decodeFixture(lumethFixtureJson, 'lumeth') },
];

describe.each(SUBJECTS)('scripted $name fixture', ({ name, kit, fixture }) => {
  /** Plays the fixture from `state` (at tick `from`) to the end. */
  function play(state: GameState, from = 0, observer: Observer = {}): GameState {
    return playFixture(fixture, state, from, observer);
  }

  function start(): GameState {
    return startMatch(fixture, kit);
  }

  it('uses the kit of its data file and its own match seed', () => {
    expect(start().kits).toStrictEqual([kit]);
    expect(fixture.seed).toBe(SEEDS[name]);
    expect(fixture.ticks).toBe(2400);
  });

  it('keeps every oracle after every action and every step', () => {
    const { steps, problems } = playUnderOracle(fixture, start());
    expect(steps).toBe(fixture.ticks);
    expect(problems).toEqual([]);
  });

  it('exercises everything the plan requires', () => {
    const coverage = new RosterCoverage();
    play(start(), 0, {
      beforeStep: (s) => coverage.before(s),
      afterStep: (s) => coverage.after(s),
    });
    expect(coverage.missing(EXPECTED[name] as Expected)).toEqual([]);
  });

  it('matches the committed checkpoints', () => {
    const actual: Checkpoint[] = [];
    play(start(), 0, {
      afterStep: (s) => {
        if (s.tick % 100 === 0) actual.push({ tick: s.tick, checksum: checksum(s) });
      },
    });
    expect(actual).toEqual(fixture.checkpoints);
  });

  it('reproduces the committed checksum', () => {
    expect(checksum(play(start()))).toBe(fixture.checksum);
  });

  it('gives the same checksum when replayed twice in one process', () => {
    expect(checksum(play(start()))).toBe(checksum(play(start())));
  });

  it('continues identically from a clone taken during a windup with live statuses and entities', () => {
    let copy: GameState | undefined;
    let cloneTick = -1;
    const original = play(start(), 0, {
      beforeTick: (s) => {
        const winding = s.champions.some((c) => c.cast !== null);
        const statuses = s.champions.some((c) => c.statuses.length > 0);
        const entities = s.projectiles.length > 0 || s.areas.length > 0;
        if (!copy && winding && statuses && entities && s.casts.length >= 2) {
          copy = cloneState(s);
          cloneTick = s.tick;
        }
      },
    });
    expect(copy).toBeDefined();
    if (!copy) return;
    expect(copy.champions.some((c) => c.cast !== null)).toBe(true);
    expect(checksum(play(copy, cloneTick))).toBe(checksum(original));
  });
});
