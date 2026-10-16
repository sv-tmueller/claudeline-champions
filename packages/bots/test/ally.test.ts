import { describe, expect, it } from 'vitest';
import { Button, SLOTS, createMatch, step } from '@claudeline/sim';
import type { ChampionState, GameState, KitDef, PlayerInput } from '@claudeline/sim';
import { leadPoint, rotateByHalfTangent, roundAim } from '../src/aim';
import { createBot } from '../src/bot';
import { createKitCache, findKit, refreshKitCache } from '../src/casting';
import { TIERS } from '../src/difficulty';
import { createRng } from '../src/rng';
import { oracleDashLanding } from './escape-oracle';
import { arena01, copyInput, rosterKits } from './helpers';
import { OPEN, THINKS, firstPress, labelOf, pressOf, sceneOf } from './scenes';
import type { Options, Press } from './scenes';

// Lumeth's ally slots (docs/architecture/bots.md, Allies): M2, R, F and M1 are pressed at an ally
// that is missing at least what the ability gives (M1 10, M2 14, R 30, F 30), within the reach of
// the ability less the 1 m margin (11, 9.133, 4.5, 4.5 m), and a bolt needs a clear shot. Lumeth
// stands at (-6, 0); the enemy, the acted target, is 8 m north of her at (-6, 8), so it is neither
// in line with an ally nor within her 3 m trigger.

const kits = rosterKits();
const ME = { x: -6, y: 0 };

/** A scene of Lumeth at (-6, 0) with her enemy 8 m north of her. */
function scene(options: Options = {}): GameState {
  return sceneOf('lumeth', 8, { kits, enemy: [-6, 8], ...options });
}

const M2_ONLY = { ready: ['M2'] } as const;
const M1_ONLY = { ready: ['M1'] } as const;
const R_ONLY = { ready: ['R'] } as const;
const F_ONLY = { ready: ['F'], energy: 100 } as const;

/** The angle, in degrees, between the aim of a press and the direction from Lumeth to a point. */
function degreesOff(press: Press, point: { x: number; y: number }): number {
  const ax = press.aimX / 100 - ME.x;
  const ay = press.aimY / 100 - ME.y;
  const px = point.x - ME.x;
  const py = point.y - ME.y;
  return (Math.abs(Math.atan2(ax * py - ay * px, ax * px + ay * py)) * 180) / Math.PI;
}

function pressAt(state: GameState): Press {
  const press = firstPress(state);
  if (press === null) throw new Error('no press');
  return press;
}

describe('Soothing Surge (M2) at a hurt ally', () => {
  const surge = (ally: readonly [number, number], missing: number, options: Options = {}) =>
    scene({ ...M2_ONLY, ally, allyMissing: missing, ...options });

  it('presses M2 at an ally 9 m off that is missing 14, and not when it is missing 13', () => {
    expect(pressOf(surge([3, 0], 14))).toBe('M2');
    expect(pressOf(surge([3, 0], 13))).toBeNull();
    expect(pressOf(surge([3, 0], 60))).toBe('M2');
  });

  it('presses M2 within 9.133 m of the ally (10.133 less the margin), and not at 9.2 m', () => {
    expect(pressOf(surge([3.1, 0], 14))).toBe('M2');
    expect(pressOf(surge([3.2, 0], 14))).toBeNull();
    expect(pressOf(surge([4, 0], 14))).toBeNull();
  });

  it('does not press M2 at an ally behind the pillar, and does where nothing is in the way', () => {
    const shield = (arena: Options['arena']) =>
      sceneOf('lumeth', 8, {
        kits,
        arena,
        ...M2_ONLY,
        me: [-3, 0],
        enemy: [-3, 6],
        ally: [3, 0],
        allyMissing: 14,
      });
    expect(pressOf(shield(OPEN))).toBe('M2');
    expect(pressOf(shield(arena01))).toBeNull();
  });

  it('never presses M2 at an enemy: with no ally hurt it is not pressed whoever is in reach', () => {
    expect(pressOf(scene(M2_ONLY))).toBeNull();
    expect(pressOf(scene({ ...M2_ONLY, ally: [3, 0], allyMissing: 13 }))).toBeNull();
    expect(pressOf(sceneOf('lumeth', 6, { kits, ...M2_ONLY }))).toBeNull();
  });

  it('does not press M2 at herself: a bolt never hits its owner', () => {
    expect(pressOf(scene({ ...M2_ONLY, missing: 60 }))).toBeNull();
    expect(pressOf(scene({ ...M2_ONLY, missing: 60, ally: [3, 0], allyMissing: 0 }))).toBeNull();
  });

  it('does not press M2 at a dead ally or at a champion of the other team', () => {
    const dead = surge([3, 0], 60);
    (dead.champions[1] as ChampionState).alive = false;
    expect(pressOf(dead)).toBeNull();
    const partner = scene(M2_ONLY);
    const foe = partner.champions[3] as ChampionState;
    foe.alive = true;
    foe.x = 3;
    foe.y = 0;
    foe.health = foe.maxHealth - 60;
    expect(pressOf(partner)).toBeNull();
  });

  it('never presses an ally slot on an idle think: with no enemy alive she does not heal', () => {
    const state = surge([3, 0], 60, { ready: ['M1', 'M2', 'R', 'F'], energy: 100 });
    (state.champions[2] as ChampionState).alive = false;
    expect(pressOf(state)).toBeNull();
  });
});

/** Lumeth with two allies (champions 1 and 2), an enemy 8 m north (champion 3), champions 4 and 5 dead. */
function trio(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  options: { ready?: readonly (typeof SLOTS)[number][] } = {},
): GameState {
  const state = createMatch(
    {
      teamSize: 3,
      players: [
        { championId: 'lumeth', team: 'A' },
        { championId: 'dummy', team: 'A' },
        { championId: 'dummy', team: 'A' },
        { championId: 'dummy', team: 'B' },
        { championId: 'dummy', team: 'B' },
        { championId: 'dummy', team: 'B' },
      ],
    },
    OPEN,
    1,
    kits,
  );
  for (const id of [4, 5]) (state.champions[id] as ChampionState).alive = false;
  const at = (id: number, [x, y, missing]: readonly [number, number, number]) => {
    const c = state.champions[id] as ChampionState;
    c.x = x;
    c.y = y;
    c.health = c.maxHealth - missing;
  };
  at(1, first);
  at(2, second);
  const me = state.champions[0] as ChampionState;
  me.x = ME.x;
  me.y = ME.y;
  const enemy = state.champions[3] as ChampionState;
  enemy.x = -6;
  enemy.y = 8;
  me.cooldowns.fill(600);
  for (const slot of options.ready ?? ['M2']) me.cooldowns[SLOTS.indexOf(slot)] = 0;
  return state;
}

describe('which ally a bolt is pressed at', () => {
  // Ally 1 stands 9 m east of her, ally 2 9 m south: the aim says which one she chose.
  const EAST = { x: 3, y: 0 };
  const SOUTH = { x: -6, y: -9 };

  it('picks the ally with the lowest health fraction', () => {
    // Missing 50 of 120 is 0.583 left, missing 60 is 0.5 left.
    expect(degreesOff(pressAt(trio([3, 0, 50], [-6, -9, 60])), SOUTH)).toBeLessThan(6);
    expect(degreesOff(pressAt(trio([3, 0, 60], [-6, -9, 50])), EAST)).toBeLessThan(6);
  });

  it('breaks a tie in the fraction toward the lower id', () => {
    expect(degreesOff(pressAt(trio([3, 0, 60], [-6, -9, 60])), EAST)).toBeLessThan(6);
  });

  it('chooses among the allies that qualify: one out of reach or not hurt enough is passed over', () => {
    // Ally 2 is the hurtest but 10 m off, past 9.133: ally 1 is chosen.
    expect(degreesOff(pressAt(trio([3, 0, 20], [-6, -10, 100])), EAST)).toBeLessThan(6);
  });
});

describe('Mend Bolt (M1) at an ally or an enemy', () => {
  // The enemy is 8 m north: inside the M1 band (11 m) with a clear shot, so M1 has an enemy to hit
  // unless an ally needs it. The ally is 5 m south.
  const bolt = (missing: number, ally: readonly [number, number] = [-6, -5], options: Options = {}) =>
    scene({ ...M1_ONLY, ally, allyMissing: missing, ...options });
  const ENEMY = { x: -6, y: 8 };
  const ALLY = { x: -6, y: -5 };

  it('is pressed at an ally that is missing 10, and at the enemy when it is missing only 9', () => {
    expect(degreesOff(pressAt(bolt(10)), ALLY)).toBeLessThan(6);
    expect(degreesOff(pressAt(bolt(9)), ENEMY)).toBeLessThan(6);
    expect(degreesOff(pressAt(scene(M1_ONLY)), ENEMY)).toBeLessThan(6);
  });

  it('is pressed at an ally within 11 m, and at the enemy past 11.05 m', () => {
    expect(degreesOff(pressAt(bolt(10, [4.9, 0])), { x: 4.9, y: 0 })).toBeLessThan(6);
    expect(degreesOff(pressAt(bolt(10, [5.05, 0])), ENEMY)).toBeLessThan(6);
  });

  it('is pressed at an ally with the enemy out of its band', () => {
    // The enemy is 20 m off: no enemy shot, but the ally needs the bolt.
    const far = bolt(10, [-6, -5], { enemy: [14, 0] });
    expect(degreesOff(pressAt(far), ALLY)).toBeLessThan(6);
    expect(pressOf(scene({ ...M1_ONLY, enemy: [14, 0] }))).toBeNull();
  });

  it('does not press M1 at an ally behind the pillar, and presses it at the enemy instead', () => {
    const shield = sceneOf('lumeth', 8, {
      kits,
      arena: arena01,
      ...M1_ONLY,
      me: [-3, 0],
      enemy: [-3, 6],
      ally: [3, 0],
      allyMissing: 10,
    });
    const press = pressAt(shield);
    expect(press.label).toBe('M1');
    const ax = press.aimX / 100 + 3;
    const ay = press.aimY / 100;
    // North, at the enemy, not east, at the ally.
    expect(Math.abs(ax)).toBeLessThan(1);
    expect(ay).toBeGreaterThan(4);
  });

  it('does not press M1 at herself', () => {
    const press = pressAt(scene({ ...M1_ONLY, missing: 60 }));
    expect(degreesOff(press, ENEMY)).toBeLessThan(6);
  });
});

describe('Dawnbloom (F) and Aegis Veil (R): areas on allies, herself included', () => {
  const near = (x: number, y = 0): readonly [number, number] => [ME.x + x, y];

  it('presses R at an ally within 4.5 m that is missing 30, and not at 4.55 m or at 29', () => {
    expect(pressOf(scene({ ...R_ONLY, ally: near(4.5), allyMissing: 30 }))).toBe('R');
    expect(pressOf(scene({ ...R_ONLY, ally: near(4.55), allyMissing: 30 }))).toBeNull();
    expect(pressOf(scene({ ...R_ONLY, ally: near(4.5), allyMissing: 29 }))).toBeNull();
  });

  it('presses R for herself when she is missing 30, and not at 29', () => {
    expect(pressOf(scene({ ...R_ONLY, missing: 30 }))).toBe('R');
    expect(pressOf(scene({ ...R_ONLY, missing: 29 }))).toBeNull();
  });

  it('presses F at 100 energy for an ally in need, and not at 99 energy', () => {
    expect(pressOf(scene({ ...F_ONLY, ally: near(4.5), allyMissing: 30 }))).toBe('F');
    expect(pressOf(scene({ ...F_ONLY, energy: 99, ally: near(4.5), allyMissing: 30 }))).toBeNull();
    expect(pressOf(scene({ ...F_ONLY, ally: near(4.55), allyMissing: 30 }))).toBeNull();
    expect(pressOf(scene({ ...F_ONLY, ally: near(4.5), allyMissing: 29 }))).toBeNull();
  });

  it('presses F for herself when she is missing 30', () => {
    expect(pressOf(scene({ ...F_ONLY, missing: 30 }))).toBe('F');
  });

  it('does not press F at an enemy 3 m away with nobody hurt: its slow is no reason to press it', () => {
    expect(pressOf(sceneOf('lumeth', 3, { kits, ...F_ONLY }))).toBeNull();
    expect(pressOf(sceneOf('lumeth', 4, { kits, ...F_ONLY }))).toBeNull();
  });

  it('does not count a dead ally or an enemy that is hurt', () => {
    const dead = scene({ ...R_ONLY, ally: near(2), allyMissing: 90 });
    (dead.champions[1] as ChampionState).alive = false;
    expect(pressOf(dead)).toBeNull();
    const foe = sceneOf('lumeth', 4, { kits, ...R_ONLY, enemyHealth: 0.2 });
    expect(pressOf(foe)).toBeNull();
  });

  it('aims at the acted enemy, not at herself or an ally: R and F keep the enemy as the aim point', () => {
    const press = pressAt(scene({ ...R_ONLY, missing: 30 }));
    expect(press.label).toBe('R');
    expect(degreesOff(press, { x: -6, y: 8 })).toBeLessThan(6);
    // Not herself: an aim at her own centre is a zero-length vector.
    expect(press.aimY / 100).toBeGreaterThan(4);
    const ally = pressAt(scene({ ...F_ONLY, ally: [-6, -3], allyMissing: 60 }));
    expect(ally.label).toBe('F');
    expect(degreesOff(ally, { x: -6, y: 8 })).toBeLessThan(6);
  });
});

describe('the aim at an ally', () => {
  const seed = 3;
  const tier = TIERS.hard;

  function expectedAim(me: ChampionState, ally: ChampionState, speed: number) {
    const u = (2 * createRng(seed).next() - 1) * tier.maxU;
    const lead = leadPoint(me, ally, { x: ally.vx, y: ally.vy }, speed);
    const turned = rotateByHalfTangent(lead.x - me.x, lead.y - me.y, u);
    return { aimX: roundAim(me.x + turned.x), aimY: roundAim(me.y + turned.y) };
  }

  it('equals the reference chain at the ally, led with the speed of Soothing Surge (16 m/s)', () => {
    const state = scene({ ...M2_ONLY, ally: [3, 0], allyMissing: 60 });
    const me = state.champions[0] as ChampionState;
    const ally = state.champions[1] as ChampionState;
    ally.vy = 4;
    const press = firstPress(state, 'hard', seed);
    expect(press?.label).toBe('M2');
    expect({ aimX: press?.aimX, aimY: press?.aimY }).toEqual(expectedAim(me, ally, 16));
    expect(expectedAim(me, ally, 16)).not.toEqual(expectedAim(me, ally, 20));
  });

  it('equals the reference chain at the ally for Mend Bolt (20 m/s)', () => {
    const state = scene({ ...M1_ONLY, ally: [-6, -5], allyMissing: 20 });
    const me = state.champions[0] as ChampionState;
    const ally = state.champions[1] as ChampionState;
    ally.vx = 3;
    const press = firstPress(state, 'hard', seed);
    expect(press?.label).toBe('M1');
    expect({ aimX: press?.aimX, aimY: press?.aimY }).toEqual(expectedAim(me, ally, 20));
  });

  const idle: PlayerInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };

  it('lands the heal on the ally after the windup: the aim is held through the 18 ticks', () => {
    const state = scene({ ...M2_ONLY, ally: [3, 0], allyMissing: 50 });
    const bot = createBot(0, 'hard', seed);
    const healed: number[] = [];
    let castTicks = 0;
    for (let t = 0; t < 140; t++) {
      const input = copyInput(bot.think(state));
      step(state, [input, idle, idle, idle]);
      if ((state.champions[0] as ChampionState).cast !== null) castTicks++;
      for (const e of state.events) {
        if (e.type === 'heal' && e.sourceId === 0 && e.targetId === 1) healed.push(e.amount);
      }
    }
    expect(castTicks).toBeGreaterThanOrEqual(17);
    expect(healed[0]).toBe(14);
  });

  it('falls back to the enemy when the ally dies during the windup', () => {
    const state = scene({ ...M2_ONLY, ally: [3, 0], allyMissing: 50 });
    const me = state.champions[0] as ChampionState;
    const bot = createBot(0, 'hard', seed);
    let pressed = false;
    for (let t = 0; t < THINKS && !pressed; t++) {
      pressed = bot.think(state).buttons !== 0;
    }
    expect(pressed).toBe(true);
    me.cast = { castId: 1, slot: 'M2', ex: false, windupTicks: 18, windupLeft: 12 };
    me.cooldowns[SLOTS.indexOf('M2')] = 300;
    // The ally is the aim while it lives.
    let input = bot.think(state);
    expect(input.buttons).toBe(0);
    const towardAlly = Math.atan2(input.aimY / 100 - me.y, input.aimX / 100 - me.x);
    expect(Math.abs(towardAlly)).toBeLessThan(0.1);
    (state.champions[1] as ChampionState).alive = false;
    input = bot.think(state);
    const towardEnemy = Math.atan2(input.aimY / 100 - me.y, input.aimX / 100 - me.x);
    expect(towardEnemy).toBeGreaterThan(1.4);
    expect(towardEnemy).toBeLessThan(1.75);
  });

  it('is the enemy again once no cast is in progress', () => {
    const state = scene({ ...M2_ONLY, ally: [3, 0], allyMissing: 50 });
    const me = state.champions[0] as ChampionState;
    const bot = createBot(0, 'hard', seed);
    let pressed = false;
    for (let t = 0; t < THINKS && !pressed; t++) {
      pressed = bot.think(state).buttons !== 0;
    }
    expect(pressed).toBe(true);
    me.cooldowns[SLOTS.indexOf('M2')] = 300;
    // No cast in progress (the frozen state never started one): the aim is the enemy's.
    const input = bot.think(state);
    const angle = Math.atan2(input.aimY / 100 - me.y, input.aimX / 100 - me.x);
    expect(angle).toBeGreaterThan(1.4);
    expect(angle).toBeLessThan(1.75);
  });

  it('aims for the cast it fires when it presses another bolt on that tick, then holds the new ally', () => {
    // Soothing Surge winds up at the ally 9 m east; on the tick it fires, Mend Bolt is pressed at the
    // ally 5 m south, who is hurt worse. This tick's aim is the Surge's, the next think's the Bolt's.
    const state = trio([3, 0, 60], [-6, -5, 0], { ready: ['M2'] });
    const me = state.champions[0] as ChampionState;
    const bot = createBot(0, 'hard', seed);
    let pressed = false;
    for (let t = 0; t < THINKS && !pressed; t++) pressed = bot.think(state).buttons !== 0;
    expect(pressed).toBe(true);
    me.cast = { castId: 1, slot: 'M2', ex: false, windupTicks: 18, windupLeft: 9 };
    me.cooldowns[SLOTS.indexOf('M2')] = 300;
    me.cooldowns[SLOTS.indexOf('M1')] = 0;
    const second = state.champions[2] as ChampionState;
    second.health = second.maxHealth - 100;
    for (let i = 0; i < 8; i++) expect(bot.think(state).buttons).toBe(0);
    me.cast.windupLeft = 1;
    const fired = bot.think(state);
    expect(labelOf(fired.buttons)).toBe('M1');
    const east = Math.atan2(fired.aimY / 100 - me.y, fired.aimX / 100 - me.x);
    expect(Math.abs(east)).toBeLessThan(0.1);
    // The Bolt winds up for 6 ticks, and its aim is the ally it was pressed at.
    me.cast = { castId: 2, slot: 'M1', ex: false, windupTicks: 6, windupLeft: 5 };
    me.cooldowns[SLOTS.indexOf('M1')] = 36;
    const winding = bot.think(state);
    const south = Math.atan2(winding.aimY / 100 - me.y, winding.aimX / 100 - me.x);
    expect(south).toBeLessThan(-1.4);
    expect(south).toBeGreaterThan(-1.75);
  });

  it('keeps the landing of Glide on the tick an ally-aimed Soothing Surge fires', () => {
    const state = scene({ ...M2_ONLY, ally: [3, 0], allyMissing: 50 });
    const me = state.champions[0] as ChampionState;
    const enemy = state.champions[2] as ChampionState;
    const bot = createBot(0, 'hard', seed);
    let pressed = false;
    for (let t = 0; t < THINKS && !pressed; t++) {
      pressed = bot.think(state).buttons !== 0;
    }
    expect(pressed).toBe(true);
    // The cast is winding up, Glide is ready and the enemy is 2 m off.
    me.cast = { castId: 1, slot: 'M2', ex: false, windupTicks: 18, windupLeft: 9 };
    me.cooldowns[SLOTS.indexOf('M2')] = 300;
    me.cooldowns[SLOTS.indexOf('SPACE')] = 0;
    enemy.x = me.x + 2;
    enemy.y = me.y;
    for (let i = 0; i < 12; i++) expect(bot.think(state).buttons).toBe(0);
    me.cast.windupLeft = 1;
    const input = bot.think(state);
    expect(labelOf(input.buttons)).toBe('SPACE');
    const landing = oracleDashLanding(state, me, enemy, 4);
    expect(landing).not.toBeNull();
    expect([input.aimX, input.aimY]).toEqual([landing?.aimX, landing?.aimY]);
  });
});

describe('the run of an ally slot', () => {
  const castDelay = TIERS.hard.castDelay;
  const delay = TIERS.hard.delay;

  it('goes on when another ally qualifies: switching allies does not start it over', () => {
    const state = trio([3, 0, 60], [-6, -9, 0], { ready: ['M2'] });
    const bot = createBot(0, 'hard', 1);
    const ally1 = state.champions[1] as ChampionState;
    const ally2 = state.champions[2] as ChampionState;
    let pressedAt = -1;
    for (let i = 0; i < 40 && pressedAt < 0; i++) {
      // Two thinks into the run (the bot acts from think `delay`), ally 1 is healed and ally 2 hurt.
      if (i === delay + 2) {
        ally1.health = ally1.maxHealth;
        ally2.health = ally2.maxHealth - 60;
      }
      if (bot.think(state).buttons !== 0) pressedAt = i;
    }
    // A run counts from think `delay` and the press needs a run above castDelay.
    expect(pressedAt).toBe(delay + castDelay);
  });
});

describe('the ally arrays of the kit cache', () => {
  function cacheOf(id: string): ReturnType<typeof createKitCache> {
    const kit = kits.find((k) => k.id === id) as KitDef;
    const cache = createKitCache();
    refreshKitCache(cache, findKit({ kits } as GameState, id), id);
    expect(cache.kit).toBe(kit);
    return cache;
  }
  const at = (slot: (typeof SLOTS)[number]) => SLOTS.indexOf(slot);

  it('holds the kind, the reach, the need and the clearance of each of Lumeth ally slots', () => {
    const cache = cacheOf('lumeth');
    expect([...cache.allyKind]).toEqual([1, 1, 0, 0, 0, 2, 2]);
    expect(cache.allyMax[at('M1')]).toBe(12);
    expect(cache.allyMax[at('M2')]).toBeCloseTo(10.1333333, 6);
    expect(cache.allyMax[at('R')]).toBe(5.5);
    expect(cache.allyMax[at('F')]).toBe(5.5);
    expect([...cache.allyNeed]).toEqual([10, 14, 0, 0, 0, 30, 30]);
    expect([...cache.allyClearance]).toEqual([0.35, 0.5, 0, 0, 0, 0, 0]);
  });

  it('drops the enemy band of the area slots and keeps the one of the bolt', () => {
    const cache = cacheOf('lumeth');
    expect(cache.hasBase[at('M1')]).toBe(1);
    expect(cache.hasBase[at('M2')]).toBe(0);
    // Dawnbloom reaches allies only: its slow on enemies is no band.
    expect(cache.hasBase[at('F')]).toBe(0);
    expect(cache.hasBase[at('R')]).toBe(0);
  });

  it('gives no ally slot to a champion whose rule lists none, whatever its kit holds', () => {
    // Rally Cry is an area on allies placed on self, and Iron Hide is a shield: neither is an ally slot.
    for (const id of ['hargrim', 'quillon', 'skerrow']) {
      expect([...cacheOf(id).allyKind], id).toEqual([0, 0, 0, 0, 0, 0, 0]);
    }
  });
});

describe('the buttons of an ally press', () => {
  it('is the plain slot, never SHIFT', () => {
    const state = scene({ ...R_ONLY, energy: 100, missing: 60 });
    const bot = createBot(0, 'hard', 1);
    let buttons = 0;
    for (let i = 0; i < THINKS && buttons === 0; i++) buttons = bot.think(state).buttons;
    expect(buttons).toBe(Button.R);
  });
});
