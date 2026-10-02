import { describe, expect, it } from 'vitest';
import { Button, createMatch, hasLineOfSight, step } from '@claudeline/sim';
import type {
  ArenaDef,
  ChampionState,
  GameState,
  KitDef,
  MatchConfig,
  PlayerInput,
  Slot,
  StatusInstance,
} from '@claudeline/sim';
import { NOMINAL_PROJECTILE_SPEED, leadPoint, rotateByHalfTangent, roundAim } from '../src/aim';
import { AIM_ERROR_HOLD, createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import { createRng } from '../src/rng';
import { arena01 } from './helpers';
import { boltAbility, boltSlot, quietAbility, quietKit, quillonKit } from './kits';

const open: ArenaDef = { ...arena01, id: 'open', obstacles: [] };

/** Champion 0 is the 'tester' (default profile 4 to 8 m, so a target 5 m away is a stand). */
const TESTER: MatchConfig = {
  teamSize: 2,
  players: [
    { championId: 'tester', team: 'A' },
    { championId: 'dummy', team: 'A' },
    { championId: 'dummy', team: 'B' },
    { championId: 'dummy', team: 'B' },
  ],
};
const QUILLON: MatchConfig = {
  teamSize: 2,
  players: [
    { championId: 'dummy', team: 'A' },
    { championId: 'quillon', team: 'A' },
    { championId: 'dummy', team: 'B' },
    { championId: 'dummy', team: 'B' },
  ],
};

function ch(state: GameState, id: number): ChampionState {
  const c = state.champions[id];
  if (!c) throw new Error(`no champion ${id}`);
  return c;
}

function put(state: GameState, id: number, x: number, y: number): ChampionState {
  const c = ch(state, id);
  c.x = x;
  c.y = y;
  return c;
}

function kill(state: GameState, ...ids: number[]): void {
  for (const id of ids) ch(state, id).alive = false;
}

/** A duel: the tester (id 0, team A) at (-3, 0) and its only enemy, champion 2, 5 m east. */
function duel(kit: KitDef, arena: ArenaDef = open): GameState {
  const state = createMatch(TESTER, arena, 1, [kit]);
  kill(state, 1, 3);
  put(state, 0, -3, 0);
  put(state, 2, 2, 0);
  return state;
}

/** Quillon (id 1) 10 m west of champion 2, which is its only enemy. */
function quillonDuel(): GameState {
  const state = createMatch(QUILLON, open, 1, [quillonKit()]);
  kill(state, 0, 3);
  put(state, 1, -12, 0);
  put(state, 2, -2, 0);
  return state;
}

function stepOne(state: GameState, id: number, input: PlayerInput): void {
  const inputs: (PlayerInput | undefined)[] = [];
  inputs[id] = input;
  step(state, inputs);
}

/** Thinks until a think presses something; the index of that think (from 0) and its input. */
function firstPress(
  bot: Bot,
  state: GameState,
  maxThinks: number,
): { index: number; input: PlayerInput } | null {
  for (let index = 0; index < maxThinks; index++) {
    const input = bot.think(state);
    if (input.buttons !== 0) return { index, input };
  }
  return null;
}

/** A status the bot's gates read; the sim only counts `remainingTicks` down. */
function status(type: 'stun' | 'silence' | 'root'): StatusInstance {
  return { type, sourceId: 2, slot: null, remainingTicks: 600 };
}

const ENOUGH = 60;

describe('cast timing and line of sight', () => {
  it('does not cast while the target is behind the pillar, and casts once it has line of sight', () => {
    const tier = TIERS.hard;
    const state = createMatch(QUILLON, arena01, 1, [quillonKit()]);
    kill(state, 0, 3);
    const me = put(state, 1, -3, 0);
    const target = put(state, 2, -3, 4);
    const bot = createBot(1, 'hard', 1);
    for (let i = 0; i < tier.delay + 1; i++) bot.think(state);
    expect(bot.inspect().intent).toBe('kite');

    // The target steps behind the pillar: 7 m away, in reach of Quillon's bolts, and out of sight.
    put(state, 2, 4, 0);
    expect(hasLineOfSight(state, me, target)).toBe(false);
    const seen: boolean[] = [];
    let pressed = -1;
    for (let tick = 0; tick < 240 && pressed < 0; tick++) {
      seen.push(hasLineOfSight(state, me, target));
      const input = bot.think(state);
      if (!seen[tick]) expect(input.buttons, `tick ${tick} has no line of sight`).toBe(0);
      if (input.buttons !== 0) pressed = tick;
      stepOne(state, 1, input);
    }
    expect(pressed, 'the bot never pressed').toBeGreaterThan(0);
    const firstSeen = seen.indexOf(true);
    expect(firstSeen).toBeGreaterThanOrEqual(0);
    // The run needs line of sight on every think from the first one to the press.
    expect(seen.slice(firstSeen, pressed + 1).every((s) => s)).toBe(true);
    expect(pressed).toBe(firstSeen + tier.castDelay);
  });

  for (const tier of ['easy', 'normal', 'hard'] as const) {
    it(`${tier} presses exactly ${TIERS[tier].castDelay} thinks after the target enters reach`, () => {
      const state = quillonDuel();
      put(state, 2, 8, 0);
      const bot = createBot(1, tier, 4);
      // 20 m away and in sight: no slot is in reach, so nothing is pressed.
      for (let i = 0; i < TIERS[tier].delay + 1; i++) {
        expect(bot.think(state).buttons, `think ${i}`).toBe(0);
      }
      expect(bot.inspect().intent).toBe('engage');

      put(state, 2, -2, 0);
      const press = firstPress(bot, state, 100);
      expect(press?.index).toBe(TIERS[tier].castDelay);
      expect(press?.input.buttons).toBe(Button.E);
    });
  }

  it('casts a 30-tick slot on ticks t0, t0 + 30 and t0 + 60', () => {
    const kit = quietKit('tester', { M1: boltSlot(20, 30, { cooldownTicks: 30 }) });
    const state = duel(kit);
    const bot = createBot(0, 'hard', 1);
    const started: number[] = [];
    for (let tick = 0; tick < 120; tick++) {
      const input = bot.think(state);
      const before = state.tick;
      stepOne(state, 0, input);
      for (const e of state.events) {
        if (e.type === 'castStarted' && e.championId === 0) started.push(before);
      }
    }
    const t0 = TIERS.hard.delay + TIERS.hard.castDelay;
    expect(started.slice(0, 3)).toEqual([t0, t0 + 30, t0 + 60]);
  });
});

describe('windups', () => {
  it('waits for a windup and casts on the tick it fires', () => {
    const kit = quietKit('tester', {
      M1: boltSlot(20, 30, { cooldownTicks: 30 }),
      Q: boltSlot(20, 30, { cooldownTicks: 600, windupTicks: 10, movement: 'locked' }),
    });
    const state = duel(kit);
    const me = ch(state, 0);
    const bot = createBot(0, 'hard', 1);
    let started = -1;
    for (let tick = 0; tick < 60 && started < 0; tick++) {
      const input = bot.think(state);
      // Q comes before M1 in the order, so the first press is Q.
      if (input.buttons !== 0) {
        expect(input.buttons).toBe(Button.Q);
        started = tick;
      }
      stepOne(state, 0, input);
    }
    expect(started).toBeGreaterThan(0);
    expect(me.cast?.slot).toBe('Q');

    let waited = 0;
    for (let guard = 0; guard < 30; guard++) {
      const left = me.cast?.windupLeft;
      expect(left, 'the windup ended without a press').toBeDefined();
      const input = bot.think(state);
      if (left === 1) {
        expect(input.buttons).toBe(Button.M1);
        stepOne(state, 0, input);
        const types = state.events
          .filter((e) => e.type === 'castFired' || e.type === 'castStarted')
          .map((e) => [e.type, 'slot' in e ? e.slot : null]);
        expect(types).toEqual([
          ['castFired', 'Q'],
          ['castStarted', 'M1'],
        ]);
        expect(waited).toBe(9);
        return;
      }
      expect(input.buttons, `windupLeft ${left}`).toBe(0);
      waited++;
      stepOne(state, 0, input);
    }
    throw new Error('the windup never reached 1');
  });
});

describe('cast gates', () => {
  const m1Kit = () => quietKit('tester', { M1: boltSlot(20, 30) });
  const THINKS = TIERS.hard.delay + TIERS.hard.castDelay + ENOUGH;

  function pressesWith(
    kit: KitDef,
    setup: (me: ChampionState) => void,
  ): { index: number; input: PlayerInput } | null {
    const state = duel(kit);
    setup(ch(state, 0));
    return firstPress(createBot(0, 'hard', 1), state, THINKS);
  }

  it('does not press while stunned, and does while not', () => {
    expect(pressesWith(m1Kit(), () => undefined)?.input.buttons).toBe(Button.M1);
    expect(pressesWith(m1Kit(), (me) => me.statuses.push(status('stun')))).toBeNull();
  });

  it('does not press while silenced, also with only SPACE in reach', () => {
    expect(pressesWith(m1Kit(), (me) => me.statuses.push(status('silence')))).toBeNull();
    const spaceOnly = quietKit('tester', { SPACE: boltSlot(20, 30) });
    expect(pressesWith(spaceOnly, () => undefined)?.input.buttons).toBe(Button.SPACE);
    expect(pressesWith(spaceOnly, (me) => me.statuses.push(status('silence')))).toBeNull();
  });

  it('skips a slot with a dash while rooted and presses the next one', () => {
    const kit = quietKit('tester', {
      M1: boltSlot(20, 30),
      SPACE: {
        cooldownTicks: 60,
        windupTicks: 0,
        movement: 'free',
        effects: [
          {
            type: 'dash',
            distance: 5,
            ticks: 10,
            then: [
              {
                type: 'area',
                placement: { type: 'self' },
                radius: 3,
                durationTicks: 1,
                intervalTicks: 1,
                targets: 'enemies',
                effects: [{ type: 'damage', amount: 1 }],
              },
            ],
          },
        ],
      },
    });
    expect(pressesWith(kit, () => undefined)?.input.buttons).toBe(Button.SPACE);
    expect(pressesWith(kit, (me) => me.statuses.push(status('root')))?.input.buttons).toBe(Button.M1);
  });

  it('skips a slot with a cooldown of 2 and presses one with a cooldown of 1, which the step starts', () => {
    expect(pressesWith(m1Kit(), (me) => (me.cooldowns[0] = 2))).toBeNull();

    const state = duel(m1Kit());
    ch(state, 0).cooldowns[0] = 1;
    const press = firstPress(createBot(0, 'hard', 1), state, THINKS);
    expect(press?.input.buttons).toBe(Button.M1);
    if (press === null) return;
    stepOne(state, 0, press.input);
    const started = state.events.filter((e) => e.type === 'castStarted');
    expect(started).toMatchObject([{ championId: 0, slot: 'M1', ex: false, cost: 0 }]);
  });

  it('presses nothing for a dead bot, an idle bot or a bot with no enemy alive', () => {
    const state = duel(m1Kit());
    const bot = createBot(0, 'hard', 1);
    expect(firstPress(bot, state, THINKS)).not.toBeNull();
    kill(state, 2);
    for (let i = 0; i < 40; i++) expect(bot.think(state).buttons, `idle think ${i}`).toBe(0);
    ch(state, 2).alive = true;
    ch(state, 0).alive = false;
    for (let i = 0; i < 40; i++) expect(bot.think(state).buttons, `dead think ${i}`).toBe(0);
  });
});

describe('energy', () => {
  const exKit = (ex: ReturnType<typeof boltAbility> | ReturnType<typeof quietAbility>) =>
    quietKit('tester', { M2: boltSlot(20, 30, { ex }) });
  const THINKS = TIERS.hard.delay + TIERS.hard.castDelay + ENOUGH;

  it('presses the base slot at 24 energy and the EX variant with SHIFT at 25', () => {
    for (const [energy, buttons] of [
      [24, Button.M2],
      [25, Button.M2 | Button.SHIFT],
    ] as const) {
      const state = duel(exKit(boltAbility(20, 30)));
      ch(state, 0).energy = energy;
      const press = firstPress(createBot(0, 'hard', 1), state, THINKS);
      expect(press?.input.buttons, `energy ${energy}`).toBe(buttons);
    }
  });

  it('makes the sim start an EX cast of cost 25 from the SHIFT press', () => {
    const state = duel(exKit(boltAbility(20, 30)));
    ch(state, 0).energy = 25;
    const press = firstPress(createBot(0, 'hard', 1), state, THINKS);
    if (press === null) throw new Error('no press');
    stepOne(state, 0, press.input);
    const started = state.events.filter((e) => e.type === 'castStarted');
    expect(started).toMatchObject([{ championId: 0, slot: 'M2', ex: true, cost: 25 }]);
  });

  it('presses the base slot without SHIFT when the EX variant has no reach band', () => {
    const state = duel(exKit(quietAbility()));
    ch(state, 0).energy = 25;
    const press = firstPress(createBot(0, 'hard', 1), state, THINKS);
    expect(press?.input.buttons).toBe(Button.M2);
  });

  it('presses F at 100 energy and not at 99', () => {
    const kit = quietKit('tester', { F: boltSlot(20, 30, { cooldownTicks: 600 }) });
    const low = duel(kit);
    ch(low, 0).energy = 99;
    expect(firstPress(createBot(0, 'hard', 1), low, THINKS)).toBeNull();

    const state = duel(kit);
    ch(state, 0).energy = 100;
    const press = firstPress(createBot(0, 'hard', 1), state, THINKS);
    expect(press?.input.buttons).toBe(Button.F);
    if (press === null) return;
    stepOne(state, 0, press.input);
    const started = state.events.filter((e) => e.type === 'castStarted');
    expect(started).toMatchObject([{ championId: 0, slot: 'F', ex: false, cost: 100 }]);
  });
});

describe('slot order', () => {
  it('walks F, R, E, Q, SPACE, M2, M1 as slots go on cooldown, one slot bit per think', () => {
    const bolt = () => boltSlot(20, 30, { cooldownTicks: 600 });
    const kit = quietKit('tester', {
      M1: bolt(),
      M2: bolt(),
      SPACE: bolt(),
      Q: bolt(),
      E: bolt(),
      R: bolt(),
      F: bolt(),
    });
    const state = duel(kit);
    const me = ch(state, 0);
    me.energy = 100;
    const bot = createBot(0, 'hard', 1);
    const press = firstPress(bot, state, 100);
    expect(press?.input.buttons).toBe(Button.F);

    const order: [Slot, number][] = [
      ['F', 6],
      ['R', 5],
      ['E', 4],
      ['Q', 3],
      ['SPACE', 2],
      ['M2', 1],
      ['M1', 0],
    ];
    const seen: number[] = [];
    for (const [, index] of order) {
      const input = bot.think(state);
      expect(input.buttons & (input.buttons - 1), 'exactly one bit').toBe(0);
      seen.push(input.buttons);
      me.cooldowns[index] = 600;
    }
    expect(seen).toEqual([Button.F, Button.R, Button.E, Button.Q, Button.SPACE, Button.M2, Button.M1]);
    expect(bot.think(state).buttons).toBe(0);
  });
});

describe('no band, no kit', () => {
  it('presses nothing with a quiet kit and the target adjacent', () => {
    const state = duel(quietKit('tester'));
    put(state, 2, -1.5, 0);
    const bot = createBot(0, 'hard', 1);
    for (let i = 0; i < 200; i++) expect(bot.think(state).buttons, `think ${i}`).toBe(0);
  });

  it('presses nothing with no kit at all', () => {
    const state = createMatch(TESTER, open, 1);
    kill(state, 1, 3);
    put(state, 0, -3, 0);
    put(state, 2, 2, 0);
    const bot = createBot(0, 'hard', 1);
    for (let i = 0; i < 200; i++) expect(bot.think(state).buttons, `think ${i}`).toBe(0);
  });
});

describe('aim speed', () => {
  const seed = 3;
  const tier = TIERS.hard;

  function expectedAim(me: ChampionState, target: ChampionState, speed: number) {
    const u = (2 * createRng(seed).next() - 1) * tier.maxU;
    const lead = leadPoint(me, target, { x: target.vx, y: target.vy }, speed);
    const turned = rotateByHalfTangent(lead.x - me.x, lead.y - me.y, u);
    return { aimX: roundAim(me.x + turned.x), aimY: roundAim(me.y + turned.y) };
  }

  it("leads with the speed of the ability it presses: Quillon's E is 24 m/s", () => {
    const state = quillonDuel();
    const me = ch(state, 1);
    const target = ch(state, 2);
    target.vx = 0;
    target.vy = 5.5;
    const bot = createBot(1, 'hard', seed);
    const press = firstPress(bot, state, 100);
    expect(press?.input.buttons).toBe(Button.E);
    expect(press?.input).toMatchObject(expectedAim(me, target, 24));
    // The lead depends on the speed: the nominal one would aim elsewhere.
    expect(expectedAim(me, target, NOMINAL_PROJECTILE_SPEED)).not.toEqual(expectedAim(me, target, 24));
    // The error draw is the first one, still held on the 4th aim.
    expect(press?.index).toBeLessThan(tier.delay + AIM_ERROR_HOLD);
  });

  it('leads with the speed of the ability winding up while one is in progress', () => {
    const state = quillonDuel();
    const me = ch(state, 1);
    const target = ch(state, 2);
    target.vx = 0;
    target.vy = 5.5;
    // Bind Shot, 15 m/s, has 5 turns left: the bot presses nothing, and aims for it.
    me.cast = { castId: 1, slot: 'M2', ex: false, windupTicks: 18, windupLeft: 5 };
    const bot = createBot(1, 'hard', seed);
    let input: PlayerInput | undefined;
    for (let i = 0; i <= tier.delay; i++) input = bot.think(state);
    expect(input?.buttons).toBe(0);
    expect(input).toMatchObject(expectedAim(me, target, 15));
    expect(expectedAim(me, target, 15)).not.toEqual(expectedAim(me, target, NOMINAL_PROJECTILE_SPEED));
  });

  it('keeps the nominal speed for a champion without a kit', () => {
    const state = createMatch(QUILLON, open, 1);
    kill(state, 0, 3);
    const me = put(state, 1, -12, 0);
    const target = put(state, 2, -2, 0);
    target.vy = 5.5;
    const bot = createBot(1, 'hard', seed);
    let input: PlayerInput | undefined;
    for (let i = 0; i <= tier.delay; i++) input = bot.think(state);
    expect(input).toMatchObject(expectedAim(me, target, NOMINAL_PROJECTILE_SPEED));
  });
});
