// The on-hit counter (rules.md section 2.6, v3 design section 4.4a). The unit tests register casts
// by hand and call `landHit`, as energy.test.ts does; the decay, the pause and the round reset run
// through `step`. No shipped kit declares a counter, so every kit here is a test kit.
import { describe, expect, it } from 'vitest';
import { Button, checksum, cloneState, createMatch, debug, step } from '../src/index';
import type { AbilityEffect, Effect, GameState, KitDef, MatchConfig, PlayerInput, Slot, SlotSpec } from '../src/index';
import { spawnArea } from '../src/area';
import { spendCounter } from '../src/counter';
import { landHit } from '../src/energy';
import { applyDamage } from '../src/health';
import { meleeArc } from '../src/melee';
import { spawnProjectile } from '../src/projectile';
import { nextRandom } from '../src/rng';
import { nextId } from '../src/state';
import { applyShield, applyStatus } from '../src/status';
import { arena01, checkAbilityInvariants, champion, input, openArena, place } from './helpers';
import { STRIKER_ID, kitWith, testStriker } from './kits';

// Champion 0 is the archer with a counter (Q builds it, cap 3, window 120); champion 1 is its
// ally, 2 and 3 are the enemies. Only the archer has a counter.
const CONFIG: MatchConfig = {
  teamSize: 2,
  players: [
    { championId: 'arch', team: 'A' },
    { championId: 'dps', team: 'A' },
    { championId: 'dps', team: 'B' },
    { championId: 'arch', team: 'B' },
  ],
};
const WINDOW = 120;

function archer(cap = 3, windowTicks = WINDOW, from: Slot = 'Q'): KitDef {
  return { ...kitWith('arch'), counter: { from, cap, windowTicks } };
}

function setup(cap = 3, windowTicks = WINDOW, extra: Partial<MatchConfig> = {}): GameState {
  const state = createMatch({ ...CONFIG, ...extra }, openArena(), 1, [archer(cap, windowTicks), kitWith('dps')]);
  place(state, 0, -3, 0);
  place(state, 1, -3, 5);
  place(state, 2, 3, 0);
  place(state, 3, 3, 5);
  return state;
}

function newCast(state: GameState, casterId: number, slot: Slot, ex = false): number {
  const id = nextId(state);
  state.casts.push({ id, casterId, slot, ex, credited: [] });
  return id;
}

const ORIGIN = { x: 0, y: 0 };
const DAMAGE: Effect[] = [{ type: 'damage', amount: 10 }];

function hit(
  state: GameState,
  castId: number | null,
  targetId: number,
  effects: readonly Effect[] = DAMAGE,
  ownerId = 0,
): void {
  landHit(state, { ownerId, castId }, targetId, effects, ORIGIN);
}

const phaseOf = (state: GameState) => state.match?.phase;
const counterOf = (state: GameState, id = 0) => champion(state, id).counter;

/** A projectile of the archer's cast `castId` that reaches champion 2 in about 15 steps. */
function bolt(extra: Partial<Parameters<typeof spawnProjectile>[1]> = {}) {
  return {
    ownerId: 0, x: -1, y: 0, dirX: 1, dirY: 0, speed: 20, radius: 0.3, lifetimeTicks: 40,
    pierce: false, effects: DAMAGE, ...extra,
  };
}

describe('the counter state', () => {
  it('starts at 0 on a champion whose kit declares a counter, and is no key on any other', () => {
    const state = setup();
    expect(counterOf(state, 0)).toEqual({ count: 0, lastHitTick: 0 });
    expect(counterOf(state, 3)).toEqual({ count: 0, lastHitTick: 0 });
    for (const id of [1, 2]) expect('counter' in champion(state, id)).toBe(false);
  });

  it('leaves no key at all when no kit declares a counter, and for a champion with no kit', () => {
    const state = createMatch(CONFIG, openArena(), 1, [kitWith('dps')]);
    for (const c of state.champions) expect('counter' in c).toBe(false);
    expect(Object.keys(champion(state, 0)).sort()).toEqual(
      ['aimX', 'aimY', 'alive', 'cast', 'championId', 'cooldowns', 'dash', 'energy', 'facing', 'health', 'id', 'maxHealth', 'statuses', 'team', 'vx', 'vy', 'x', 'y'].sort(),
    );
  });

  it('is covered by the checksum, and survives a clone', () => {
    const state = setup();
    const before = checksum(state);
    (counterOf(state) as { count: number }).count = 1;
    expect(checksum(state)).not.toBe(before);
    (counterOf(state) as { count: number }).count = 0;
    (counterOf(state) as { lastHitTick: number }).lastHitTick = 7;
    expect(checksum(state)).not.toBe(before);
    expect(checksum(cloneState(state))).toBe(checksum(state));
    expect(cloneState(state).champions[0]?.counter).toEqual({ count: 0, lastHitTick: 7 });
  });
});

describe('building the counter', () => {
  it('adds one per qualifying enemy hit by the from slot, and stores the tick of the step', () => {
    const state = setup();
    state.tick = 40;
    hit(state, newCast(state, 0, 'Q'), 2);
    expect(counterOf(state)).toEqual({ count: 1, lastHitTick: 40 });
    state.tick = 45;
    hit(state, newCast(state, 0, 'Q'), 3);
    expect(counterOf(state)).toEqual({ count: 2, lastHitTick: 45 });
  });

  it('stops at the cap, and a hit at the cap refreshes the tick but adds nothing', () => {
    const state = setup(2);
    state.tick = 10;
    for (let i = 0; i < 2; i++) hit(state, newCast(state, 0, 'Q'), 2);
    expect(counterOf(state)).toEqual({ count: 2, lastHitTick: 10 });
    state.tick = 50;
    hit(state, newCast(state, 0, 'Q'), 2);
    expect(counterOf(state)).toEqual({ count: 2, lastHitTick: 50 });
  });

  it('counts the EX variant of the from slot, and not another slot, not even its EX', () => {
    const state = setup();
    hit(state, newCast(state, 0, 'Q', true), 2);
    expect(counterOf(state)?.count).toBe(1);
    for (const slot of ['M1', 'M2', 'SPACE', 'E', 'R', 'F'] as const) {
      state.tick += 1;
      hit(state, newCast(state, 0, slot), 2);
      hit(state, newCast(state, 0, slot, true), 2);
    }
    expect(counterOf(state)).toEqual({ count: 1, lastHitTick: 0 });
  });

  it('follows the declared slot, for any of the seven', () => {
    for (const slot of ['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'] as const) {
      const state = createMatch(CONFIG, openArena(), 1, [archer(3, WINDOW, slot), kitWith('dps')]);
      hit(state, newCast(state, 0, slot), 2);
      expect(counterOf(state)?.count, slot).toBe(1);
      hit(state, newCast(state, 0, slot === 'M1' ? 'Q' : 'M1'), 2);
      expect(counterOf(state)?.count, slot).toBe(1);
    }
  });

  it('counts a hit that a shield absorbs completely, and a hit that kills', () => {
    const state = setup();
    applyShield(state, 2, { absorb: 50, ticks: 100 }, { sourceId: 3, slot: null });
    hit(state, newCast(state, 0, 'Q'), 2);
    expect(champion(state, 2).health).toBe(120);
    expect(counterOf(state)?.count).toBe(1);
    champion(state, 3).health = 4;
    hit(state, newCast(state, 0, 'Q'), 3);
    expect(champion(state, 3).alive).toBe(false);
    expect(counterOf(state)?.count).toBe(2);
  });

  it('adds nothing for an invulnerable target, and does not refresh the tick', () => {
    const state = setup();
    state.tick = 10;
    hit(state, newCast(state, 0, 'Q'), 3);
    applyStatus(state, 2, { type: 'invulnerable', ticks: 30 }, { sourceId: 2, slot: null });
    state.tick = 20;
    hit(state, newCast(state, 0, 'Q'), 2);
    expect(counterOf(state)).toEqual({ count: 1, lastHitTick: 10 });
  });

  it('adds nothing for an ally, a dead enemy, the caster itself or a list without damage', () => {
    const state = setup();
    hit(state, newCast(state, 0, 'Q'), 1);
    hit(state, newCast(state, 0, 'Q'), 0);
    champion(state, 2).alive = false;
    champion(state, 2).health = 0;
    hit(state, newCast(state, 0, 'Q'), 2);
    const quiet: Effect[][] = [
      [{ type: 'applyStatus', status: { type: 'stun', ticks: 30 } }],
      [{ type: 'shield', absorb: 20, ticks: 60 }],
      [{ type: 'knockback', distance: 2, ticks: 8, direction: 'away' }],
      [{ type: 'heal', amount: 5 }],
      [{ type: 'energyGain', amount: 5 }],
    ];
    for (const effects of quiet) hit(state, newCast(state, 0, 'Q'), 3, effects);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('adds one for every hit, ignoring the once-per-target energy rule', () => {
    const state = setup(5);
    const castId = newCast(state, 0, 'Q');
    hit(state, castId, 2);
    hit(state, castId, 2);
    hit(state, castId, 3);
    expect(champion(state, 0).energy).toBe(20);
    expect(counterOf(state)?.count).toBe(3);
  });

  it('adds nothing for a hit with no cast, a dead caster, or a kit without a counter', () => {
    const state = setup();
    hit(state, null, 2);
    expect(counterOf(state)?.count).toBe(0);
    const castId = newCast(state, 0, 'Q');
    applyDamage(state, 0, 1000, 2);
    hit(state, castId, 3);
    expect(champion(state, 3).health).toBe(110);
    expect(counterOf(state)?.count).toBe(0);
    const other = newCast(state, 1, 'Q');
    hit(state, other, 2, DAMAGE, 1);
    expect('counter' in champion(state, 1)).toBe(false);
  });

  it('leaves the effects, the energy and the events as they are without a counter', () => {
    const run = (kit: KitDef) => {
      const state = createMatch(CONFIG, openArena(), 1, [kit, kitWith('dps')]);
      place(state, 2, 3, 0);
      const castId = newCast(state, 0, 'Q');
      hit(state, castId, 2);
      hit(state, castId, 3);
      const { counter: _, ...rest } = champion(state, 0);
      void _;
      return { rest, events: state.events, health: [champion(state, 2).health, champion(state, 3).health] };
    };
    expect(run(archer())).toEqual(run(kitWith('arch')));
  });
});

describe('what builds it through a step', () => {
  it('builds from a projectile hit, with the tick of the step the hit lands in', () => {
    const state = setup();
    place(state, 0, -1, 0);
    const castId = newCast(state, 0, 'Q');
    spawnProjectile(state, bolt(), castId);
    let landed = -1;
    for (let i = 0; i < 30 && landed < 0; i++) {
      const tick = state.tick;
      step(state, []);
      if (counterOf(state)?.count === 1) landed = tick;
    }
    expect(landed).toBeGreaterThan(0);
    expect(champion(state, 2).health).toBe(110);
    expect(counterOf(state)).toEqual({ count: 1, lastHitTick: landed });
  });

  it('adds one for each enemy a piercing projectile hits', () => {
    const state = setup(5);
    place(state, 0, -1, 0);
    place(state, 3, 6, 0);
    const castId = newCast(state, 0, 'Q');
    spawnProjectile(state, bolt({ pierce: true, lifetimeTicks: 40 }), castId);
    for (let i = 0; i < 25; i++) step(state, []);
    expect(champion(state, 2).health).toBe(110);
    expect(champion(state, 3).health).toBe(110);
    expect(counterOf(state)?.count).toBe(2);
  });

  it('adds one for each pulse of an area that hits an enemy', () => {
    const state = setup(5);
    place(state, 2, 0, 0);
    const castId = newCast(state, 0, 'Q');
    spawnArea(
      state,
      { ownerId: 0, x: 0, y: 0, radius: 2, durationTicks: 3, intervalTicks: 1, targets: 'enemies', effects: DAMAGE },
      castId,
    );
    for (let i = 0; i < 3; i++) step(state, []);
    expect(champion(state, 2).health).toBe(90);
    expect(counterOf(state)?.count).toBe(3);
  });

  it('adds one for each enemy a melee arc hits', () => {
    const state = setup(5);
    place(state, 2, 0, 0);
    place(state, 3, 0, 1);
    const castId = newCast(state, 0, 'Q');
    meleeArc(state, { ownerId: 0, x: 0, y: 0, dirX: 1, dirY: 0, radius: 2, cosHalfAngle: -1, effects: DAMAGE, castId });
    expect(counterOf(state)?.count).toBe(2);
  });

  it('adds nothing for a projectile of a caster who has died since firing it', () => {
    const state = setup();
    place(state, 0, -1, 0);
    const castId = newCast(state, 0, 'Q');
    spawnProjectile(state, bolt(), castId);
    applyDamage(state, 0, 1000, 2);
    for (let i = 0; i < 25; i++) step(state, []);
    expect(champion(state, 2).health).toBe(110);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('adds nothing for a dev tool spawn, a damage over time pulse, or the ring', () => {
    const state = setup();
    place(state, 0, -1, 0);
    debug.spawnProjectile(state, bolt());
    debug.spawnArea(state, {
      ownerId: 0, x: 3, y: 0, radius: 2, durationTicks: 3, intervalTicks: 1, targets: 'enemies', effects: DAMAGE,
    });
    for (let i = 0; i < 25; i++) step(state, []);
    expect(champion(state, 2).health).toBeLessThan(100);
    // A dot applied by a hit of another slot pulses for 90 steps and builds nothing more.
    hit(state, newCast(state, 0, 'E'), 3, [
      { type: 'damage', amount: 5 },
      { type: 'applyStatus', status: { type: 'dot', perPulse: 3, ticks: 90 } },
    ]);
    for (let i = 0; i < 90; i++) step(state, []);
    expect(champion(state, 3).health).toBe(120 - 5 - 9);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
    // The ring damages through `applyDamage`, which is not a hit.
    applyDamage(state, 2, 1, -1, true);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });
});

describe('the decay', () => {
  /** Lands a hit now, then steps; returns the count after each of `steps` steps. */
  function afterSteps(state: GameState, steps: number): number[] {
    const counts: number[] = [];
    for (let i = 0; i < steps; i++) {
      step(state, []);
      counts.push(counterOf(state)?.count ?? -1);
    }
    return counts;
  }

  it('keeps the count through the steps up to the window and resets it on the step that reaches it', () => {
    const state = setup(3, 60);
    hit(state, newCast(state, 0, 'Q'), 2);
    hit(state, newCast(state, 0, 'Q'), 2);
    // The hit is in step T; steps T to T + 59 keep the count, the step T + 60 resets it.
    const counts = afterSteps(state, 61);
    expect(counts.slice(0, 60).every((c) => c === 2)).toBe(true);
    expect(counts[60]).toBe(0);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('is cleared the same way at the longest window, and stays at 0 afterwards', () => {
    const state = setup(3, 600);
    hit(state, newCast(state, 0, 'Q'), 2);
    const counts = afterSteps(state, 700);
    expect(counts[598]).toBe(1);
    expect(counts[599]).toBe(1);
    expect(counts[600]).toBe(0);
    expect(counts.slice(600).every((c) => c === 0)).toBe(true);
  });

  it('is held by a qualifying hit that lands in the step the window would end', () => {
    const state = setup(3, 60);
    hit(state, newCast(state, 0, 'Q'), 2);
    afterSteps(state, 60);
    expect(counterOf(state)).toEqual({ count: 1, lastHitTick: 0 });
    // The hit lands in step 60, before the decay of that step.
    hit(state, newCast(state, 0, 'Q'), 2);
    step(state, []);
    expect(counterOf(state)).toEqual({ count: 2, lastHitTick: 60 });
  });

  it('restarts the whole window with every qualifying hit, one timer for all the stacks', () => {
    const state = setup(3, 60);
    hit(state, newCast(state, 0, 'Q'), 2);
    afterSteps(state, 40);
    hit(state, newCast(state, 0, 'Q'), 2);
    afterSteps(state, 60);
    expect(counterOf(state)).toEqual({ count: 2, lastHitTick: 40 });
    step(state, []);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('does not restart for a hit that adds nothing: another slot, or an invulnerable target', () => {
    const state = setup(3, 60);
    hit(state, newCast(state, 0, 'Q'), 3);
    afterSteps(state, 30);
    hit(state, newCast(state, 0, 'M1'), 3);
    applyStatus(state, 2, { type: 'invulnerable', ticks: 90 }, { sourceId: 2, slot: null });
    hit(state, newCast(state, 0, 'Q'), 2);
    afterSteps(state, 30);
    expect(counterOf(state)?.count).toBe(1);
    step(state, []);
    expect(counterOf(state)?.count).toBe(0);
  });

  it('decays on a dead champion too', () => {
    const state = setup(3, 60);
    hit(state, newCast(state, 0, 'Q'), 2);
    applyDamage(state, 0, 1000, 2);
    expect(champion(state, 0).alive).toBe(false);
    afterSteps(state, 60);
    expect(counterOf(state)?.count).toBe(1);
    step(state, []);
    expect(counterOf(state)?.count).toBe(0);
  });

  it('runs for every champion with a counter, and touches none without one', () => {
    const state = setup(3, 60);
    hit(state, newCast(state, 0, 'Q'), 2);
    hit(state, newCast(state, 3, 'Q'), 1, DAMAGE, 3);
    expect(counterOf(state, 3)?.count).toBe(1);
    afterSteps(state, 61);
    expect(counterOf(state, 0)?.count).toBe(0);
    expect(counterOf(state, 3)?.count).toBe(0);
    expect('counter' in champion(state, 1)).toBe(false);
  });

  it('leaves a counter at 0 alone', () => {
    const state = setup();
    for (let i = 0; i < 1000; i++) step(state, []);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('runs on a match in its round phase, on the step that decides the round', () => {
    const state = setup(3, 60, { roundsToWin: 2 });
    while (state.match?.phase !== 'round') step(state, []);
    (state.champions[0] as { counter: unknown }).counter = { count: 2, lastHitTick: state.tick - 59 };
    step(state, []);
    expect(counterOf(state)?.count).toBe(2);
    // Both enemies fall in the same step in which the window ends.
    champion(state, 2).alive = false;
    champion(state, 3).alive = false;
    step(state, []);
    expect(state.match?.phase).toBe('roundEnd');
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });
});

describe('the pause', () => {
  it('freezes the count in the warmup, the round end pause and after the match', () => {
    for (const phase of ['warmup', 'roundEnd', 'matchEnd'] as const) {
      const state = setup(3, 60, { roundsToWin: 2 });
      if (!state.match) throw new Error('no match');
      state.match.phase = phase;
      state.match.phaseTicks = 0;
      (state.champions[0] as { counter: unknown }).counter = { count: 2, lastHitTick: 5 };
      state.tick = 5;
      for (let i = 0; i < 100 && state.match.phase === phase; i++) {
        step(state, []);
        if (state.match.phase === phase) expect(counterOf(state)).toEqual({ count: 2, lastHitTick: 5 });
      }
    }
  });

  it('keeps the last count at the end of the match', () => {
    const state = setup(3, 60, { roundsToWin: 1 });
    while (state.match?.phase !== 'round') step(state, []);
    hit(state, newCast(state, 0, 'Q'), 2);
    champion(state, 2).alive = false;
    champion(state, 3).alive = false;
    // The 60-step window runs out several times over in the 180-step pause and after it.
    for (let i = 0; i < 1000 && phaseOf(state) !== 'matchEnd'; i++) step(state, []);
    expect(phaseOf(state)).toBe('matchEnd');
    expect(counterOf(state)?.count).toBe(1);
    const frozen = { ...(counterOf(state) as object) };
    for (let i = 0; i < 300; i++) step(state, []);
    expect(counterOf(state)).toEqual(frozen);
  });
});

describe('the round reset', () => {
  it('clears the count and the tick at the start of the next round', () => {
    const state = setup(3, 600, { roundsToWin: 2 });
    while (state.match?.phase !== 'round') step(state, []);
    hit(state, newCast(state, 0, 'Q'), 2);
    hit(state, newCast(state, 0, 'Q'), 2);
    expect(counterOf(state)?.count).toBe(2);
    champion(state, 2).alive = false;
    champion(state, 3).alive = false;
    step(state, []);
    expect(state.match?.phase).toBe('roundEnd');
    // Frozen through the pause: the longest window would not have run out anyway, and the pause
    // is 180 steps, so check the count right before the round starts.
    for (let i = 0; i < 170; i++) step(state, []);
    expect(counterOf(state)?.count).toBe(2);
    while (state.match?.phase !== 'round') step(state, []);
    expect(state.match?.round).toBe(2);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('clears it for a window that has not run out, in the first round after the warmup too', () => {
    const state = setup(3, 600, { roundsToWin: 2 });
    (state.champions[0] as { counter: unknown }).counter = { count: 3, lastHitTick: 0 };
    while (state.match?.phase !== 'round') step(state, []);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });
});

describe('a counter that changes nothing else', () => {
  /** The same seeded brawl, with and without the declaration, on champions that stand together. */
  function play(kit: KitDef, steps: number) {
    const state = createMatch(
      {
        teamSize: 2,
        players: [
          { championId: STRIKER_ID, team: 'A' },
          { championId: 'dps', team: 'A' },
          { championId: STRIKER_ID, team: 'B' },
          { championId: 'dps', team: 'B' },
        ],
      },
      arena01,
      7,
      [kit, kitWith('dps')],
    );
    place(state, 0, -1, 0);
    place(state, 1, -1, 3);
    place(state, 2, 1, 0);
    place(state, 3, 1, 3);
    let held: PlayerInput[] = [];
    const frames: { champions: unknown; events: unknown }[] = [];
    let built = 0;
    for (let i = 0; i < steps; i++) {
      held = state.champions.map((c, k) => {
        const old = held[k];
        if (old && nextRandom(state) < 0.85) return old;
        let buttons = 0;
        for (let bit = 0; bit < 7; bit++) if (nextRandom(state) < 0.3) buttons |= 1 << bit;
        const foe = state.champions.find((o) => o.team !== c.team && o.alive);
        return {
          moveX: (Math.floor(nextRandom(state) * 3) - 1) as -1 | 0 | 1,
          moveY: (Math.floor(nextRandom(state) * 3) - 1) as -1 | 0 | 1,
          aimX: foe ? Math.round(foe.x * 100) : 0,
          aimY: foe ? Math.round(foe.y * 100) : 0,
          buttons,
        };
      });
      step(state, held);
      expect(checkAbilityInvariants(state)).toEqual([]);
      const stripped = cloneState(state).champions.map((c) => {
        const { counter, ...rest } = c;
        if (counter && counter.count > 0) built += 1;
        return rest;
      });
      frames.push({ champions: stripped, events: state.events.slice() });
    }
    return { frames, built, state };
  }

  it('gives equal champions and events with and without a counter, and builds it in the one run', () => {
    const plain = testStriker();
    const withCounter: KitDef = { ...testStriker(), counter: { from: 'M1', cap: 5, windowTicks: 120 } };
    const a = play(plain, 1500);
    const b = play(withCounter, 1500);
    expect(b.built).toBeGreaterThan(0);
    expect(a.built).toBe(0);
    expect(b.frames).toEqual(a.frames);
  });
});

describe('spending the counter', () => {
  const BONUS = 4;
  const SLOT_INDEX = (slot: Slot) => (['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'] as Slot[]).indexOf(slot);
  const bolt = (amount = 10): AbilityEffect => ({
    type: 'projectile',
    speed: 20,
    radius: 0.4,
    lifetimeTicks: 40,
    pierce: false,
    effects: [{ type: 'damage', amount }],
  });
  const bonus = (n = BONUS): AbilityEffect => ({ type: 'consumeCounter', bonusDamagePerStack: n });

  /** A kit whose M1 builds the counter and whose Q holds `effects` (and `exEffects` as the EX). */
  function spender(effects: AbilityEffect[], exEffects?: AbilityEffect[]): KitDef {
    // A long cooldown keeps a single cast to one in the tests that step past its flight and dots.
    const q: SlotSpec = { cooldownTicks: 1200, windupTicks: 0, movement: 'free', effects };
    if (exEffects) q.ex = { windupTicks: 0, movement: 'free', effects: exEffects };
    return { ...kitWith('arch', { Q: q }), counter: { from: 'M1', cap: 3, windowTicks: 360 } };
  }

  function spent(effects: AbilityEffect[], exEffects?: AbilityEffect[]): GameState {
    const state = createMatch(CONFIG, openArena(), 1, [spender(effects, exEffects), kitWith('dps')]);
    place(state, 0, -3, 0);
    place(state, 1, -3, 5);
    place(state, 2, 3, 0);
    place(state, 3, 3, 5);
    return state;
  }

  const setCount = (state: GameState, count: number, lastHitTick = 0, id = 0): void => {
    (champion(state, id) as { counter: unknown }).counter = { count, lastHitTick };
  };

  /** Holds `buttons` for `ticks` steps, aiming at champion 2's position (3, 0). */
  function cast(state: GameState, buttons: number, ticks: number, ex = false): void {
    const held = buttons | (ex ? Button.SHIFT : 0);
    for (let i = 0; i < ticks; i++) step(state, [input(0, 0, 300, 0, held)]);
  }

  it('spends the whole counter, zeroes it and clears the window stamp', () => {
    const state = spent([bonus(), bolt()]);
    state.tick = 7;
    setCount(state, 3, 7);
    expect(spendCounter(state, champion(state, 0))).toBe(3);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('returns 0 and touches nothing when the counter is 0', () => {
    const state = spent([bonus(), bolt()]);
    setCount(state, 0, 0);
    const before = checksum(state);
    expect(spendCounter(state, champion(state, 0))).toBe(0);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
    expect(checksum(state)).toBe(before);
  });

  it('deals the bonus per stack to the damage effects of the cast, which lands with the hit', () => {
    const state = spent([bonus(), bolt(10)]);
    setCount(state, 3);
    cast(state, Button.Q, 30);
    // 10 base + 4 per stack x 3 = 22, and the counter is spent.
    expect(champion(state, 2).health).toBe(120 - 22);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('gives the same cast no bonus at 0 stacks, and the base damage only', () => {
    const state = spent([bonus(), bolt(10)]);
    setCount(state, 0);
    cast(state, Button.Q, 30);
    expect(champion(state, 2).health).toBe(120 - 10);
  });

  it('adds the bonus to each damage effect in the hit list', () => {
    const state = spent([
      bonus(),
      { type: 'projectile', speed: 20, radius: 0.4, lifetimeTicks: 40, pierce: false, effects: [{ type: 'damage', amount: 6 }, { type: 'damage', amount: 5 }] },
    ]);
    setCount(state, 2);
    cast(state, Button.Q, 30);
    expect(champion(state, 2).health).toBe(120 - (6 + 8) - (5 + 8));
  });

  it('adds the bonus to every enemy a piercing projectile of the cast hits', () => {
    const state = spent([bonus(), { ...bolt(10), pierce: true } as AbilityEffect]);
    place(state, 3, 6, 0);
    setCount(state, 3);
    cast(state, Button.Q, 40);
    expect(champion(state, 2).health).toBe(120 - 22);
    expect(champion(state, 3).health).toBe(120 - 22);
  });

  it('rides an area and adds the bonus to every pulse', () => {
    const state = spent([
      bonus(),
      { type: 'area', placement: { type: 'ahead', distance: 3 }, radius: 2, durationTicks: 3, intervalTicks: 1, targets: 'enemies', effects: [{ type: 'damage', amount: 5 }] },
    ]);
    // The area centre is 3 m ahead of the caster at (-3, 0), so (0, 0); the enemy must be inside 2.5 m.
    place(state, 2, 2, 0);
    setCount(state, 3);
    cast(state, Button.Q, 5);
    // 5 + 12 = 17 a pulse, three pulses.
    expect(champion(state, 2).health).toBe(120 - 17 * 3);
  });

  it('carries the bonus on the immediate hits of a melee arc of the spending cast', () => {
    const state = spent([
      bonus(),
      { type: 'meleeArc', radius: 2.5, cosHalfAngle: -1, effects: [{ type: 'damage', amount: 10 }] },
    ]);
    place(state, 2, -1, 0);
    setCount(state, 3);
    cast(state, Button.Q, 1);
    expect(champion(state, 2).health).toBe(120 - 22);
  });

  it('lands the bonus on the damage of an allyEffects list aimed at the caster, as when it spawns', () => {
    // The self-cast branch applies the ally list to the caster at once, spawning nothing; the spend
    // verb's bonus has to reach a `damage` there exactly as it does on the spawned projectile's ally
    // hit. Same cast, same ally list: the damage must not depend on the aim (cast.ts, rules 2.5).
    const allyBolt: AbilityEffect = {
      type: 'projectile',
      speed: 20,
      radius: 0.3,
      lifetimeTicks: 60,
      pierce: true,
      effects: [],
      allyEffects: [{ type: 'damage', amount: 4 }],
    };
    const run = (verbs: AbilityEffect[], aimAtSelf: boolean): number => {
      const state = spent([...verbs, allyBolt]);
      // The ally (champion 1) stands in the cast's path when it is not aimed at the caster.
      place(state, 1, 2, 0);
      setCount(state, 2);
      // Aiming at (-3, 0), the caster's own position, is the self-cast; at (10, 0) it spawns.
      step(state, [input(0, 0, aimAtSelf ? -300 : 1000, 0, Button.Q)]);
      if (aimAtSelf) return champion(state, 0).health;
      for (let i = 0; i < 40 && champion(state, 1).health === 120; i++) step(state, []);
      return champion(state, 1).health;
    };
    // 2 stacks x 5 per stack = 10 on top of the ally list's 4, in both aim variants.
    expect(run([bonus(5)], true)).toBe(120 - 4 - 10);
    expect(run([bonus(5)], false)).toBe(120 - 4 - 10);
    // Controls: without a verb the two aims deal the same 4, so the difference is the bonus alone.
    expect(run([], true)).toBe(120 - 4);
    expect(run([], false)).toBe(120 - 4);
  });

  it('carries the bonus on the then arc of a dash, rooted at fire and deferred alike', () => {
    // The then-arc is a hit of the spending cast (its slot is the cast's, its hit is credited to
    // the cast), so it must see the 3-stack bonus on both paths: the rooted-at-fire one, where
    // `runEffects` threads the bonus into `then`, and the deferred one, where `fireDashThen` runs
    // the arc where the dash ends. Its hit also rebuilds the from-Q counter after the spend.
    const thenArc: AbilityEffect = {
      type: 'meleeArc',
      radius: 8,
      cosHalfAngle: -1,
      effects: [{ type: 'damage', amount: 10 }],
    };
    const dashing = (windupTicks: number): KitDef => {
      const q: SlotSpec = {
        cooldownTicks: 1200,
        windupTicks,
        movement: 'free',
        effects: [bonus(), { type: 'dash', distance: 6, ticks: 12, then: [thenArc] }],
      };
      return { ...kitWith('arch', { Q: q }), counter: { from: 'Q', cap: 3, windowTicks: 360 } };
    };
    const run = (windupTicks: number, rootAtFire: boolean): GameState => {
      const state = createMatch(CONFIG, openArena(), 1, [dashing(windupTicks), kitWith('dps')]);
      place(state, 0, -3, 0);
      place(state, 2, 3, 2);
      // Out of the arc's reach, so only one from-Q hit rebuilds the counter.
      place(state, 3, 12, -8);
      setCount(state, 3);
      step(state, [input(0, 0, 300, 0, Button.Q)]);
      if (rootAtFire) applyStatus(state, 0, { type: 'root', ticks: 300 }, { sourceId: 2, slot: null });
      for (let i = 0; i < 40; i++) step(state, []);
      return state;
    };
    // Rooted at the fire tick: the then fires at once and its arc takes the cast's bonus.
    const rooted = run(3, true);
    expect(champion(rooted, 2).health).toBe(120 - 22);
    expect(counterOf(rooted)?.count).toBe(1);
    // Deferred: the dash runs to its end, and the arc there must take the same bonus.
    const deferred = run(0, false);
    expect(champion(deferred, 2).health).toBe(120 - 22);
    expect(counterOf(deferred)?.count).toBe(1);
  });

  it('cuts the named slot cooldown by the verb per stack, and clamps at 0', () => {
    const state = spent([{ type: 'consumeCounter', cooldownTicksPerStack: 30, slot: 'SPACE' }, bolt()]);
    setCount(state, 3);
    champion(state, 0).cooldowns[SLOT_INDEX('SPACE')] = 100;
    cast(state, Button.Q, 1);
    // 100 ticked down to 99 before the cast, then cut by 30 x 3 = 90.
    expect(champion(state, 0).cooldowns[SLOT_INDEX('SPACE')]).toBe(99 - 90);
    expect(champion(state, 0).cooldowns[SLOT_INDEX('R')]).toBe(0);
  });

  it('clamps the cut at 0 and never touches another slot', () => {
    const state = spent([{ type: 'consumeCounter', cooldownTicksPerStack: 600, slot: 'SPACE' }, bolt()]);
    setCount(state, 3);
    champion(state, 0).cooldowns[SLOT_INDEX('SPACE')] = 100;
    champion(state, 0).cooldowns[SLOT_INDEX('R')] = 200;
    cast(state, Button.Q, 1);
    expect(champion(state, 0).cooldowns[SLOT_INDEX('SPACE')]).toBe(0);
    expect(champion(state, 0).cooldowns[SLOT_INDEX('R')]).toBe(199);
  });

  it('spends nothing for the base cast of a kit whose only spend is on its EX', () => {
    const state = spent([bolt(10)], [bonus(), bolt(10)]);
    setCount(state, 3);
    cast(state, Button.Q, 30);
    expect(champion(state, 2).health).toBe(120 - 10);
    // The base cast spends nothing, so the counter is still 3.
    expect(counterOf(state)?.count).toBe(3);
    setCount(state, 3);
    place(state, 2, 3, 0);
    champion(state, 2).health = 120;
    champion(state, 0).cooldowns[SLOT_INDEX('Q')] = 0;
    champion(state, 0).energy = 25;
    cast(state, Button.Q, 30, true);
    expect(champion(state, 2).health).toBe(120 - 22);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('spends on the fire tick of a windup cast, not when the cast starts', () => {
    const q: SlotSpec = {
      cooldownTicks: 60,
      windupTicks: 3,
      movement: 'free',
      effects: [bonus(), bolt(10)],
    };
    const state = createMatch(CONFIG, openArena(), 1, [
      { ...kitWith('arch', { Q: q }), counter: { from: 'M1', cap: 3, windowTicks: 360 } },
      kitWith('dps'),
    ]);
    place(state, 0, -3, 0);
    place(state, 2, 3, 0);
    setCount(state, 3);
    // The cast starts on this step (cooldown set), but the windup has not ended.
    step(state, [input(0, 0, 300, 0, Button.Q)]);
    expect(counterOf(state)?.count).toBe(3);
    // Three more steps end the windup, and the cast fires then.
    for (let i = 0; i < 3; i++) step(state, []);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
    for (let i = 0; i < 30; i++) step(state, []);
    expect(champion(state, 2).health).toBe(120 - 22);
  });

  it('spends before the decay of the same tick: a spend in the tick the window ends still sees the stacks', () => {
    const state = spent([{ type: 'consumeCounter', cooldownTicksPerStack: 30, slot: 'SPACE' }, bolt()]);
    // The window (360) has run out, so step 6d would zero the count this tick; the spend runs first.
    setCount(state, 3, state.tick - 360);
    champion(state, 0).cooldowns[SLOT_INDEX('SPACE')] = 100;
    cast(state, Button.Q, 1);
    expect(champion(state, 0).cooldowns[SLOT_INDEX('SPACE')]).toBe(99 - 90);
    expect(counterOf(state)).toEqual({ count: 0, lastHitTick: 0 });
  });

  it('spends before the cast own hits: a from-slot arc rebuilds the counter after the spend', () => {
    const q: SlotSpec = {
      cooldownTicks: 60,
      windupTicks: 0,
      movement: 'free',
      effects: [bonus(), { type: 'meleeArc', radius: 2.5, cosHalfAngle: -1, effects: [{ type: 'damage', amount: 10 }] }],
    };
    const state = createMatch(CONFIG, openArena(), 1, [
      { ...kitWith('arch', { Q: q }), counter: { from: 'Q', cap: 3, windowTicks: 360 } },
      kitWith('dps'),
    ]);
    place(state, 0, -3, 0);
    place(state, 2, -1, 0);
    setCount(state, 3);
    cast(state, Button.Q, 1);
    // The arc sees the 3-stack bonus (22), then its hit rebuilds the counter to 1.
    expect(champion(state, 2).health).toBe(120 - 22);
    expect(counterOf(state)).toEqual({ count: 1, lastHitTick: 0 });
  });

  it('does not hand the bonus to a damage over time pulse, and leaves the counter spent', () => {
    const state = spent([
      bonus(),
      {
        type: 'projectile',
        speed: 20,
        radius: 0.4,
        lifetimeTicks: 40,
        pierce: false,
        effects: [{ type: 'damage', amount: 10 }, { type: 'applyStatus', status: { type: 'dot', perPulse: 3, ticks: 90 } }],
      },
    ]);
    setCount(state, 3);
    cast(state, Button.Q, 120);
    // 22 lands with the hit; the dot pulses 3 x 3 = 9 more, with no bonus.
    expect(champion(state, 2).health).toBe(120 - 22 - 9);
  });

  it('leaves a cast with no bonus key, and a kit with no spend verb, byte-identical in the state', () => {
    const state = spent([bonus(), bolt()]);
    const plain = spent([bolt()]);
    expect(Object.keys(state.projectiles).length).toBe(0);
    for (let i = 0; i < 30; i++) {
      step(state, []);
      step(plain, []);
    }
    for (const p of plain.projectiles) expect('bonusDamage' in p).toBe(false);
    for (const p of state.projectiles) expect('bonusDamage' in p).toBe(false);
    expect(state.champions.map((c) => c.health)).toEqual(plain.champions.map((c) => c.health));
  });
});
