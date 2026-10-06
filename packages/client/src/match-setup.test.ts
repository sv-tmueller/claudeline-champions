import { DEFAULT_ROUNDS_TO_WIN, parseArenaDef, step, type ArenaDef, type GameState, type KitDef, type PlayerInput } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import arena02Json from '../../../data/arenas/arena02.json';
import { createBotDriver } from './bot-driver';
import type { Launch } from './launch';
import { LOCAL_SEED, createLocalMatch } from './match-setup';
import { HARGRIM_KIT, QUILLON_KIT, TEST_KITS } from './test-kits';

const arena = parseArenaDef(arena01Json);
const arena02 = parseArenaDef(arena02Json);
// The tick budget of e2e/match-end.spec.ts for the default match to its result screen.
const MATCH_END_BUDGET_TICKS = 12_000;

function launch(champion: string, scene: Launch['scene'] = 'match'): Launch {
  return { scene, champion, difficulty: 'normal', arena: 'arena01' };
}

describe('createLocalMatch', () => {
  it('puts the pick on team A with an ally bot of the other kit and two enemy bots', () => {
    const { state, botIds } = createLocalMatch(launch('hargrim'), arena, TEST_KITS);
    expect(state.champions.map((c) => [c.championId, c.team])).toEqual([
      ['hargrim', 'A'],
      ['quillon', 'A'],
      ['hargrim', 'B'],
      ['quillon', 'B'],
    ]);
    expect(botIds).toEqual([1, 2, 3]);
  });

  it('gives the ally bot the hargrim kit when the pick is quillon', () => {
    const { state } = createLocalMatch(launch('quillon'), arena, TEST_KITS);
    expect(state.champions.map((c) => c.championId)).toEqual(['quillon', 'hargrim', 'hargrim', 'quillon']);
    expect(state.champions.map((c) => c.team)).toEqual(['A', 'A', 'B', 'B']);
  });

  it('keeps the human at champion 0 on the first team A spawn', () => {
    const { state } = createLocalMatch(launch('quillon'), arena, TEST_KITS);
    expect([state.champions[0]?.x, state.champions[0]?.y]).toEqual([-12, 2]);
  });

  it('stands the human on the first team A spawn of the arena it is given: arena02 is (-11, 2)', () => {
    const { state } = createLocalMatch({ ...launch('hargrim'), arena: 'arena02' }, arena02, TEST_KITS);
    expect([state.champions[0]?.x, state.champions[0]?.y]).toEqual([-11, 2]);
    expect(state.arena.id).toBe('arena02');
  });

  it('starts in the warmup of a match to 3 round wins', () => {
    const { state } = createLocalMatch(launch('hargrim'), arena, TEST_KITS);
    expect(state.match).toMatchObject({ phase: 'warmup', roundsToWin: 3, round: 0, score: { A: 0, B: 0 } });
    expect(DEFAULT_ROUNDS_TO_WIN).toBe(3);
  });

  it('takes the rounds to win from the argument', () => {
    const { state } = createLocalMatch(launch('hargrim'), arena, TEST_KITS, 1);
    expect(state.match?.roundsToWin).toBe(1);
  });

  it('takes the health from the kits', () => {
    const { state } = createLocalMatch(launch('hargrim'), arena, TEST_KITS);
    expect(state.champions.map((c) => c.maxHealth)).toEqual([160, 120, 160, 120]);
    expect(HARGRIM_KIT.maxHealth).toBe(160);
    expect(QUILLON_KIT.maxHealth).toBe(120);
  });

  it('seeds the match with the local seed', () => {
    const a = createLocalMatch(launch('hargrim'), arena, TEST_KITS).state;
    const b = createLocalMatch(launch('hargrim'), arena, TEST_KITS).state;
    expect(LOCAL_SEED).toBe(1);
    expect(a.rng).toBe(b.rng);
  });

  describe('the sandbox', () => {
    it('keeps the roster of the e2e specs: hargrim and quillon against lumeth and skerrow', () => {
      const { state, botIds } = createLocalMatch(launch('hargrim', 'sandbox'), arena, TEST_KITS);
      expect(state.champions.map((c) => [c.championId, c.team])).toEqual([
        ['hargrim', 'A'],
        ['quillon', 'A'],
        ['lumeth', 'B'],
        ['skerrow', 'B'],
      ]);
      expect(botIds).toEqual([3]);
      expect(state.match?.roundsToWin).toBe(3);
    });

    it('has exactly the two kits, so Lumeth and Skerrow stay without one', () => {
      const lumeth: KitDef = { ...HARGRIM_KIT, id: 'lumeth', maxHealth: 77 };
      const skerrow: KitDef = { ...QUILLON_KIT, id: 'skerrow', maxHealth: 66 };
      const { state } = createLocalMatch(launch('hargrim', 'sandbox'), arena, [...TEST_KITS, lumeth, skerrow]);
      expect(state.kits.map((kit) => kit.id)).toEqual(['hargrim', 'quillon']);
      expect(state.champions.map((c) => c.maxHealth)).toEqual([160, 120, 120, 120]);
    });

    it('ignores the pick of the launch', () => {
      const { state } = createLocalMatch(launch('quillon', 'sandbox'), arena, TEST_KITS);
      expect(state.champions[0]?.championId).toBe('hargrim');
    });

    it('fails when a kit it needs is not loaded', () => {
      expect(() => createLocalMatch(launch('hargrim', 'sandbox'), arena, [HARGRIM_KIT])).toThrow(/quillon/);
    });
  });
});

// The match through the client's own setup and driver. No browser: the human sends
// no input, as in the e2e specs that play a match to the end.
function playToTheEnd(
  roundsToWin: number,
  limit: number,
  played: ArenaDef = arena,
): { state: GameState; winner: string | undefined; matchEnded: number } {
  const { state, botIds } = createLocalMatch({ ...launch('hargrim'), arena: played.id }, played, TEST_KITS, roundsToWin);
  const driver = createBotDriver(botIds, 'normal', LOCAL_SEED);
  const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
  let matchEnded = 0;
  let winner: string | undefined;
  const started = Date.now();
  while (state.match?.phase !== 'matchEnd' && state.tick < limit) {
    driver.think(state, inputs);
    step(state, inputs);
    for (const event of state.events) {
      if (event.type === 'matchEnded') {
        matchEnded++;
        winner = event.winner;
      }
    }
  }
  // The run time and tick count are reported in the pull request.
  const score = state.match?.score;
  console.log(
    `integration match on ${played.id} (${roundsToWin} to win): matchEnd at tick ${state.tick}, round ${state.match?.round}, score ${score?.A} : ${score?.B}, in ${Date.now() - started} ms`,
  );
  return { state, winner, matchEnded };
}

describe('a match of bots from setup to the result', () => {
  it('ends in matchEnd with one winner whose score is the rounds to win', { timeout: 60_000 }, () => {
    const { state, winner, matchEnded } = playToTheEnd(1, 30_000);
    expect(state.match?.phase).toBe('matchEnd');
    expect(matchEnded).toBe(1);
    const score = state.match?.score;
    expect(winner === 'A' || winner === 'B').toBe(true);
    expect(score?.[winner as 'A' | 'B']).toBe(1);
    for (const champion of state.champions) {
      expect(Number.isFinite(champion.x) && Number.isFinite(champion.y), `champion ${champion.id}`).toBe(true);
    }
  });

  // The source of the tick budget of e2e/match-end.spec.ts, which plays this match in
  // a browser at a time scale. The budget is a margin over this deterministic match
  // (the console line below reports its end tick, and every bots change moves it):
  // two more rounds and one sudden-death round. A bots change past it fails here first.
  it('ends the match to 3 rounds with a winner on 3 within the budget of the e2e', { timeout: 60_000 }, () => {
    const { state, winner, matchEnded } = playToTheEnd(DEFAULT_ROUNDS_TO_WIN, MATCH_END_BUDGET_TICKS);
    expect(state.match?.phase).toBe('matchEnd');
    expect(matchEnded).toBe(1);
    const score = state.match?.score;
    expect(score?.[winner as 'A' | 'B']).toBe(DEFAULT_ROUNDS_TO_WIN);
    expect(Math.max(score?.A ?? 0, score?.B ?? 0)).toBe(DEFAULT_ROUNDS_TO_WIN);
    expect(state.tick).toBeLessThanOrEqual(MATCH_END_BUDGET_TICKS);
  });
});

// The tick budget of the arena02 row of e2e/match-end.spec.ts. Measured below as the
// end tick of this match, plus two rounds of about 1000 ticks and one sudden-death
// round of about 7000, rounded up to 1000. Tick 3474 on main's bots (every bots change moves it, and this test fails first).
const ARENA02_END_TICK = 3474;
const ARENA02_BUDGET_TICKS = 13_000;

describe('a match of bots on arena02', () => {
  it('ends the match to 3 rounds with a winner on 3, at the tick the e2e budget is built from', { timeout: 60_000 }, () => {
    const { state, winner, matchEnded } = playToTheEnd(DEFAULT_ROUNDS_TO_WIN, ARENA02_BUDGET_TICKS, arena02);
    expect(state.match?.phase).toBe('matchEnd');
    expect(matchEnded).toBe(1);
    expect(state.match?.score[winner as 'A' | 'B']).toBe(DEFAULT_ROUNDS_TO_WIN);
    expect(state.tick).toBe(ARENA02_END_TICK);
    expect(ARENA02_BUDGET_TICKS).toBe(Math.ceil((ARENA02_END_TICK + 2 * 1000 + 7000) / 1000) * 1000);
  });
});
