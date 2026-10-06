import { TICK_RATE } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_FRAME, STEP_MS, createFixedStepClock } from './loop';

describe('fixed-step clock', () => {
  it('has the step length of the sim tick rate', () => {
    expect(STEP_MS).toBeCloseTo(1000 / TICK_RATE, 12);
  });

  it.each([30, 60, 144])('steps exactly 60 times per second at %i fps', (fps) => {
    const clock = createFixedStepClock();
    let total = 0;
    for (let i = 0; i <= 3 * fps; i++) {
      const steps = clock.advance((i * 1000) / fps);
      expect(steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
      total += steps;
      if (i > 0 && i % fps === 0) expect(total).toBe(60 * (i / fps));
    }
  });

  it('steps exactly twice per frame at 30 fps', () => {
    const clock = createFixedStepClock();
    clock.advance(0);
    for (let i = 1; i <= 90; i++) expect(clock.advance((i * 1000) / 30)).toBe(2);
  });

  it('returns 0 for the first call, which only stores the timestamp', () => {
    const clock = createFixedStepClock();
    expect(clock.advance(123_456)).toBe(0);
    expect(clock.alpha).toBe(0);
  });

  it('returns 0 for a timestamp that goes backwards', () => {
    const clock = createFixedStepClock();
    clock.advance(1000);
    expect(clock.advance(500)).toBe(0);
    // The clock continues from the earlier timestamp, so no time was banked.
    expect(clock.advance(500 + STEP_MS)).toBe(1);
  });

  it('pins the step cap at 5', () => {
    expect(MAX_STEPS_PER_FRAME).toBe(5);
  });

  it('caps the steps after a stall and drops the backlog', () => {
    const clock = createFixedStepClock();
    clock.advance(0);
    expect(clock.advance(10_000)).toBe(5);
    expect(clock.alpha).toBe(0);
    expect(clock.advance(10_000 + STEP_MS)).toBe(1);
  });

  it('keeps the remainder as alpha in [0, 1)', () => {
    const clock = createFixedStepClock();
    clock.advance(0);
    expect(clock.advance(1.5 * STEP_MS)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0.5, 6);
    expect(clock.advance(2 * STEP_MS)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0, 6);
  });

  it('keeps alpha inside [0, 1) over a long irregular run', () => {
    const clock = createFixedStepClock();
    let now = 0;
    clock.advance(now);
    for (let i = 0; i < 2000; i++) {
      now += 3 + ((i * 7) % 29);
      clock.advance(now);
      expect(clock.alpha).toBeGreaterThanOrEqual(0);
      expect(clock.alpha).toBeLessThan(1);
    }
  });

  describe('reset', () => {
    it('makes the next advance return 0 whatever the gap, so a pause is never caught up', () => {
      const clock = createFixedStepClock();
      clock.advance(0);
      expect(clock.advance(STEP_MS)).toBe(1);
      clock.reset();
      expect(clock.advance(60_000)).toBe(0);
      // The clock goes on from there: one tick's worth of time is one step.
      expect(clock.advance(60_000 + STEP_MS)).toBe(1);
    });

    it('drops the time banked before it, so the remainder is not a step later', () => {
      const clock = createFixedStepClock();
      clock.advance(0);
      expect(clock.advance(1.9 * STEP_MS)).toBe(1);
      clock.reset();
      clock.advance(10_000);
      expect(clock.advance(10_000 + 0.2 * STEP_MS)).toBe(0);
    });

    it('keeps the time scale', () => {
      const clock = createFixedStepClock(10);
      clock.advance(0);
      clock.reset();
      clock.advance(5000);
      expect(clock.advance(5000 + STEP_MS)).toBe(10);
    });
  });

  describe('with a time scale', () => {
    it('steps 6000 times per 60 frames at scale 100', () => {
      const clock = createFixedStepClock(100);
      clock.advance(0);
      let total = 0;
      for (let i = 1; i <= 60; i++) total += clock.advance((i * 1000) / 60);
      // The cap is MAX_STEPS_PER_FRAME times the scale, so no frame drops steps here.
      expect(total).toBe(6000);
    });

    it('scales the cap, and a stall at scale 10 gives 50 steps and drops the backlog', () => {
      const clock = createFixedStepClock(10);
      clock.advance(0);
      expect(clock.advance(1000)).toBe(50);
      expect(clock.alpha).toBe(0);
      expect(clock.advance(1000 + STEP_MS)).toBe(10);
    });

    it('is the plain clock at scale 1', () => {
      const plain = createFixedStepClock();
      const scaled = createFixedStepClock(1);
      plain.advance(0);
      scaled.advance(0);
      for (let i = 1; i <= 90; i++) {
        const now = (i * 1000) / 45;
        expect(scaled.advance(now)).toBe(plain.advance(now));
        expect(scaled.alpha).toBe(plain.alpha);
      }
    });
  });
});
