import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_WAKE, STEP_MS, StepClock } from '../src/step-clock';

// Online design section 4, Loop: a fixed-step accumulator at 60 Hz on an injected clock, at most 5
// steps a wake, and a longer stall drops the backlog. It is the idea of the client's
// createFixedStepClock, written again because the server cannot import the client.

describe('StepClock', () => {
  it('runs at 60 Hz with a cap of 5', () => {
    expect(STEP_MS).toBeCloseTo(1000 / 60, 12);
    expect(MAX_STEPS_PER_WAKE).toBe(5);
  });

  it('gives no step on the first call and on a backwards timestamp', () => {
    const clock = new StepClock();
    expect(clock.advance(5000)).toBe(0);
    expect(clock.advance(5000 + STEP_MS)).toBe(1);
    expect(clock.advance(1000)).toBe(0);
  });

  it('gives exactly one step for each 1000 / 60 ms the clock moves, with no drift over ten seconds', () => {
    const clock = new StepClock();
    let now = 123.456;
    clock.advance(now);
    let total = 0;
    for (let i = 0; i < 600; i++) {
      now += 1000 / 60;
      const steps = clock.advance(now);
      expect(steps).toBe(1);
      total += steps;
    }
    expect(total).toBe(600);
  });

  it('banks a partial step until it is whole', () => {
    const clock = new StepClock();
    clock.advance(0);
    expect(clock.advance(10)).toBe(0);
    expect(clock.advance(20)).toBe(1);
    expect(clock.advance(30)).toBe(0);
  });

  it('runs five steps for a gap of five steps and keeps no backlog', () => {
    const clock = new StepClock();
    clock.advance(0);
    expect(clock.advance(5 * STEP_MS)).toBe(5);
    expect(clock.advance(5 * STEP_MS + STEP_MS)).toBe(1);
  });

  it('drops the backlog after a stall instead of catching up', () => {
    const clock = new StepClock();
    clock.advance(0);
    expect(clock.advance(10_000)).toBe(5);
    // Nothing is owed after the stall: the next frame of normal length is one step.
    expect(clock.advance(10_000 + STEP_MS)).toBe(1);
  });

  it('forgets the last timestamp and the banked time on reset', () => {
    const clock = new StepClock();
    clock.advance(0);
    clock.advance(10);
    clock.reset();
    expect(clock.advance(60_000)).toBe(0);
    expect(clock.advance(60_000 + STEP_MS)).toBe(1);
  });
});
