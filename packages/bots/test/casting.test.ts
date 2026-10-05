import { describe, expect, it } from 'vitest';
import { Button, createMatch, hasLineOfSight, step } from '@claudeline/sim';
import type {
  AbilitySpec,
  ArenaDef,
  ChampionState,
  GameState,
  KitDef,
  MatchConfig,
  PlayerInput,
  Slot,
  SlotSpec,
  StatusInstance,
} from '@claudeline/sim';
import { NOMINAL_PROJECTILE_SPEED, leadPoint, rotateByHalfTangent, roundAim } from '../src/aim';
import { AIM_ERROR_HOLD, createBot } from '../src/bot';
import type { Bot } from '../src/bot';
import { TIERS } from '../src/difficulty';
import { createRng } from '../src/rng';
import { arena01, clearShotOracle } from './helpers';
import { boltAbility, boltSlot, quietAbility, quietKit, quietSlot, quillonKit } from './kits';

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
    // The first slot in the order that is in reach is E, a shot of radius 0.2.
    const seen: boolean[] = [];
    let pressed = -1;
    for (let tick = 0; tick < 240 && pressed < 0; tick++) {
      seen.push(clearShotOracle(state, me, target, 0.2));
      const input = bot.think(state);
      if (!hasLineOfSight(state, me, target)) {
        expect(input.buttons, `tick ${tick} has no line of sight`).toBe(0);
      }
      if (input.buttons !== 0) pressed = tick;
      stepOne(state, 1, input);
    }
    expect(pressed, 'the bot never pressed').toBeGreaterThan(0);
    const firstSeen = seen.indexOf(true);
    expect(firstSeen).toBeGreaterThanOrEqual(0);
    // The run needs a clear shot on every think from the first one to the press.
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

describe('clear shot', () => {
  // The pillar of arena01 is a circle of radius 1.5 at the origin. On a level line at height h
  // the centre line clears it when h > 1.5, and a shot of radius r when h - r > 1.5.
  function shadowDuel(h: number, kit: KitDef = quillonKit()): GameState {
    const state = createMatch(QUILLON, arena01, 1, [kit]);
    kill(state, 0, 3);
    put(state, 1, -4, h);
    put(state, 2, 4, h);
    return state;
  }
  const THINKS = TIERS.hard.delay + TIERS.hard.castDelay + ENOUGH;

  it('does not press on a shadow edge where the centre line is clear and a shifted line hits the pillar', () => {
    const state = shadowDuel(1.6);
    const me = ch(state, 1);
    expect(hasLineOfSight(state, me, ch(state, 2))).toBe(true);
    // Every shot of the kit is at least 0.2 m wide, and 1.6 - 0.2 is inside the pillar.
    expect(clearShotOracle(state, me, ch(state, 2), 0.2)).toBe(false);
    expect(firstPress(createBot(1, 'hard', 1), state, THINKS)).toBeNull();
  });

  it('presses once the shot is wide-clear: the same duel 0.4 m higher', () => {
    const state = shadowDuel(2);
    const press = firstPress(createBot(1, 'hard', 1), state, THINKS);
    expect(press?.input.buttons).toBe(Button.E);
  });

  it('tests each ability with its own projectile radius', () => {
    // At 1.8 the 0.2 and 0.25 shots (E and M1) clear the pillar, the 0.4 and 0.6 shots do not.
    const state = shadowDuel(1.8);
    const me = ch(state, 1);
    expect(clearShotOracle(state, me, ch(state, 2), 0.2)).toBe(true);
    expect(clearShotOracle(state, me, ch(state, 2), 0.25)).toBe(true);
    expect(clearShotOracle(state, me, ch(state, 2), 0.4)).toBe(false);
    expect(firstPress(createBot(1, 'hard', 1), state, THINKS)?.input.buttons).toBe(Button.E);

    // With E cooling down, Q (0.6) and M2 (0.4) are skipped and M1 (0.25) is pressed.
    const next = shadowDuel(1.8);
    ch(next, 1).cooldowns[4] = 600;
    expect(firstPress(createBot(1, 'hard', 1), next, THINKS)?.input.buttons).toBe(Button.M1);

    // With E and M1 cooling down, nothing with a clear shot is left.
    const none = shadowDuel(1.8);
    ch(none, 1).cooldowns[4] = 600;
    ch(none, 1).cooldowns[0] = 600;
    expect(firstPress(createBot(1, 'hard', 1), none, THINKS)).toBeNull();
  });

  it('gives an ability with no projectile a clearance of 0.5 m, not 0.25 or 1', () => {
    // M1 is a ground burst 8 m ahead, 1 m wide: a band that reaches across the pillar, no bolt.
    const burst: SlotSpec = {
      cooldownTicks: 60,
      windupTicks: 0,
      movement: 'free',
      effects: [
        {
          type: 'area',
          placement: { type: 'aim', range: 8 },
          radius: 1,
          durationTicks: 1,
          intervalTicks: 1,
          targets: 'enemies',
          effects: [{ type: 'damage', amount: 1 }],
        },
      ],
    };
    const kit = () => quietKit('quillon', { M1: burst });
    // At 1.8 a shot of 0.25 m would clear the pillar (1.55 > 1.5) and one of 0.5 m does not (1.3).
    const edge = shadowDuel(1.8, kit());
    expect(clearShotOracle(edge, ch(edge, 1), ch(edge, 2), 0.25)).toBe(true);
    expect(clearShotOracle(edge, ch(edge, 1), ch(edge, 2), 0.5)).toBe(false);
    expect(firstPress(createBot(1, 'hard', 1), edge, THINKS)).toBeNull();

    // At 2.1 the 0.5 m shot clears it (1.6 > 1.5), and a clearance of 1 m (1.1) would not.
    const clear = shadowDuel(2.1, kit());
    expect(clearShotOracle(clear, ch(clear, 1), ch(clear, 2), 0.5)).toBe(true);
    expect(firstPress(createBot(1, 'hard', 1), clear, THINKS)?.input.buttons).toBe(Button.M1);
  });

  it("tests an EX press with the EX variant's own radius, not the base slot's", () => {
    // At h 1.8 a shot of 0.25 m clears the pillar and one of 0.6 m does not.
    const kit = (base: number, ex: number) =>
      quietKit('quillon', {
        M2: boltSlot(20, 30, { radius: base, ex: boltAbility(20, 30, { radius: ex }) }),
      });
    const pressWith = (base: number, ex: number, energy: number) => {
      const state = shadowDuel(1.8, kit(base, ex));
      ch(state, 1).energy = energy;
      return firstPress(createBot(1, 'hard', 1), state, THINKS)?.input.buttons ?? null;
    };
    // A narrow base and a wide EX: with 25 energy the EX is the ability, and it has no clear shot.
    expect(pressWith(0.25, 0.6, 24)).toBe(Button.M2);
    expect(pressWith(0.25, 0.6, 25)).toBeNull();
    // A wide base and a narrow EX: with 25 energy the EX is the ability, and it has a clear shot.
    expect(pressWith(0.6, 0.25, 24)).toBeNull();
    expect(pressWith(0.6, 0.25, 25)).toBe(Button.M2 | Button.SHIFT);
  });

  it('gives the Quillon EX bolts the radii of the roster: 0.6 m for M2 and 0.2 m for E', () => {
    const { M2, E } = quillonKit().slots;
    const radius = (spec: AbilitySpec | undefined) => {
      const effect = spec?.effects[0];
      return effect !== undefined && effect.type === 'projectile' ? effect.radius : null;
    };
    expect([radius(M2), radius(M2.ex)]).toEqual([0.4, 0.6]);
    expect([radius(E), radius(E.ex)]).toEqual([0.2, 0.2]);
  });
});

describe('finisher', () => {
  it('presses at an enemy at 15 percent in reach while the bot is at 20 percent, as the engaging bot', () => {
    const state = quillonDuel();
    ch(state, 1).health = 0.2 * ch(state, 1).maxHealth;
    ch(state, 2).health = 0.15 * ch(state, 2).maxHealth;
    const bot = createBot(1, 'hard', 1);
    const press = firstPress(bot, state, 100);
    expect(press?.input.buttons).toBe(Button.E);
    expect(bot.inspect()).toEqual({ intent: 'engage', targetId: 2 });
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
        // M1 is instant, so it fires in the step that starts it, after the Q fire.
        expect(types).toEqual([
          ['castFired', 'Q'],
          ['castStarted', 'M1'],
          ['castFired', 'M1'],
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

describe('cast run resets', () => {
  const m1Kit = () => quietKit('tester', { M1: boltSlot(20, 30) });
  const hard = TIERS.hard;

  it('starts the run again when the acted target changes, though both are in reach', () => {
    const state = duel(m1Kit());
    const me = ch(state, 0);
    // M1 is on cooldown, so nothing is pressed while the run builds on enemy 2, 8 m away.
    me.cooldowns[0] = 600;
    put(state, 2, 5, 0);
    const bot = createBot(0, 'hard', 1);
    for (let i = 0; i < 30; i++) expect(bot.think(state).buttons, `think ${i}`).toBe(0);
    expect(bot.inspect().targetId).toBe(2);

    // Enemy 3 comes back 3 m nearer than enemy 2, and both are inside the band of M1 (9 m).
    ch(state, 3).alive = true;
    put(state, 3, -3, 5);
    let switched = -1;
    for (let i = 0; i < 30 && switched < 0; i++) {
      expect(bot.think(state).buttons, `think ${i}`).toBe(0);
      if (bot.inspect().targetId === 3) switched = i;
    }
    expect(switched, 'the bot never switched to enemy 3').toBeGreaterThanOrEqual(0);

    // The cooldown ends. The switch think counted as the first of the run on enemy 3, so the
    // press is castDelay - 1 thinks later, not on the first think.
    me.cooldowns[0] = 0;
    const press = firstPress(bot, state, 20);
    expect(press?.index).toBe(hard.castDelay - 1);
    expect(press?.input.buttons).toBe(Button.M1);
  });

  it('starts the run again after a dead think', () => {
    const state = duel(m1Kit());
    const me = ch(state, 0);
    me.cooldowns[0] = 600;
    const bot = createBot(0, 'hard', 1);
    for (let i = 0; i < 30; i++) expect(bot.think(state).buttons, `think ${i}`).toBe(0);

    me.alive = false;
    expect(bot.think(state).buttons).toBe(0);
    me.alive = true;
    me.cooldowns[0] = 0;
    const press = firstPress(bot, state, 20);
    expect(press?.index).toBe(hard.castDelay);
    expect(press?.input.buttons).toBe(Button.M1);
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

describe('the kit cache', () => {
  // Quillon with an M1 that is the only slot with a band: 21 m/s for 40 ticks reaches 14 m and
  // for 20 ticks 7 m.
  const m1Kit = (lifetimeTicks: number): KitDef =>
    quietKit('quillon', { M1: boltSlot(21, lifetimeTicks, { cooldownTicks: 30 }) });

  /** Quillon (id 1) 9 m from champion 2, its only enemy, in a match with this kit. */
  function nineMetres(kit: KitDef): GameState {
    const state = createMatch(QUILLON, open, 1, [kit]);
    kill(state, 0, 3);
    put(state, 1, -3, 0);
    put(state, 2, 6, 0);
    return state;
  }

  it('reads the band of the kit of the match the bot is in, not the first one it saw', () => {
    const bot = createBot(1, 'hard', 1);
    expect(firstPress(bot, nineMetres(m1Kit(40)), 60), 'the long M1 reaches 9 m').not.toBeNull();
    const short = nineMetres(m1Kit(20));
    for (let i = 0; i < 60; i++) expect(bot.think(short).buttons, `short, think ${i}`).toBe(0);
    expect(firstPress(bot, nineMetres(m1Kit(40)), 60), 'the long M1 again').not.toBeNull();
  });

  it('reads the profile of the champion the bot is in, when neither match has a kit', () => {
    const asQuillon = createMatch(QUILLON, open, 1);
    kill(asQuillon, 0, 3);
    put(asQuillon, 1, -3, 0);
    put(asQuillon, 2, 0, 0);
    const bot = createBot(1, 'hard', 1);
    for (let i = 0; i < TIERS.hard.delay + 1; i++) bot.think(asQuillon);
    // Quillon is 3 m from its enemy: closer than rangeMin 6, so it kites.
    expect(bot.inspect().intent).toBe('kite');

    const asHargrim = createMatch(
      {
        teamSize: 2,
        players: [
          { championId: 'dummy', team: 'A' },
          { championId: 'hargrim', team: 'A' },
          { championId: 'dummy', team: 'B' },
          { championId: 'dummy', team: 'B' },
        ],
      },
      open,
      1,
    );
    kill(asHargrim, 0, 3);
    put(asHargrim, 1, -3, 0);
    put(asHargrim, 2, 0, 0);
    for (let i = 0; i < TIERS.hard.delay + 1; i++) bot.think(asHargrim);
    // Hargrim never kites: it stands 3 m from its enemy.
    expect(bot.inspect().intent).toBe('engage');
  });
});

describe('energy reserve for the ultimate', () => {
  // Hold the EX variants while F is ready, has a reach band and the energy is at least 75, so the
  // bar can reach the 100 that F costs. An EX press spends 25, which is why the line is at 75.
  const THINKS = TIERS.hard.delay + TIERS.hard.castDelay + ENOUGH;
  const F_INDEX = 6;
  const bolt = () => boltAbility(20, 30);

  interface Scene {
    energy: number;
    /** The cooldown of F, in ticks; at most 1 counts as ready. */
    fCooldown?: number;
    /** Whether F has a reach band. */
    fBand?: boolean;
    /** The lifetime of the base M2 bolt, in ticks; its reach is 20 x lifetime / 60. */
    baseLifetime?: number;
  }

  /** What the tester presses 5 m from its enemy with an M2 that has an EX variant: null for nothing. */
  function pressOf(scene: Scene): number | null {
    const kit = quietKit('tester', {
      M2: boltSlot(20, scene.baseLifetime ?? 30, { ex: bolt() }),
      F: scene.fBand === false ? quietSlot() : boltSlot(20, 30, { cooldownTicks: 600 }),
    });
    const state = duel(kit);
    const me = ch(state, 0);
    me.energy = scene.energy;
    me.cooldowns[F_INDEX] = scene.fCooldown ?? 0;
    return firstPress(createBot(0, 'hard', 1), state, THINKS)?.input.buttons ?? null;
  }

  it('holds the EX variant at 75 energy with F ready, and spends it at 74', () => {
    expect(pressOf({ energy: 74 })).toBe(Button.M2 | Button.SHIFT);
    expect(pressOf({ energy: 75 })).toBe(Button.M2);
    expect(pressOf({ energy: 99 })).toBe(Button.M2);
  });

  it('spends the EX variant at 80 energy when F is on cooldown, and holds it when F is ready at 1 tick', () => {
    expect(pressOf({ energy: 80, fCooldown: 2 })).toBe(Button.M2 | Button.SHIFT);
    expect(pressOf({ energy: 80, fCooldown: 1 })).toBe(Button.M2);
    expect(pressOf({ energy: 80, fCooldown: 0 })).toBe(Button.M2);
  });

  it('spends the EX variant at 80 energy when F has no reach band: an ultimate that reaches only allies', () => {
    expect(pressOf({ energy: 80, fBand: false })).toBe(Button.M2 | Button.SHIFT);
    expect(pressOf({ energy: 80, fBand: false, fCooldown: 600 })).toBe(Button.M2 | Button.SHIFT);
  });

  it('presses F itself at 100 energy', () => {
    expect(pressOf({ energy: 100 })).toBe(Button.F);
  });

  it('takes the reach of the base ability while the EX variant is held, and of the EX variant when it is spent', () => {
    // The base M2 reaches 5 m (15 ticks), so a target 5 m away is outside its margin of 1 m; the
    // EX variant reaches 10 m.
    expect(pressOf({ energy: 74, baseLifetime: 15 })).toBe(Button.M2 | Button.SHIFT);
    expect(pressOf({ energy: 80, baseLifetime: 15 })).toBeNull();
    expect(pressOf({ energy: 80, baseLifetime: 15, fCooldown: 2 })).toBe(Button.M2 | Button.SHIFT);
  });
});
