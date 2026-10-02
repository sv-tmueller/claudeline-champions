import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/index';
import type { GameState, SimEvent, StatusInstance, StatusSpec, StatusType } from '../src/index';
import { applyKnockback, applyShield, applyStatus } from '../src/status';
import { champion, config2v2, openArena } from './helpers';

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
