import { DEFAULT_ROUNDS_TO_WIN, parseArenaDef, step, type KitDef, type PlayerInput } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createBotDriver } from './bot-driver';
import type { Launch } from './launch';
import { LOCAL_SEED, createLocalMatch } from './match-setup';
import { HARGRIM_KIT, QUILLON_KIT, TEST_KITS } from './test-kits';

const arena = parseArenaDef(arena01Json);

function launch(champion: string, scene: Launch['scene'] = 'match'): Launch {
  return { scene, champion, difficulty: 'normal' };
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

// The match through the client's own setup and driver, with one round to win so
// it ends quickly. No browser: the human sends no input, as in the e2e sandbox.
describe('a match of bots from setup to the result', () => {
  it('ends in matchEnd with one winner whose score is the rounds to win', { timeout: 60_000 }, () => {
    const { state, botIds } = createLocalMatch(launch('hargrim'), arena, TEST_KITS, 1);
    const driver = createBotDriver(botIds, 'normal', LOCAL_SEED);
    const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
    let matchEnded = 0;
    let winner: string | undefined;
    const started = Date.now();
    const limit = 30_000;
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
    console.log(`integration match: matchEnd at tick ${state.tick} in ${Date.now() - started} ms`);
    expect(state.match?.phase).toBe('matchEnd');
    expect(matchEnded).toBe(1);
    const score = state.match?.score;
    expect(winner === 'A' || winner === 'B').toBe(true);
    expect(score?.[winner as 'A' | 'B']).toBe(1);
    for (const champion of state.champions) {
      expect(Number.isFinite(champion.x) && Number.isFinite(champion.y), `champion ${champion.id}`).toBe(true);
    }
  });
});
