import { describe, expect, it } from 'vitest';
import { Button, SLOTS, createMatch, step } from '../src/index';
import type {
  AbilityEffect,
  GameState,
  KitDef,
  MatchConfig,
  Obstacle,
  PlayerInput,
  SimEvent,
  Slot,
} from '../src/index';
import { resetAbilityState } from '../src/cast';
import { applyDamage } from '../src/health';
import { startDash } from '../src/motion';
import { applyKnockback, applyStatus } from '../src/status';
import { champion, checkInvariants, input, openArena, place } from './helpers';
import { kitWith, quiet, quietEx } from './kits';

// Champions 0 and 1 are team A, 2 and 3 team B. Champion 0 has the kit 'k0', 1 has 'k1', 2 has
// 'k2' and 3 has none, unless a test gives fewer kits. `state.tick` is the tick a step runs.
const CONFIG: MatchConfig = {
  teamSize: 2,
  players: [
    { championId: 'k0', team: 'A' },
    { championId: 'k1', team: 'A' },
    { championId: 'k2', team: 'B' },
    { championId: 'none', team: 'B' },
  ],
};

const NONE = { sourceId: 2, slot: null } as const;
const M1 = Button.M1;
const M2 = Button.M2;
const SPACE = Button.SPACE;
const Q = Button.Q;
const E = Button.E;
const R = Button.R;
const F = Button.F;
const SHIFT = Button.SHIFT;

function wall(x: number, y: number, w: number, h: number): Obstacle {
  return { type: 'rect', x, y, w, h, height: 1, blocksProjectiles: true };
}

/** Champion 0 stands at (-5, 0) and 2 at (5, 0); 1 and 3 are far away at y = 8. */
function setup(kits: KitDef[], obstacles: Obstacle[] = []): GameState {
  const state = createMatch(CONFIG, openArena(obstacles), 1, kits);
  place(state, 0, -5, 0);
  place(state, 1, -5, 8);
  place(state, 2, 5, 0);
  place(state, 3, 5, 8);
  return state;
}

/** One kit for champion 0 with the given slots; every other slot is `quiet()`. */
function solo(slots: Partial<Record<Slot, ReturnType<typeof quiet>>>, ex?: [Slot, Slot]): GameState {
  return setup([kitWith('k0', slots, ex ? { ex } : {})]);
}

interface Logged {
  tick: number;
  event: SimEvent;
}

/** Steps `ticks` times, giving each step the inputs for the tick it runs, and logs every event. */
function run(
  state: GameState,
  ticks: number,
  inputsAt: (tick: number) => (PlayerInput | undefined)[],
): Logged[] {
  const log: Logged[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = state.tick;
    step(state, inputsAt(tick));
    expect(checkInvariants(state)).toEqual([]);
    for (const event of state.events) log.push({ tick, event });
  }
  return log;
}

/** Champion 0 holds `buttons` and aims at (aimX, aimY) centimeters on every tick. */
function hold(buttons: number, aimX = 1000, aimY = 0, moveX: -1 | 0 | 1 = 0): (tick: number) => PlayerInput[] {
  return () => [input(moveX, 0, aimX, aimY, buttons)];
}

function of<T extends SimEvent['type']>(log: Logged[], type: T): { tick: number; event: Extract<SimEvent, { type: T }> }[] {
  return log.filter((l) => l.event.type === type) as { tick: number; event: Extract<SimEvent, { type: T }> }[];
}

function starts(log: Logged[]): [number, Slot, boolean][] {
  return of(log, 'castStarted').map((l) => [l.tick, l.event.slot, l.event.ex]);
}

function heal(amount = 1): AbilityEffect {
  return { type: 'heal', amount };
}

const SLAM: AbilityEffect = {
  type: 'area',
  placement: { type: 'self' },
  radius: 1,
  durationTicks: 1,
  intervalTicks: 1,
  targets: 'enemies',
  effects: [{ type: 'damage', amount: 1 }],
};

describe('cooldowns', () => {
  it('lets a held button cast again every cooldown ticks', () => {
    const state = solo({ M1: quiet({ cooldownTicks: 30 }) });
    const log = run(state, 61, hold(M1));
    expect(starts(log)).toEqual([[0, 'M1', false], [30, 'M1', false], [60, 'M1', false]]);
  });

  it('has no global cooldown: one slot never starts another', () => {
    const state = solo({ M1: quiet({ cooldownTicks: 30 }) });
    step(state, hold(M1)(0));
    expect(champion(state, 0).cooldowns).toEqual([30, 0, 0, 0, 0, 0, 0]);
    step(state, hold(M1 | M2)(1));
    expect(champion(state, 0).cooldowns).toEqual([29, 30, 0, 0, 0, 0, 0]);
  });

  it('counts down in SLOTS order for each slot and stops at 0', () => {
    const slots: Partial<Record<Slot, ReturnType<typeof quiet>>> = {};
    SLOTS.forEach((slot, i) => (slots[slot] = quiet({ cooldownTicks: 2 + i })));
    const state = solo(slots);
    step(state, hold(M1 | M2 | SPACE | Q | E | R)(0));
    // One cast per tick: R first.
    expect(champion(state, 0).cooldowns).toEqual([0, 0, 0, 0, 0, 7, 0]);
    for (let i = 0; i < 10; i++) step(state, []);
    expect(champion(state, 0).cooldowns).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('keeps counting during the windup, and an EX variant shares the cooldown', () => {
    const state = solo({ Q: quiet({ cooldownTicks: 30, windupTicks: 10, ex: quietEx({ windupTicks: 4 }) }) });
    const log = run(state, 11, hold(Q));
    expect(champion(state, 0).cooldowns[3]).toBe(20);
    expect(of(log, 'castFired').map((l) => l.tick)).toEqual([10]);
    expect(starts(log)).toEqual([[0, 'Q', false]]);
    // The EX variant of the same slot is on cooldown too, with energy to spare.
    champion(state, 0).energy = 100;
    step(state, hold(Q | SHIFT)(11));
    expect(state.events.some((e) => e.type === 'castStarted')).toBe(false);
    expect(champion(state, 0).energy).toBe(100);
  });
});

describe('priority and one cast per tick', () => {
  it('starts F, R, E, Q, SPACE, M2, M1 in that order, one per tick', () => {
    const state = solo({});
    champion(state, 0).energy = 100;
    const log = run(state, 9, hold(F | R | E | Q | SPACE | M2 | M1));
    expect(starts(log)).toEqual([
      [0, 'F', false],
      [1, 'R', false],
      [2, 'E', false],
      [3, 'Q', false],
      [4, 'SPACE', false],
      [5, 'M2', false],
      [6, 'M1', false],
    ]);
  });

  it('skips an F that lacks 100 energy and casts the next slot', () => {
    const state = solo({});
    champion(state, 0).energy = 99;
    step(state, hold(F | Q)(0));
    expect(starts([{ tick: 0, event: state.events[0] as SimEvent }])).toEqual([[0, 'Q', false]]);
    expect(champion(state, 0).cooldowns[6]).toBe(0);
    expect(champion(state, 0).energy).toBe(99);
  });

  it('casts the slot that is ready when a higher one is on cooldown', () => {
    const state = solo({ R: quiet({ cooldownTicks: 5 }) });
    const log = run(state, 6, hold(R | M1));
    expect(starts(log)).toEqual([[0, 'R', false], [1, 'M1', false], [5, 'R', false]]);
  });
});

describe('energy costs', () => {
  it('pays 25 for an EX variant and 100 for F, and reports the cost', () => {
    const ex = solo({});
    champion(ex, 0).energy = 100;
    step(ex, hold(M2 | SHIFT)(0));
    expect(champion(ex, 0).energy).toBe(75);
    expect(ex.events[0]).toMatchObject({ type: 'castStarted', slot: 'M2', ex: true, cost: 25 });

    const ult = solo({});
    champion(ult, 0).energy = 100;
    step(ult, hold(F)(0));
    expect(champion(ult, 0).energy).toBe(0);
    expect(ult.events[0]).toMatchObject({ type: 'castStarted', slot: 'F', ex: false, cost: 100 });

    const plain = solo({});
    champion(plain, 0).energy = 100;
    step(plain, hold(M2)(0));
    expect(champion(plain, 0).energy).toBe(100);
    expect(plain.events[0]).toMatchObject({ type: 'castStarted', slot: 'M2', ex: false, cost: 0 });
  });

  it('rejects an EX variant at 24 energy with no fallback, and tries the next slot', () => {
    const lone = solo({});
    champion(lone, 0).energy = 24;
    const none = run(lone, 3, hold(M2 | SHIFT));
    expect(of(none, 'castStarted')).toEqual([]);
    expect(champion(lone, 0).cooldowns).toEqual([0, 0, 0, 0, 0, 0, 0]);

    const state = solo({});
    champion(state, 0).energy = 24;
    const log = run(state, 1, hold(M2 | M1 | SHIFT));
    expect(starts(log)).toEqual([[0, 'M1', false]]);
    expect(champion(state, 0).cooldowns[1]).toBe(0);
  });

  it('casts the EX variant at exactly 25 energy', () => {
    const state = solo({});
    champion(state, 0).energy = 25;
    const log = run(state, 1, hold(M2 | SHIFT));
    expect(starts(log)).toEqual([[0, 'M2', true]]);
    expect(champion(state, 0).energy).toBe(0);
  });

  it('casts the normal ability for Shift on a slot without an EX variant', () => {
    const state = solo({});
    champion(state, 0).energy = 100;
    const log = run(state, 1, hold(M1 | SHIFT));
    expect(starts(log)).toEqual([[0, 'M1', false]]);
    expect(champion(state, 0).energy).toBe(100);
  });

  it('uses the EX windup and effects for the EX variant', () => {
    const state = solo({ M2: quiet({ windupTicks: 5, ex: quietEx({ windupTicks: 2 }) }) });
    champion(state, 0).energy = 50;
    const log = run(state, 7, hold(M2 | SHIFT));
    expect(of(log, 'castStarted')[0]?.event).toMatchObject({ windupTicks: 2, ex: true });
    expect(of(log, 'castFired').map((l) => [l.tick, l.event.ex])).toEqual([[2, true]]);
  });
});

describe('what stops a cast from starting', () => {
  it('does nothing for a dead champion, and keeps its cooldowns', () => {
    const state = solo({});
    applyDamage(state, 0, 1000, 2);
    const log = run(state, 3, hold(M1 | Q));
    expect(of(log, 'castStarted')).toEqual([]);
    expect(champion(state, 0).cooldowns).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('does nothing while stunned, then casts on the first free tick', () => {
    const state = solo({});
    applyStatus(state, 0, { type: 'stun', ticks: 10 }, NONE);
    const log = run(state, 12, hold(M1));
    expect(starts(log)).toEqual([[10, 'M1', false]]);
  });

  it('does nothing while silenced, SPACE included', () => {
    const state = solo({});
    applyStatus(state, 0, { type: 'silence', ticks: 10 }, NONE);
    const log = run(state, 12, hold(SPACE | M1));
    expect(starts(log)).toEqual([[10, 'SPACE', false], [11, 'M1', false]]);
  });

  it('does nothing while another windup runs, and starts the next cast in the turn it fires', () => {
    const state = solo({ Q: quiet({ windupTicks: 10 }) });
    const log = run(state, 12, hold(Q | M1));
    expect(starts(log)).toEqual([[0, 'Q', false], [10, 'M1', false]]);
    // The windup of Q fires first, then the instant M1 starts and fires in the same turn.
    expect(of(log, 'castFired').map((l) => [l.tick, l.event.slot])).toEqual([[10, 'Q'], [10, 'M1']]);
  });

  it('rejects a dash cast for a rooted champion at no cost, but not a teleport cast', () => {
    const dash: AbilityEffect = { type: 'dash', distance: 3, ticks: 3, then: [] };
    const blink: AbilityEffect = { type: 'teleport', range: 2, fixed: true };
    const state = solo({ SPACE: quiet({ effects: [dash] }), Q: quiet({ effects: [blink] }) });
    applyStatus(state, 0, { type: 'root', ticks: 10 }, NONE);
    const dashLog = run(state, 12, hold(SPACE));
    expect(starts(dashLog)).toEqual([[10, 'SPACE', false]]);

    const teleporter = solo({ Q: quiet({ effects: [blink] }) });
    applyStatus(teleporter, 0, { type: 'root', ticks: 10 }, NONE);
    const log = run(teleporter, 1, hold(Q));
    expect(starts(log)).toEqual([[0, 'Q', false]]);
    expect(champion(teleporter, 0).x).toBe(-3);
  });

  it('charges nothing for the rejected dash and falls through to the next slot', () => {
    const dash: AbilityEffect = { type: 'dash', distance: 3, ticks: 3, then: [] };
    const state = solo({ SPACE: quiet({ effects: [dash], ex: quietEx({ effects: [dash] }) }) }, ['SPACE', 'Q']);
    champion(state, 0).energy = 50;
    applyStatus(state, 0, { type: 'root', ticks: 10 }, NONE);
    const log = run(state, 1, hold(SPACE | M1 | SHIFT));
    expect(starts(log)).toEqual([[0, 'M1', false]]);
    expect(champion(state, 0).energy).toBe(50);
    expect(champion(state, 0).cooldowns[2]).toBe(0);
  });

  it('does nothing for a champion without a kit', () => {
    const state = solo({});
    champion(state, 3).energy = 100;
    const log = run(state, 3, () => [undefined, undefined, undefined, input(0, 0, 0, 0, 127 | SHIFT)]);
    expect(of(log, 'castStarted')).toEqual([]);
    expect(champion(state, 3).energy).toBe(100);
  });
});

describe('windups', () => {
  it('fires W ticks after it starts, with the aim of the fire tick', () => {
    const area: AbilityEffect = { ...SLAM, placement: { type: 'aim', range: 50 } };
    const state = solo({ E: quiet({ windupTicks: 5, effects: [area] }) });
    const aimAt = (tick: number) => (tick === 0 ? 1000 : 500);
    const log = run(state, 7, (tick) => [input(0, 0, aimAt(tick), 0, E)]);
    expect(of(log, 'castStarted').map((l) => l.tick)).toEqual([0]);
    expect(of(log, 'castFired').map((l) => l.tick)).toEqual([5]);
    expect(of(log, 'areaSpawned').map((l) => [l.tick, l.event.x, l.event.y])).toEqual([[5, 5, 0]]);
  });

  it('stores the windup while it runs and clears it before the effects fire', () => {
    const state = solo({ E: quiet({ windupTicks: 3 }) });
    step(state, hold(E)(0));
    expect(champion(state, 0).cast).toEqual({ castId: 4, slot: 'E', ex: false, windupTicks: 3, windupLeft: 3 });
    step(state, hold(E)(1));
    expect(champion(state, 0).cast).toMatchObject({ windupLeft: 2 });
    step(state, hold(E)(2));
    expect(champion(state, 0).cast).toMatchObject({ windupLeft: 1 });
    step(state, hold(E)(3));
    expect(champion(state, 0).cast).toBeNull();
    expect(state.events.map((e) => e.type)).toEqual(['castFired']);
  });

  it('emits castFired before the first effect', () => {
    const state = solo({ E: quiet({ windupTicks: 0, effects: [SLAM, heal()] }) });
    const log = run(state, 1, hold(E));
    expect(log.map((l) => l.event.type)).toEqual([
      'castStarted', 'castFired', 'areaSpawned', 'areaTick', 'areaExpired',
    ]);
  });

  it('fires a windup of 0 in the turn it starts and never stores it', () => {
    const state = solo({ E: quiet({ windupTicks: 0 }) });
    step(state, hold(E)(0));
    expect(champion(state, 0).cast).toBeNull();
    expect(state.events.map((e) => e.type)).toEqual(['castStarted', 'castFired']);
  });

  it('starts a new cast in the turn the last one fires', () => {
    const state = solo({ Q: quiet({ cooldownTicks: 3, windupTicks: 3 }) });
    const log = run(state, 10, hold(Q));
    expect(starts(log).map(([tick]) => tick)).toEqual([0, 3, 6, 9]);
    expect(of(log, 'castFired').map((l) => l.tick)).toEqual([3, 6, 9]);
    // The fire comes before the next start in the same turn.
    expect(log.filter((l) => l.tick === 3).map((l) => l.event.type)).toEqual(['castFired', 'castStarted']);
  });

  it('hands out cast ids from the shared entity counter', () => {
    const projectile: AbilityEffect = {
      type: 'projectile', speed: 10, radius: 0.3, lifetimeTicks: 3, pierce: false, effects: [{ type: 'damage', amount: 1 }],
    };
    const state = solo({ E: quiet({ effects: [projectile] }) });
    step(state, hold(E)(0));
    expect(state.events[0]).toMatchObject({ type: 'castStarted', castId: 4 });
    expect(state.projectiles[0]).toMatchObject({ id: 5, castId: 4 });
    expect(state.nextEntityId).toBe(6);
  });
});

describe('movement during a windup', () => {
  const walk = (kit: KitDef['slots']['E'], moveSpeed = 5.5, ticks = 4) => {
    const state = setup([kitWith('k0', { E: kit }, { moveSpeed })]);
    const vx: number[] = [];
    for (let i = 0; i < ticks; i++) {
      step(state, [input(1, 0, 1000, 0, E)]);
      vx.push(champion(state, 0).vx);
    }
    return { state, vx };
  };

  it('walks at full speed for free, 2.75 for slowed and 0 for locked, until the fire tick', () => {
    expect(walk(quiet({ windupTicks: 3, movement: 'free' })).vx).toEqual([5.5, 5.5, 5.5, 5.5]);
    expect(walk(quiet({ windupTicks: 3, movement: 'slowed' })).vx).toEqual([2.75, 2.75, 2.75, 5.5]);
    expect(walk(quiet({ windupTicks: 3, movement: 'locked' })).vx).toEqual([0, 0, 0, 5.5]);
  });

  it('halves the kit move speed, not the base speed', () => {
    expect(walk(quiet({ windupTicks: 3, movement: 'slowed' }), 6).vx).toEqual([3, 3, 3, 6]);
  });

  it('halves the speed after slow and haste', () => {
    const state = setup([kitWith('k0', { E: quiet({ windupTicks: 3, movement: 'slowed' }) })]);
    applyStatus(state, 0, { type: 'slow', percent: 30, ticks: 100 }, NONE);
    step(state, [input(1, 0, 1000, 0, E)]);
    expect(champion(state, 0).vx).toBeCloseTo(5.5 * 0.7 * 0.5, 12);
    const hasted = setup([kitWith('k0', { E: quiet({ windupTicks: 3, movement: 'slowed' }) })]);
    applyStatus(hasted, 0, { type: 'haste', percent: 20, ticks: 100 }, NONE);
    step(hasted, [input(1, 0, 1000, 0, E)]);
    expect(champion(hasted, 0).vx).toBeCloseTo(5.5 * 1.2 * 0.5, 12);
  });

  it('moves the champion by its velocity, and not at all while locked', () => {
    const { state } = walk(quiet({ windupTicks: 3, movement: 'locked' }), 5.5, 3);
    expect(champion(state, 0).x).toBe(-5);
    const free = walk(quiet({ windupTicks: 3, movement: 'free' }), 5.5, 3).state;
    expect(champion(free, 0).x).toBeCloseTo(-5 + 3 * (5.5 / 60), 12);
  });

  it('leaves a champion without a kit at 5.5 and unaffected by anyone else', () => {
    const state = setup([kitWith('k0', { E: quiet({ windupTicks: 3, movement: 'locked' }) })]);
    step(state, [input(1, 0, 1000, 0, E), undefined, undefined, input(1, 0, 0, 0, 0)]);
    expect(champion(state, 3).vx).toBe(5.5);
  });

  it('still pushes a champion in a locked windup with a knockback', () => {
    const state = setup([kitWith('k0', { E: quiet({ windupTicks: 5, movement: 'locked' }) })]);
    step(state, [input(0, 0, 1000, 0, E)]);
    applyKnockback(state, 0, { dirX: 1, dirY: 0, distance: 1.5, ticks: 3 }, NONE);
    step(state, [input(1, 0, 1000, 0, E)]);
    expect(champion(state, 0).vx).toBe(0);
    expect(champion(state, 0).x).toBeCloseTo(-5 + 0.75, 12);
    expect(champion(state, 0).cast).not.toBeNull();
  });
});

describe('interrupts', () => {
  const windingQ = () => solo({ Q: quiet({ cooldownTicks: 30, windupTicks: 10, ex: quietEx({ windupTicks: 10 }) }) });

  it('a stun drops the cast with no refund, and the cooldown keeps running', () => {
    const state = windingQ();
    champion(state, 0).energy = 50;
    run(state, 3, (tick) => [input(0, 0, 1000, 0, tick === 0 ? Q | SHIFT : 0)]);
    expect(champion(state, 0).energy).toBe(25);
    expect(champion(state, 0).cooldowns[3]).toBe(28);
    state.events.length = 0;
    applyStatus(state, 0, { type: 'stun', ticks: 5 }, NONE);
    expect(state.events.map((e) => e.type)).toEqual(['statusApplied', 'castInterrupted']);
    expect(state.events[1]).toEqual({
      type: 'castInterrupted', championId: 0, castId: 4, slot: 'Q', ex: true, reason: 'stun',
    });
    expect(champion(state, 0).cast).toBeNull();
    const log = run(state, 20, hold(0));
    expect(of(log, 'castFired')).toEqual([]);
    expect(champion(state, 0).energy).toBe(25);
    expect(champion(state, 0).cooldowns[3]).toBe(8);
    expect(state.casts).toEqual([]);
  });

  it('death drops the cast', () => {
    const state = windingQ();
    run(state, 3, (tick) => [input(0, 0, 1000, 0, tick === 0 ? Q : 0)]);
    state.events.length = 0;
    applyDamage(state, 0, 1000, 2);
    expect(state.events.map((e) => e.type)).toEqual(['damage', 'death', 'castInterrupted']);
    expect(state.events[2]).toMatchObject({ reason: 'death', slot: 'Q', ex: false, castId: 4 });
    expect(champion(state, 0).cast).toBeNull();
    const log = run(state, 20, hold(0));
    expect(of(log, 'castFired')).toEqual([]);
    expect(state.casts).toEqual([]);
  });

  it('silence, root, slow and knockback do not interrupt: the cast fires on time', () => {
    const state = windingQ();
    run(state, 2, (tick) => [input(0, 0, 1000, 0, tick === 0 ? Q : 0)]);
    applyStatus(state, 0, { type: 'silence', ticks: 40 }, NONE);
    applyStatus(state, 0, { type: 'root', ticks: 40 }, NONE);
    applyStatus(state, 0, { type: 'slow', percent: 30, ticks: 40 }, NONE);
    applyKnockback(state, 0, { dirX: 0, dirY: 1, distance: 1, ticks: 6 }, NONE);
    const log = run(state, 9, hold(0));
    expect(of(log, 'castInterrupted')).toEqual([]);
    expect(of(log, 'castFired').map((l) => l.tick)).toEqual([10]);
  });

  it('a stun from a lower-numbered champion interrupts before the windup advances', () => {
    const stunArc: AbilityEffect = {
      type: 'meleeArc', radius: 6, cosHalfAngle: -1, effects: [{ type: 'applyStatus', status: { type: 'stun', ticks: 30 } }],
    };
    const state = setup([
      kitWith('k0', { M1: quiet({ effects: [stunArc] }) }),
      kitWith('k2', { Q: quiet({ windupTicks: 10 }) }),
    ]);
    place(state, 2, -2, 0);
    const log = run(state, 6, (tick) => [input(0, 0, 1000, 0, tick === 4 ? M1 : 0), undefined, input(0, 0, 0, 0, Q)]);
    expect(of(log, 'castStarted').map((l) => [l.tick, l.event.championId])).toEqual([[0, 2], [4, 0]]);
    expect(log.filter((l) => l.tick === 4).map((l) => l.event.type)).toEqual([
      'castStarted', 'castFired', 'meleeArc', 'statusApplied', 'castInterrupted',
    ]);
    expect(of(log, 'castFired').map((l) => l.event.championId)).toEqual([0]);
  });
});

describe('event order at interrupts', () => {
  /** Champion 0 dashes from tick 0 and starts a windup at tick 1. */
  function dashingAndWinding(): GameState {
    const dash: AbilityEffect = { type: 'dash', distance: 6, ticks: 6, then: [] };
    const state = solo({ SPACE: quiet({ effects: [dash] }), M1: quiet({ windupTicks: 8 }) });
    run(state, 3, (tick) => [input(0, 0, 1000, 0, tick === 0 ? SPACE : M1)]);
    expect(champion(state, 0).dash).not.toBeNull();
    expect(champion(state, 0).cast).not.toBeNull();
    return state;
  }

  it('casting is not blocked while dashing', () => {
    const state = dashingAndWinding();
    expect(champion(state, 0).dash?.ticksLeft).toBe(3);
  });

  it('a stun emits statusApplied, dashEnded and then castInterrupted', () => {
    const state = dashingAndWinding();
    state.events.length = 0;
    applyStatus(state, 0, { type: 'stun', ticks: 5 }, NONE);
    expect(state.events.map((e) => e.type)).toEqual(['statusApplied', 'dashEnded', 'castInterrupted']);
    expect(state.events[1]).toMatchObject({ reason: 'stunned' });
    expect(state.events[2]).toMatchObject({ reason: 'stun' });
  });

  it('death emits damage, death, each statusExpired, dashEnded and castInterrupted', () => {
    const state = dashingAndWinding();
    applyStatus(state, 0, { type: 'slow', percent: 30, ticks: 50 }, NONE);
    applyStatus(state, 0, { type: 'haste', percent: 20, ticks: 50 }, NONE);
    state.events.length = 0;
    applyDamage(state, 0, 1000, 2);
    expect(state.events.map((e) => e.type)).toEqual([
      'damage', 'death', 'statusExpired', 'statusExpired', 'dashEnded', 'castInterrupted',
    ]);
    expect(state.events[4]).toMatchObject({ reason: 'death' });
    expect(state.events[5]).toMatchObject({ reason: 'death' });
  });
});

describe('area placement', () => {
  type Placement = { type: 'self' } | { type: 'ahead'; distance: number } | { type: 'aim'; range: number };

  /** Where the area of an instant M1 lands when `caster` aims at (aimX, aimY) centimeters. */
  const placed = (placement: Placement, aimX: number, aimY = 0, caster: 0 | 2 = 0): [number, number] => {
    const effect: AbilityEffect = { ...SLAM, placement };
    const state = setup([
      kitWith('k0', caster === 0 ? { M1: quiet({ effects: [effect] }) } : {}),
      kitWith('k1'),
      kitWith('k2', caster === 2 ? { M1: quiet({ effects: [effect] }) } : {}),
    ]);
    const inputs: PlayerInput[] = [];
    inputs[caster] = input(0, 0, aimX, aimY, M1);
    step(state, inputs);
    const spawned = state.events.find((e) => e.type === 'areaSpawned');
    if (spawned?.type !== 'areaSpawned') throw new Error('no area spawned');
    return [spawned.x, spawned.y];
  };

  it('self centres the area on the caster', () => {
    expect(placed({ type: 'self' }, 1000)).toEqual([-5, 0]);
    expect(placed({ type: 'self' }, 1000, 0, 2)).toEqual([5, 0]);
  });

  it('ahead goes the distance along the direction of the aim', () => {
    expect(placed({ type: 'ahead', distance: 3 }, 1000)).toEqual([-2, 0]);
    expect(placed({ type: 'ahead', distance: 3 }, -1000)).toEqual([-8, 0]);
    expect(placed({ type: 'ahead', distance: 3 }, -500, 400)).toEqual([-5, 3]);
  });

  it('aim goes to the aim point, and no farther than the range', () => {
    expect(placed({ type: 'aim', range: 4 }, 1000)).toEqual([-1, 0]);
    expect(placed({ type: 'aim', range: 4 }, -300)).toEqual([-3, 0]);
    expect(placed({ type: 'aim', range: 4 }, -500, 300)).toEqual([-5, 3]);
    expect(placed({ type: 'aim', range: 4 }, -500, 900)).toEqual([-5, 4]);
  });

  it('falls back to +x for team A and -x for team B when the aim is on the caster', () => {
    expect(placed({ type: 'ahead', distance: 3 }, -500, 0)).toEqual([-2, 0]);
    expect(placed({ type: 'ahead', distance: 3 }, 500, 0, 2)).toEqual([2, 0]);
    // With the aim on the caster the aim point is no distance away.
    expect(placed({ type: 'aim', range: 4 }, -500, 0)).toEqual([-5, 0]);
    expect(placed({ type: 'aim', range: 4 }, 500, 0, 2)).toEqual([5, 0]);
  });
});

describe('teleport', () => {
  const blink = (fixed: boolean, range = 4): KitDef['slots']['M1'] =>
    quiet({ effects: [{ type: 'teleport', range, fixed }] });

  it('a fixed teleport goes exactly the range toward the aim', () => {
    for (const aimX of [1000, -400, -490]) {
      const state = solo({ M1: blink(true) });
      step(state, [input(0, 0, aimX, 0, M1)]);
      const toward = aimX > -500 ? 1 : -1;
      // The aim at -400 is 1 m to the right of the caster, and at -490 is 0.1 m to the right.
      expect(champion(state, 0).x, String(aimX)).toBe(-5 + 4 * toward);
    }
  });

  it('an up-to teleport goes to the aim, and no farther than the range', () => {
    const near = solo({ M1: blink(false) });
    step(near, [input(0, 0, -300, 0, M1)]);
    expect(champion(near, 0).x).toBe(-3);
    const far = solo({ M1: blink(false) });
    step(far, [input(0, 0, 1000, 0, M1)]);
    expect(champion(far, 0).x).toBe(-1);
    expect(far.events.map((e) => e.type)).toEqual(['castStarted', 'castFired', 'teleport']);
    expect(far.events[2]).toMatchObject({ fromX: -5, toX: -1, blocked: false });
  });

  it('stays put when the aim is on the caster, going nowhere when not fixed and the team forward when fixed', () => {
    const upTo = solo({ M1: blink(false) });
    step(upTo, [input(0, 0, -500, 0, M1)]);
    expect(champion(upTo, 0).x).toBe(-5);
    const fixed = solo({ M1: blink(true) });
    step(fixed, [input(0, 0, -500, 0, M1)]);
    expect(champion(fixed, 0).x).toBe(-1);
  });

  it('a blocked teleport leaves the caster where it is but still pays the cost and the cooldown', () => {
    const state = setup(
      [kitWith('k0', { Q: quiet({ cooldownTicks: 40, ex: quietEx({ effects: [{ type: 'teleport', range: 4, fixed: true }] }) }) })],
      [wall(-3, 0, 1, 4)],
    );
    champion(state, 0).energy = 30;
    step(state, [input(0, 0, 1000, 0, Q | SHIFT)]);
    expect(champion(state, 0).x).toBe(-5);
    expect(state.events.find((e) => e.type === 'teleport')).toMatchObject({ blocked: true, toX: -5 });
    expect(champion(state, 0).energy).toBe(5);
    expect(champion(state, 0).cooldowns[3]).toBe(40);
  });

  it('acts where the caster stands: a teleport and then an arc swing where it arrives', () => {
    const arc: AbilityEffect = {
      type: 'meleeArc', radius: 1.5, cosHalfAngle: -1, effects: [{ type: 'damage', amount: 20 }],
    };
    const state = solo({ R: quiet({ effects: [{ type: 'teleport', range: 6, fixed: true }, arc] }) });
    place(state, 2, 2, 0);
    place(state, 3, -5, 1.2);
    step(state, [input(0, 0, 1000, 0, R)]);
    expect(champion(state, 0).x).toBe(1);
    expect(champion(state, 2).health).toBe(100);
    expect(champion(state, 3).health).toBe(120);
    expect(state.events.map((e) => e.type)).toEqual([
      'castStarted', 'castFired', 'teleport', 'meleeArc', 'damage', 'energyGained',
    ]);
    expect(state.events[3]).toMatchObject({ x: 1, y: 0, targetIds: [2] });
  });
});

describe('dash and then', () => {
  const marker: AbilityEffect = { ...SLAM, placement: { type: 'self' } };
  const dashing = (then: AbilityEffect[], distance = 5, ticks = 5): KitDef['slots']['M1'] =>
    quiet({ effects: [{ type: 'dash', distance, ticks, then: then as never }] });

  it('starts the dash in the turn it fires and moves the caster in the same turn', () => {
    const state = solo({ SPACE: dashing([]) });
    step(state, [input(0, 0, 1000, 0, SPACE)]);
    expect(champion(state, 0).x).toBe(-4);
    expect(champion(state, 0).dash).toMatchObject({ dirX: 1, dirY: 0, stepLength: 1, ticksLeft: 4, castId: 4 });
    expect(state.events.map((e) => e.type)).toEqual(['castStarted', 'castFired', 'dashStarted']);
  });

  it('fires then where a completed dash ends, after dashEnded', () => {
    const state = solo({ SPACE: dashing([marker]) });
    const log = run(state, 6, hold(SPACE));
    const ticks = log.filter((l) => l.event.type === 'dashEnded' || l.event.type === 'areaSpawned');
    expect(ticks.map((l) => [l.tick, l.event.type])).toEqual([[4, 'dashEnded'], [4, 'areaSpawned']]);
    expect(of(log, 'dashEnded')[0]?.event).toMatchObject({ reason: 'complete', x: 0, y: 0 });
    expect(of(log, 'areaSpawned')[0]?.event).toMatchObject({ x: 0, y: 0 });
  });

  it('fires then where a blocked dash stopped', () => {
    const state = setup([kitWith('k0', { SPACE: dashing([marker], 8, 8) })], [wall(-1, 0, 1, 4)]);
    const log = run(state, 8, hold(SPACE));
    expect(of(log, 'dashEnded').map((l) => l.event.reason)).toEqual(['blocked']);
    const spawned = of(log, 'areaSpawned');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.event.x).toBeCloseTo(-2, 6);
    expect(spawned[0]?.tick).toBe(of(log, 'dashEnded')[0]?.tick);
  });

  it('fires then where a rooted dash ended, in the tick the root is seen', () => {
    const state = solo({ SPACE: dashing([marker]) });
    run(state, 3, hold(SPACE));
    applyStatus(state, 0, { type: 'root', ticks: 30 }, NONE);
    state.events.length = 0;
    step(state, hold(SPACE)(3));
    expect(state.events.map((e) => e.type)).toEqual(['dashEnded', 'areaSpawned', 'areaTick', 'areaExpired']);
    expect(state.events[0]).toMatchObject({ reason: 'rooted', x: -2 });
    expect(state.events[1]).toMatchObject({ x: -2, y: 0 });
  });

  it('drops then when a stun, a death or a new dash ends the dash', () => {
    for (const end of ['stun', 'death', 'replaced'] as const) {
      const state = solo({ SPACE: dashing([marker]) });
      run(state, 2, hold(SPACE));
      if (end === 'stun') applyStatus(state, 0, { type: 'stun', ticks: 3 }, NONE);
      else if (end === 'death') applyDamage(state, 0, 1000, 2);
      else startDash(state, 0, { dirX: 0, dirY: 1, distance: 1, ticks: 2 });
      const log = run(state, 8, hold(0));
      expect(of(log, 'areaSpawned'), end).toEqual([]);
      expect(state.casts, end).toEqual([]);
    }
  });

  it('takes the dash direction and the aim of the tick the dash ends', () => {
    const state = solo({
      SPACE: dashing([{ ...marker, placement: { type: 'aim', range: 50 } }]),
    });
    run(state, 4, hold(SPACE, 1000, 0));
    // The last tick of the dash: the aim is now (3, 4) from the end point (0, 0), 5 m away.
    const log = run(state, 1, hold(SPACE, 300, 400));
    expect(of(log, 'areaSpawned')[0]?.event).toMatchObject({ x: 5, y: 0 });
  });

  it('skips the dash for a champion that is rooted at fire time and fires then at once', () => {
    const effects: AbilityEffect[] = [
      { type: 'dash', distance: 5, ticks: 5, then: [{ type: 'applyStatus', status: { type: 'haste', percent: 20, ticks: 30 } }] },
      { type: 'shield', absorb: 5, ticks: 30 },
    ];
    const state = solo({ SPACE: quiet({ windupTicks: 5, effects }) });
    run(state, 2, hold(SPACE));
    applyStatus(state, 0, { type: 'root', ticks: 40 }, NONE);
    state.events.length = 0;
    const log = run(state, 4, hold(SPACE));
    expect(log.map((l) => [l.tick, l.event.type])).toEqual([
      [5, 'castFired'], [5, 'statusApplied'], [5, 'statusApplied'],
    ]);
    expect(of(log, 'statusApplied').map((l) => [l.event.status, l.event.slot, l.event.sourceId])).toEqual([
      ['haste', 'SPACE', 0], ['shield', 'SPACE', 0],
    ]);
    expect(champion(state, 0).x).toBe(-5);
    expect(champion(state, 0).dash).toBeNull();
  });

  it('runs a dash with its then when not rooted, and the effects after it act at the start', () => {
    const effects: AbilityEffect[] = [
      { type: 'dash', distance: 5, ticks: 5, then: [marker] },
      { ...marker, placement: { type: 'self' } },
    ];
    const state = solo({ SPACE: quiet({ effects }) });
    const log = run(state, 6, hold(SPACE));
    // The area listed after the dash is at the caster's start position -5 (the dash only moves it
    // later in the tick), the one in then is where the dash ends, 0.
    expect(of(log, 'areaSpawned').map((l) => [l.tick, l.event.x])).toEqual([[0, -5], [4, 0]]);
  });

  it('replaces a running dash with a new cast, dropping the first then', () => {
    const first = dashing([marker], 5, 50);
    const state = solo({ SPACE: { ...first, cooldownTicks: 1 } });
    const log = run(state, 120, (tick) => [input(0, 0, tick < 1 ? 1000 : -1000, 0, tick < 2 ? SPACE : 0)]);
    expect(of(log, 'dashEnded').map((l) => l.event.reason)).toEqual(['replaced', 'complete']);
  });
});

describe('top-level effects on the caster', () => {
  it('apply statuses and shields with the slot of the cast and never give energy', () => {
    const state = solo({
      Q: quiet({
        effects: [
          { type: 'applyStatus', status: { type: 'haste', percent: 20, ticks: 30 } },
          { type: 'shield', absorb: 10, ticks: 60 },
          { type: 'heal', amount: 10 },
        ],
      }),
    });
    champion(state, 0).health = 100;
    step(state, hold(Q)(0));
    expect(champion(state, 0).statuses).toEqual([
      { type: 'haste', sourceId: 0, slot: 'Q', remainingTicks: 29, percent: 20 },
      { type: 'shield', sourceId: 0, slot: 'Q', remainingTicks: 59, absorb: 10 },
    ]);
    expect(champion(state, 0).health).toBe(110);
    expect(champion(state, 0).energy).toBe(0);
  });
});

describe('cast records', () => {
  const projectile: AbilityEffect = {
    type: 'projectile', speed: 10, radius: 0.3, lifetimeTicks: 3, pierce: false, effects: [{ type: 'damage', amount: 1 }],
  };

  it('are dropped in the step that leaves nothing referring to them', () => {
    const arc: AbilityEffect = { type: 'meleeArc', radius: 1, cosHalfAngle: -1, effects: [{ type: 'damage', amount: 1 }] };
    const instant = solo({ M1: quiet({ effects: [arc] }) });
    step(instant, hold(M1)(0));
    expect(instant.casts).toEqual([]);
    expect(instant.nextEntityId).toBe(5);

    const winding = solo({ E: quiet({ windupTicks: 3 }) });
    step(winding, hold(E)(0));
    expect(winding.casts).toEqual([{ id: 4, casterId: 0, slot: 'E', ex: false, credited: [] }]);
    run(winding, 3, hold(0));
    expect(winding.casts).toEqual([]);
  });

  it('live as long as a projectile of the cast does', () => {
    const state = solo({ E: quiet({ effects: [projectile] }) });
    step(state, hold(E)(0));
    expect(state.casts).toHaveLength(1);
    step(state, hold(0)(1));
    expect(state.casts).toHaveLength(1);
    step(state, hold(0)(2));
    expect(state.projectiles).toEqual([]);
    expect(state.casts).toEqual([]);
  });

  it('live as long as an area, and as long as a dash with its then', () => {
    const longArea: AbilityEffect = { ...SLAM, durationTicks: 4, intervalTicks: 2 };
    const area = solo({ E: quiet({ effects: [longArea] }) });
    run(area, 3, hold(E));
    expect(area.casts).toHaveLength(1);
    run(area, 1, hold(0));
    expect(area.casts).toEqual([]);

    const dash = solo({ SPACE: quiet({ effects: [{ type: 'dash', distance: 4, ticks: 4, then: [] }] }) });
    run(dash, 3, hold(SPACE));
    expect(dash.casts).toHaveLength(1);
    run(dash, 1, hold(0));
    expect(dash.casts).toEqual([]);
  });
});

describe('ids and records of casts by several champions in one tick', () => {
  it('a status or push a cast lands acts in the target turn of the same tick for a higher id only', () => {
    const push: AbilityEffect = {
      type: 'meleeArc', radius: 4, cosHalfAngle: -1,
      effects: [{ type: 'knockback', distance: 1.5, ticks: 3, direction: 'away' }],
    };
    const state = setup([kitWith('k0', { M1: quiet({ effects: [push] }) }), kitWith('k1'), kitWith('k2', { M1: quiet({ effects: [push] }) })]);
    place(state, 0, -1, 0);
    place(state, 2, 1, 0);
    step(state, [input(0, 0, 1000, 0, M1), undefined, input(0, 0, -1000, 0, M1)]);
    // Champion 0 pushed champion 2 before its turn, so 2 already moved 0.75 m; champion 2 pushed
    // champion 0 after its turn, so 0 has not moved yet.
    expect(champion(state, 2).x).toBeCloseTo(1.75, 12);
    expect(champion(state, 0).x).toBe(-1);
    step(state, []);
    expect(champion(state, 0).x).toBeCloseTo(-1.75, 12);
    expect(champion(state, 2).x).toBeCloseTo(2.25, 12);
  });

  it('a stun lasts exactly its ticks of its holder, however the casts are ordered', () => {
    const stunArc: AbilityEffect = {
      type: 'meleeArc', radius: 6, cosHalfAngle: -1, effects: [{ type: 'applyStatus', status: { type: 'stun', ticks: 3 } }],
    };
    const stunner = quiet({ cooldownTicks: 30, effects: [stunArc] });
    const every = quiet({ cooldownTicks: 1 });
    // Champion 0 stuns champion 2 in tick 0, before 2's turn: 2 skips ticks 0, 1 and 2.
    const forward = setup([kitWith('k0', { M1: stunner }), kitWith('k1'), kitWith('k2', { Q: every })]);
    place(forward, 2, -2, 0);
    const first = run(forward, 5, (tick) => [tick === 0 ? input(0, 0, 1000, 0, M1) : undefined, undefined, input(0, 0, 0, 0, Q)]);
    expect(of(first, 'castStarted').filter((l) => l.event.championId === 2).map((l) => l.tick)).toEqual([3, 4]);
    // Champion 2 stuns champion 0 in tick 0, after 0's turn: 0 cast at tick 0 and skips 1, 2 and 3.
    const backward = setup([kitWith('k0', { Q: every }), kitWith('k1'), kitWith('k2', { M1: stunner })]);
    place(backward, 2, -2, 0);
    const second = run(backward, 6, (tick) => [input(0, 0, 1000, 0, Q), undefined, tick === 0 ? input(0, 0, -1000, 0, M1) : undefined]);
    expect(of(second, 'castStarted').filter((l) => l.event.championId === 0).map((l) => l.tick)).toEqual([0, 4, 5]);
  });
});

describe('resetAbilityState', () => {
  it('clears energy, cooldowns, windup, dash, statuses and casts, and the cast ids of live entities', () => {
    const projectile: AbilityEffect = {
      type: 'projectile', speed: 10, radius: 0.3, lifetimeTicks: 50, pierce: false, effects: [{ type: 'damage', amount: 1 }],
    };
    const state = solo({
      E: quiet({ effects: [projectile] }),
      Q: quiet({ windupTicks: 20 }),
      SPACE: quiet({ effects: [{ type: 'dash', distance: 9, ticks: 9, then: [] }] }),
    });
    champion(state, 0).energy = 60;
    run(state, 3, (tick) => [input(0, 0, 1000, 0, tick === 0 ? E : tick === 1 ? SPACE : Q)]);
    applyStatus(state, 0, { type: 'haste', percent: 20, ticks: 99 }, NONE);
    expect(champion(state, 0).cast).not.toBeNull();
    expect(champion(state, 0).dash).not.toBeNull();
    expect(state.projectiles[0]?.castId).toBe(4);
    const { x, health } = champion(state, 0);
    state.events.length = 0;

    resetAbilityState(state);

    expect(champion(state, 0).energy).toBe(0);
    expect(champion(state, 0).cooldowns).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(champion(state, 0).cast).toBeNull();
    expect(champion(state, 0).dash).toBeNull();
    expect(champion(state, 0).statuses).toEqual([]);
    expect(state.casts).toEqual([]);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0]?.castId).toBeNull();
    expect(state.kits).toHaveLength(1);
    expect(state.events).toEqual([]);
    expect([champion(state, 0).x, champion(state, 0).health]).toEqual([x, health]);
    // The state still runs: nothing refers to a dropped cast.
    for (let i = 0; i < 60; i++) step(state, []);
    expect(state.projectiles).toEqual([]);
  });
});
