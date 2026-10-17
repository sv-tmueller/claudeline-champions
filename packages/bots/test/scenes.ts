import { Button, SLOTS, cloneState, createMatch, debug, step } from '@claudeline/sim';
import type {
  ArenaDef,
  ChampionState,
  Effect,
  GameState,
  KitDef,
  MatchConfig,
  ProjectileState,
  Slot,
} from '@claudeline/sim';
import { createBot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import type { Difficulty } from '../src/difficulty';
import { arena01, jsonKits } from './helpers';

// Frozen states with the shipped kits for the rule pins (openers, escapes, the ultimate's hold).
// Champion 0 is the champion under test and champion 2 its only enemy; champions 1 and 3 are dead.
// A frozen state repeats the same think, so the first press is what the bot would choose.

/** Arena 01 without its obstacles. */
export const OPEN: ArenaDef = { ...arena01, id: 'open', obstacles: [] };

/** Thinks enough for a hard bot to settle its intent and press, whatever its cast delay. */
export const THINKS = TIERS.hard.delay + TIERS.hard.castDelay + 60;

export interface Options {
  /** Default: `OPEN`. */
  arena?: ArenaDef;
  /** Default: the three shipped kits of `jsonKits()`; `rosterKits()` adds Lumeth's. */
  kits?: readonly KitDef[];
  /** Default: the champion at (-6, 0), the enemy `distance` metres east of it. */
  me?: readonly [number, number];
  enemy?: readonly [number, number];
  energy?: number;
  /** The slots left off cooldown; every other slot is on a long cooldown. All ready when absent. */
  ready?: readonly Slot[];
  /** The cooldown of single slots of the champion under test, in ticks, applied after `ready`. */
  cooldown?: Partial<Record<Slot, number>>;
  /**
   * Where champion 1, the dummy ally of the champion under test, stands. It is alive only with
   * this option: a scene is a duel otherwise.
   */
  ally?: readonly [number, number];
  /** Health points the ally lacks (the ally has the default maximum, 120). Default: 0. */
  allyMissing?: number;
  /** Health points the champion under test lacks. Default: 0. */
  missing?: number;
  /** The enemy's velocity along x, in m/s: positive is away from the champion under test. */
  enemyVx?: number;
  /** The champion id of the enemy (champion 2). Default: `dummy`, which has no kit and no rule. */
  enemyId?: string;
  /** The enemy's slots left off cooldown, as `ready` does for the champion under test. */
  enemyReady?: readonly Slot[];
  /** The enemy's cooldown of single slots, in ticks, applied after `enemyReady`. */
  enemyCooldown?: Partial<Record<Slot, number>>;
  /** A status the enemy carries, which its gates read. */
  enemyStatus?: 'stun' | 'silence';
  /** Health of the champion under test and of the enemy, as fractions of the maximum. */
  health?: number;
  enemyHealth?: number;
}

export function sceneOf(championId: string, distance: number, options: Options = {}): GameState {
  const config: MatchConfig = {
    teamSize: 2,
    players: [
      { championId, team: 'A' },
      { championId: 'dummy', team: 'A' },
      { championId: options.enemyId ?? 'dummy', team: 'B' },
      { championId: 'dummy', team: 'B' },
    ],
  };
  const state = createMatch(config, options.arena ?? OPEN, 1, options.kits ?? jsonKits());
  for (const id of [1, 3]) (state.champions[id] as ChampionState).alive = false;
  if (options.ally !== undefined) {
    const ally = state.champions[1] as ChampionState;
    ally.alive = true;
    ally.x = options.ally[0];
    ally.y = options.ally[1];
    ally.health = ally.maxHealth - (options.allyMissing ?? 0);
  }
  const me = state.champions[0] as ChampionState;
  const enemy = state.champions[2] as ChampionState;
  me.x = options.me?.[0] ?? -6;
  me.y = options.me?.[1] ?? 0;
  enemy.x = options.enemy?.[0] ?? me.x + distance;
  enemy.y = options.enemy?.[1] ?? me.y;
  enemy.vx = options.enemyVx ?? 0;
  me.energy = options.energy ?? 0;
  if (options.health !== undefined) me.health = options.health * me.maxHealth;
  if (options.missing !== undefined) me.health = me.maxHealth - options.missing;
  if (options.enemyHealth !== undefined) enemy.health = options.enemyHealth * enemy.maxHealth;
  if (options.ready !== undefined) {
    me.cooldowns.fill(600);
    for (const slot of options.ready) me.cooldowns[SLOTS.indexOf(slot)] = 0;
  }
  for (const [slot, ticks] of Object.entries(options.cooldown ?? {})) {
    me.cooldowns[SLOTS.indexOf(slot as Slot)] = ticks;
  }
  if (options.enemyReady !== undefined) {
    enemy.cooldowns.fill(600);
    for (const slot of options.enemyReady) enemy.cooldowns[SLOTS.indexOf(slot)] = 0;
  }
  for (const [slot, ticks] of Object.entries(options.enemyCooldown ?? {})) {
    enemy.cooldowns[SLOTS.indexOf(slot as Slot)] = ticks;
  }
  if (options.enemyStatus !== undefined) {
    enemy.statuses.push({ type: options.enemyStatus, sourceId: 0, slot: null, remainingTicks: 600 });
  }
  return state;
}

/** A press of a bot: its label (`SPACE`, `M2+SHIFT`) and the aim it returned with it. */
export interface Press {
  label: string;
  aimX: number;
  aimY: number;
}

export function labelOf(buttons: number): string {
  const slot = SLOTS.find((s) => (buttons & Button[s]) !== 0);
  return `${slot}${(buttons & Button.SHIFT) !== 0 ? '+SHIFT' : ''}`;
}

/** The first press of a bot of champion 0 on the frozen state, or null for none. */
export function firstPress(
  state: GameState,
  tier: Difficulty = 'hard',
  seed = 1,
  thinks = THINKS,
): Press | null {
  const bot = createBot(0, tier, seed);
  for (let i = 0; i < thinks; i++) {
    const input = bot.think(state);
    if (input.buttons !== 0) {
      return { label: labelOf(input.buttons), aimX: input.aimX, aimY: input.aimY };
    }
  }
  return null;
}

/** The label of the first press, or null. */
export function pressOf(state: GameState, tier: Difficulty = 'hard'): string | null {
  return firstPress(state, tier)?.label ?? null;
}

/** Whether a bot of champion 0 walks on its last think of a frozen state, after `thinks` thinks. */
export function walks(state: GameState, tier: Difficulty = 'hard', seed = 1, thinks = THINKS): boolean {
  const bot = createBot(0, tier, seed);
  let moving = false;
  for (let i = 0; i < thinks; i++) {
    const input = bot.think(state);
    moving = input.moveX !== 0 || input.moveY !== 0;
  }
  return moving;
}

/** A bolt for the dodge pins. Defaults: speed 20 m/s, radius 0.3 m, 120 sweeps, owner 2 (the enemy). */
export interface BoltOptions {
  from: readonly [number, number];
  /** The direction of flight; the sim normalizes it. */
  dir: readonly [number, number];
  speed?: number;
  radius?: number;
  /** The lifetime the sim spawns it with, in sweeps. */
  lifetime?: number;
  owner?: number;
  pierce?: boolean;
  effects?: readonly Effect[];
  /** Makes it an ally bolt, like Lumeth's: with empty `effects` it passes the other team. */
  allyEffects?: readonly Effect[];
  /** Sweeps left, set on the projectile after the spawn. */
  remaining?: number;
  /** Champions it has hit already, set after the spawn. */
  hitIds?: readonly number[];
}

/** Spawns a bolt through the sim's dev tool, so it has the shape of a real one, and returns it. */
export function spawnBolt(state: GameState, options: BoltOptions): ProjectileState {
  const id = debug.spawnProjectile(state, {
    ownerId: options.owner ?? 2,
    x: options.from[0],
    y: options.from[1],
    dirX: options.dir[0],
    dirY: options.dir[1],
    speed: options.speed ?? 20,
    radius: options.radius ?? 0.3,
    lifetimeTicks: options.lifetime ?? 120,
    pierce: options.pierce ?? false,
    effects: options.effects ?? [{ type: 'damage', amount: 10 }],
    ...(options.allyEffects !== undefined ? { allyEffects: options.allyEffects } : {}),
  });
  const bolt = state.projectiles.find((p) => p.id === id) as ProjectileState;
  if (options.remaining !== undefined) bolt.remainingTicks = options.remaining;
  for (const hit of options.hitIds ?? []) bolt.hitIds.push(hit);
  return bolt;
}

/**
 * The sweep, counted from the next step, in which champion 0 standing still is hit by projectile
 * `id`, from the sim itself, or null when it is not hit within `within` steps. The oracle of the
 * dodge pins: the bot's own prediction is never used to set up a scene.
 */
export function sweepOfHit(state: GameState, id: number, within = 300): number | null {
  const clone = cloneState(state);
  for (let k = 1; k <= within; k++) {
    step(clone, []);
    if (clone.events.some((e) => e.type === 'projectileHit' && e.projectileId === id && e.targetId === 0)) {
      return k;
    }
  }
  return null;
}

/** Per think of a bot of champion 0 on the frozen state, whether it moves. */
export function moveTrace(state: GameState, tier: Difficulty, seed: number, thinks: number): boolean[] {
  const bot = createBot(0, tier, seed);
  const moving: boolean[] = [];
  for (let i = 0; i < thinks; i++) {
    const input = bot.think(state);
    moving.push(input.moveX !== 0 || input.moveY !== 0);
  }
  return moving;
}
