import {
  DEFAULT_ROUNDS_TO_WIN,
  parseArenaDef,
  step,
  type ArenaDef,
  type GameState,
  type KitDef,
  type MatchConfig,
  type PlayerInput,
} from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import arena02Json from '../../../data/arenas/arena02.json';
import { createBotDriver } from './bot-driver';
import type { Launch } from './launch';
import { LOCAL_SEED, createLocalMatch, playableTeamSize } from './match-setup';
import { HARGRIM_KIT, QUILLON_KIT, TEST_KITS } from './test-kits';

const arena = parseArenaDef(arena01Json);
const arena02 = parseArenaDef(arena02Json);
// The tick budget of e2e/match-end.spec.ts for the default match to its result screen.
const MATCH_END_BUDGET_TICKS = 15_000;

function launch(champion: string, scene: Launch['scene'] = 'match'): Launch {
  return { scene, champion, difficulty: 'normal', arena: 'arena01', teamSize: 2 };
}

function launch3(champion: string, arenaId = 'arena01'): Launch {
  return { scene: 'match', champion, difficulty: 'normal', arena: arenaId, teamSize: 3 };
}

// The kit of a roster id the test kits do not load, so a pick of it still builds a match.
const SKERROW_KIT: KitDef = { ...QUILLON_KIT, id: 'skerrow' };

// The 3v3 of the bots package, copied from packages/bots/test/headless-kits.test.ts, function
// config3v3 (lines 31 to 43 on 9612bff; docs/architecture/bots.md names it too). The client cannot
// import a bots test, so the Hargrim pick must equal this literal by an assertion, not by import.
const BOTS_CONFIG_3V3: MatchConfig = {
  teamSize: 3,
  players: [
    { championId: 'hargrim', team: 'A' },
    { championId: 'quillon', team: 'A' },
    { championId: 'quillon', team: 'A' },
    { championId: 'hargrim', team: 'B' },
    { championId: 'quillon', team: 'B' },
    { championId: 'quillon', team: 'B' },
  ],
};

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

  describe('3v3', () => {
    it('plays the 3v3 of the bots package for the hargrim pick', () => {
      const { state } = createLocalMatch(launch3('hargrim'), arena, TEST_KITS);
      expect(state.champions.map((c) => ({ championId: c.championId, team: c.team }))).toEqual(BOTS_CONFIG_3V3.players);
    });

    it('gives the quillon pick the hargrim and a quillon ally against the same enemy row', () => {
      const { state } = createLocalMatch(launch3('quillon'), arena, TEST_KITS);
      expect(state.champions.map((c) => [c.championId, c.team])).toEqual([
        ['quillon', 'A'],
        ['hargrim', 'A'],
        ['quillon', 'A'],
        ['hargrim', 'B'],
        ['quillon', 'B'],
        ['quillon', 'B'],
      ]);
    });

    it('gives a pick outside the enemy row two quillon allies', () => {
      const { state } = createLocalMatch(launch3('skerrow'), arena, [...TEST_KITS, SKERROW_KIT]);
      expect(state.champions.filter((c) => c.team === 'A').map((c) => c.championId)).toEqual(['skerrow', 'quillon', 'quillon']);
      expect(state.champions.filter((c) => c.team === 'B').map((c) => c.championId)).toEqual(['hargrim', 'quillon', 'quillon']);
    });

    it('makes champions 1 to 5 bots and leaves champion 0 to the human', () => {
      expect(createLocalMatch(launch3('hargrim'), arena, TEST_KITS).botIds).toEqual([1, 2, 3, 4, 5]);
    });

    it('stands the three of each team on the three spawns of arena01, team B mirrored', () => {
      const { state } = createLocalMatch(launch3('hargrim'), arena, TEST_KITS);
      expect(state.champions.map((c) => [c.x, c.y])).toEqual([
        [-12, 2],
        [-12, -2],
        [-12, 0],
        [12, 2],
        [12, -2],
        [12, 0],
      ]);
    });

    it('stands the three of each team on the three spawns of arena02, team B mirrored', () => {
      const { state } = createLocalMatch(launch3('hargrim', 'arena02'), arena02, TEST_KITS);
      expect(state.champions.map((c) => [c.x, c.y])).toEqual([
        [-11, 2],
        [-11, -2],
        [-12.5, 0],
        [11, 2],
        [11, -2],
        [12.5, 0],
      ]);
      expect(state.arena.id).toBe('arena02');
    });

    it('plays 2v2 on an arena with two spawns on one team, where the sim would throw', () => {
      const twoSpawns: ArenaDef = { ...arena, spawns: { teamA: arena.spawns.teamA, teamB: arena.spawns.teamB.slice(0, 2) } };
      const { state, botIds } = createLocalMatch(launch3('hargrim'), twoSpawns, TEST_KITS);
      expect(state.champions.map((c) => [c.championId, c.team])).toEqual([
        ['hargrim', 'A'],
        ['quillon', 'A'],
        ['hargrim', 'B'],
        ['quillon', 'B'],
      ]);
      expect(botIds).toEqual([1, 2, 3]);
    });
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

    it('stays 2v2 when the launch asks for 3v3', () => {
      const asked: Launch = { ...launch('hargrim', 'sandbox'), teamSize: 3 };
      const { state, botIds } = createLocalMatch(asked, arena, TEST_KITS);
      expect(state.champions).toHaveLength(4);
      expect(botIds).toEqual([3]);
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
  teamSize: 2 | 3 = 2,
): { state: GameState; winner: string | undefined; matchEnded: number } {
  const { state, botIds } = createLocalMatch({ ...launch('hargrim'), arena: played.id, teamSize }, played, TEST_KITS, roundsToWin);
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
    `integration ${teamSize}v${teamSize} match on ${played.id} (${roundsToWin} to win): matchEnd at tick ${state.tick}, round ${state.match?.round}, score ${score?.A} : ${score?.B}, in ${Date.now() - started} ms`,
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
  // (the console line above reports its end tick, and every bots change moves it):
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

// The tick budget of the arena02 row of e2e/match-end.spec.ts: the end tick of this match
// when the budget was set, plus two rounds of about 1000 ticks and one sudden-death round
// of about 7000, rounded up to 1000. The end tick was 3474 on the bots of #86 and is 4198 on
// those of #98 (the dash hold shortened the first two rounds of the live match, and lengthened
// this one); every bots change moves it, the console line above reports the current one, and a
// match that ends past the budget fails here before the e2e does.
const ARENA02_END_TICK = 4198;
const ARENA02_BUDGET_TICKS = 14_000;

describe('a match of bots on arena02', () => {
  it('ends the match to 3 rounds with a winner on 3 within the budget of the e2e', { timeout: 60_000 }, () => {
    const { state, winner, matchEnded } = playToTheEnd(DEFAULT_ROUNDS_TO_WIN, ARENA02_BUDGET_TICKS, arena02);
    expect(state.match?.phase).toBe('matchEnd');
    expect(matchEnded).toBe(1);
    expect(state.match?.score[winner as 'A' | 'B']).toBe(DEFAULT_ROUNDS_TO_WIN);
    expect(state.tick).toBeLessThanOrEqual(ARENA02_BUDGET_TICKS);
    expect(ARENA02_BUDGET_TICKS).toBe(Math.ceil((ARENA02_END_TICK + 2 * 1000 + 7000) / 1000) * 1000);
  });
});

describe('playableTeamSize', () => {
  const spawns3 = { teamA: [[0, 0], [0, 1], [0, 2]], teamB: [[1, 0], [1, 1], [1, 2]] } as ArenaDef['spawns'];

  it('plays 3v3 when asked on an arena with three spawns per team', () => {
    expect(playableTeamSize(3, { spawns: spawns3 })).toBe(3);
    expect(playableTeamSize(3, arena)).toBe(3);
    expect(playableTeamSize(3, arena02)).toBe(3);
  });

  it('plays 2v2 when asked, whatever the arena has', () => {
    expect(playableTeamSize(2, { spawns: spawns3 })).toBe(2);
  });

  it('plays 2v2 when either team has two spawns', () => {
    expect(playableTeamSize(3, { spawns: { teamA: spawns3.teamA.slice(0, 2), teamB: spawns3.teamB } })).toBe(2);
    expect(playableTeamSize(3, { spawns: { teamA: spawns3.teamA, teamB: spawns3.teamB.slice(0, 2) } })).toBe(2);
  });
});

// The tick budgets of the 3v3 rows of e2e/match-end.spec.ts: the end tick of the match when the
// budget was set (measured through this setup and the client's bot driver on 57dd52f, the bots of
// #98; 10631 and 7119 on 9612bff), plus two rounds and one sudden-death round of about 7000,
// rounded up to 1000. The round term is 1600, the longest non-sudden 3v3 round measured (1557
// ticks, arena02, on both), where the 2v2 rows assume 1000. arena01: ceil((12431 + 2 * 1600 +
// 7000) / 1000) * 1000 = 23000. arena02: ceil((7125 + 2 * 1600 + 7000) / 1000) * 1000 = 18000.
// Every bots change moves the end tick, the console line reports the current one, and a match
// that ends past the budget fails here before the e2e does.
const THREE_V_THREE_ROUND_TICKS = 1600;
const ARENA01_3V3_END_TICK = 12_431;
const ARENA01_3V3_BUDGET_TICKS = 23_000;
const ARENA02_3V3_END_TICK = 7125;
const ARENA02_3V3_BUDGET_TICKS = 18_000;

describe('a 3v3 match of bots from setup to the result', () => {
  it('ends on arena01 with a winner on 3 within the budget of the e2e', { timeout: 120_000 }, () => {
    const { state, winner, matchEnded } = playToTheEnd(DEFAULT_ROUNDS_TO_WIN, ARENA01_3V3_BUDGET_TICKS, arena, 3);
    expect(state.champions).toHaveLength(6);
    expect(state.match?.phase).toBe('matchEnd');
    expect(matchEnded).toBe(1);
    expect(state.match?.score[winner as 'A' | 'B']).toBe(DEFAULT_ROUNDS_TO_WIN);
    expect(state.tick).toBeLessThanOrEqual(ARENA01_3V3_BUDGET_TICKS);
    expect(ARENA01_3V3_BUDGET_TICKS).toBe(
      Math.ceil((ARENA01_3V3_END_TICK + 2 * THREE_V_THREE_ROUND_TICKS + 7000) / 1000) * 1000,
    );
  });

  it('ends on arena02, whose third spawns have not hosted a match before, within the budget of the e2e', { timeout: 120_000 }, () => {
    const { state, winner, matchEnded } = playToTheEnd(DEFAULT_ROUNDS_TO_WIN, ARENA02_3V3_BUDGET_TICKS, arena02, 3);
    expect(state.champions).toHaveLength(6);
    expect(state.match?.phase).toBe('matchEnd');
    expect(matchEnded).toBe(1);
    expect(state.match?.score[winner as 'A' | 'B']).toBe(DEFAULT_ROUNDS_TO_WIN);
    expect(state.tick).toBeLessThanOrEqual(ARENA02_3V3_BUDGET_TICKS);
    expect(ARENA02_3V3_BUDGET_TICKS).toBe(
      Math.ceil((ARENA02_3V3_END_TICK + 2 * THREE_V_THREE_ROUND_TICKS + 7000) / 1000) * 1000,
    );
  });
});
