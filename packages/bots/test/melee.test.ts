import { describe, expect, it } from 'vitest';
import { Button, cloneState, hasLineOfSight, step } from '@claudeline/sim';
import type { AbilitySpec, ChampionState, GameState, KitDef, PlayerInput, SimEvent, SlotSpec } from '@claudeline/sim';
import { createBot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import type { Difficulty } from '../src/difficulty';
import { arena01, clearShotOracle, jsonKits } from './helpers';
import { boltAbility, boltSlot } from './kits';
import { KIT_SETS, MELEE, pressProblems } from './press-oracle';
import { firstPress, labelOf, sceneOf } from './scenes';
import type { Options } from './scenes';

// A melee arc ignores obstacles (the sim's choice, melee.ts and simulation.md), so a press whose
// ability's first top-level effect is a `meleeArc` gets no clear-shot test (#186, bots.md, Clear
// shot). The frozen state is the H3 seed 98 state of #123: STAND_SEED_98 of touching.test.ts, copied
// literally. The two Hargrims stand 0.9999999999999999 m apart with the centre pillar of arena01
// (radius 1.5) on the line: the line of sight is true, a 0.5 m shot is not clear, a 0.25 m shot is.
const A = { x: 0.2539074065005658, y: -1.9838172871825055 };
const B = { x: 1.2433171588985585, y: -1.8386679094375675 };
const TIER_NAMES = ['easy', 'normal', 'hard'] as const;

function scene(championId: string, options: Options = {}, from = A, to = B): GameState {
  return sceneOf(championId, 0, {
    arena: arena01,
    me: [from.x, from.y],
    enemy: [to.x, to.y],
    enemyId: 'hargrim',
    ...options,
  });
}

/** The think (from 0) on which a bot of champion 0 first presses on the frozen state, and its input. */
function pressAt(state: GameState, tier: Difficulty, seed = 1): { think: number; input: PlayerInput } | null {
  const bot = createBot(0, tier, seed);
  for (let think = 0; think < 200; think++) {
    const input = bot.think(state);
    if (input.buttons !== 0) return { think, input };
  }
  return null;
}

function me(state: GameState): ChampionState {
  return state.champions[0] as ChampionState;
}

/** A Skerrow kit with the slot E (and its EX variant) replaced; the rest is the shipped kit. */
function skerrowWith(base: SlotSpec | undefined, ex: AbilitySpec | undefined): KitDef[] {
  const kits = jsonKits();
  const kit = kits.find((k) => k.id === 'skerrow') as KitDef;
  const rend = kit.slots.E;
  kit.slots.E = { ...(base ?? rend), ex: ex ?? rend.ex } as SlotSpec;
  return kits;
}

// A 0.6 m bolt: no clear shot in the frozen state, which a 0.25 m one has.
const BOLT = boltSlot(20, 30, { radius: 0.6, damage: 10 });
const BOLT_EX = boltAbility(20, 30, { radius: 0.6, damage: 10 });

describe('the frozen state of #123 (seed 98): a Hargrim 1 m from a Hargrim, the pillar on the line', () => {
  const state = scene('hargrim', { ready: ['M1'], energy: 40 });

  it('has a line of sight, no clear shot of 0.5 m either way, and a clear shot of 0.25 m', () => {
    const [a, b] = [me(state), state.champions[2] as ChampionState];
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1.0000001);
    expect(hasLineOfSight(state, a, b)).toBe(true);
    expect(clearShotOracle(state, a, b, 0.5)).toBe(false);
    expect(clearShotOracle(state, b, a, 0.5)).toBe(false);
    expect(clearShotOracle(state, a, b, 0.25)).toBe(true);
  });

  it.each(TIER_NAMES)('presses M1 on the %s tier at the think of its reaction and cast delays', (tier) => {
    const press = pressAt(state, tier);
    expect(press && labelOf(press.input.buttons)).toBe('M1');
    expect(press?.think).toBe(TIERS[tier].delay + TIERS[tier].castDelay);
  });

  it.each(TIER_NAMES)('presses M1 on the %s tier from the other side too', (tier) => {
    const other = scene('hargrim', { ready: ['M1'], energy: 40 }, B, A);
    expect(clearShotOracle(other, me(other), other.champions[2] as ChampionState, 0.5)).toBe(false);
    expect(firstPress(other, tier)?.label).toBe('M1');
  });

  it('presses M1 with every slot ready at 40 energy', () => {
    expect(firstPress(scene('hargrim', { energy: 40 }))?.label).toBe('M1');
  });

  it('lands: the sim names the other Hargrim in the arc and deals damage to it', () => {
    const press = pressAt(state, 'hard');
    if (press === null) throw new Error('no press');
    const sim = cloneState(state);
    const held: PlayerInput = { ...press.input, moveX: 0, moveY: 0 };
    const idle: PlayerInput = { moveX: 0, moveY: 0, aimX: press.input.aimX, aimY: press.input.aimY, buttons: 0 };
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 30; tick++) {
      step(sim, [tick === 0 ? held : idle]);
      events.push(...sim.events);
    }
    const arc = events.find((e) => e.type === 'meleeArc');
    expect(arc?.type === 'meleeArc' && arc.targetIds).toEqual([2]);
    const hit = events.find((e) => e.type === 'damage' && e.targetId === 2 && e.sourceId === 0);
    expect(hit?.type === 'damage' && hit.amount).toBe(12);
  });
});

describe('the other melee slots in the same state', () => {
  it('presses Skerrow M1', () => {
    expect(firstPress(scene('skerrow', { ready: ['M1'] }))?.label).toBe('M1');
  });

  it('presses Rend (Skerrow E), and Rend EX at 25 energy', () => {
    expect(firstPress(scene('skerrow', { ready: ['E'] }))?.label).toBe('E');
    expect(firstPress(scene('skerrow', { ready: ['E'], energy: 25 }))?.label).toBe('E+SHIFT');
  });
});

describe('what keeps the 0.5 m test in the same state', () => {
  it('refuses Hargrim M2, an area, at 0 and at 40 energy', () => {
    expect(firstPress(scene('hargrim', { ready: ['M2'] }))).toBeNull();
    expect(firstPress(scene('hargrim', { ready: ['M2'], energy: 40 }))).toBeNull();
  });

  it('refuses the EX Lunge, an arc after a dash, at 25 energy', () => {
    expect(firstPress(scene('skerrow', { ready: ['SPACE'], energy: 25 }))).toBeNull();
  });

  it("refuses Reaper's Dance, an arc after a teleport, at 100 energy against a target at 40 health", () => {
    expect(firstPress(scene('skerrow', { ready: ['F'], energy: 100, enemyHealth: 40 / 160 }))).toBeNull();
  });

  it('refuses a Hargrim F, a dash, at 100 energy', () => {
    expect(firstPress(scene('hargrim', { ready: ['F'], energy: 100 }))).toBeNull();
  });
});

// The base and the EX variant of a slot are read apart, as the dash hold of #98 reads them.
describe('the base and the EX variant are read apart', () => {
  const pressOf = (kits: KitDef[], energy: number): string | null =>
    firstPress(scene('skerrow', { kits, ready: ['E'], energy }))?.label ?? null;

  it('an arc base with a 0.6 m bolt EX: the arc is pressed at 24 energy, the EX bolt refused at 25', () => {
    const kits = skerrowWith(undefined, BOLT_EX);
    expect(pressOf(kits, 24)).toBe('E');
    expect(pressOf(kits, 25)).toBeNull();
  });

  it('a 0.6 m bolt base with an arc EX: the base bolt is refused at 24 energy, the EX arc pressed at 25', () => {
    const kits = skerrowWith(BOLT, undefined);
    expect(pressOf(kits, 24)).toBeNull();
    expect(pressOf(kits, 25)).toBe('E+SHIFT');
  });
});

describe('the oracle of the headless runs', () => {
  const set = KIT_SETS[1] as (typeof KIT_SETS)[number];
  const check = (slot: 'M1' | 'M2') => {
    const state = scene('hargrim', { ready: [slot], energy: 40 });
    const c = me(state);
    const input: PlayerInput = { moveX: 0, moveY: 0, aimX: 124, aimY: -184, buttons: Button[slot] };
    return pressProblems(state, c, { slot, ex: false }, { intent: 'engage', targetId: 2 }, input, set).problems;
  };

  it('passes the M1 press of the seed 98 state', () => {
    expect(check('M1')).toEqual([]);
  });

  it('still reports no clear shot of width 0.5 for a Hargrim M2 press in the same state', () => {
    expect(check('M2')).toContain('no clear shot of width 0.5');
  });

  it('lists the four melee keys', () => {
    expect([...MELEE].sort()).toEqual(['hargrim:M1', 'skerrow:E', 'skerrow:E:ex', 'skerrow:M1']);
  });
});
