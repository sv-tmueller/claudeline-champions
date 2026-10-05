import { describe, expect, it } from 'vitest';
import { createMatch, step } from '@claudeline/sim';
import type { ArenaDef, ChampionState, GameState, PlayerInput } from '@claudeline/sim';
import { createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import { buildNavGrid, cellCenter, cellIndexAt } from '../src/grid';
import { arena01, clearShotOracle, config2v2, configMirror, createRun, jsonKits } from './helpers';
import { hargrimKit, quillonKit } from './kits';

// The low-health deadlock: every champion of a match retreats to its spawn and stands there, and
// nobody is ever in reach of anybody. A retreating bot advances when no enemy is in its reach and
// its team is not ahead (the sum of health fractions of its alive champions is at most the enemy's),
// and a bot that is advancing stays so until it stops retreating, its target changes or its team
// gets ahead. These are the unit pins of that rule; the match-sized pin is in headless-kits.test.ts.

const open: ArenaDef = { ...arena01, id: 'open', obstacles: [] };
const DELAY = TIERS.hard.delay;

function ch(state: GameState, id: number): ChampionState {
  const c = state.champions[id];
  if (!c) throw new Error(`no champion ${id}`);
  return c;
}

function put(state: GameState, id: number, x: number, y: number): void {
  const c = ch(state, id);
  c.x = x;
  c.y = y;
}

/**
 * Puts the champion on the centre of the grid cell it stands in. A retreating bot walks to the
 * centre of the cell of its spawn and stops there, so a test of a bot that stands still starts it
 * there; a spawn point itself is 0.35 m from a centre.
 */
function snap(state: GameState, id: number): void {
  const grid = buildNavGrid(state.arena);
  const c = ch(state, id);
  const centre = cellCenter(grid, cellIndexAt(grid, c));
  c.x = centre.x;
  c.y = centre.y;
}

function health(state: GameState, id: number, fraction: number): void {
  const c = ch(state, id);
  c.health = fraction * c.maxHealth;
}

/** Thinks `n` times on the frozen state and returns what the last think returned, copied. */
function think(bot: Bot, state: GameState, n = 1): PlayerInput {
  let last = bot.think(state);
  for (let i = 1; i < n; i++) last = bot.think(state);
  return { ...last };
}

/** Enough thinks for the reaction delay to pass and a decision to be acted on. */
const SETTLE = DELAY + 10;

/**
 * Quillon (id 1, kitless, so the table profile: stands 6 to 13 m from its target) at the centre of
 * the cell of its spawn (-12, -2) on open ground at 20 percent health, with one enemy alive, Lumeth (id 2), at full
 * health 24 m away. The other two champions are dead, so the sums are 0.2 against 1.
 */
function lone(enemyAt: [number, number] = [12, 2]): { state: GameState; bot: Bot } {
  const state = createMatch(config2v2(), open, 1);
  for (const dead of [0, 3]) ch(state, dead).alive = false;
  snap(state, 1);
  put(state, 2, enemyAt[0], enemyAt[1]);
  health(state, 1, 0.2);
  return { state, bot: createBot(1, 'hard', 1) };
}

describe('the advance of a retreating bot', () => {
  it('walks toward the enemy when nobody is in reach and its team is behind', () => {
    const { state, bot } = lone();
    const input = think(bot, state, SETTLE);
    expect(bot.inspect()).toEqual({ intent: 'retreat', targetId: 2 });
    expect(input.moveX).toBe(1);
  });

  it('stays at its spawn when its team is ahead', () => {
    const { state, bot } = lone();
    health(state, 2, 0.1);
    // The enemy is far away, so no finisher applies; 0.2 against 0.1 is ahead.
    const input = think(bot, state, SETTLE);
    expect(bot.inspect()).toEqual({ intent: 'retreat', targetId: 2 });
    expect([input.moveX, input.moveY]).toEqual([0, 0]);
  });

  it('advances when the sums are equal: a tie is not ahead, on both teams of a mirror', () => {
    // 0.2 against 0.2 on both sides: each bot is behind or level, so each of the four advances.
    const state = createMatch(
      {
        teamSize: 2,
        players: [
          { championId: 'quillon', team: 'A' },
          { championId: 'quillon', team: 'A' },
          { championId: 'quillon', team: 'B' },
          { championId: 'quillon', team: 'B' },
        ],
      },
      open,
      1,
    );
    for (const id of [0, 1, 2, 3]) {
      health(state, id, 0.2);
      snap(state, id);
    }
    const bots = [0, 1, 2, 3].map((id) => createBot(id, 'hard', id + 1));
    const inputs = bots.map((bot) => think(bot, state, SETTLE));
    const towardEnemy = [1, 1, -1, -1];
    inputs.forEach((input, id) => expect(input.moveX, `bot ${id}`).toBe(towardEnemy[id]));
    // One more hit on team B makes team A ahead and it stays; team B, behind, still advances.
    health(state, 2, 0.1);
    const after = bots.map((bot) => think(bot, state, SETTLE));
    expect([after[0]?.moveX, after[1]?.moveX], 'team A').toEqual([0, 0]);
    expect([after[2]?.moveX, after[3]?.moveX], 'team B').toEqual([-1, -1]);
  });

  it('counts the health of every alive champion of the team, the bot included', () => {
    const { state, bot } = lone();
    // A teammate at 0.9 makes the team 1.1 against 1: ahead, so it stays.
    ch(state, 0).alive = true;
    snap(state, 0);
    health(state, 0, 0.9);
    const input = think(bot, state, SETTLE);
    expect([input.moveX, input.moveY]).toEqual([0, 0]);
    // A dead teammate counts for nothing.
    ch(state, 0).alive = false;
    expect(think(bot, state, SETTLE).moveX).toBe(1);
  });

  it('flees to its spawn instead when an enemy is in reach with a clear shot', () => {
    // The bot stands 8 m from Lumeth, inside its 13 m, with nothing between them. Lumeth is at full
    // health, so it is no finisher, and the team is behind, so only the reach keeps it from advancing.
    const { state, bot } = lone([4, -2]);
    put(state, 1, -4, -2);
    const input = think(bot, state, SETTLE);
    expect(bot.inspect()).toEqual({ intent: 'retreat', targetId: 2 });
    expect(input.moveX).toBe(-1);
  });

  it('advances past an enemy in range that has no clear shot, behind a pillar', () => {
    // arena01's pillar (radius 1.5 at the origin) is between the bot and Lumeth: 10 m apart on a
    // line through it, which is in range but has no line of sight. Nothing is in reach, so the bot
    // walks around the pillar to a cell that sees Lumeth, away from its spawn, and stands there with
    // a clear shot, where a bot that retreats walks to its spawn and stays.
    const state = createMatch(config2v2(), arena01, 1);
    for (const dead of [0, 3]) ch(state, dead).alive = false;
    put(state, 1, -5, 0);
    put(state, 2, 5, 0);
    health(state, 1, 0.2);
    const bot = createBot(1, 'hard', 1);
    const me = ch(state, 1);
    const lumeth = ch(state, 2);
    expect(clearShotOracle(state, me, lumeth, 0.5)).toBe(false);
    for (let tick = 0; tick < SETTLE + 200; tick++) {
      const input = bot.think(state);
      step(state, [undefined, { ...input }]);
    }
    expect(bot.inspect()).toEqual({ intent: 'retreat', targetId: 2 });
    expect(clearShotOracle(state, me, lumeth, 0.5), 'it sees Lumeth').toBe(true);
    expect(Math.hypot(me.x - lumeth.x, me.y - lumeth.y), 'and is in reach').toBeLessThanOrEqual(13);
  });
});

describe('the latch of the advance', () => {
  /** The bot advancing at its spawn (enemy far away), then the enemy steps into reach. */
  function latched(): { state: GameState; bot: Bot } {
    const { state, bot } = lone();
    expect(think(bot, state, SETTLE).moveX).toBe(1);
    put(state, 1, -4, -2);
    put(state, 2, 4, -2);
    return { state, bot };
  }

  it('keeps standing in reach once the advance has begun, where a bot that is not latched flees', () => {
    const { state, bot } = latched();
    // The enemy is 8 m away with a clear shot: a bot that begins here flees (see above); this one began
    // before and stands, so it can cast.
    const input = think(bot, state, SETTLE);
    expect(bot.inspect()).toEqual({ intent: 'retreat', targetId: 2 });
    expect([input.moveX, input.moveY]).toEqual([0, 0]);
  });

  it('is cleared when the team gets ahead', () => {
    const { state, bot } = latched();
    ch(state, 0).alive = true;
    snap(state, 0);
    health(state, 0, 0.2);
    // 0.4 against 1: still behind, still latched.
    expect([think(bot, state, SETTLE).moveX, think(bot, state, 1).moveY]).toEqual([0, 0]);
    health(state, 0, 1);
    // 1.2 against 1: ahead, so the latch is gone and the bot flees from the enemy in reach.
    expect(think(bot, state, SETTLE).moveX).toBe(-1);
  });

  it('is cleared when the intent leaves retreat', () => {
    const { state, bot } = latched();
    // Healed to full, the bot engages; hurt again it retreats, and must decide afresh: it flees.
    health(state, 1, 1);
    think(bot, state, SETTLE);
    expect(bot.inspect().intent).not.toBe('retreat');
    health(state, 1, 0.2);
    const input = think(bot, state, SETTLE);
    expect(bot.inspect().intent).toBe('retreat');
    expect(input.moveX).toBe(-1);
  });

  it('is cleared when the target changes', () => {
    const { state, bot } = lone([4, -2]);
    // The first enemy is 16 m away, out of reach; the bot advances toward it and is latched.
    expect(think(bot, state, SETTLE).moveX).toBe(1);
    // The bot has walked 1.75 m (the first enemy is now 14 m away, still out of reach) and a second
    // enemy appears 7 m away, nearer by more than 1 m: the target changes, the latch goes, and with
    // that enemy in reach the bot flees to its spawn.
    put(state, 1, -10, -2);
    ch(state, 3).alive = true;
    put(state, 3, -3, -2);
    const input = think(bot, state, SETTLE);
    expect(bot.inspect()).toEqual({ intent: 'retreat', targetId: 3 });
    expect(input.moveX).toBe(-1);
  });

  it('is cleared when the bot dies, so a bot revived at a new round starts afresh', () => {
    const { state, bot } = latched();
    ch(state, 1).alive = false;
    think(bot, state, 3);
    ch(state, 1).alive = true;
    const input = think(bot, state, SETTLE);
    expect(bot.inspect().intent).toBe('retreat');
    expect(input.moveX).toBe(-1);
  });
});

describe.each([
  { name: 'the test kits', kits: () => [hargrimKit(), quillonKit()] },
  { name: 'the shipped kits', kits: jsonKits },
])('the match that froze at low health, with $name', ({ kits }) => {
  // The final state of the kit headless run of #58 (a mirror 2v2 of Hargrim and Quillon, seeds 101 to
  // 104, easy, normal, hard, normal): health 3 of 160, 27 of 120, 26 of 160 and 13 of 120, every
  // champion under 36 percent, every champion retreating to its spawn and standing there, no kill.
  // Team A has 0.244 of health summed against 0.271 of team B, so team A is behind and advances,
  // and team B, ahead, stays until something changes.
  const HEALTH = [3, 27, 26, 13];
  const TIER_NAMES = ['easy', 'normal', 'hard', 'normal'] as const;

  it('has the team that is behind leave its spawn and a death follow within 3600 ticks', () => {
    const run = createRun([101, 102, 103, 104], TIER_NAMES, 7, { config: configMirror(), kits: kits() });
    const { state } = run;
    state.champions.forEach((c, id) => {
      c.health = HEALTH[id] as number;
    });
    const spawns = state.champions.map((c) => ({ x: c.x, y: c.y }));
    const left = state.champions.map(() => -1);
    let firstDeath = -1;
    for (let t = 0; t < 3600; t++) {
      run.advance();
      state.champions.forEach((c, id) => {
        const spawn = spawns[id];
        if (spawn !== undefined && left[id] === -1 && Math.hypot(c.x - spawn.x, c.y - spawn.y) > 1) {
          left[id] = state.tick;
        }
      });
      if (firstDeath < 0 && state.events.some((e) => e.type === 'death')) firstDeath = state.tick;
    }
    // Both bots of team A are 1 m from their spawns within their reaction delay and a second.
    for (const id of [0, 1]) {
      const delay = TIERS[TIER_NAMES[id] as 'easy' | 'normal' | 'hard'].delay;
      expect(left[id], `champion ${id} left its spawn`).toBeGreaterThan(-1);
      expect(left[id], `champion ${id} left its spawn`).toBeLessThanOrEqual(delay + 60);
    }
    expect(firstDeath, 'a death').toBeGreaterThan(0);
  }, 30_000);
});
