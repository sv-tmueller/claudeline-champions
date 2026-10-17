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
  type StatusInstance,
  type MatchState,
} from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import {
  TIMER_TEXT,
  createRingView,
  createShieldView,
  createRoundView,
  createSlotViews,
  primeStatusReads,
  readRingView,
  readRoundView,
  readShieldView,
  readSlotViews,
  scoreIndex,
  scoreTexts,
  type RingView,
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
  return { energy: 0, cooldowns: [0, 0, 0, 0, 0, 0, 0], cast: null, statuses: [], ...overrides };
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

function status(type: StatusInstance['type'], extra: Record<string, number> = {}): StatusInstance {
  return { type, sourceId: 3, slot: null, remainingTicks: 60, ...extra } as StatusInstance;
}

describe('silence in the slot views', () => {
  it('starts every view not silenced', () => {
    expect(createSlotViews().some((v) => v.silenced)).toBe(false);
  });

  it('marks all seven slots silenced while any silence status exists, and none after', () => {
    const views = createSlotViews();
    readSlotViews(source({ statuses: [status('slow', { percent: 20 }), status('silence')] }), views);
    expect(views.map((v) => v.silenced)).toEqual([true, true, true, true, true, true, true]);
    readSlotViews(source({ statuses: [] }), views);
    expect(views.some((v) => v.silenced)).toBe(false);
  });

  it('is not triggered by the other statuses', () => {
    const views = createSlotViews();
    const others = [
      status('stun'),
      status('root'),
      status('invulnerable'),
      status('slow', { percent: 30 }),
      status('haste', { percent: 20 }),
      status('shield', { absorb: 40 }),
      status('dot', { perPulse: 4, ticksToNextPulse: 10 }),
      status('hot', { perPulse: 4, ticksToNextPulse: 10 }),
    ];
    readSlotViews(source({ statuses: others }), views);
    expect(views.some((v) => v.silenced)).toBe(false);
  });

  it('leaves blocked to the energy gate alone', () => {
    const views = createSlotViews();
    readSlotViews(source({ energy: 100, statuses: [status('silence')] }), views);
    expect(views.some((v) => v.blocked)).toBe(false);
    readSlotViews(source({ energy: 0, statuses: [] }), views);
    expect(views.map((v) => v.blocked)).toEqual([false, false, false, false, false, false, true]);
  });
});

describe('shield view', () => {
  it('starts at 0', () => {
    expect(createShieldView()).toEqual({ absorb: 0 });
  });

  it('reads 0 without a shield', () => {
    const view = createShieldView();
    readShieldView(source({ statuses: [status('haste', { percent: 20 }), status('silence')] }), view);
    expect(view.absorb).toBe(0);
    readShieldView(source(), view);
    expect(view.absorb).toBe(0);
  });

  it('reads the absorb of one shield', () => {
    const view = createShieldView();
    readShieldView(source({ statuses: [status('shield', { absorb: 40 })] }), view);
    expect(view.absorb).toBe(40);
  });

  it('adds the shields, as the sim stacks them', () => {
    const view = createShieldView();
    const statuses = [status('shield', { absorb: 40 }), status('slow', { percent: 20 }), status('shield', { absorb: 15 })];
    readShieldView(source({ statuses }), view);
    expect(view.absorb).toBe(55);
  });

  it('rounds a fraction up, like the health', () => {
    const view = createShieldView();
    readShieldView(source({ statuses: [status('shield', { absorb: 31.2 })] }), view);
    expect(view.absorb).toBe(32);
    readShieldView(source({ statuses: [status('shield', { absorb: 0.2 })] }), view);
    expect(view.absorb).toBe(1);
  });

  it('rounds each shield up before it adds them', () => {
    const view = createShieldView();
    readShieldView(source({ statuses: [status('shield', { absorb: 0.5 }), status('shield', { absorb: 0.5 })] }), view);
    expect(view.absorb).toBe(2);
  });

  it('forgets the last read: a fresh read starts from nothing', () => {
    const view = createShieldView();
    readShieldView(source({ statuses: [status('shield', { absorb: 40 })] }), view);
    readShieldView(source({ statuses: [status('shield', { absorb: 10 })] }), view);
    expect(view.absorb).toBe(10);
  });

  it('reads a real champion after a shield cast as the kit absorb', () => {
    const champion = localChampion();
    champion.statuses.push(status('shield', { absorb: 40 }));
    const view = createShieldView();
    readShieldView(champion, view);
    expect(view.absorb).toBe(40);
  });
});

describe('priming the status readers', () => {
  it('runs at startup and leaves the readers with nothing of its own', () => {
    primeStatusReads();
    const views = createSlotViews();
    const shield = createShieldView();
    readSlotViews(source(), views);
    readShieldView(source(), shield);
    expect(views.some((v) => v.silenced)).toBe(false);
    expect(shield.absorb).toBe(0);
    readSlotViews(source({ statuses: [status('silence')] }), views);
    readShieldView(source({ statuses: [status('shield', { absorb: 7 })] }), shield);
    expect(views.every((v) => v.silenced)).toBe(true);
    expect(shield.absorb).toBe(7);
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

describe('ring view', () => {
  const RING_X = 0;
  const RING_Y = 0;

  type RingState = { match?: MatchState; champions: { x: number; y: number; alive: boolean }[] };

  function matchAt(phase: MatchPhase, phaseTicks: number, radius: number | null): RingState & { match: MatchState } {
    return {
      match: {
        phase,
        phaseTicks,
        round: 1,
        roundsToWin: 3,
        score: { A: 0, B: 0 },
        ring: radius === null ? null : { x: RING_X, y: RING_Y, radius, damagePerTick: 1 / 6 },
      },
      champions: [{ x: -12, y: 2, alive: true }],
    };
  }

  function read(state: RingState): RingView {
    const view = createRingView();
    readRingView(state, 0, view);
    return view;
  }

  const HIDDEN: RingView = { visible: false, countdown: 0, radiusDm: 0, distanceDm: 0, outside: false };

  it('starts hidden', () => {
    expect(createRingView()).toEqual(HIDDEN);
  });

  it('is hidden in the warmup, the round end and the match end, and without match flow', () => {
    expect(read(matchAt('warmup', 5399, null))).toEqual(HIDDEN);
    expect(read(matchAt('roundEnd', 10, 18))).toEqual(HIDDEN);
    expect(read(matchAt('matchEnd', 0, 18))).toEqual(HIDDEN);
    expect(read({ champions: [{ x: 0, y: 0, alive: true }] })).toEqual(HIDDEN);
  });

  it('is hidden in a round until 600 ticks are left', () => {
    expect(read(matchAt('round', 0, null))).toEqual(HIDDEN);
    expect(read(matchAt('round', 4799, null))).toEqual(HIDDEN);
  });

  it('counts down from 10 at 600 ticks left to 1 at 1 tick left', () => {
    expect(read(matchAt('round', 4800, null))).toMatchObject({ visible: true, countdown: 10, outside: false });
    expect(read(matchAt('round', 4859, null)).countdown).toBe(10);
    expect(read(matchAt('round', 4860, null)).countdown).toBe(9);
    expect(read(matchAt('round', 5399, null))).toMatchObject({ visible: true, countdown: 1 });
  });

  it('still shows 1 on the one tick between the last second and the ring, which the next step creates', () => {
    // The sim creates the ring in the step that starts at 5400 phase ticks, so a frame between
    // can read 5400 phase ticks with no ring yet.
    expect(read(matchAt('round', 5400, null))).toMatchObject({ visible: true, countdown: 1 });
  });

  it('shows no radius or distance while it counts down', () => {
    expect(read(matchAt('round', 5000, null))).toMatchObject({ radiusDm: 0, distanceDm: 0 });
  });

  it('shows the ring radius in decimetres, rounded, and no countdown once the ring exists', () => {
    expect(read(matchAt('round', 5400, 18))).toMatchObject({ visible: true, countdown: 0, radiusDm: 180 });
    expect(read(matchAt('round', 5500, 17.04))).toMatchObject({ radiusDm: 170 });
    expect(read(matchAt('round', 5500, 17.05))).toMatchObject({ radiusDm: 171 });
    expect(read(matchAt('round', 5500, 17.049999))).toMatchObject({ radiusDm: 170 });
  });

  it('reads the radius from the ring of the match, not the starting radius of the arena', () => {
    expect(read(matchAt('round', 6000, 9.3)).radiusDm).toBe(93);
  });

  it('is inside, with its distance to the edge, while the champion is within the radius', () => {
    // The champion stands at (-12, 2): 12.166 m from the centre, 5.83 m inside an 18 m ring.
    const view = read(matchAt('round', 5400, 18));
    expect(view.outside).toBe(false);
    expect(view.distanceDm).toBe(58);
  });

  it('is outside, with the distance past the edge, once the radius passes the champion', () => {
    const view = read(matchAt('round', 6200, 12));
    expect(view.outside).toBe(true);
    expect(view.distanceDm).toBe(2);
  });

  it('counts a champion exactly on the radius as inside, like the sim', () => {
    const state = matchAt('round', 5400, 5);
    state.champions[0] = { x: 3, y: 4, alive: true };
    expect(read(state).outside).toBe(false);
    state.champions[0] = { x: 3, y: 4.0001, alive: true };
    expect(read(state).outside).toBe(true);
  });

  it('never shows a dead champion as outside', () => {
    const state = matchAt('round', 6200, 12);
    state.champions[0] = { x: -12, y: 2, alive: false };
    expect(read(state)).toMatchObject({ visible: true, radiusDm: 120, outside: false, distanceDm: 0 });
  });

  it('refills the view it is given, back to hidden when the round ends', () => {
    const view = createRingView();
    readRingView(matchAt('round', 5400, 18), 0, view);
    expect(view.visible).toBe(true);
    readRingView(matchAt('roundEnd', 0, 18), 0, view);
    expect(view).toEqual(HIDDEN);
  });
});
