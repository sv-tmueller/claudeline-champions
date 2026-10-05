import {
  DEFAULT_ROUNDS_TO_WIN,
  EX_ENERGY_COST,
  MAX_ENERGY,
  ROUND_TICKS,
  SLOTS,
  ULTIMATE_ENERGY_COST,
  createMatch,
  parseArenaDef,
  type CastState,
  type MatchPhase,
  type MatchState,
} from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import {
  TIMER_TEXT,
  createRoundView,
  createSlotViews,
  readRoundView,
  readSlotViews,
  scoreIndex,
  scoreTexts,
  type RoundView,
  type SlotSource,
} from './hud-views';

function localChampion(): SlotSource {
  const state = createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'lumeth', team: 'B' },
        { championId: 'skerrow', team: 'B' },
      ],
    },
    parseArenaDef(arena01Json),
    1,
  );
  const champion = state.champions[0];
  if (!champion) throw new Error('no champion');
  return champion;
}

// The HUD reads these from the sim. The literals pin them to rules.md sections 1 to 3.
describe('HUD constants', () => {
  it('match rules.md sections 1 to 3', () => {
    expect(EX_ENERGY_COST).toBe(25);
    expect(ULTIMATE_ENERGY_COST).toBe(100);
    expect(MAX_ENERGY).toBe(100);
    expect(ROUND_TICKS).toBe(5400);
    expect(DEFAULT_ROUNDS_TO_WIN).toBe(3);
  });
});

/** A source with ready slots, the shape of a real champion. */
function source(overrides: Partial<SlotSource> = {}): SlotSource {
  return { energy: 0, cooldowns: [0, 0, 0, 0, 0, 0, 0], cast: null, ...overrides };
}

const WINDUP: CastState = { castId: 1, slot: 'Q', ex: false, windupTicks: 12, windupLeft: 12 };

describe('slot views', () => {
  it('creates seven views, one per slot', () => {
    expect(createSlotViews()).toHaveLength(SLOTS.length);
    expect(SLOTS).toEqual(['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F']);
  });

  it('reads every slot of a real champion as ready, F blocked below 100 energy', () => {
    const views = createSlotViews();
    const champion = localChampion();
    for (const energy of [0, 99]) {
      champion.energy = energy;
      readSlotViews(champion, views);
      expect(views.map((v) => v.seconds)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(views.map((v) => v.windup)).toEqual([false, false, false, false, false, false, false]);
      expect(views.map((v) => v.blocked)).toEqual([false, false, false, false, false, false, true]);
    }
    champion.energy = 100;
    readSlotViews(champion, views);
    expect(views.some((v) => v.blocked)).toBe(false);
  });

  it('shows the remaining cooldown in whole seconds, rounded up', () => {
    const views = createSlotViews();
    readSlotViews(source({ energy: 100, cooldowns: [61, 60, 1, 0, 120, 121, 599] }), views);
    expect(views.map((v) => v.seconds)).toEqual([2, 1, 1, 0, 2, 3, 10]);
  });

  it('dims every slot during a windup', () => {
    const views = createSlotViews();
    readSlotViews(source({ cast: WINDUP }), views);
    expect(views.every((v) => v.windup)).toBe(true);
    readSlotViews(source({ cast: null }), views);
    expect(views.some((v) => v.windup)).toBe(false);
  });

  it('keeps the identity of its view objects', () => {
    const views = createSlotViews();
    const before = [...views];
    readSlotViews(source({ cooldowns: [1, 2, 3, 4, 5, 6, 7] }), views);
    for (let i = 0; i < views.length; i++) expect(views[i]).toBe(before[i]);
  });

  it('reads a short cooldowns array as ready for the missing slots', () => {
    const views = createSlotViews();
    readSlotViews(source({ energy: 100, cooldowns: [90] }), views);
    expect(views.map((v) => v.seconds)).toEqual([2, 0, 0, 0, 0, 0, 0]);
  });
});

describe('round view', () => {
  function matchAt(phase: MatchPhase, phaseTicks: number, over: Partial<MatchState> = {}): { match: MatchState } {
    return {
      match: { phase, phaseTicks, round: 1, roundsToWin: 3, score: { A: 0, B: 0 }, ring: null, ...over },
    };
  }

  function read(state: { match?: MatchState }): RoundView {
    const view = createRoundView();
    readRoundView(state, view);
    return view;
  }

  function timer(phaseTicks: number): string {
    return TIMER_TEXT[read(matchAt('round', phaseTicks)).secondsLeft] as string;
  }

  it('starts at 0 : 0 with 90 seconds left, no sudden death, and a running timer', () => {
    expect(createRoundView()).toEqual({ scoreA: 0, scoreB: 0, secondsLeft: 90, suddenDeath: false, live: true });
  });

  it('reads a state without match flow as 0 : 0 and 90 seconds', () => {
    expect(read({})).toEqual({ scoreA: 0, scoreB: 0, secondsLeft: 90, suddenDeath: false, live: true });
  });

  it('shows the full round in the warmup, where the round clock has not started', () => {
    expect(read(matchAt('warmup', 0))).toMatchObject({ secondsLeft: 90, live: true, suddenDeath: false });
    expect(read(matchAt('warmup', 179))).toMatchObject({ secondsLeft: 90, live: true });
  });

  it('counts the timer down by the ticks of the round phase', () => {
    expect(timer(0)).toBe('1:30');
    expect(timer(59)).toBe('1:30');
    expect(timer(60)).toBe('1:29');
    expect(timer(5400 - 61)).toBe('0:02');
    expect(timer(5400 - 60)).toBe('0:01');
    expect(timer(5399)).toBe('0:01');
  });

  it('holds at 0:00 until the ring comes', () => {
    expect(timer(5400)).toBe('0:00');
    expect(timer(6000)).toBe('0:00');
  });

  it('reads sudden death from the ring, not from the clock', () => {
    const ring = { x: 0, y: 0, radius: 12, damagePerTick: 0.1 };
    expect(read(matchAt('round', 5400)).suddenDeath).toBe(false);
    expect(read(matchAt('round', 5401, { ring })).suddenDeath).toBe(true);
  });

  it('reads the score of the match', () => {
    const view = read(matchAt('roundEnd', 10, { score: { A: 2, B: 1 } }));
    expect([view.scoreA, view.scoreB]).toEqual([2, 1]);
  });

  it('stops the timer after the round and after the match', () => {
    expect(read(matchAt('roundEnd', 0)).live).toBe(false);
    expect(read(matchAt('matchEnd', 0)).live).toBe(false);
    expect(read(matchAt('round', 0)).live).toBe(true);
  });

  it('has a text for every whole second from 0 to 90', () => {
    expect(TIMER_TEXT).toHaveLength(91);
    expect(TIMER_TEXT[0]).toBe('0:00');
    expect(TIMER_TEXT[9]).toBe('0:09');
    expect(TIMER_TEXT[60]).toBe('1:00');
    expect(TIMER_TEXT[90]).toBe('1:30');
  });
});

describe('scoreTexts', () => {
  it.each([1, 3])('has one "a : b" text per score pair up to %i rounds to win', (roundsToWin) => {
    const texts = scoreTexts(roundsToWin);
    expect(texts).toHaveLength((roundsToWin + 1) ** 2);
    for (let a = 0; a <= roundsToWin; a++) {
      for (let b = 0; b <= roundsToWin; b++) expect(texts[scoreIndex(roundsToWin, a, b)], `${a} : ${b}`).toBe(`${a} : ${b}`);
    }
  });

  it('keeps 3 : 1 and 1 : 3 apart, so the two scores are not transposed', () => {
    expect(scoreTexts(3)[scoreIndex(3, 3, 1)]).toBe('3 : 1');
    expect(scoreTexts(3)[scoreIndex(3, 1, 3)]).toBe('1 : 3');
    expect(scoreTexts(1)[scoreIndex(1, 1, 0)]).toBe('1 : 0');
  });

  it('has no entry for a score past the rounds to win, so a caller falls back', () => {
    expect(scoreIndex(3, 4, 0)).toBe(-1);
    expect(scoreIndex(3, 0, 4)).toBe(-1);
    expect(scoreIndex(3, -1, 0)).toBe(-1);
    expect(scoreTexts(3)[scoreIndex(3, 4, 0)]).toBeUndefined();
  });
});
