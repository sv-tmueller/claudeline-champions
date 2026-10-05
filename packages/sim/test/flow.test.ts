// Match flow (rules.md section 1): the warmup, the round clock, sudden death, the decision, the
// pause and the reset. Every number is a literal. `state.tick` is the tick a step runs: "the step
// that makes `state.tick` N" is the step that runs at tick N - 1.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS_TO_WIN, checksum, cloneState, createMatch, debug, step } from '../src/index';
import type { GameState, KitDef, MatchConfig, PlayerInput, SimEvent } from '../src/index';
import { applyDamage } from '../src/health';
import { startDash } from '../src/motion';
import { applyShield, applyStatus } from '../src/status';
import { champion, input, openArena, place } from './helpers';
import { kitWith, quiet } from './kits';

// Champions 0 and 1 are team A, 2 and 3 team B. 0, 1 and 2 have kits with 160, 120 and 160 health;
// 3 has none and 120. The M1 of champions 0 and 1 winds up for 30 ticks.
function config(roundsToWin = 3): MatchConfig {
  return {
    teamSize: 2,
    roundsToWin,
    players: [
      { championId: 'k0', team: 'A' },
      { championId: 'k1', team: 'A' },
      { championId: 'k2', team: 'B' },
      { championId: 'none', team: 'B' },
    ],
  };
}

function kits(): KitDef[] {
  return [
    kitWith('k0', { M1: quiet({ windupTicks: 30, cooldownTicks: 60 }) }, { maxHealth: 160 }),
    kitWith('k1', { M1: quiet({ windupTicks: 30, cooldownTicks: 60 }) }, { maxHealth: 120 }),
    kitWith('k2', {}, { maxHealth: 160 }),
  ];
}

function fresh(roundsToWin = 3): GameState {
  return createMatch(config(roundsToWin), openArena(), 1, kits());
}

/** Warmup played out: round 1 is running at `state.tick` 180, everyone at a spawn. */
function begun(roundsToWin = 3): GameState {
  const state = fresh(roundsToWin);
  for (let i = 0; i < 180; i++) step(state, []);
  return state;
}

/** Everyone inside the ring's final radius of 3 m, so sudden death leaves them alone. */
function centred(state: GameState): void {
  place(state, 0, -2, 0);
  place(state, 1, -2, 2);
  place(state, 2, 2, 0);
  place(state, 3, 2, -2);
}

function stepTo(state: GameState, tick: number, inputs: (PlayerInput | undefined)[] = []): void {
  while (state.tick < tick) step(state, inputs);
}

/** Kills champions between steps; the damage and death events are dropped by the next step. */
function kill(state: GameState, ...ids: number[]): void {
  for (const id of ids) applyDamage(state, id, 1000, 0);
  state.events.length = 0;
}

function types(state: GameState): string[] {
  return state.events.map((e) => e.type);
}

function ofType<T extends SimEvent['type']>(
  state: GameState,
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return state.events.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];
}

/** A lethal debug projectile one metre before champion `targetId`, flying at it. */
function lethalAt(state: GameState, ownerId: number, targetId: number): number {
  const target = champion(state, targetId);
  const dirX = target.x > champion(state, ownerId).x ? 1 : -1;
  return debug.spawnProjectile(state, {
    ownerId,
    x: target.x - dirX,
    y: target.y,
    dirX,
    dirY: 0,
    speed: 25,
    radius: 0.2,
    lifetimeTicks: 60,
    pierce: false,
    effects: [{ type: 'damage', amount: 1000 }],
  });
}

/** What a locked or paused match must not change in a champion. */
function frozen(state: GameState): unknown {
  return cloneState(state).champions.map((c) => ({
    x: c.x,
    y: c.y,
    vx: c.vx,
    vy: c.vy,
    health: c.health,
    energy: c.energy,
    alive: c.alive,
    statuses: c.statuses,
    dash: c.dash,
    cooldowns: c.cooldowns,
    cast: c.cast,
  }));
}

const HOLD_ALL: PlayerInput[] = [
  input(1, 0, -1200, 1200, 127),
  input(-1, 1, 500, 500, 127),
  input(1, 1, -500, 500, 127),
  input(0, -1, 0, 0, 127),
];

describe('the warmup', () => {
  it('locks walking and casting for 180 steps and keeps the facing on the aim', () => {
    const state = fresh();
    for (let i = 0; i < 179; i++) {
      step(state, HOLD_ALL);
      const c = champion(state, 0);
      expect([c.x, c.y]).toEqual([-12, 2]);
      expect(Object.is(c.vx, 0)).toBe(true);
      expect(Object.is(c.vy, 0)).toBe(true);
      expect(c.cooldowns).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect([c.energy, c.cast]).toEqual([0, null]);
      expect([c.aimX, c.aimY]).toEqual([-1200, 1200]);
      expect(c.facing).toBe(1.5707963267948966);
      expect(state.events).toEqual([]);
      expect(state.casts).toEqual([]);
    }
    expect(state.match).toMatchObject({ phase: 'warmup', phaseTicks: 179, round: 0 });
  });

  it('starts round 1 in the step that makes state.tick 180', () => {
    const state = fresh();
    stepTo(state, 179, HOLD_ALL);
    expect(state.tick).toBe(179);
    step(state, HOLD_ALL);
    expect(state.tick).toBe(180);
    expect(state.events).toEqual([{ type: 'roundStarted', round: 1 }]);
    expect(state.match).toEqual({
      phase: 'round',
      phaseTicks: 0,
      round: 1,
      roundsToWin: 3,
      score: { A: 0, B: 0 },
      ring: null,
    });
    expect([champion(state, 0).x, champion(state, 0).y]).toEqual([-12, 2]);
  });

  it('lets the step at tick 180 walk and cast', () => {
    const state = fresh();
    stepTo(state, 180, HOLD_ALL);
    step(state, HOLD_ALL);
    expect(champion(state, 0).x).toBe(-11.908333333333333);
    expect(state.events[0]).toMatchObject({ type: 'castStarted', championId: 0, slot: 'R' });
  });

  it('keeps dead champions out of the locked turn and leaves missing inputs alone', () => {
    const state = fresh();
    kill(state, 3);
    const dead = champion(state, 3);
    const [aimX, aimY, facing] = [dead.aimX, dead.aimY, dead.facing];
    step(state, [input(1, 0, 900, 900, 0), undefined, undefined, input(0, 0, -700, 300, 0)]);
    expect(champion(state, 3).alive).toBe(false);
    expect([dead.aimX, dead.aimY, dead.facing]).toEqual([aimX, aimY, facing]);
    expect([champion(state, 1).aimX, champion(state, 1).aimY]).toEqual([-1100, -200]);
  });

  it('throws on an input that throws and leaves the state unchanged', () => {
    for (const ticks of [0, 100]) {
      const state = fresh();
      stepTo(state, ticks);
      const before = checksum(state);
      const bad = { get moveX(): number { throw new Error('boom'); } } as unknown as PlayerInput;
      expect(() => step(state, [bad])).toThrow('boom');
      expect(checksum(state)).toBe(before);
    }
  });
});

describe('the round clock and the ring', () => {
  it('starts sudden death at the step that makes state.tick 5581 and shrinks to 3 by 7381', () => {
    const state = begun();
    centred(state);
    const radii: [number, number][] = [
      [5581, 18],
      [5582, 17.991666666666667],
      [5701, 17],
      [6481, 10.5],
      [7380, 3.008333333333333],
      [7381, 3],
      [8000, 3],
    ];
    let started = 0;
    for (const [tick, radius] of radii) {
      while (state.tick < tick) {
        step(state, []);
        started += ofType(state, 'suddenDeathStarted').length;
        expect(ofType(state, 'roundEnded')).toEqual([]);
        if (state.tick === 5580) {
          expect(state.match?.ring).toBeNull();
          expect(state.match?.phaseTicks).toBe(5400);
        }
      }
      expect(state.match?.ring?.radius, `tick ${tick}`).toBe(radius);
    }
    expect(started).toBe(1);
    expect(state.match?.round).toBe(1);
    expect(state.match?.phase).toBe('round');
    expect(state.match?.ring).toEqual({ x: 0, y: 0, radius: 3, damagePerTick: 0.16666666666666666 });
  });

  it('holds the end radius exactly from the step that makes state.tick 7381 on a ring of 12 to 0.7', () => {
    const arena = { ...openArena(), ring: { startRadius: 12, endRadius: 0.7, damagePerSecond: 10 } };
    const state = createMatch(config(), arena, 1, kits());
    for (let i = 0; i < 180; i++) step(state, []);
    centred(state);
    stepTo(state, 7380);
    expect(state.match?.ring?.radius).toBe(0.7062777777777782);
    step(state, []);
    expect(state.tick).toBe(7381);
    expect(state.match?.ring?.radius).toBe(0.7);
    expect(state.match).toMatchObject({ phase: 'round', round: 1 });
    stepTo(state, 8000);
    expect(state.match?.ring?.radius).toBe(0.7);
    expect(state.match).toMatchObject({ phase: 'round', round: 1 });
  });

  it('announces sudden death once, with the round and the start radius', () => {
    const state = begun();
    centred(state);
    stepTo(state, 5580);
    step(state, []);
    expect(state.tick).toBe(5581);
    expect(state.events).toEqual([{ type: 'suddenDeathStarted', round: 1, radius: 18 }]);
    expect(state.match?.ring).toEqual({ x: 0, y: 0, radius: 18, damagePerTick: 0.16666666666666666 });
    step(state, []);
    expect(state.events).toEqual([]);
  });

  it('never decides a round by the timer while both teams live', () => {
    const state = begun();
    centred(state);
    stepTo(state, 9000);
    expect(state.match?.phase).toBe('round');
    expect(state.match?.score).toEqual({ A: 0, B: 0 });
    expect(state.match?.phaseTicks).toBe(8820);
  });
});

describe('ring damage', () => {
  /** Champion 1 stands in the corner at (14.5, 9.5), the rest inside the final ring. */
  function cornered(): GameState {
    const state = begun();
    centred(state);
    place(state, 1, 14.5, 9.5);
    return state;
  }

  it('hurts the corner champion first at the step that makes state.tick 5661', () => {
    const state = cornered();
    stepTo(state, 5660);
    expect(state.match?.ring?.radius).toBe(17.341666666666665);
    expect(champion(state, 1).health).toBe(120);
    expect(state.events.some((e) => e.type === 'damage')).toBe(false);
    step(state, []);
    expect(state.match?.ring?.radius).toBe(17.333333333333332);
    expect(state.events).toEqual([
      {
        type: 'damage',
        targetId: 1,
        sourceId: -1,
        amount: 0.1666666666666714,
        health: 119.83333333333333,
      },
    ]);
    expect([0, 2, 3].map((id) => champion(state, id).health)).toEqual([160, 160, 120]);
  });

  it('treats a champion exactly on the radius as inside', () => {
    const state = begun();
    centred(state);
    place(state, 1, 10.5, 0);
    stepTo(state, 6481);
    expect(state.match?.ring?.radius).toBe(10.5);
    expect(champion(state, 1).health).toBe(120);
    expect(state.events.some((e) => e.type === 'damage')).toBe(false);
    step(state, []);
    expect(state.match?.ring?.radius).toBe(10.491666666666667);
    expect(ofType(state, 'damage')).toEqual([
      {
        type: 'damage',
        targetId: 1,
        sourceId: -1,
        amount: 0.1666666666666714,
        health: 119.83333333333333,
      },
    ]);
  });

  it('ignores shields: no absorb event, the shield untouched', () => {
    const state = cornered();
    stepTo(state, 5660);
    applyShield(state, 1, { absorb: 50, ticks: 100 }, { sourceId: 1, slot: null });
    step(state, []);
    expect(types(state)).toEqual(['damage']);
    expect(champion(state, 1).statuses).toMatchObject([{ type: 'shield', absorb: 50 }]);
    expect(champion(state, 1).health).toBe(119.83333333333333);
  });

  it('is blocked by invulnerable', () => {
    const state = cornered();
    stepTo(state, 5660);
    applyStatus(state, 1, { type: 'invulnerable', ticks: 50 }, { sourceId: 1, slot: null });
    step(state, []);
    expect(state.events).toEqual([]);
    expect(champion(state, 1).health).toBe(120);
  });

  it('gives nobody energy', () => {
    const state = cornered();
    stepTo(state, 5700);
    expect(state.champions.map((c) => c.energy)).toEqual([0, 0, 0, 0]);
    expect(champion(state, 1).health).toBeLessThan(120);
  });

  it('kills with the ring as the source and leaves the round running while the team lives', () => {
    const state = cornered();
    champion(state, 1).health = 0.1;
    stepTo(state, 5660);
    step(state, []);
    expect(state.events).toEqual([
      { type: 'damage', targetId: 1, sourceId: -1, amount: 0.1, health: 0 },
      { type: 'death', targetId: 1, sourceId: -1 },
    ]);
    expect(champion(state, 1).alive).toBe(false);
    expect(state.match?.phase).toBe('round');
  });
});

describe('the round decision', () => {
  it('gives team A the round when team B is dead', () => {
    const state = begun();
    kill(state, 2, 3);
    step(state, []);
    expect(state.tick).toBe(181);
    expect(state.events).toEqual([
      { type: 'roundEnded', round: 1, winner: 'A', scoreA: 1, scoreB: 0 },
    ]);
    expect(state.match).toEqual({
      phase: 'roundEnd',
      phaseTicks: 1,
      round: 1,
      roundsToWin: 3,
      score: { A: 1, B: 0 },
      ring: null,
    });
  });

  it('gives team B the round when team A is dead', () => {
    const state = begun();
    kill(state, 0, 1);
    step(state, []);
    expect(state.events).toEqual([
      { type: 'roundEnded', round: 1, winner: 'B', scoreA: 0, scoreB: 1 },
    ]);
    expect(state.match?.score).toEqual({ A: 0, B: 1 });
  });

  it('ends in a draw when two projectiles kill the last champions of both teams in one step', () => {
    const state = begun();
    kill(state, 1, 3);
    place(state, 0, -5, 0);
    place(state, 2, 5, 0);
    lethalAt(state, 0, 2);
    lethalAt(state, 2, 0);
    step(state, []);
    expect(types(state)).toEqual([
      'projectileHit',
      'damage',
      'death',
      'projectileExpired',
      'projectileHit',
      'damage',
      'death',
      'projectileExpired',
      'roundEnded',
    ]);
    expect(ofType(state, 'roundEnded')).toEqual([
      { type: 'roundEnded', round: 1, winner: null, scoreA: 0, scoreB: 0 },
    ]);
    expect(state.match?.score).toEqual({ A: 0, B: 0 });
    expect(state.match?.phase).toBe('roundEnd');
  });

  it('decides at the end of the step, after the ring deaths of that tick', () => {
    const state = begun();
    centred(state);
    place(state, 2, 14.5, 9.5);
    place(state, 3, 14.5, -9.5);
    champion(state, 2).health = 0.1;
    champion(state, 3).health = 0.1;
    stepTo(state, 5660);
    expect(state.match?.phase).toBe('round');
    step(state, []);
    expect(types(state)).toEqual(['damage', 'death', 'damage', 'death', 'roundEnded']);
    expect(ofType(state, 'death')).toEqual([
      { type: 'death', targetId: 2, sourceId: -1 },
      { type: 'death', targetId: 3, sourceId: -1 },
    ]);
    expect(ofType(state, 'roundEnded')).toEqual([
      { type: 'roundEnded', round: 1, winner: 'A', scoreA: 1, scoreB: 0 },
    ]);
  });

  it('ends in a draw when the ring kills the last champion of each team in one step', () => {
    const state = begun();
    kill(state, 1, 3);
    place(state, 0, 14.5, 9.5);
    place(state, 2, -14.5, -9.5);
    champion(state, 0).health = 0.1;
    champion(state, 2).health = 0.1;
    stepTo(state, 5660);
    step(state, []);
    expect(types(state)).toEqual(['damage', 'death', 'damage', 'death', 'roundEnded']);
    expect(ofType(state, 'roundEnded')).toEqual([
      { type: 'roundEnded', round: 1, winner: null, scoreA: 0, scoreB: 0 },
    ]);
  });

  it('orders the deciding step: deaths, roundEnded, interrupted windups, projectiles, areas', () => {
    const state = begun();
    kill(state, 3);
    const far = debug.spawnProjectile(state, {
      ownerId: 0,
      x: -10,
      y: 5,
      dirX: 0,
      dirY: 1,
      speed: 6,
      radius: 0.2,
      lifetimeTicks: 600,
      pierce: false,
      effects: [{ type: 'damage', amount: 1 }],
    });
    const area = debug.spawnArea(state, {
      ownerId: 2,
      x: 0,
      y: 8,
      radius: 1,
      durationTicks: 600,
      intervalTicks: 30,
      targets: 'enemies',
      effects: [{ type: 'damage', amount: 1 }],
    });
    lethalAt(state, 0, 2);
    expect([far, area]).toEqual([4, 5]);
    step(state, [input(0, 0, 0, 0, 1)]);
    const decided = types(state).indexOf('roundEnded');
    expect(types(state).slice(0, decided)).toEqual([
      'castStarted',
      'projectileHit',
      'damage',
      'death',
      'projectileExpired',
      'areaTick',
    ]);
    expect(state.events.slice(decided)).toEqual([
      { type: 'roundEnded', round: 1, winner: 'A', scoreA: 1, scoreB: 0 },
      { type: 'castInterrupted', championId: 0, castId: 7, slot: 'M1', ex: false, reason: 'roundEnd' },
      { type: 'projectileExpired', projectileId: 4, reason: 'roundEnd', x: -10, y: 5.1 },
      { type: 'areaExpired', areaId: 5 },
    ]);
    expect(state.projectiles).toEqual([]);
    expect(state.areas).toEqual([]);
    expect(champion(state, 0).cast).toBeNull();
    expect(state.casts).toEqual([]);
  });

  it('counts every windup of the winners as interrupted, in champion id order', () => {
    const state = begun();
    kill(state, 2, 3);
    step(state, [input(0, 0, 0, 0, 1), input(0, 0, 0, 0, 1)]);
    expect(
      ofType(state, 'castInterrupted').map((e) => [e.championId, e.reason]),
    ).toEqual([
      [0, 'roundEnd'],
      [1, 'roundEnd'],
    ]);
  });
});

describe('the round end pause', () => {
  /** Team A wins at the deciding step; champion 0 carries a dot and a dash, 1 a hot. */
  function paused(): GameState {
    const state = begun();
    champion(state, 1).health = 50;
    applyStatus(state, 0, { type: 'dot', perPulse: 5, ticks: 600 }, { sourceId: 2, slot: null });
    applyStatus(state, 1, { type: 'hot', perPulse: 4, ticks: 600 }, { sourceId: 1, slot: null });
    startDash(state, 0, { dirX: 1, dirY: 0, distance: 3, ticks: 6 });
    kill(state, 2, 3);
    step(state, []);
    return state;
  }

  it('freezes everything for 179 steps after the deciding one', () => {
    const state = paused();
    expect(state.tick).toBe(181);
    expect(champion(state, 0).statuses).toMatchObject([
      { type: 'dot', remainingTicks: 599, ticksToNextPulse: 29 },
    ]);
    expect(champion(state, 1).statuses).toMatchObject([
      { type: 'hot', remainingTicks: 599, ticksToNextPulse: 29 },
    ]);
    expect(champion(state, 0).dash?.ticksLeft).toBe(5);
    const snapshot = frozen(state);
    for (let i = 0; i < 178; i++) {
      step(state, HOLD_ALL);
      expect(state.events).toEqual([]);
      expect(frozen(state)).toEqual(snapshot);
    }
    expect(state.match).toMatchObject({ phase: 'roundEnd', phaseTicks: 179 });
    expect(state.tick).toBe(359);
    step(state, HOLD_ALL);
    expect(state.tick).toBe(360);
    expect(state.events).toEqual([{ type: 'roundStarted', round: 2 }]);
  });

  it('keeps the aim live in the pause and does not cast', () => {
    const state = paused();
    step(state, HOLD_ALL);
    expect([champion(state, 0).aimX, champion(state, 0).aimY]).toEqual([-1200, 1200]);
    // The dash moved champion 0 to x = -11.5 before the pause, so the aim is no longer straight up.
    expect(champion(state, 0).facing).toBe(1.6207547225168395);
    expect(state.casts).toEqual([]);
  });

  it('freezes a debug projectile spawned in the pause and ends it just before roundStarted', () => {
    const state = paused();
    for (let i = 0; i < 10; i++) step(state, []);
    const id = debug.spawnProjectile(state, {
      ownerId: 0,
      x: -6,
      y: 4,
      dirX: 1,
      dirY: 0,
      speed: 25,
      radius: 0.2,
      lifetimeTicks: 600,
      pierce: false,
      effects: [{ type: 'damage', amount: 1 }],
    });
    for (let i = 0; i < 168; i++) {
      step(state, []);
      expect(state.events).toEqual([]);
      expect(state.projectiles.map((p) => [p.id, p.x, p.y, p.remainingTicks])).toEqual([
        [id, -6, 4, 600],
      ]);
    }
    step(state, []);
    expect(state.events).toEqual([
      { type: 'projectileExpired', projectileId: id, reason: 'roundEnd', x: -6, y: 4 },
      { type: 'roundStarted', round: 2 },
    ]);
    expect(state.projectiles).toEqual([]);
  });

  it('ends a debug area spawned in the pause with areaExpired before roundStarted', () => {
    const state = paused();
    const id = debug.spawnArea(state, {
      ownerId: 0,
      x: 0,
      y: 0,
      radius: 2,
      durationTicks: 600,
      intervalTicks: 1,
      targets: 'all',
      effects: [{ type: 'damage', amount: 5 }],
    });
    stepTo(state, 359);
    expect(state.areas.map((a) => [a.id, a.remainingTicks])).toEqual([[id, 600]]);
    step(state, []);
    expect(state.events).toEqual([
      { type: 'areaExpired', areaId: id },
      { type: 'roundStarted', round: 2 },
    ]);
  });
});

describe('the round reset', () => {
  /** Round 1 decided during sudden death with everything loaded; returns the state just before the reset. */
  function loaded(): { state: GameState; nextEntityId: number } {
    const state = begun();
    champion(state, 0).energy = 40;
    champion(state, 1).energy = 100;
    champion(state, 0).cooldowns[3] = 99;
    champion(state, 1).cooldowns[0] = 5;
    champion(state, 0).health = 17;
    applyStatus(state, 1, { type: 'slow', percent: 30, ticks: 500 }, { sourceId: 2, slot: 'Q' });
    startDash(state, 0, { dirX: 1, dirY: 0, distance: 3, ticks: 6 });
    place(state, 1, 3, 3);
    place(state, 2, -3, -3);
    state.match!.phaseTicks = 5400;
    kill(state, 2, 3);
    step(state, [input(0, 0, 0, 0, 1), input(1, 0, 700, 700, 0)]);
    expect(state.match?.phase).toBe('roundEnd');
    expect(state.match?.ring).not.toBeNull();
    for (let i = 0; i < 178; i++) step(state, [input(0, 0, 0, 0, 0), input(1, 0, 700, 700, 0)]);
    return { state, nextEntityId: state.nextEntityId };
  }

  it('puts every champion back at its spawn, healed and alive, and empties the ability state', () => {
    const { state } = loaded();
    step(state, [input(0, 0, 0, 0, 0), input(1, 0, 700, 700, 0)]);
    expect(state.events).toEqual([{ type: 'roundStarted', round: 2 }]);
    expect(state.champions.map((c) => [c.x, c.y])).toEqual([
      [-12, 2],
      [-12, -2],
      [12, 2],
      [12, -2],
    ]);
    expect(state.champions.map((c) => [c.health, c.maxHealth, c.alive])).toEqual([
      [160, 160, true],
      [120, 120, true],
      [160, 160, true],
      [120, 120, true],
    ]);
    for (const c of state.champions) {
      expect(c.energy).toBe(0);
      expect(c.cooldowns).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(c.statuses).toEqual([]);
      expect([c.dash, c.cast]).toEqual([null, null]);
      expect([Object.is(c.vx, 0), Object.is(c.vy, 0)]).toEqual([true, true]);
    }
    expect(state.casts).toEqual([]);
    expect(state.match).toEqual({
      phase: 'round',
      phaseTicks: 0,
      round: 2,
      roundsToWin: 3,
      score: { A: 1, B: 0 },
      ring: null,
    });
  });

  it('keeps the aim, the facing and the entity ids across the reset', () => {
    const { state, nextEntityId } = loaded();
    const before = state.champions.map((c) => [c.aimX, c.aimY, c.facing]);
    step(state, [input(0, 0, 0, 0, 0), input(1, 0, 700, 700, 0)]);
    expect(state.champions.map((c) => [c.aimX, c.aimY, c.facing])).toEqual(before);
    expect(state.nextEntityId).toBe(nextEntityId);
  });

  it('lets the new round start with a full round clock and no ring', () => {
    const { state } = loaded();
    step(state, []);
    stepTo(state, state.tick + 5400);
    expect(state.match?.ring).toBeNull();
    step(state, []);
    expect(state.match?.ring).not.toBeNull();
    expect(state.match?.round).toBe(2);
  });

  it('puts each champion on its own team slot, also when the teams alternate', () => {
    const state = createMatch(
      {
        teamSize: 3,
        roundsToWin: 3,
        players: [
          { championId: 'a1', team: 'A' },
          { championId: 'b1', team: 'B' },
          { championId: 'a2', team: 'A' },
          { championId: 'b2', team: 'B' },
          { championId: 'a3', team: 'A' },
          { championId: 'b3', team: 'B' },
        ],
      },
      openArena(),
      1,
    );
    for (let i = 0; i < 6; i++) place(state, i, 1 + i, 3);
    stepTo(state, 180);
    expect(state.champions.map((c) => [c.x, c.y])).toEqual([
      [-12, 2],
      [12, 2],
      [-12, -2],
      [12, -2],
      [-12, 0],
      [12, 0],
    ]);
  });
});

describe('the match end', () => {
  it('ends with matchEnded in the step that makes state.tick T + 179', () => {
    const state = begun(1);
    kill(state, 2, 3);
    step(state, []);
    const decided = state.tick;
    expect(decided).toBe(181);
    stepTo(state, decided + 178);
    expect(state.events).toEqual([]);
    step(state, []);
    expect(state.tick).toBe(360);
    expect(state.events).toEqual([{ type: 'matchEnded', winner: 'A', scoreA: 1, scoreB: 0 }]);
    expect(state.match).toEqual({
      phase: 'matchEnd',
      phaseTicks: 0,
      round: 1,
      roundsToWin: 1,
      score: { A: 1, B: 0 },
      ring: null,
    });
  });

  it('stays over: 300 steps with held inputs change nothing and emit nothing', () => {
    const state = begun(1);
    kill(state, 0, 1);
    step(state, []);
    stepTo(state, 360);
    expect(state.events).toEqual([{ type: 'matchEnded', winner: 'B', scoreA: 0, scoreB: 1 }]);
    const snapshot = frozen(state);
    for (let i = 0; i < 300; i++) {
      step(state, HOLD_ALL);
      expect(state.events).toEqual([]);
    }
    expect(frozen(state)).toEqual(snapshot);
    expect(state.match).toMatchObject({ phase: 'matchEnd', phaseTicks: 300, round: 1 });
  });

  it('keeps a debug projectile spawned in the match end frozen for good', () => {
    const state = begun(1);
    kill(state, 0, 1);
    step(state, []);
    stepTo(state, 360);
    expect(state.match?.phase).toBe('matchEnd');
    const id = debug.spawnProjectile(state, {
      ownerId: 0,
      x: -6,
      y: 4,
      dirX: 1,
      dirY: 0,
      speed: 25,
      radius: 0.2,
      lifetimeTicks: 600,
      pierce: false,
      effects: [{ type: 'damage', amount: 1 }],
    });
    for (let i = 0; i < 300; i++) {
      step(state, HOLD_ALL);
      expect(state.events).toEqual([]);
    }
    expect(state.projectiles.map((p) => [p.id, p.x, p.y, p.remainingTicks])).toEqual([[id, -6, 4, 600]]);
  });

  it('takes three round wins in a standard match', () => {
    expect(DEFAULT_ROUNDS_TO_WIN).toBe(3);
    const state = begun(DEFAULT_ROUNDS_TO_WIN);
    const started: number[] = [];
    let ended: SimEvent | undefined;
    for (let round = 1; round <= 3; round++) {
      kill(state, 2, 3);
      step(state, []);
      expect(state.match?.score).toEqual({ A: round, B: 0 });
      for (let i = 0; i < 179; i++) {
        step(state, []);
        for (const e of state.events) {
          if (e.type === 'roundStarted') started.push(e.round);
          if (e.type === 'matchEnded') ended = e;
        }
      }
    }
    expect(started).toEqual([2, 3]);
    expect(ended).toEqual({ type: 'matchEnded', winner: 'A', scoreA: 3, scoreB: 0 });
    expect(state.match?.phase).toBe('matchEnd');
  });

  it('has no cap on rounds: draws score nothing and round 3 runs', () => {
    const state = begun(1);
    for (let round = 1; round <= 2; round++) {
      kill(state, 0, 1, 2, 3);
      step(state, []);
      expect(ofType(state, 'roundEnded')).toEqual([
        { type: 'roundEnded', round, winner: null, scoreA: 0, scoreB: 0 },
      ]);
      for (let i = 0; i < 179; i++) step(state, []);
      expect(state.events).toEqual([{ type: 'roundStarted', round: round + 1 }]);
    }
    expect(state.match).toMatchObject({ phase: 'round', round: 3, score: { A: 0, B: 0 } });
  });
});

describe('free play', () => {
  function free(): GameState {
    return createMatch(
      { teamSize: 2, players: config().players },
      openArena(),
      1,
      kits(),
    );
  }

  it('ends nothing when a team is wiped', () => {
    const state = free();
    kill(state, 2, 3);
    for (let i = 0; i < 400; i++) step(state, []);
    expect(state.events).toEqual([]);
    expect('match' in state).toBe(false);
  });

  it('moves a champion in the very first step', () => {
    const state = free();
    step(state, [input(1, 0, 0, 0, 0)]);
    expect(champion(state, 0).x).toBe(-11.908333333333333);
  });

  it('never starts a ring: nothing at the corner after 7400 steps', () => {
    const state = free();
    place(state, 0, 0, 0);
    place(state, 1, 14.5, 9.5);
    for (let i = 0; i < 7400; i++) step(state, []);
    expect(champion(state, 1).health).toBe(120);
    expect('match' in state).toBe(false);
    expect(state.events).toEqual([]);
  });
});
