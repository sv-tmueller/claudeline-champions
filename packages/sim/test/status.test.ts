import { describe, expect, it } from 'vitest';
import { DT, MAX_MAGNITUDE, MAX_STATUS_TICKS, createMatch, step } from '../src/index';
import type { GameState, SimEvent, StatusInstance, StatusSpec, StatusType } from '../src/index';
import { applyDamage } from '../src/health';
import { applyKnockback, applyShield, applyStatus } from '../src/status';
import { champion, config2v2, input, openArena } from './helpers';

function open(): GameState {
  return createMatch(config2v2(), openArena(), 1);
}

function statuses(state: GameState, id: number): StatusInstance[] {
  return champion(state, id).statuses;
}

function fresh(state: GameState): SimEvent[] {
  const events = [...state.events];
  state.events.length = 0;
  return events;
}

const NONE = { sourceId: 0, slot: null } as const;

describe('applyStatus: stun, root, silence and invulnerable', () => {
  const unique: StatusType[] = ['stun', 'root', 'silence', 'invulnerable'];

  it('adds an instance with its source and emits statusApplied', () => {
    const state = open();
    const applied = applyStatus(state, 2, { type: 'stun', ticks: 60 }, { sourceId: 0, slot: 'Q' });
    expect(applied).toBe(true);
    expect(statuses(state, 2)).toEqual([
      { type: 'stun', sourceId: 0, slot: 'Q', remainingTicks: 60 },
    ]);
    expect(state.events).toEqual([
      { type: 'statusApplied', targetId: 2, sourceId: 0, slot: 'Q', status: 'stun', remainingTicks: 60 },
    ]);
  });

  for (const type of unique) {
    describe(type, () => {
      const spec = (ticks: number): StatusSpec => ({ type, ticks }) as StatusSpec;

      it('is replaced by an application with more remaining ticks', () => {
        const state = open();
        applyStatus(state, 2, spec(40), { sourceId: 0, slot: 'Q' });
        fresh(state);
        expect(applyStatus(state, 2, spec(41), { sourceId: 1, slot: 'E' })).toBe(true);
        expect(statuses(state, 2)).toEqual([
          { type, sourceId: 1, slot: 'E', remainingTicks: 41 },
        ]);
        expect(fresh(state)).toEqual([
          { type: 'statusExpired', targetId: 2, sourceId: 0, slot: 'Q', status: type, reason: 'replaced' },
          { type: 'statusApplied', targetId: 2, sourceId: 1, slot: 'E', status: type, remainingTicks: 41 },
        ]);
      });

      it('is not shortened, and an equal application changes nothing', () => {
        const state = open();
        applyStatus(state, 2, spec(40), { sourceId: 0, slot: 'Q' });
        fresh(state);
        expect(applyStatus(state, 2, spec(39), { sourceId: 1, slot: 'E' })).toBe(false);
        expect(applyStatus(state, 2, spec(40), { sourceId: 1, slot: 'E' })).toBe(false);
        expect(statuses(state, 2)).toEqual([{ type, sourceId: 0, slot: 'Q', remainingTicks: 40 }]);
        expect(state.events).toEqual([]);
      });

      it('compares against the ticks left, not the ticks it started with', () => {
        const state = open();
        applyStatus(state, 2, spec(40), NONE);
        (statuses(state, 2)[0] as StatusInstance).remainingTicks = 10;
        expect(applyStatus(state, 2, spec(11), NONE)).toBe(true);
        expect(statuses(state, 2)).toHaveLength(1);
      });
    });
  }

  it('caps the remaining stun at 120 ticks', () => {
    const state = open();
    applyStatus(state, 2, { type: 'stun', ticks: 500 }, NONE);
    expect(statuses(state, 2)[0]?.remainingTicks).toBe(120);
    expect(state.events).toMatchObject([{ type: 'statusApplied', remainingTicks: 120 }]);
    fresh(state);
    expect(applyStatus(state, 2, { type: 'stun', ticks: 300 }, NONE)).toBe(false);
    expect(state.events).toEqual([]);
  });

  it('does not cap root, silence or invulnerable at 120', () => {
    const state = open();
    applyStatus(state, 2, { type: 'root', ticks: 150 }, NONE);
    applyStatus(state, 2, { type: 'silence', ticks: 180 }, NONE);
    applyStatus(state, 2, { type: 'invulnerable', ticks: 200 }, NONE);
    expect(statuses(state, 2).map((s) => s.remainingTicks)).toEqual([150, 180, 200]);
  });

  it('keeps different types side by side in application order', () => {
    const state = open();
    applyStatus(state, 2, { type: 'silence', ticks: 60 }, NONE);
    applyStatus(state, 2, { type: 'stun', ticks: 30 }, NONE);
    applyStatus(state, 2, { type: 'root', ticks: 90 }, NONE);
    expect(statuses(state, 2).map((s) => s.type)).toEqual(['silence', 'stun', 'root']);
  });
});

describe('applyStatus: slow and haste', () => {
  for (const type of ['slow', 'haste'] as const) {
    describe(type, () => {
      const spec = (percent: number, ticks: number): StatusSpec => ({ type, percent, ticks });

      it('stacks across sources, each with its own timer', () => {
        const state = open();
        applyStatus(state, 2, spec(30, 60), { sourceId: 0, slot: 'Q' });
        applyStatus(state, 2, spec(20, 90), { sourceId: 1, slot: 'Q' });
        applyStatus(state, 2, spec(10, 120), { sourceId: 0, slot: 'E' });
        expect(statuses(state, 2).map((s) => [s.sourceId, s.slot, s.remainingTicks])).toEqual([
          [0, 'Q', 60],
          [1, 'Q', 90],
          [0, 'E', 120],
        ]);
      });

      it('refreshes from the same source: the old instance goes, the new one is appended with the new strength', () => {
        const state = open();
        applyStatus(state, 2, spec(30, 120), { sourceId: 0, slot: 'Q' });
        applyStatus(state, 2, spec(20, 90), { sourceId: 1, slot: 'Q' });
        fresh(state);
        // A refresh sets the new values even when they are shorter or weaker.
        expect(applyStatus(state, 2, spec(10, 30), { sourceId: 0, slot: 'Q' })).toBe(true);
        expect(statuses(state, 2)).toEqual([
          { type, sourceId: 1, slot: 'Q', remainingTicks: 90, percent: 20 },
          { type, sourceId: 0, slot: 'Q', remainingTicks: 30, percent: 10 },
        ]);
        expect(fresh(state)).toEqual([
          { type: 'statusExpired', targetId: 2, sourceId: 0, slot: 'Q', status: type, reason: 'replaced' },
          { type: 'statusApplied', targetId: 2, sourceId: 0, slot: 'Q', status: type, remainingTicks: 30 },
        ]);
      });

      it('treats a null slot as a source of its own', () => {
        const state = open();
        applyStatus(state, 2, spec(30, 60), { sourceId: 0, slot: null });
        applyStatus(state, 2, spec(30, 60), { sourceId: 0, slot: 'M1' });
        expect(statuses(state, 2)).toHaveLength(2);
      });
    });
  }

  it('keeps slow and haste of the same source apart', () => {
    const state = open();
    applyStatus(state, 2, { type: 'slow', percent: 30, ticks: 60 }, NONE);
    applyStatus(state, 2, { type: 'haste', percent: 30, ticks: 60 }, NONE);
    expect(statuses(state, 2).map((s) => s.type)).toEqual(['slow', 'haste']);
  });
});

describe('applyStatus: damage over time and heal over time', () => {
  for (const type of ['dot', 'hot'] as const) {
    describe(type, () => {
      const spec = (perPulse: number, ticks: number): StatusSpec => ({ type, perPulse, ticks });

      it('starts with a full pulse timer of 30 ticks', () => {
        const state = open();
        applyStatus(state, 2, spec(6, 120), { sourceId: 0, slot: 'E' });
        expect(statuses(state, 2)).toEqual([
          { type, sourceId: 0, slot: 'E', remainingTicks: 120, perPulse: 6, ticksToNextPulse: 30 },
        ]);
      });

      it('stacks across sources, each with its own timer', () => {
        const state = open();
        applyStatus(state, 2, spec(6, 120), { sourceId: 0, slot: 'E' });
        applyStatus(state, 2, spec(4, 90), { sourceId: 1, slot: 'E' });
        expect(statuses(state, 2).map((s) => s.sourceId)).toEqual([0, 1]);
      });

      it('refreshes from the same source: new ticks and strength, the pulse timer kept, moved to the end', () => {
        const state = open();
        applyStatus(state, 2, spec(6, 120), { sourceId: 0, slot: 'E' });
        applyStatus(state, 2, spec(4, 90), { sourceId: 1, slot: 'E' });
        const old = statuses(state, 2)[0] as StatusInstance & { ticksToNextPulse: number };
        old.ticksToNextPulse = 11;
        old.remainingTicks = 50;
        fresh(state);
        expect(applyStatus(state, 2, spec(9, 60), { sourceId: 0, slot: 'E' })).toBe(true);
        expect(statuses(state, 2)).toEqual([
          { type, sourceId: 1, slot: 'E', remainingTicks: 90, perPulse: 4, ticksToNextPulse: 30 },
          { type, sourceId: 0, slot: 'E', remainingTicks: 60, perPulse: 9, ticksToNextPulse: 11 },
        ]);
        expect(fresh(state)).toMatchObject([
          { type: 'statusExpired', sourceId: 0, status: type, reason: 'replaced' },
          { type: 'statusApplied', sourceId: 0, status: type, remainingTicks: 60 },
        ]);
      });
    });
  }
});

describe('applyShield', () => {
  it('adds a shield instance and emits statusApplied', () => {
    const state = open();
    expect(applyShield(state, 2, { absorb: 40, ticks: 200 }, { sourceId: 2, slot: 'R' })).toBe(true);
    expect(statuses(state, 2)).toEqual([
      { type: 'shield', sourceId: 2, slot: 'R', remainingTicks: 200, absorb: 40 },
    ]);
    expect(state.events).toEqual([
      { type: 'statusApplied', targetId: 2, sourceId: 2, slot: 'R', status: 'shield', remainingTicks: 200 },
    ]);
  });

  it('stacks across sources in application order', () => {
    const state = open();
    applyShield(state, 2, { absorb: 40, ticks: 200 }, { sourceId: 0, slot: 'R' });
    applyShield(state, 2, { absorb: 25, ticks: 300 }, { sourceId: 1, slot: 'R' });
    expect(statuses(state, 2).map((s) => s.sourceId)).toEqual([0, 1]);
  });

  it('refreshes from the same source: the old shield goes and the new one is the newest', () => {
    const state = open();
    applyShield(state, 2, { absorb: 40, ticks: 200 }, { sourceId: 0, slot: 'R' });
    applyShield(state, 2, { absorb: 25, ticks: 300 }, { sourceId: 1, slot: 'R' });
    fresh(state);
    applyShield(state, 2, { absorb: 10, ticks: 180 }, { sourceId: 0, slot: 'R' });
    expect(statuses(state, 2).map((s) => [s.sourceId, s.type === 'shield' ? s.absorb : -1])).toEqual([
      [1, 25],
      [0, 10],
    ]);
    expect(fresh(state)).toMatchObject([
      { type: 'statusExpired', sourceId: 0, status: 'shield', reason: 'replaced' },
      { type: 'statusApplied', sourceId: 0, status: 'shield', remainingTicks: 180 },
    ]);
  });

  it('is not blocked by invulnerable', () => {
    const state = open();
    applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, NONE);
    expect(applyShield(state, 2, { absorb: 20, ticks: 180 }, NONE)).toBe(true);
  });

  it('rejects an absorb that is not above 0 or a bad tick count', () => {
    const state = open();
    for (const absorb of [0, -5, NaN, Infinity]) {
      expect(() => applyShield(state, 2, { absorb, ticks: 60 }, NONE)).toThrow(/^Invalid status: /);
    }
    for (const ticks of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => applyShield(state, 2, { absorb: 20, ticks }, NONE)).toThrow(/^Invalid status: /);
    }
    expect(statuses(state, 2)).toEqual([]);
  });
});

describe('invulnerable', () => {
  const hostile: StatusSpec[] = [
    { type: 'stun', ticks: 60 },
    { type: 'root', ticks: 60 },
    { type: 'silence', ticks: 60 },
    { type: 'slow', percent: 30, ticks: 60 },
    { type: 'dot', perPulse: 5, ticks: 60 },
  ];

  it('blocks new stun, root, silence, slow and damage over time without an event', () => {
    for (const spec of hostile) {
      const state = open();
      applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, NONE);
      fresh(state);
      expect(applyStatus(state, 2, spec, NONE), spec.type).toBe(false);
      expect(statuses(state, 2).map((s) => s.type)).toEqual(['invulnerable']);
      expect(state.events).toEqual([]);
    }
  });

  it('lets heal over time, haste and another invulnerable through', () => {
    const state = open();
    applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, NONE);
    expect(applyStatus(state, 2, { type: 'hot', perPulse: 5, ticks: 60 }, NONE)).toBe(true);
    expect(applyStatus(state, 2, { type: 'haste', percent: 20, ticks: 60 }, NONE)).toBe(true);
    expect(applyStatus(state, 2, { type: 'invulnerable', ticks: 90 }, NONE)).toBe(true);
    expect(statuses(state, 2).map((s) => s.type)).toEqual(['hot', 'haste', 'invulnerable']);
  });

  it('keeps the statuses that were already running', () => {
    const state = open();
    applyStatus(state, 2, { type: 'stun', ticks: 60 }, NONE);
    applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, NONE);
    expect(statuses(state, 2).map((s) => s.type)).toEqual(['stun', 'invulnerable']);
  });
});

describe('status validation', () => {
  it('does nothing to a dead target', () => {
    const state = open();
    champion(state, 2).alive = false;
    expect(applyStatus(state, 2, { type: 'stun', ticks: 60 }, NONE)).toBe(false);
    expect(applyShield(state, 2, { absorb: 20, ticks: 60 }, NONE)).toBe(false);
    expect(statuses(state, 2)).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it('throws for an unknown target or source', () => {
    const state = open();
    expect(() => applyStatus(state, 9, { type: 'stun', ticks: 60 }, NONE)).toThrow(
      'Invalid status: unknown target 9',
    );
    expect(() => applyStatus(state, -1, { type: 'stun', ticks: 60 }, NONE)).toThrow(/^Invalid status: /);
    expect(() => applyStatus(state, 2, { type: 'stun', ticks: 60 }, { sourceId: 7, slot: null })).toThrow(
      'Invalid status: unknown source 7',
    );
    expect(() =>
      applyStatus(state, 2, { type: 'stun', ticks: 60 }, { sourceId: 0, slot: 'X' as never }),
    ).toThrow('Invalid status: unknown slot X');
  });

  it('throws for a bad spec, even for a dead target', () => {
    const state = open();
    champion(state, 2).alive = false;
    const bad: unknown[] = [
      null,
      { type: 'burn', ticks: 60 },
      { type: 'shield', ticks: 60 },
      { type: 'knockback', ticks: 60 },
      { type: 'stun', ticks: 0 },
      { type: 'stun', ticks: 1.5 },
      { type: 'stun', ticks: NaN },
      { type: 'stun', ticks: Infinity },
      { type: 'stun' },
      { type: 'slow', percent: 0, ticks: 60 },
      { type: 'slow', percent: 101, ticks: 60 },
      { type: 'haste', percent: 10.5, ticks: 60 },
      { type: 'haste', ticks: 60 },
      { type: 'dot', perPulse: 0, ticks: 60 },
      { type: 'hot', perPulse: -1, ticks: 60 },
      { type: 'dot', perPulse: NaN, ticks: 60 },
      { type: 'hot', ticks: 60 },
    ];
    for (const spec of bad) {
      expect(() => applyStatus(state, 2, spec as StatusSpec, NONE), JSON.stringify(spec)).toThrow(
        /^Invalid status: /,
      );
    }
  });

  it('accepts percent 1 and 100', () => {
    const state = open();
    expect(applyStatus(state, 2, { type: 'slow', percent: 1, ticks: 60 }, NONE)).toBe(true);
    expect(applyStatus(state, 3, { type: 'haste', percent: 100, ticks: 60 }, NONE)).toBe(true);
  });

  it('stores its own copy of the numbers it is given', () => {
    const state = open();
    const spec: StatusSpec = { type: 'slow', percent: 30, ticks: 60 };
    applyStatus(state, 2, spec, NONE);
    spec.percent = 99;
    expect(statuses(state, 2)[0]).toMatchObject({ percent: 30 });
  });
});

describe('status bounds', () => {
  const SRC = (sourceId: number) => ({ sourceId, slot: null }) as const;
  const push = (distance: number, ticks: number) => ({ dirX: 1, dirY: 0, distance, ticks });

  // Each call applies one spec with the given tick count to a fresh match.
  const withTicks: [string, (ticks: number) => boolean][] = [
    ['stun', (ticks) => applyStatus(open(), 2, { type: 'stun', ticks }, NONE)],
    ['root', (ticks) => applyStatus(open(), 2, { type: 'root', ticks }, NONE)],
    ['silence', (ticks) => applyStatus(open(), 2, { type: 'silence', ticks }, NONE)],
    ['invulnerable', (ticks) => applyStatus(open(), 2, { type: 'invulnerable', ticks }, NONE)],
    ['slow', (ticks) => applyStatus(open(), 2, { type: 'slow', percent: 20, ticks }, NONE)],
    ['haste', (ticks) => applyStatus(open(), 2, { type: 'haste', percent: 20, ticks }, NONE)],
    ['dot', (ticks) => applyStatus(open(), 2, { type: 'dot', perPulse: 1, ticks }, NONE)],
    ['hot', (ticks) => applyStatus(open(), 2, { type: 'hot', perPulse: 1, ticks }, NONE)],
    ['shield', (ticks) => applyShield(open(), 2, { absorb: 10, ticks }, NONE)],
    ['knockback', (ticks) => applyKnockback(open(), 2, push(1, ticks), NONE)],
  ];

  for (const [name, apply] of withTicks) {
    it(`${name}: accepts ${MAX_STATUS_TICKS} ticks and rejects one more`, () => {
      expect(apply(MAX_STATUS_TICKS)).toBe(true);
      expect(() => apply(MAX_STATUS_TICKS + 1)).toThrow(/^Invalid status: ticks 36001 /);
      expect(() => apply(1e200)).toThrow(/^Invalid status: /);
    });
  }

  const withMagnitude: [string, (value: number) => boolean][] = [
    ['dot perPulse', (value) => applyStatus(open(), 2, { type: 'dot', perPulse: value, ticks: 60 }, NONE)],
    ['hot perPulse', (value) => applyStatus(open(), 2, { type: 'hot', perPulse: value, ticks: 60 }, NONE)],
    ['shield absorb', (value) => applyShield(open(), 2, { absorb: value, ticks: 60 }, NONE)],
    ['knockback distance', (value) => applyKnockback(open(), 2, push(value, 10), NONE)],
  ];

  for (const [name, apply] of withMagnitude) {
    it(`${name}: accepts ${MAX_MAGNITUDE} and rejects one more`, () => {
      expect(apply(MAX_MAGNITUDE)).toBe(true);
      expect(() => apply(MAX_MAGNITUDE + 1)).toThrow(/^Invalid status: .* 1000001 /);
      expect(() => apply(1.7e308)).toThrow(/^Invalid status: /);
    });
  }

  it('still takes percent from 1 to 100 only', () => {
    expect(() => applyStatus(open(), 2, { type: 'slow', percent: 101, ticks: 60 }, NONE)).toThrow(
      /^Invalid status: percent 101 /,
    );
  });

  it('rejects a knockback of 1e200 ticks, so a second push never meets NaN', () => {
    const state = open();
    expect(() => applyKnockback(state, 0, push(1, 1e200), SRC(2))).toThrow(/^Invalid status: /);
    expect(applyKnockback(state, 0, push(1, 10), SRC(3))).toBe(true);
    expect(statuses(state, 0)).toMatchObject([{ type: 'knockback', sourceId: 3, distance: 1, totalTicks: 10 }]);
  });

  it('keeps absorbLeft finite with two shields at the bound', () => {
    const state = open();
    applyShield(state, 0, { absorb: MAX_MAGNITUDE, ticks: 5 }, SRC(2));
    applyShield(state, 0, { absorb: MAX_MAGNITUDE, ticks: 5 }, SRC(3));
    fresh(state);
    applyDamage(state, 0, 1, 2);
    expect(state.events).toEqual([
      { type: 'shieldAbsorbed', targetId: 0, sourceId: 2, amount: 1, absorbLeft: 2 * MAX_MAGNITUDE - 1 },
    ]);
  });

  it('rejects two shields of 1.7e308, the overflow that gave absorbLeft Infinity', () => {
    const state = open();
    expect(() => applyShield(state, 0, { absorb: 1.7e308, ticks: 5 }, SRC(2))).toThrow(/^Invalid status: /);
    expect(statuses(state, 0)).toEqual([]);
  });
});

describe('applyKnockback', () => {
  const push = (distance: number, ticks: number, dirX = 1, dirY = 0) => ({ dirX, dirY, distance, ticks });

  it('adds an instance with a unit direction and emits statusApplied', () => {
    const state = open();
    expect(applyKnockback(state, 2, push(3, 10, 3, 4), { sourceId: 0, slot: 'E' })).toBe(true);
    const k = statuses(state, 2)[0];
    expect(k).toMatchObject({
      type: 'knockback',
      sourceId: 0,
      slot: 'E',
      remainingTicks: 10,
      distance: 3,
      totalTicks: 10,
    });
    expect((k as { dirX: number }).dirX).toBeCloseTo(0.6, 15);
    expect((k as { dirY: number }).dirY).toBeCloseTo(0.8, 15);
    expect(state.events).toEqual([
      { type: 'statusApplied', targetId: 2, sourceId: 0, slot: 'E', status: 'knockback', remainingTicks: 10 },
    ]);
  });

  it('stacks across sources', () => {
    const state = open();
    applyKnockback(state, 2, push(2, 10), { sourceId: 0, slot: 'E' });
    applyKnockback(state, 2, push(1, 8, 0, 1), { sourceId: 1, slot: 'E' });
    expect(statuses(state, 2).map((s) => s.sourceId)).toEqual([0, 1]);
  });

  it('trims a new push so the push still to come never exceeds 6 m', () => {
    const state = open();
    applyKnockback(state, 2, push(5, 10), { sourceId: 0, slot: 'E' });
    applyKnockback(state, 2, push(4, 10), { sourceId: 1, slot: 'E' });
    expect(statuses(state, 2)[1]).toMatchObject({ distance: 1 });
  });

  it('caps one push of more than 6 m at 6 m', () => {
    const state = open();
    applyKnockback(state, 2, push(10, 10), NONE);
    expect(statuses(state, 2)[0]).toMatchObject({ distance: 6 });
  });

  it('counts only the push an instance has left: D n (n + 1) / (N (N + 1))', () => {
    const state = open();
    applyKnockback(state, 2, push(4, 4), { sourceId: 0, slot: 'E' });
    (statuses(state, 2)[0] as StatusInstance).remainingTicks = 2;
    // 4 m over 4 ticks with 2 left: 4 * 2 * 3 / (4 * 5) = 1.2 m remain.
    applyKnockback(state, 2, push(6, 10), { sourceId: 1, slot: 'E' });
    expect((statuses(state, 2)[1] as { distance: number }).distance).toBeCloseTo(4.8, 12);
  });

  it('drops a push with no room left, without an event', () => {
    const state = open();
    applyKnockback(state, 2, push(6, 10), { sourceId: 0, slot: 'E' });
    fresh(state);
    expect(applyKnockback(state, 2, push(3, 10), { sourceId: 1, slot: 'E' })).toBe(false);
    expect(statuses(state, 2)).toHaveLength(1);
    expect(state.events).toEqual([]);
  });

  it('refreshes from the same source by replacing the instance', () => {
    const state = open();
    applyKnockback(state, 2, push(2, 10), { sourceId: 0, slot: 'E' });
    applyKnockback(state, 2, push(1, 8, 0, 1), { sourceId: 1, slot: 'E' });
    fresh(state);
    expect(applyKnockback(state, 2, push(3, 12, 0, -1), { sourceId: 0, slot: 'E' })).toBe(true);
    expect(statuses(state, 2).map((s) => [s.sourceId, s.type === 'knockback' ? s.distance : -1])).toEqual([
      [1, 1],
      [0, 3],
    ]);
    expect(fresh(state)).toMatchObject([
      { type: 'statusExpired', sourceId: 0, status: 'knockback', reason: 'replaced' },
      { type: 'statusApplied', sourceId: 0, status: 'knockback', remainingTicks: 12 },
    ]);
  });

  it('does not count the instance it replaces against the cap', () => {
    const state = open();
    applyKnockback(state, 2, push(6, 10), { sourceId: 0, slot: 'E' });
    expect(applyKnockback(state, 2, push(5, 10), { sourceId: 0, slot: 'E' })).toBe(true);
    expect(statuses(state, 2)).toMatchObject([{ distance: 5 }]);
  });

  it('leaves the running instance alone when the refresh has no room', () => {
    const state = open();
    applyKnockback(state, 2, push(2, 10), { sourceId: 0, slot: 'E' });
    applyKnockback(state, 2, push(6, 10), { sourceId: 1, slot: 'E' });
    // Source 1 holds 4 m (trimmed). Source 0 refreshes with 3 m: room is 6 - 4 = 2 m.
    fresh(state);
    expect(applyKnockback(state, 2, push(3, 10), { sourceId: 0, slot: 'E' })).toBe(true);
    expect((statuses(state, 2)[1] as { distance: number }).distance).toBe(2);
    // Now source 1 is full again, so a refresh by source 0 with no room is dropped.
    const full = open();
    applyKnockback(full, 2, push(2, 10), { sourceId: 0, slot: 'E' });
    (statuses(full, 2)[0] as StatusInstance).remainingTicks = 10;
    applyKnockback(full, 2, push(6, 10), { sourceId: 1, slot: 'E' });
    const other = statuses(full, 2)[1] as StatusInstance & { distance: number };
    other.distance = 6;
    fresh(full);
    expect(applyKnockback(full, 2, push(3, 10), { sourceId: 0, slot: 'E' })).toBe(false);
    expect(statuses(full, 2)[0]).toMatchObject({ sourceId: 0, distance: 2 });
    expect(full.events).toEqual([]);
  });

  it('is blocked by invulnerable and does nothing to a dead target', () => {
    const state = open();
    applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, NONE);
    fresh(state);
    expect(applyKnockback(state, 2, push(3, 10), NONE)).toBe(false);
    champion(state, 3).alive = false;
    expect(applyKnockback(state, 3, push(3, 10), NONE)).toBe(false);
    expect(state.events).toEqual([]);
  });

  it('rejects a bad push', () => {
    const state = open();
    const bad = [
      push(3, 10, 0, 0),
      push(3, 10, NaN, 1),
      push(3, 10, Infinity, 0),
      push(0, 10),
      push(-1, 10),
      push(NaN, 10),
      push(Infinity, 10),
      push(3, 0),
      push(3, 1.5),
      push(3, NaN),
    ];
    for (const spec of bad) {
      expect(() => applyKnockback(state, 2, spec, NONE), JSON.stringify(spec)).toThrow(/^Invalid status: /);
    }
    expect(() => applyKnockback(state, 9, push(3, 10), NONE)).toThrow('Invalid status: unknown target 9');
    expect(statuses(state, 2)).toEqual([]);
  });

  it('measures a direction beyond the range of length', () => {
    const state = open();
    applyKnockback(state, 2, push(3, 10, 1e200, 1e200), NONE);
    expect((statuses(state, 2)[0] as { dirX: number }).dirX).toBeCloseTo(Math.SQRT1_2, 15);
  });
});

function tick(state: GameState, inputs: Parameters<typeof step>[1] = []): SimEvent[] {
  step(state, inputs);
  return [...state.events];
}

function repeat(state: GameState, ticks: number, inputs: Parameters<typeof step>[1] = []): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...tick(state, inputs));
  return all;
}

describe('status upkeep', () => {
  it('lets every status last exactly its ticks, then ends it as expired', () => {
    const state = open();
    applyStatus(state, 2, { type: 'silence', ticks: 3 }, { sourceId: 0, slot: 'Q' });
    expect(tick(state)).toEqual([]);
    expect(statuses(state, 2)[0]?.remainingTicks).toBe(2);
    expect(tick(state)).toEqual([]);
    expect(tick(state)).toEqual([
      { type: 'statusExpired', targetId: 2, sourceId: 0, slot: 'Q', status: 'silence', reason: 'expired' },
    ]);
    expect(statuses(state, 2)).toEqual([]);
    expect(tick(state)).toEqual([]);
  });

  it('ends a status of 1 tick after the first step', () => {
    const state = open();
    applyStatus(state, 2, { type: 'root', ticks: 1 }, NONE);
    expect(tick(state)).toMatchObject([{ type: 'statusExpired', reason: 'expired' }]);
  });

  it('ticks down the statuses of every champion that is alive, and not a dead one', () => {
    const state = open();
    applyStatus(state, 1, { type: 'silence', ticks: 5 }, NONE);
    applyStatus(state, 3, { type: 'silence', ticks: 5 }, NONE);
    champion(state, 3).alive = false;
    tick(state);
    expect(statuses(state, 1)[0]?.remainingTicks).toBe(4);
    expect(statuses(state, 3)[0]?.remainingTicks).toBe(5);
  });

  describe('damage over time', () => {
    it('pulses every 30 ticks and gives floor(D / 30) pulses', () => {
      for (const [ticks, pulses] of [[29, 0], [30, 1], [45, 1], [60, 2], [90, 3], [91, 3]] as const) {
        const state = open();
        applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks }, { sourceId: 1, slot: 'E' });
        const events = repeat(state, ticks);
        expect(events.filter((e) => e.type === 'damage'), `D=${ticks}`).toHaveLength(pulses);
        expect(champion(state, 2).health).toBe(120 - 5 * pulses);
        expect(statuses(state, 2)).toEqual([]);
      }
    });

    it('pulses at ticks 30, 60 and 90 with the source as damage source, then expires', () => {
      const state = open();
      applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 90 }, { sourceId: 1, slot: 'E' });
      state.events.length = 0;
      const damageTicks: number[] = [];
      let last: SimEvent[] = [];
      for (let i = 1; i <= 90; i++) {
        last = tick(state);
        if (last.some((e) => e.type === 'damage')) damageTicks.push(i);
      }
      expect(damageTicks).toEqual([30, 60, 90]);
      expect(last).toEqual([
        { type: 'damage', targetId: 2, sourceId: 1, amount: 5, health: 105 },
        { type: 'statusExpired', targetId: 2, sourceId: 1, slot: 'E', status: 'dot', reason: 'expired' },
      ]);
    });

    it('keeps the pulse timer between 1 and 30', () => {
      const state = open();
      applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 100 }, NONE);
      for (let i = 0; i < 99; i++) {
        step(state, []);
        const dot = statuses(state, 2)[0] as { ticksToNextPulse: number };
        expect(dot.ticksToNextPulse).toBeGreaterThanOrEqual(1);
        expect(dot.ticksToNextPulse).toBeLessThanOrEqual(30);
      }
    });

    it('keeps its pulse timer when refreshed', () => {
      const state = open();
      applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 100 }, NONE);
      repeat(state, 10);
      applyStatus(state, 2, { type: 'dot', perPulse: 8, ticks: 100 }, NONE);
      const events = repeat(state, 19);
      expect(events.some((e) => e.type === 'damage')).toBe(false);
      expect(tick(state)).toMatchObject([{ type: 'damage', amount: 8 }]);
    });

    it('stacks pulses from different sources, each on its own timer', () => {
      const state = open();
      applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 60 }, { sourceId: 0, slot: null });
      repeat(state, 10);
      applyStatus(state, 2, { type: 'dot', perPulse: 3, ticks: 60 }, { sourceId: 1, slot: null });
      const damage = repeat(state, 50).filter((e) => e.type === 'damage');
      expect(damage.map((e) => (e.type === 'damage' ? [e.sourceId, e.amount] : []))).toEqual([
        [0, 5],
        [1, 3],
        [0, 5],
      ]);
    });

    it('does nothing while the holder is invulnerable, and keeps running', () => {
      const state = open();
      applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 60 }, NONE);
      applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, NONE);
      const events = repeat(state, 60);
      expect(events.filter((e) => e.type === 'damage')).toEqual([]);
      expect(champion(state, 2).health).toBe(120);
      expect(events.filter((e) => e.type === 'statusExpired').map((e) => e.type === 'statusExpired' && e.status)).toEqual([
        'dot',
        'invulnerable',
      ]);
    });

    it('kills through a pulse: death, then every status ends with the reason death', () => {
      const state = open();
      champion(state, 2).health = 3;
      applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 60 }, { sourceId: 1, slot: 'E' });
      applyStatus(state, 2, { type: 'slow', percent: 20, ticks: 100 }, NONE);
      const events = repeat(state, 30);
      expect(events).toEqual([
        { type: 'damage', targetId: 2, sourceId: 1, amount: 3, health: 0 },
        { type: 'death', targetId: 2, sourceId: 1 },
        { type: 'statusExpired', targetId: 2, sourceId: 1, slot: 'E', status: 'dot', reason: 'death' },
        { type: 'statusExpired', targetId: 2, sourceId: 0, slot: null, status: 'slow', reason: 'death' },
      ]);
      expect(statuses(state, 2)).toEqual([]);
      expect(repeat(state, 40)).toEqual([]);
    });

    it('is absorbed by a shield, which is then used up as depleted', () => {
      const state = open();
      applyShield(state, 2, { absorb: 3, ticks: 100 }, { sourceId: 2, slot: null });
      applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 30 }, { sourceId: 1, slot: null });
      expect(repeat(state, 30)).toEqual([
        { type: 'shieldAbsorbed', targetId: 2, sourceId: 1, amount: 3, absorbLeft: 0 },
        { type: 'statusExpired', targetId: 2, sourceId: 2, slot: null, status: 'shield', reason: 'depleted' },
        { type: 'damage', targetId: 2, sourceId: 1, amount: 2, health: 118 },
        { type: 'statusExpired', targetId: 2, sourceId: 1, slot: null, status: 'dot', reason: 'expired' },
      ]);
    });

    it('lets a shield on its last tick absorb the pulse due that tick before it times out', () => {
      const state = open();
      applyShield(state, 2, { absorb: 20, ticks: 30 }, { sourceId: 2, slot: null });
      applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 30 }, { sourceId: 1, slot: null });
      const events = repeat(state, 30);
      expect(events.map((e) => e.type)).toEqual(['shieldAbsorbed', 'statusExpired', 'statusExpired']);
      expect(champion(state, 2).health).toBe(120);
    });
  });

  describe('heal over time', () => {
    it('pulses every 30 ticks with the source as heal source', () => {
      const state = open();
      champion(state, 2).health = 50;
      applyStatus(state, 2, { type: 'hot', perPulse: 4, ticks: 100 }, { sourceId: 3, slot: 'R' });
      const heals = repeat(state, 100).filter((e) => e.type === 'heal');
      expect(heals).toEqual([
        { type: 'heal', targetId: 2, sourceId: 3, amount: 4, health: 54 },
        { type: 'heal', targetId: 2, sourceId: 3, amount: 4, health: 58 },
        { type: 'heal', targetId: 2, sourceId: 3, amount: 4, health: 62 },
      ]);
    });

    it('works through invulnerable', () => {
      const state = open();
      champion(state, 2).health = 50;
      applyStatus(state, 2, { type: 'invulnerable', ticks: 60 }, NONE);
      applyStatus(state, 2, { type: 'hot', perPulse: 4, ticks: 30 }, NONE);
      repeat(state, 30);
      expect(champion(state, 2).health).toBe(54);
    });
  });

  describe('shield', () => {
    it('loses its remaining absorb when it times out', () => {
      const state = open();
      applyShield(state, 2, { absorb: 20, ticks: 5 }, { sourceId: 2, slot: 'R' });
      const events = repeat(state, 5);
      expect(events).toEqual([
        { type: 'statusExpired', targetId: 2, sourceId: 2, slot: 'R', status: 'shield', reason: 'expired' },
      ]);
      expect(applyDamage(state, 2, 10, 0)).toBe(10);
    });
  });
});

describe('walking under statuses', () => {
  const east = [input(1, 0, 5000, 0)];
  const BASE = 5.5;

  it('blocks walking for exactly the ticks of a stun, then walks again', () => {
    const state = open();
    const x0 = champion(state, 0).x;
    applyStatus(state, 0, { type: 'stun', ticks: 3 }, NONE);
    repeat(state, 3, east);
    expect(champion(state, 0).x).toBe(x0);
    step(state, east);
    expect(champion(state, 0).x).toBe(x0 + BASE * DT);
  });

  it('blocks walking for the ticks of a root', () => {
    const state = open();
    const x0 = champion(state, 0).x;
    applyStatus(state, 0, { type: 'root', ticks: 2 }, NONE);
    repeat(state, 2, east);
    expect(champion(state, 0).x).toBe(x0);
    step(state, east);
    expect(champion(state, 0).x).toBeGreaterThan(x0);
  });

  it('does not stop a silenced champion from walking', () => {
    const state = open();
    const x0 = champion(state, 0).x;
    applyStatus(state, 0, { type: 'silence', ticks: 60 }, NONE);
    step(state, east);
    expect(champion(state, 0).x).toBe(x0 + BASE * DT);
  });

  it('stores a walk velocity of +0 while blocked, also for a negative direction', () => {
    const state = open();
    step(state, [input(-1, -1, 0, 0)]);
    expect(champion(state, 0).vx).not.toBe(0);
    applyStatus(state, 0, { type: 'stun', ticks: 5 }, NONE);
    step(state, [input(-1, -1, 0, 0)]);
    expect(Object.is(champion(state, 0).vx, 0)).toBe(true);
    expect(Object.is(champion(state, 0).vy, 0)).toBe(true);
  });

  it('still takes the aim and the facing while stunned or rooted', () => {
    const state = open();
    applyStatus(state, 0, { type: 'stun', ticks: 5 }, NONE);
    step(state, [input(1, 0, -1200, 700)]);
    const c = champion(state, 0);
    expect([c.aimX, c.aimY]).toEqual([-1200, 700]);
    expect(c.facing).toBeCloseTo(Math.atan2(7 - 2, -12 + 12), 12);
  });

  it('scales speed by 1 + (haste - slow) / 100', () => {
    const cases: [string, StatusSpec[], number][] = [
      ['no status', [], 1],
      ['slow 30', [{ type: 'slow', percent: 30, ticks: 60 }], 0.7],
      ['haste 20', [{ type: 'haste', percent: 20, ticks: 60 }], 1.2],
      [
        'haste 20 and slow 30',
        [
          { type: 'haste', percent: 20, ticks: 60 },
          { type: 'slow', percent: 30, ticks: 60 },
        ],
        1 + (20 - 30) / 100,
      ],
    ];
    for (const [name, specs, factor] of cases) {
      const state = open();
      specs.forEach((spec) => applyStatus(state, 0, spec, NONE));
      step(state, east);
      expect(champion(state, 0).vx, name).toBe(BASE * factor);
    }
  });

  it('adds the percents of different sources and caps slow at 70 and haste at 50', () => {
    const slowed = open();
    applyStatus(slowed, 0, { type: 'slow', percent: 50, ticks: 60 }, { sourceId: 1, slot: null });
    applyStatus(slowed, 0, { type: 'slow', percent: 40, ticks: 60 }, { sourceId: 2, slot: null });
    step(slowed, east);
    expect(champion(slowed, 0).vx).toBe(BASE * (1 + (0 - 70) / 100));

    const hasty = open();
    applyStatus(hasty, 0, { type: 'haste', percent: 30, ticks: 60 }, { sourceId: 1, slot: null });
    applyStatus(hasty, 0, { type: 'haste', percent: 40, ticks: 60 }, { sourceId: 2, slot: null });
    step(hasty, east);
    expect(champion(hasty, 0).vx).toBe(BASE * (1 + 50 / 100));

    const both = open();
    for (const [type, sourceId] of [['slow', 1], ['slow', 2], ['haste', 1], ['haste', 2]] as const) {
      applyStatus(both, 0, { type, percent: 60, ticks: 60 }, { sourceId, slot: null });
    }
    step(both, east);
    expect(champion(both, 0).vx).toBe(BASE * (1 + (50 - 70) / 100));
  });

  it('moves the speed-scaled distance each tick', () => {
    const state = open();
    applyStatus(state, 0, { type: 'slow', percent: 50, ticks: 60 }, NONE);
    const x0 = champion(state, 0).x;
    step(state, east);
    expect(champion(state, 0).x).toBe(x0 + BASE * 0.5 * DT);
  });

  it('returns to full speed when a slow ends', () => {
    const state = open();
    applyStatus(state, 0, { type: 'slow', percent: 50, ticks: 2 }, NONE);
    repeat(state, 2, east);
    step(state, east);
    expect(champion(state, 0).vx).toBe(BASE);
  });
});

describe('stun and a windup', () => {
  function winding(): GameState {
    const state = open();
    champion(state, 2).cast = { castId: 6, slot: 'Q', ex: false, windupTicks: 18, windupLeft: 11 };
    return state;
  }

  it('interrupts the windup after the status and the dash end, in that order', () => {
    const state = winding();
    champion(state, 2).dash = {
      dirX: 1, dirY: 0, stepLength: 0.1, ticksLeft: 4, castId: 6, then: [],
    };
    applyStatus(state, 2, { type: 'stun', ticks: 40 }, NONE);
    expect(fresh(state).map((e) => e.type)).toEqual(['statusApplied', 'dashEnded', 'castInterrupted']);
    expect(champion(state, 2).cast).toBeNull();
    expect(champion(state, 2).dash).toBeNull();
  });

  it('reports the cast it dropped', () => {
    const state = winding();
    applyStatus(state, 2, { type: 'stun', ticks: 40 }, NONE);
    expect(state.events[1]).toEqual({
      type: 'castInterrupted', championId: 2, castId: 6, slot: 'Q', ex: false, reason: 'stun',
    });
  });

  it('is not interrupted by silence, root, slow, haste or a knockback', () => {
    const state = winding();
    applyStatus(state, 2, { type: 'silence', ticks: 40 }, NONE);
    applyStatus(state, 2, { type: 'root', ticks: 40 }, NONE);
    applyStatus(state, 2, { type: 'slow', percent: 30, ticks: 40 }, NONE);
    applyStatus(state, 2, { type: 'haste', percent: 30, ticks: 40 }, NONE);
    applyKnockback(state, 2, { dirX: 1, dirY: 0, distance: 2, ticks: 8 }, NONE);
    expect(champion(state, 2).cast).toMatchObject({ castId: 6, windupLeft: 11 });
    expect(state.events.some((e) => e.type === 'castInterrupted')).toBe(false);
  });

  it('is not interrupted by a stun that invulnerable blocks or that lands on a dead champion', () => {
    const blocked = winding();
    applyStatus(blocked, 2, { type: 'invulnerable', ticks: 40 }, NONE);
    expect(applyStatus(blocked, 2, { type: 'stun', ticks: 40 }, NONE)).toBe(false);
    expect(champion(blocked, 2).cast).not.toBeNull();

    const dead = winding();
    champion(dead, 2).alive = false;
    expect(applyStatus(dead, 2, { type: 'stun', ticks: 40 }, NONE)).toBe(false);
    expect(champion(dead, 2).cast).not.toBeNull();
  });

  it('does nothing for a champion with no windup', () => {
    const state = open();
    applyStatus(state, 2, { type: 'stun', ticks: 40 }, NONE);
    expect(state.events.map((e) => e.type)).toEqual(['statusApplied']);
  });
});
