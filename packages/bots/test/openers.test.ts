import { describe, expect, it } from 'vitest';
import { Button, SLOTS, createMatch } from '@claudeline/sim';
import type {
  AbilitySpec,
  ArenaDef,
  ChampionState,
  GameState,
  KitDef,
  MatchConfig,
  Slot,
  SlotSpec,
} from '@claudeline/sim';
import { createBot } from '../src/bot';
import { dashBand } from '../src/casting';
import { TIERS } from '../src/difficulty';
import type { Difficulty } from '../src/difficulty';
import { arena01, jsonKits } from './helpers';

function kitById(id: string): KitDef {
  const kit = jsonKits().find((k) => k.id === id);
  if (kit === undefined) throw new Error(`no kit ${id}`);
  return kit;
}

function slotOf(id: string, slot: Slot): SlotSpec {
  return kitById(id).slots[slot];
}

describe('the dash band of an opener', () => {
  // A base ability with no band whose first effect is a dash of distance D gets [D - 1, D]: its
  // windup is 0, so the target cannot walk out of reach, and the dash ends against the body.
  it('is [4, 5] for Rush and [5, 6] for Lunge, read from the kit', () => {
    expect(dashBand(slotOf('hargrim', 'SPACE'))).toEqual([4, 5]);
    expect(dashBand(slotOf('skerrow', 'SPACE'))).toEqual([5, 6]);
  });

  it('is none for an EX dash that has a band of its own, for the ultimate and for other shapes', () => {
    expect(dashBand(slotOf('hargrim', 'SPACE').ex as AbilitySpec)).toBeNull();
    expect(dashBand(slotOf('skerrow', 'SPACE').ex as AbilitySpec)).toBeNull();
    expect(dashBand(slotOf('hargrim', 'F'))).toBeNull();
    expect(dashBand(slotOf('quillon', 'SPACE'))).toBeNull();
    expect(dashBand(slotOf('hargrim', 'R'))).toBeNull();
  });
});

// Frozen states on an open arena with the shipped kits. Champion 0 is the champion under test, 6 m
// west of the origin, and champion 2, the only enemy, stands `distance` east of it; the other two
// are dead. A frozen state repeats the same think, so the first press is what the bot would choose.
const OPEN: ArenaDef = { ...arena01, id: 'open', obstacles: [] };
const THINKS = TIERS.hard.delay + TIERS.hard.castDelay + 60;

interface Options {
  energy?: number;
  /** The slots left off cooldown; every other slot is on a long cooldown. All ready when absent. */
  ready?: readonly Slot[];
  /** The enemy's velocity along x, in m/s: positive is away from the champion under test. */
  enemyVx?: number;
  health?: number;
}

function sceneOf(championId: string, distance: number, options: Options = {}): GameState {
  const config: MatchConfig = {
    teamSize: 2,
    players: [
      { championId, team: 'A' },
      { championId: 'dummy', team: 'A' },
      { championId: 'dummy', team: 'B' },
      { championId: 'dummy', team: 'B' },
    ],
  };
  const state = createMatch(config, OPEN, 1, jsonKits());
  for (const id of [1, 3]) (state.champions[id] as ChampionState).alive = false;
  const me = state.champions[0] as ChampionState;
  const enemy = state.champions[2] as ChampionState;
  me.x = -6;
  me.y = 0;
  enemy.x = -6 + distance;
  enemy.y = 0;
  enemy.vx = options.enemyVx ?? 0;
  me.energy = options.energy ?? 0;
  if (options.health !== undefined) me.health = options.health * me.maxHealth;
  if (options.ready !== undefined) {
    me.cooldowns.fill(600);
    for (const slot of options.ready) me.cooldowns[SLOTS.indexOf(slot)] = 0;
  }
  return state;
}

/** What the first press of a bot on the frozen state is: the slot and EX, or null for none. */
function pressOf(state: GameState, tier: Difficulty = 'hard'): string | null {
  const bot = createBot(0, tier, 1);
  for (let i = 0; i < THINKS; i++) {
    const { buttons } = bot.think(state);
    if (buttons === 0) continue;
    const slot = SLOTS.find((s) => (buttons & Button[s]) !== 0);
    return `${slot}${(buttons & Button.SHIFT) !== 0 ? '+SHIFT' : ''}`;
  }
  return null;
}

describe('Rush, the dash opener of Hargrim', () => {
  it('presses base SPACE from 4 to 5 m with no energy, and not at 3.95 or 5.05 m', () => {
    for (const d of [4, 4.5, 5]) {
      expect(pressOf(sceneOf('hargrim', d, { ready: ['SPACE'] })), `at ${d} m`).toBe('SPACE');
    }
    for (const d of [3.95, 5.05]) {
      expect(pressOf(sceneOf('hargrim', d, { ready: ['SPACE'] })), `at ${d} m`).toBeNull();
    }
  });

  it('presses base SPACE, without SHIFT, while an ultimate reserve holds the EX variants', () => {
    // 80 energy with F ready: the reserve holds the EX dash back, so Rush is the base dash.
    const state = sceneOf('hargrim', 4.5, { energy: 80, ready: ['SPACE', 'F'] });
    expect(pressOf(state)).toBe('SPACE');
  });
});

describe('Chain Hook, the opener of Hargrim on a target that runs', () => {
  const E_ONLY = { ready: ['E'] } as const;

  it('presses E from 4 to 7 m at a target walking away', () => {
    for (const d of [4, 6, 7]) {
      expect(pressOf(sceneOf('hargrim', d, { ...E_ONLY, enemyVx: 5.5 })), `at ${d} m`).toBe('E');
    }
  });

  it('does not press E at 3.5 or 7.5 m, though the kit band reaches 8 m', () => {
    for (const d of [3.5, 7.5]) {
      expect(pressOf(sceneOf('hargrim', d, { ...E_ONLY, enemyVx: 5.5 })), `at ${d} m`).toBeNull();
    }
  });

  it('does not press E at a target that stands or closes in', () => {
    expect(pressOf(sceneOf('hargrim', 6, { ...E_ONLY, enemyVx: 0 }))).toBeNull();
    expect(pressOf(sceneOf('hargrim', 6, { ...E_ONLY, enemyVx: -5.5 }))).toBeNull();
  });
});

describe('Snare Orb, the opener of Quillon on a target that closes in', () => {
  const Q_AND_M2 = { ready: ['Q', 'M2'] } as const;

  it('presses Q at 8 m at a target walking toward her, and M2 at one that stands', () => {
    expect(pressOf(sceneOf('quillon', 8, { ...Q_AND_M2, enemyVx: -5.5 }))).toBe('Q');
    expect(pressOf(sceneOf('quillon', 8, { ...Q_AND_M2, enemyVx: 0 }))).toBe('M2');
  });

  it('presses M2, not Q, at a target walking away', () => {
    expect(pressOf(sceneOf('quillon', 8, { ...Q_AND_M2, enemyVx: 5.5 }))).toBe('M2');
  });

  it('does not press Q on a closing target beyond the kit band less the margin', () => {
    expect(pressOf(sceneOf('quillon', 9, { ready: ['Q'], enemyVx: -5.5 }))).toBe('Q');
    expect(pressOf(sceneOf('quillon', 9.05, { ready: ['Q'], enemyVx: -5.5 }))).toBeNull();
  });
});
