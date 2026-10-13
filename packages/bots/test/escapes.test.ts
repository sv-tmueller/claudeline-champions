import { describe, expect, it } from 'vitest';
import { Button, SLOTS, createMatch, step } from '@claudeline/sim';
import type {
  AbilitySpec,
  ArenaDef,
  ChampionState,
  GameState,
  KitDef,
  Obstacle,
  PlayerInput,
  SlotSpec,
} from '@claudeline/sim';
import { NOMINAL_PROJECTILE_SPEED, leadPoint, rotateByHalfTangent, roundAim } from '../src/aim';
import { createBot } from '../src/bot';
import { computeCues, createCastCues, createKitCache, refreshKitCache } from '../src/casting';
import { buildNavGrid } from '../src/grid';
import { createMeasure } from '../src/hypot';
import { createKiteScratch } from '../src/kite';
import { createSightScratch } from '../src/sight';
import { TIERS } from '../src/difficulty';
import { createLanding, teleportEndInto } from '../src/escape';
import { createRng } from '../src/rng';
import { arena01, copyInput, jsonKits, rosterKits } from './helpers';
import { quietKit } from './kits';
import { THINKS, firstPress, labelOf, pressOf, sceneOf } from './scenes';

const C = Math.SQRT1_2;

function arenaWith(...obstacles: Obstacle[]): ArenaDef {
  return { ...arena01, id: 'custom', obstacles };
}

/** A wall that blocks projectiles, 0.5 m thick and 2 m long, 2 m west of the origin. */
const WALL: Obstacle = {
  type: 'rect',
  x: -2,
  y: 0,
  w: 0.5,
  h: 2,
  height: 1.5,
  blocksProjectiles: true,
};

/** Steps the frozen state once with the press of champion 0 as its only input. */
function stepWith(state: GameState, input: PlayerInput): void {
  const inputs: (PlayerInput | undefined)[] = [];
  inputs[0] = copyInput(input);
  step(state, inputs);
}

describe('the escape trigger', () => {
  it('presses Iron Hide at a retreat with the target within 6 m, inclusive, and not at 6.05 m', () => {
    const at = (d: number) => sceneOf('hargrim', d, { ready: ['R'], health: 0.2 });
    expect(pressOf(at(6))).toBe('R');
    expect(pressOf(at(4))).toBe('R');
    expect(pressOf(at(6.05))).toBeNull();
  });

  it('does not press Iron Hide at a healthy Hargrim, however close the target', () => {
    expect(pressOf(sceneOf('hargrim', 3, { ready: ['R'] }))).toBeNull();
  });

  it('presses Skip while kiting inside rangeMin, and not at 6.0 or 6.5 m where the kite goes on', () => {
    expect(pressOf(sceneOf('quillon', 5.9, { ready: ['SPACE'] }))).toBe('SPACE');

    // The bot settles into the kite at 5.9 m with Skip cooling down, and the target then steps to
    // exactly rangeMin (6.0 m, where `d < rangeMin` is false) or to 6.5 m, inside the hysteresis
    // band: it still kites and presses nothing.
    for (const d of [6, 6.5]) {
      const state = sceneOf('quillon', 5.9, { ready: [] });
      const me = state.champions[0] as ChampionState;
      const bot = createBot(0, 'hard', 1);
      for (let i = 0; i < TIERS.hard.delay + 5; i++) bot.think(state);
      expect(bot.inspect().intent).toBe('kite');
      me.cooldowns[SLOTS.indexOf('SPACE')] = 0;
      (state.champions[2] as ChampionState).x = me.x + d;
      for (let i = 0; i < THINKS; i++) {
        expect(bot.think(state).buttons, `${d} m, think ${i}`).toBe(0);
        expect(bot.inspect().intent).toBe('kite');
      }
    }
  });

  it('presses an escape without a band or a clear shot: Iron Hide behind a wall', () => {
    const state = sceneOf('hargrim', 4, {
      arena: arenaWith({ ...WALL, x: -4, h: 4 }),
      me: [-6, 0],
      ready: ['R'],
      health: 0.2,
    });
    expect(pressOf(state)).toBe('R');
  });
});

// Lumeth's trigger is her own: any acted intent but idle, with the acted target within 3 m,
// inclusive (the roster's "an enemy inside 3 m"). It replaces the common trigger for her: a kite
// inside rangeMin 6 and a retreat within 6 m are no escape think unless the target is that close.
describe('Lantern Burst, the escape of Lumeth, and her trigger', () => {
  const kits = rosterKits();
  const burst = (d: number, options: Parameters<typeof sceneOf>[2] = {}) =>
    sceneOf('lumeth', d, { kits, ready: ['E'], ...options });

  it('presses E at a kiting target within 3 m, inclusive, and not at 3.05 m', () => {
    expect(pressOf(burst(3))).toBe('E');
    expect(pressOf(burst(2))).toBe('E');
    expect(pressOf(burst(3.05))).toBeNull();
  });

  it('presses E on a retreat with the target within 3 m, and not at 3.05 or 4 m', () => {
    const retreat = (d: number) => burst(d, { health: 0.2 });
    expect(pressOf(retreat(3))).toBe('E');
    expect(pressOf(retreat(3.05))).toBeNull();
    expect(pressOf(retreat(4))).toBeNull();
  });

  it('does not treat a kite at 5 m, inside rangeMin, as an escape think', () => {
    // The common trigger would: a kite inside rangeMin 6. Burst reaches 3.5 m, so no press follows.
    const state = burst(5);
    const bot = createBot(0, 'hard', 1);
    for (let i = 0; i < THINKS; i++) expect(bot.think(state).buttons, `think ${i}`).toBe(0);
    expect(bot.inspect().intent).toBe('kite');
  });

  it('presses E beyond its band at 3 m, with no clear shot: the trigger needs neither', () => {
    // Lantern Burst reaches 3.5 m and the margin takes 1 m off, so 3 m is outside its band; the
    // wall is no matter to an escape.
    const state = burst(3, { arena: arenaWith({ ...WALL, x: -4.5, h: 4 }) });
    expect(pressOf(state)).toBe('E');
  });
});

describe('the escape trigger of computeCues', () => {
  const kit = rosterKits().find((k) => k.id === 'lumeth') as KitDef;

  /** The `escapeThink` cue for an acted intent and a target `d` metres from Lumeth. */
  function think(championId: string, intent: string, d: number): boolean {
    const state = sceneOf(championId, d, { kits: rosterKits() });
    const me = state.champions[0] as ChampionState;
    const target = state.champions[2] as ChampionState;
    const kite = createKiteScratch();
    const cache = createKitCache();
    refreshKitCache(cache, state.kits.find((k) => k.id === championId), championId);
    const cues = createCastCues(kite);
    cues.escapeThink = false;
    computeCues(
      cues,
      cache,
      cache.profile,
      intent,
      state,
      me,
      target,
      createSightScratch(),
      createMeasure(),
      buildNavGrid(state.arena),
    );
    return cues.escapeThink;
  }

  it('is any intent but idle within 3 m for Lumeth, 3 m inclusive', () => {
    expect(kit.id).toBe('lumeth');
    for (const intent of ['engage', 'kite', 'retreat']) {
      expect(think('lumeth', intent, 3), `${intent} at 3 m`).toBe(true);
      expect(think('lumeth', intent, 3.05), `${intent} at 3.05 m`).toBe(false);
      expect(think('lumeth', intent, 0.5), `${intent} at 0.5 m`).toBe(true);
    }
  });

  it('is never an idle think, however close the target', () => {
    expect(think('lumeth', 'idle', 2)).toBe(false);
  });

  it('keeps the common trigger for Hargrim, Quillon and Skerrow', () => {
    // A retreat within 6 m, inclusive, or a kite inside rangeMin.
    expect(think('hargrim', 'retreat', 6)).toBe(true);
    expect(think('hargrim', 'retreat', 6.05)).toBe(false);
    expect(think('hargrim', 'engage', 2)).toBe(false);
    expect(think('quillon', 'kite', 5.9)).toBe(true);
    expect(think('quillon', 'kite', 6)).toBe(false);
    expect(think('skerrow', 'retreat', 4)).toBe(true);
  });
});

describe('Vanish Step, the escape of Skerrow', () => {
  it('presses R at health 20 percent with the target 4 m away, aimed at a 5 m landing', () => {
    // The common trigger: a retreat with the acted target within 6 m. Her teleport is not fixed:
    // the landing is 5 m straight away from the target, at (-11, 0), and the aim is exactly there.
    const state = sceneOf('skerrow', 4, { ready: ['R'], health: 0.2 });
    expect(firstPress(state, 'easy', 1)).toEqual({ label: 'R', aimX: -1100, aimY: 0 });
  });

  it('does not press R at a healthy Skerrow, nor beyond 6 m', () => {
    expect(pressOf(sceneOf('skerrow', 4, { ready: ['R'] }))).toBeNull();
    expect(pressOf(sceneOf('skerrow', 6.05, { ready: ['R'], health: 0.2 }))).toBeNull();
  });
});

// A dash on an escape think carries the champion toward the target it is leaving: a cornered
// Skerrow with Vanish Step cooling down used to Lunge into the Hargrim she was fleeing. On an
// escape think no slot whose ability starts with a dash is pressed, base or EX, for every kit.
describe('the dash hold on an escape think', () => {
  it('does not press Lunge at a target 5.5 m away while Skerrow retreats with Vanish Step cooling down', () => {
    const state = sceneOf('skerrow', 5.5, { ready: ['SPACE'], health: 0.2 });
    expect(pressOf(state)).toBeNull();
  });

  it('does not press the EX Lunge at a target 4 m away with 50 energy on a retreat', () => {
    const state = sceneOf('skerrow', 4, { ready: ['SPACE'], health: 0.2, energy: 50 });
    expect(pressOf(state)).toBeNull();
  });

  it('does not press Rush at a target 4.5 m away while Hargrim retreats with Iron Hide cooling down', () => {
    const state = sceneOf('hargrim', 4.5, { ready: ['SPACE'], health: 0.2 });
    expect(pressOf(state)).toBeNull();
  });

  it("does not press Hargrim's ultimate, a dash, on a retreat either", () => {
    const state = sceneOf('hargrim', 4, { ready: ['F'], health: 0.2, energy: 100 });
    expect(pressOf(state)).toBeNull();
  });

  // The hold reads the variant that would be cast: the shipped kits dash in both, so two edited
  // kits tell the two flags apart.
  it('reads the EX variant when it would be cast: an EX dash on a base that is no dash is held', () => {
    const kits = jsonKits();
    const hargrim = kits.find((k) => k.id === 'hargrim') as KitDef;
    hargrim.slots.M2.ex = structuredClone(hargrim.slots.SPACE.ex) as AbilitySpec;
    expect(pressOf(sceneOf('hargrim', 4, { kits, ready: ['M2'], health: 0.2, energy: 50 }))).toBeNull();
    // Healthy, it is an ordinary press.
    expect(pressOf(sceneOf('hargrim', 4, { kits, ready: ['M2'], energy: 50 }))).toBe('M2+SHIFT');
  });

  it('reads the base ability when it would be cast: a base dash is held with an EX arc, and the arc is not', () => {
    const kits = jsonKits();
    const skerrow = kits.find((k) => k.id === 'skerrow') as KitDef;
    skerrow.slots.SPACE.ex = structuredClone(skerrow.slots.E.ex) as AbilitySpec;
    // No energy: the base Lunge would be pressed at 5.5 m, and is held.
    expect(pressOf(sceneOf('skerrow', 5.5, { kits, ready: ['SPACE'], health: 0.2 }))).toBeNull();
    // 50 energy at 1.5 m: the EX variant is an arc, no dash, and it is pressed.
    const arc = sceneOf('skerrow', 1.5, { kits, ready: ['SPACE'], health: 0.2, energy: 50 });
    expect(pressOf(arc)).toBe('SPACE+SHIFT');
  });

  it('still presses the escape itself: Vanish Step first, with Lunge ready as well', () => {
    const state = sceneOf('skerrow', 4, { ready: ['SPACE', 'R'], health: 0.2 });
    expect(pressOf(state)).toBe('R');
  });

  it('still presses Lunge and the EX Lunge when the think is not an escape think', () => {
    expect(pressOf(sceneOf('skerrow', 5.5, { ready: ['SPACE'] }))).toBe('SPACE');
    expect(pressOf(sceneOf('skerrow', 4, { ready: ['SPACE'], energy: 50 }))).toBe('SPACE+SHIFT');
    expect(pressOf(sceneOf('hargrim', 4.5, { ready: ['SPACE'] }))).toBe('SPACE');
  });

  it('presses a dash at a retreat with the target beyond 6 m, which is not an escape think', () => {
    // 6.05 m: past the escape range, and a Lunge band of [5, 6] is out too, so use the EX Lunge
    // (0 to 9.5 m) with energy: a retreat that is not an escape think does not hold the dash.
    const state = sceneOf('skerrow', 6.05, { ready: ['SPACE'], health: 0.2, energy: 50 });
    expect(pressOf(state)).toBe('SPACE+SHIFT');
  });
});

describe('the order of an escape', () => {
  it('presses Skip, not the ultimate, when both are ready and the target is 3 m away', () => {
    // Quillon kites at 3 m with 100 energy: F is in reach, and a Skip is the escape.
    expect(pressOf(sceneOf('quillon', 3, { energy: 100 }))).toBe('SPACE');
  });
});

describe('the landing of an escape teleport', () => {
  it('goes straight away, to the centimetre, with no aim error even on the easy tier', () => {
    const state = sceneOf('quillon', 3, { ready: ['SPACE'] });
    const press = firstPress(state, 'easy', 1);
    expect(press).toEqual({ label: 'SPACE', aimX: -1000, aimY: 0 });
  });

  it('takes the first free direction in the order: +45 before -45 behind a wall', () => {
    const state = sceneOf('quillon', 3, {
      arena: arenaWith(WALL),
      me: [0, 0],
      ready: ['SPACE'],
    });
    const bot = createBot(0, 'hard', 1);
    let input: PlayerInput | undefined;
    for (let i = 0; i < THINKS && input === undefined; i++) {
      const next = bot.think(state);
      if (next.buttons !== 0) input = copyInput(next);
    }
    expect(input && labelOf(input.buttons)).toBe('SPACE');
    expect([input?.aimX, input?.aimY]).toEqual([-283, -283]);
    // The sim teleports the champion to the point the bot computed, 4 m off at -135 degrees.
    stepWith(state, input as PlayerInput);
    const teleport = state.events.find((e) => e.type === 'teleport');
    expect(teleport?.type === 'teleport' && teleport.blocked).toBe(false);
    if (teleport?.type !== 'teleport') throw new Error('no teleport');
    expect(Math.hypot(teleport.toX + 4 * C, teleport.toY + 4 * C)).toBeLessThan(1e-9);
  });

  it('skips a direction whose path a pillar blocks, though its landing cell is free', () => {
    const pillar: Obstacle = {
      type: 'circle',
      x: -2,
      y: 0,
      r: 0.5,
      height: 2,
      blocksProjectiles: true,
    };
    const state = sceneOf('quillon', 3, {
      arena: arenaWith(pillar),
      me: [0, 0],
      ready: ['SPACE'],
    });
    expect(firstPress(state)).toEqual({ label: 'SPACE', aimX: -283, aimY: -283 });
  });

  it('crosses a low wall: a landing behind the wall at (6, 5) is straight away', () => {
    const state = sceneOf('quillon', 2, {
      arena: arena01,
      me: [6, 3],
      enemy: [6, 1],
      ready: ['SPACE'],
    });
    expect(firstPress(state)).toEqual({ label: 'SPACE', aimX: 600, aimY: 700 });
  });

  it('presses Hush Ward when boxed in, and no Skip without a landing', () => {
    // The north-east corner with the target 2.83 m away on the diagonal: all five landings fall
    // outside the arena.
    const state = sceneOf('quillon', 0, {
      arena: arena01,
      me: [14.4, 9.4],
      enemy: [12.4, 7.4],
      ready: ['SPACE', 'R'],
    });
    expect(pressOf(state)).toBe('R');
    const skipOnly = sceneOf('quillon', 0, {
      arena: arena01,
      me: [14.4, 9.4],
      enemy: [12.4, 7.4],
      ready: ['SPACE'],
    });
    expect(pressOf(skipOnly)).toBeNull();
  });
});

describe('the landing differential', () => {
  /** A kit whose SPACE is a teleport of `range`, fixed or not, and nothing else. */
  function teleportKit(range: number, fixed: boolean) {
    const spec: SlotSpec = {
      cooldownTicks: 60,
      windupTicks: 0,
      movement: 'free',
      effects: [{ type: 'teleport', range, fixed }],
    };
    return quietKit('quillon', { SPACE: spec });
  }

  it('matches the end the sim teleports to, bit for bit, over 2000 seeded aims', () => {
    const rng = createRng(8081);
    let blockedCount = 0;
    const shortAims = { below: 0, above: 0, onCaster: 0 };
    for (let i = 0; i < 2000; i++) {
      const range = [4, 5, 8][i % 3] as number;
      const fixed = i % 2 === 0;
      // Quillon is champion 0 on team A or champion 2 on team B (the forward direction differs).
      const teamB = i % 4 >= 2;
      const state = createMatch(
        {
          teamSize: 2,
          players: [
            { championId: teamB ? 'dummy' : 'quillon', team: 'A' },
            { championId: 'dummy', team: 'A' },
            { championId: teamB ? 'quillon' : 'dummy', team: 'B' },
            { championId: 'dummy', team: 'B' },
          ],
        },
        // A large open arena, so no landing is clamped to the boundary by the sim's collision pass.
        { ...arena01, id: 'open', obstacles: [], size: { width: 60, height: 60 } },
        1,
        [teleportKit(range, fixed)],
      );
      const meId = teamB ? 2 : 0;
      for (const champion of state.champions) champion.alive = champion.id === meId;
      const me = state.champions[meId] as ChampionState;
      const onCaster = i % 50 === 0;
      me.x = onCaster ? 3.45 : (rng.next() - 0.5) * 20;
      me.y = onCaster ? -1.2 : (rng.next() - 0.5) * 12;
      // An aim 0 to 1.5 times the range away, in a random direction, in whole centimetres.
      const heading = rng.next() * 2 * Math.PI;
      const length = rng.next() * 1.5 * range;
      const aimX = onCaster ? 345 : Math.round((me.x + Math.cos(heading) * length) * 100) + 0;
      const aimY = onCaster ? -120 : Math.round((me.y + Math.sin(heading) * length) * 100) + 0;

      const land = createLanding();
      land.aimX = aimX;
      land.aimY = aimY;
      land.range = range;
      land.fixed = fixed;
      teleportEndInto(land, me);

      const input: PlayerInput = { moveX: 0, moveY: 0, aimX, aimY, buttons: Button.SPACE };
      const inputs: (PlayerInput | undefined)[] = [];
      inputs[meId] = input;
      step(state, inputs);
      const teleport = state.events.find((e) => e.type === 'teleport');
      if (teleport && 'blocked' in teleport && teleport.blocked) blockedCount++;
      expect([me.x, me.y], `aim ${aimX},${aimY} range ${range} fixed ${fixed}`).toEqual([
        land.x,
        land.y,
      ]);
      if (onCaster) shortAims.onCaster++;
      else if (length < range) shortAims.below++;
      else shortAims.above++;
    }
    expect(blockedCount).toBe(0);
    // Both sides of the range are covered, and the aim on the caster too.
    expect(shortAims.below).toBeGreaterThan(300);
    expect(shortAims.above).toBeGreaterThan(300);
    expect(shortAims.onCaster).toBe(40);
  });
});

describe('the aim draw cadence', () => {
  // The first draw is on the first think that acts (think `delay`: before that the bot idles and
  // `aim` does not run), and the next one 15 aim calls later.
  it('draws on the same thinks after an escape press that falls on a draw boundary', () => {
    const seed = 41;
    const tier = TIERS.hard;
    const state = sceneOf('quillon', 3, { ready: [] });
    const me = state.champions[0] as ChampionState;
    const target = state.champions[2] as ChampionState;
    const bot = createBot(0, 'hard', seed);
    const draws: number[] = [];
    const replay = createRng(seed);
    const spaceIndex = SLOTS.indexOf('SPACE');
    const boundary = tier.delay + 15;
    let pressedAt = -1;
    for (let n = 0; n < 60; n++) {
      // Skip comes off cooldown on the think the second draw falls on, and on no other.
      me.cooldowns[spaceIndex] = n === boundary ? 0 : 600;
      const input = bot.think(state);
      if (input.buttons !== 0) {
        expect(n).toBe(boundary);
        expect(labelOf(input.buttons)).toBe('SPACE');
        pressedAt = n;
        continue;
      }
      if (n < tier.delay) continue;
      // The reference chain: the draw in force is the one of the block this think is in.
      const block = Math.floor((n - tier.delay) / 15);
      while (draws.length <= block) {
        draws.push((2 * replay.next() - 1) * tier.maxU);
      }
      const u = draws[block] as number;
      const lead = leadPoint(me, target, { x: 0, y: 0 }, NOMINAL_PROJECTILE_SPEED);
      const turned = rotateByHalfTangent(lead.x - me.x, lead.y - me.y, u);
      expect([input.aimX, input.aimY], `think ${n}`).toEqual([
        roundAim(me.x + turned.x),
        roundAim(me.y + turned.y),
      ]);
    }
    expect(pressedAt).toBe(boundary);
  });
});

// Kit data the pins above read: Skip is a fixed 4 m teleport and Hush Ward is a shield.
describe('the shipped escape abilities', () => {
  it('are a fixed 4 m teleport for Quillon SPACE and a self shield for the two R slots', () => {
    const kits = jsonKits();
    const quillon = kits.find((k) => k.id === 'quillon');
    expect(quillon?.slots.SPACE.effects[0]).toEqual({ type: 'teleport', range: 4, fixed: true });
    expect(quillon?.slots.R.effects[0]?.type).toBe('shield');
    expect(kits.find((k) => k.id === 'hargrim')?.slots.R.effects[0]?.type).toBe('shield');
  });
});
