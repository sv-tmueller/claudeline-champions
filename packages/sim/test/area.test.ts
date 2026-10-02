import { describe, expect, it } from 'vitest';
import { createMatch, step } from '../src/index';
import type { GameState, SimEvent } from '../src/index';
import { spawnArea } from '../src/area';
import type { AreaSpec } from '../src/area';
import { applyDamage } from '../src/health';
import { spawnProjectile } from '../src/projectile';
import { arena01, champion, config2v2, openArena, place } from './helpers';

function spec(over: Partial<AreaSpec> = {}): AreaSpec {
  return {
    ownerId: 0,
    x: 0,
    y: 0,
    radius: 2,
    durationTicks: 120,
    intervalTicks: 30,
    targets: 'enemies',
    effects: [{ type: 'damage', amount: 5 }],
    ...over,
  };
}

function open(): GameState {
  return createMatch(config2v2(), openArena(), 1);
}

function ticks(events: SimEvent[]): number[][] {
  return events.flatMap((e) => (e.type === 'areaTick' ? [e.targetIds] : []));
}

describe('spawnArea', () => {
  it('takes the next id from the shared counter, stores the record and emits areaSpawned', () => {
    const state = open();
    expect(spawnProjectile(state, {
      ownerId: 0, x: -5, y: 0, dirX: 1, dirY: 0, speed: 10, radius: 0.2,
      lifetimeTicks: 10, pierce: false, effects: [{ type: 'damage', amount: 1 }],
    })).toBe(4);
    state.events.length = 0;
    expect(spawnArea(state, spec({ ownerId: 2, x: 1, y: 2 }))).toBe(5);
    expect(state.nextEntityId).toBe(6);
    expect(state.areas).toEqual([
      {
        id: 5,
        type: 'circle',
        ownerId: 2,
        team: 'B',
        x: 1,
        y: 2,
        radius: 2,
        targets: 'enemies',
        remainingTicks: 120,
        intervalTicks: 30,
        ticksToNextApply: 0,
        effects: [{ type: 'damage', amount: 5 }],
        castId: null,
      },
    ]);
    expect(state.events).toEqual([
      { type: 'areaSpawned', areaId: 5, ownerId: 2, x: 1, y: 2, radius: 2 },
    ]);
  });

  it('stores -0 coordinates as +0 and copies the effects', () => {
    const state = open();
    const effect = { type: 'damage' as const, amount: 5 };
    const effects = [effect];
    spawnArea(state, spec({ x: -0, y: -0, effects }));
    effect.amount = 99;
    const area = state.areas[0];
    expect(Object.is(area?.x, 0)).toBe(true);
    expect(Object.is(area?.y, 0)).toBe(true);
    expect(area?.effects).toEqual([{ type: 'damage', amount: 5 }]);
  });

  it.each([
    ['an unknown owner', { ownerId: 9 }],
    ['a NaN x', { x: NaN }],
    ['an infinite radius', { radius: Infinity }],
    ['a zero radius', { radius: 0 }],
    ['a negative radius', { radius: -1 }],
    ['a zero duration', { durationTicks: 0 }],
    ['a fractional duration', { durationTicks: 2.5 }],
    ['a zero interval', { intervalTicks: 0 }],
    ['a fractional interval', { intervalTicks: 0.5 }],
    ['an unknown target filter', { targets: 'everyone' as never }],
    ['a zero effect amount', { effects: [{ type: 'heal' as const, amount: 0 }] }],
    ['an infinite effect amount', { effects: [{ type: 'damage' as const, amount: Infinity }] }],
    ['a status effect with a bad spec', { effects: [{ type: 'applyStatus' as const, status: { type: 'dot' as const, perPulse: 0, ticks: 60 } }] }],
    ['a shield effect with fractional ticks', { effects: [{ type: 'shield' as const, absorb: 5, ticks: 1.5 }] }],
    ['a knockback effect with no ticks', { effects: [{ type: 'knockback' as const, distance: 1, ticks: 0, direction: 'away' as const }] }],
  ])('throws on %s and changes nothing', (_name, over) => {
    const state = open();
    expect(() => spawnArea(state, spec(over))).toThrow('Invalid area');
    expect(state.nextEntityId).toBe(4);
    expect(state.areas).toEqual([]);
    expect(state.events).toEqual([]);
  });
});

describe('area timing', () => {
  it('applies at steps 1, 31, 61 and 91 for a duration of 120 and an interval of 30', () => {
    const state = open();
    place(state, 2, 0, 0);
    spawnArea(state, spec());
    const applied: number[] = [];
    for (let n = 1; n <= 120; n++) {
      step(state, []);
      if (state.events.some((e) => e.type === 'areaTick')) applied.push(n);
      if (n === 1) {
        expect(state.areas[0]?.ticksToNextApply).toBe(29);
        expect(state.areas[0]?.remainingTicks).toBe(119);
      }
      if (n < 120) expect(state.areas).toHaveLength(1);
    }
    expect(applied).toEqual([1, 31, 61, 91]);
    expect(state.areas).toEqual([]);
    expect(state.events).toEqual([{ type: 'areaExpired', areaId: 4 }]);
    expect(champion(state, 2).health).toBe(100);
  });

  it('applies once and expires in the same step for a duration and interval of 1', () => {
    const state = open();
    place(state, 2, 0, 0);
    spawnArea(state, spec({ durationTicks: 1, intervalTicks: 1 }));
    state.events.length = 0;
    step(state, []);
    expect(state.areas).toEqual([]);
    expect(state.events.map((e) => e.type)).toEqual(['areaTick', 'damage', 'areaExpired']);
  });

  it('emits an empty areaTick when nobody is inside, then picks up a champion that enters', () => {
    const state = open();
    place(state, 2, 10, 0);
    spawnArea(state, spec({ durationTicks: 90 }));
    state.events.length = 0;
    step(state, []);
    expect(ticks(state.events)).toEqual([[]]);

    place(state, 2, 0, 0);
    for (let n = 2; n <= 30; n++) step(state, []);
    expect(ticks(state.events)).toEqual([]);
    step(state, []);
    expect(ticks(state.events)).toEqual([[2]]);

    place(state, 2, 10, 0);
    for (let n = 32; n <= 60; n++) step(state, []);
    step(state, []);
    expect(ticks(state.events)).toEqual([[]]);
    expect(champion(state, 2).health).toBe(115);
  });

  it('applies the effects after listing the targets, in champion id order', () => {
    const state = open();
    place(state, 2, 0, 0);
    place(state, 3, 0.5, 1.5);
    spawnArea(state, spec());
    state.events.length = 0;
    step(state, []);
    expect(state.events.map((e) => e.type)).toEqual(['areaTick', 'damage', 'damage']);
    expect(state.events[0]).toEqual({ type: 'areaTick', areaId: 4, targetIds: [2, 3] });
    expect(state.events.slice(1).map((e) => (e as { targetId: number }).targetId)).toEqual([2, 3]);
  });
});

describe('who an area affects', () => {
  function crowd(): GameState {
    const state = open();
    for (let id = 0; id < 4; id++) place(state, id, id, 0);
    return state;
  }

  function targetsOf(state: GameState, over: Partial<AreaSpec>): number[] {
    spawnArea(state, spec({ radius: 10, durationTicks: 1, intervalTicks: 1, ...over }));
    state.events.length = 0;
    step(state, []);
    return ticks(state.events)[0] ?? [];
  }

  it('enemies means the other team', () => {
    expect(targetsOf(crowd(), { targets: 'enemies' })).toEqual([2, 3]);
  });

  it('allies means the owner team including the owner', () => {
    expect(targetsOf(crowd(), { targets: 'allies' })).toEqual([0, 1]);
  });

  it('all means everyone', () => {
    expect(targetsOf(crowd(), { targets: 'all' })).toEqual([0, 1, 2, 3]);
  });

  it('never includes a dead champion', () => {
    const state = crowd();
    applyDamage(state, 3, 1000, 0);
    expect(targetsOf(state, { targets: 'all' })).toEqual([0, 1, 2]);
  });

  it('heals allies up to max health and emits nothing for a champion at full health', () => {
    const state = crowd();
    champion(state, 1).health = 100;
    spawnArea(state, spec({
      radius: 10, durationTicks: 1, intervalTicks: 1, targets: 'allies',
      effects: [{ type: 'heal', amount: 50 }],
    }));
    state.events.length = 0;
    step(state, []);
    const heals = state.events.filter((e) => e.type === 'heal');
    expect(heals).toEqual([{ type: 'heal', targetId: 1, sourceId: 0, amount: 20, health: 120 }]);
  });

  it('counts the body as inside up to radius + 0.5 and not beyond', () => {
    const inside = open();
    place(inside, 2, 2.5, 0);
    expect(targetsOf(inside, { radius: 2 })).toEqual([2]);

    const outside = open();
    place(outside, 2, 2.5 + 1e-6, 0);
    expect(targetsOf(outside, { radius: 2 })).toEqual([]);
  });

  it('ignores obstacles', () => {
    const state = createMatch(config2v2(), arena01, 1);
    place(state, 2, 2.2, 0);
    expect(targetsOf(state, { x: -2, radius: 4 })).toEqual([2]);
  });
});

describe('area hit effects', () => {
  it('pushes targets away from the area centre', () => {
    const state = open();
    place(state, 2, 1, 1);
    place(state, 3, -1, 0);
    spawnArea(state, spec({ effects: [{ type: 'knockback', distance: 2, ticks: 8, direction: 'away' }] }));
    step(state, []);
    const dir = (id: number) => champion(state, id).statuses[0] as { dirX: number; dirY: number };
    expect(dir(2).dirX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(dir(2).dirY).toBeCloseTo(Math.SQRT1_2, 12);
    expect(dir(3)).toMatchObject({ dirX: -1, dirY: 0 });
  });

  it('gives no push to a target exactly at the centre', () => {
    const state = open();
    place(state, 2, 0, 0);
    spawnArea(state, spec({ effects: [{ type: 'knockback', distance: 2, ticks: 8, direction: 'away' }] }));
    step(state, []);
    expect(champion(state, 2).statuses).toEqual([]);
  });

  it('refreshes a status each pulse instead of stacking it', () => {
    const state = open();
    place(state, 2, 0, 0);
    spawnArea(
      state,
      spec({ intervalTicks: 10, effects: [{ type: 'applyStatus', status: { type: 'slow', percent: 30, ticks: 25 } }] }),
    );
    for (let i = 0; i < 25; i++) step(state, []);
    expect(champion(state, 2).statuses).toHaveLength(1);
    expect(champion(state, 2).statuses[0]).toMatchObject({ type: 'slow', sourceId: 0 });
  });
});
