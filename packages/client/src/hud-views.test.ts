import { SLOTS, createMatch, parseArenaDef } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import {
  EX_MARK,
  MAX_ENERGY,
  ROUNDS_TO_WIN,
  ROUND_TICKS,
  TIMER_TEXT,
  ULTIMATE_COST,
  createRoundView,
  createSlotViews,
  readRoundView,
  readSlotViews,
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

describe('HUD constants', () => {
  it('match rules.md sections 1 to 3', () => {
    expect(EX_MARK).toBe(25);
    expect(ULTIMATE_COST).toBe(100);
    expect(MAX_ENERGY).toBe(100);
    expect(ROUND_TICKS).toBe(5400);
    expect(ROUNDS_TO_WIN).toBe(3);
  });
});

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
    readSlotViews({ energy: 100, cooldowns: [61, 60, 1, 0, 120, 121, 599] }, views);
    expect(views.map((v) => v.seconds)).toEqual([2, 1, 1, 0, 2, 3, 10]);
  });

  it('dims every slot during a windup', () => {
    const views = createSlotViews();
    readSlotViews({ energy: 0, cast: { slot: 'Q' } }, views);
    expect(views.every((v) => v.windup)).toBe(true);
    readSlotViews({ energy: 0, cast: null }, views);
    expect(views.some((v) => v.windup)).toBe(false);
  });

  it('reads a source without cooldowns or cast as ready', () => {
    const views = createSlotViews();
    readSlotViews({ energy: 100, cooldowns: [5, 5, 5, 5, 5, 5, 5], cast: {} }, views);
    readSlotViews({ energy: 100 }, views);
    expect(views.map((v) => v.seconds)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(views.some((v) => v.windup)).toBe(false);
  });

  it('keeps the identity of its view objects', () => {
    const views = createSlotViews();
    const before = [...views];
    readSlotViews({ energy: 0, cooldowns: [1, 2, 3, 4, 5, 6, 7] }, views);
    for (let i = 0; i < views.length; i++) expect(views[i]).toBe(before[i]);
  });

  it('reads a short cooldowns array as ready for the missing slots', () => {
    const views = createSlotViews();
    readSlotViews({ energy: 100, cooldowns: [90] }, views);
    expect(views.map((v) => v.seconds)).toEqual([2, 0, 0, 0, 0, 0, 0]);
  });
});

describe('round view', () => {
  function timer(tick: number): string {
    const view = createRoundView();
    readRoundView({ tick }, view);
    return TIMER_TEXT[view.secondsLeft] as string;
  }

  it('starts at 0 : 0 with 90 seconds left', () => {
    const view = createRoundView();
    readRoundView({ tick: 0 }, view);
    expect(view).toEqual({ scoreA: 0, scoreB: 0, secondsLeft: 90 });
  });

  it('counts the timer down by tick', () => {
    expect(timer(0)).toBe('1:30');
    expect(timer(59)).toBe('1:30');
    expect(timer(60)).toBe('1:29');
    expect(timer(5400 - 61)).toBe('0:02');
    expect(timer(5400 - 60)).toBe('0:01');
    expect(timer(5399)).toBe('0:01');
  });

  it('holds at 0:00', () => {
    expect(timer(5400)).toBe('0:00');
    expect(timer(6000)).toBe('0:00');
  });

  it('has a text for every whole second from 0 to 90', () => {
    expect(TIMER_TEXT).toHaveLength(91);
    expect(TIMER_TEXT[0]).toBe('0:00');
    expect(TIMER_TEXT[9]).toBe('0:09');
    expect(TIMER_TEXT[60]).toBe('1:00');
    expect(TIMER_TEXT[90]).toBe('1:30');
  });
});
