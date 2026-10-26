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
import { createLanding, landingInto, teleportEndInto } from '../src/escape';
import { createRng } from '../src/rng';
import { arena01, copyInput, jsonKits, rosterKits, sixKits } from './helpers';
import { quietKit } from './kits';
import { THINKS, firstPress, labelOf, pressOf, sceneOf, walks } from './scenes';

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

// Glide is a dash, so it has no teleport landing: `chooseEscape` finds the point a dash of 4 m
// reaches in the first of the five directions (straight away from the target, then +45, -45, +90,
// -90 degrees) whose end cell is free and whose straight path nothing blocks. A dash collides with
// low walls as well, which a teleport crosses, so the path test is `segmentClear`, not the line of
// sight. The press is aimed at that point, with no aim error.
describe('Glide, the dash escape of Lumeth', () => {
  const kits = rosterKits();
  const glide = (d: number, options: Parameters<typeof sceneOf>[2] = {}) =>
    sceneOf('lumeth', d, { kits, ready: ['SPACE'], ...options });

  it('is pressed with Lantern Burst cooling down, aimed 4 m straight away, with no aim error', () => {
    const state = glide(3);
    expect(firstPress(state, 'hard', 1)).toEqual({ label: 'SPACE', aimX: -1000, aimY: 0 });
    expect(firstPress(glide(3), 'easy', 7)).toEqual({ label: 'SPACE', aimX: -1000, aimY: 0 });
  });

  it('comes after Lantern Burst: with both ready, E is pressed', () => {
    expect(pressOf(glide(3, { ready: ['E', 'SPACE'] }))).toBe('E');
  });

  it('is pressed on a retreat within 3 m, and not at 3.05 m or on a kite at 5 m', () => {
    expect(pressOf(glide(3, { health: 0.2 }))).toBe('SPACE');
    expect(pressOf(glide(3.05))).toBeNull();
    expect(pressOf(glide(5))).toBeNull();
  });

  it('is not held on its escape think, unlike every other dash', () => {
    // The dash hold of chooseCast reads the slot: Glide is pressed by the escape choice, which
    // marks it tried, and the hold leaves it alone.
    expect(pressOf(glide(2))).toBe('SPACE');
  });

  it('takes the first free direction in the order: +45 before -45 behind a wall', () => {
    const state = glide(3, { arena: arenaWith(WALL), me: [0, 0] });
    expect(firstPress(state)).toEqual({ label: 'SPACE', aimX: -283, aimY: -283 });
  });

  it('skips a direction whose path a low wall blocks, which a teleport would cross', () => {
    // Arena 01, Lumeth at (6, 3) with the target 2 m south of her: straight away is (6, 7), across
    // the low wall at (6, 5), and so is +45 degrees ((3.17, 5.83), through its corner) and -45
    // degrees ((8.83, 5.83)). The first path that is clear is +90 degrees, west to (2, 3). Skip
    // takes the straight landing in the same place (see the teleport pin above).
    const state = glide(2, { arena: arena01, me: [6, 3], enemy: [6, 1] });
    expect(firstPress(state)).toEqual({ label: 'SPACE', aimX: 200, aimY: 300 });
  });

  it('is not pressed boxed in at the north-east corner, where all five landings are outside', () => {
    const corner = () => glide(0, { arena: arena01, me: [14.4, 9.4], enemy: [12.4, 7.4] });
    expect(pressOf(corner())).toBeNull();
    // The walk goes on: the bot leaves along the path to its spawn instead of standing.
    expect(walks(corner())).toBe(true);
  });

  it('is not pressed while rooted, as every dash', () => {
    const state = glide(3);
    (state.champions[0] as ChampionState).statuses.push({
      type: 'root',
      sourceId: 2,
      slot: null,
      remainingTicks: 600,
    });
    expect(pressOf(state)).toBeNull();
  });

  it('leaves the target: the sim starts the dash away from it and ends it 4 m off', () => {
    const state = glide(3);
    const me = state.champions[0] as ChampionState;
    const target = state.champions[2] as ChampionState;
    const bot = createBot(0, 'hard', 1);
    let input: PlayerInput | undefined;
    for (let i = 0; i < THINKS && input === undefined; i++) {
      const next = bot.think(state);
      if (next.buttons !== 0) input = copyInput(next);
    }
    expect(input && labelOf(input.buttons)).toBe('SPACE');
    stepWith(state, input as PlayerInput);
    const started = state.events.find((e) => e.type === 'dashStarted');
    if (started?.type !== 'dashStarted') throw new Error('no dash started');
    // Away from the target at (-3, 0): the dash goes west.
    expect([started.dirX, started.dirY]).toEqual([-1, 0]);
    for (let i = 0; i < 20; i++) step(state, []);
    expect(Math.hypot(me.x - target.x, me.y - target.y)).toBeCloseTo(7, 6);
    expect(me.x).toBeCloseTo(-10, 6);
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

describe('the rounding of the landing aim', () => {
  /** Champion 0 of a mirror match, moved to (x, y); `landingInto` reads only its position and team. */
  function meAt(x: number, y: number): ChampionState {
    const state = createMatch(
      {
        teamSize: 2,
        players: [
          { championId: 'quillon', team: 'A' },
          { championId: 'hargrim', team: 'A' },
          { championId: 'quillon', team: 'B' },
          { championId: 'hargrim', team: 'B' },
        ],
      },
      arena01,
      1,
      jsonKits(),
    );
    const me = state.champions[0] as ChampionState;
    me.x = x;
    me.y = y;
    return me;
  }

  it('turns a landing point in [-0.5, 0) cm into +0 on x and on y, as roundAim does', () => {
    // A bare Math.round gives -0 here, which `Object.is` tells from 0: the aim is the same input
    // to the sim, but `+ 0` after Math.round deoptimised the function in Maglev (see
    // allocation.test.ts, the move to -0).
    for (const offset of [-0.0001, -0.003, -0.00499, -0.005]) {
      const land = createLanding();
      land.range = 4;
      land.dirX = 1;
      land.dirY = 0;
      landingInto(land, meAt(-4 + offset, 1.5));
      expect(land.aimX, `x landing ${offset} m`).toSatisfy((v: number) => Object.is(v, 0));
      expect(land.aimY, `y of the landing at 1.5 m`).toBe(150);
      expect(land.aimX).toBe(roundAim(-4 + offset + 4));
      const mirrored = createLanding();
      mirrored.range = 4;
      mirrored.dirX = 0;
      mirrored.dirY = 1;
      landingInto(mirrored, meAt(1.5, -4 + offset));
      expect(mirrored.aimY, `y landing ${offset} m`).toSatisfy((v: number) => Object.is(v, 0));
      expect(mirrored.aimX, `x of the landing at 1.5 m`).toBe(150);
    }
  });

  it('is roundAim of the landing point, bit for bit, over 4000 seeded landings', () => {
    const rng = createRng(4047);
    for (let i = 0; i < 4000; i++) {
      const range = [4, 5, 8][i % 3] as number;
      const heading = rng.next() * 2 * Math.PI;
      const land = createLanding();
      land.range = range;
      // Some headings are the axes, where one coordinate of the landing is the position itself.
      land.dirX = i % 7 === 0 ? 0 : i % 11 === 0 ? 1 : Math.cos(heading);
      land.dirY = i % 7 === 0 ? 1 : i % 11 === 0 ? 0 : Math.sin(heading);
      // Every third landing is within a centimetre of the origin on x, the others anywhere.
      const x = i % 3 === 0 ? -land.dirX * range + (rng.next() - 0.5) * 0.02 : (rng.next() - 0.5) * 20;
      const y = i % 5 === 0 ? -land.dirY * range + (rng.next() - 0.5) * 0.02 : (rng.next() - 0.5) * 12;
      const me = meAt(x, y);
      landingInto(land, me);
      const wantX = roundAim(me.x + land.dirX * range);
      const wantY = roundAim(me.y + land.dirY * range);
      expect(Object.is(land.aimX, wantX), `x ${x} dir ${land.dirX} range ${range}`).toBe(true);
      expect(Object.is(land.aimY, wantY), `y ${y} dir ${land.dirY} range ${range}`).toBe(true);
    }
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

// Reed Step, the dash escape of Ondrel, is a dash of 4.5 m with a self area after it: like Glide,
// its landing is the end of the dash, found over the five directions with `segmentClear`. Reed
// Screen (R) comes second. Both use the common trigger: a kite inside rangeMin 5, or a retreat
// with the target within 6 m.
describe('Reed Step and Reed Screen, the escapes of Ondrel', () => {
  const kits = sixKits();
  const ondrel = (d: number, options: Parameters<typeof sceneOf>[2] = {}) =>
    sceneOf('ondrel', d, { kits, ready: ['SPACE'], ...options });
  const corner = (ready: Parameters<typeof sceneOf>[2] = {}) =>
    ondrel(0, { arena: arena01, me: [14.4, 9.4], enemy: [12.4, 7.4], ...ready });

  it('presses Reed Step at a kiting target inside 5 m, aimed 4.5 m straight away', () => {
    expect(firstPress(ondrel(4.9))).toEqual({ label: 'SPACE', aimX: -1050, aimY: 0 });
    expect(firstPress(ondrel(4.9), 'easy', 7)).toEqual({ label: 'SPACE', aimX: -1050, aimY: 0 });
  });

  it('does not press it at a target at 5 m or 5.5 m, where the kite stops', () => {
    expect(pressOf(ondrel(5))).toBeNull();
    expect(pressOf(ondrel(5.5))).toBeNull();
  });

  it('presses it on a retreat with the target within 6 m, and not at 6.05 m', () => {
    expect(pressOf(ondrel(6, { health: 0.2 }))).toBe('SPACE');
    expect(pressOf(ondrel(6.05, { health: 0.2 }))).toBeNull();
  });

  it('comes before Reed Screen: with both ready SPACE is pressed, with only R ready R is', () => {
    expect(pressOf(ondrel(4, { ready: ['SPACE', 'R'] }))).toBe('SPACE');
    expect(pressOf(ondrel(4, { ready: ['R'] }))).toBe('R');
  });

  it('presses Reed Screen alone when boxed in at the north-east corner, and walks on without it', () => {
    expect(pressOf(corner({ ready: ['SPACE', 'R'] }))).toBe('R');
    expect(pressOf(corner())).toBeNull();
    expect(walks(corner())).toBe(true);
  });

  it('skips a direction whose path a low wall blocks, which a teleport would cross', () => {
    // Arena 01, Ondrel at (6, 3) with the target 2 m south of her: straight away is (6, 7.5), across
    // the low wall at (6, 5), and so are +45 and -45 degrees. The first clear path is +90 degrees,
    // west to (1.5, 3).
    const state = ondrel(2, { arena: arena01, me: [6, 3], enemy: [6, 1] });
    expect(firstPress(state)).toEqual({ label: 'SPACE', aimX: 150, aimY: 300 });
  });

  it('presses Reed Screen, not the dash, while rooted', () => {
    const state = ondrel(3, { ready: ['SPACE', 'R'] });
    (state.champions[0] as ChampionState).statuses.push({
      type: 'root',
      sourceId: 2,
      slot: null,
      remainingTicks: 600,
    });
    expect(pressOf(state)).toBe('R');
  });

  it('is a dash with a self area after it, in the kit data the pins above read', () => {
    const slot = (kits.find((k) => k.id === 'ondrel') as KitDef).slots.SPACE;
    expect(slot.effects[0]).toEqual({ type: 'dash', distance: 4.5, ticks: 15, then: [] });
    const area = slot.effects[1];
    expect(area?.type === 'area' && area.placement.type === 'self' && area.radius).toBe(1.5);
  });

  it('leaves the target: the sim starts the dash away, ends it 4.5 m off, and drops the area behind', () => {
    const state = ondrel(3);
    const me = state.champions[0] as ChampionState;
    const bot = createBot(0, 'hard', 1);
    let input: PlayerInput | undefined;
    for (let i = 0; i < THINKS && input === undefined; i++) {
      const next = bot.think(state);
      if (next.buttons !== 0) input = copyInput(next);
    }
    expect(input && labelOf(input.buttons)).toBe('SPACE');
    const [x, y] = [me.x, me.y];
    stepWith(state, input as PlayerInput);
    const started = state.events.find((e) => e.type === 'dashStarted');
    if (started?.type !== 'dashStarted') throw new Error('no dash started');
    expect([started.dirX, started.dirY]).toEqual([-1, 0]);
    const spawned = state.events.find((e) => e.type === 'areaSpawned');
    if (spawned?.type !== 'areaSpawned') throw new Error('no area spawned');
    expect([spawned.x, spawned.y, spawned.radius]).toEqual([x, y, 1.5]);
    for (let i = 0; i < 20; i++) step(state, []);
    expect(me.x).toBeCloseTo(x - 4.5, 6);
    expect(me.y).toBeCloseTo(y, 6);
  });
});

// Flare Step, the teleport escape of Brimwick, is a teleport of up to 6 m that is not fixed: it
// goes the lesser of the range and the distance to the aim, and the bot aims 6 m straight away, so
// it goes the whole 6 m. Smoke Pot (R) comes second. The trigger is the common one with rangeMin 7.
describe('Flare Step and Smoke Pot, the escapes of Brimwick', () => {
  const kits = sixKits();
  const brimwick = (d: number, options: Parameters<typeof sceneOf>[2] = {}) =>
    sceneOf('brimwick', d, { kits, ready: ['SPACE'], ...options });
  const corner = (ready: Parameters<typeof sceneOf>[2] = {}) =>
    brimwick(0, { arena: arena01, me: [14.4, 9.4], enemy: [12.4, 7.4], ...ready });

  it('presses Flare Step at a kiting target inside 7 m, aimed 6 m straight away', () => {
    expect(firstPress(brimwick(6.9))).toEqual({ label: 'SPACE', aimX: -1200, aimY: 0 });
    expect(firstPress(brimwick(6.9), 'easy', 7)).toEqual({ label: 'SPACE', aimX: -1200, aimY: 0 });
  });

  it('does not press it at a target at 7 m or 7.5 m, where the kite stops', () => {
    expect(pressOf(brimwick(7))).toBeNull();
    expect(pressOf(brimwick(7.5))).toBeNull();
  });

  it('comes before Smoke Pot: with both ready SPACE is pressed, with only R ready R is', () => {
    expect(pressOf(brimwick(6, { ready: ['SPACE', 'R'] }))).toBe('SPACE');
    expect(pressOf(brimwick(6, { ready: ['R'] }))).toBe('R');
  });

  it('presses Smoke Pot alone when boxed in at the north-east corner, where no landing is free', () => {
    expect(pressOf(corner({ ready: ['SPACE', 'R'] }))).toBe('R');
    expect(pressOf(corner())).toBeNull();
  });

  it('crosses a low wall: the landing at (6, 9) behind the wall at (6, 5) is straight away', () => {
    const state = brimwick(2, { arena: arena01, me: [6, 3], enemy: [6, 1] });
    expect(firstPress(state)).toEqual({ label: 'SPACE', aimX: 600, aimY: 900 });
  });

  it('is a non-fixed teleport of 6 m, in the kit data the pins above read', () => {
    const slot = (kits.find((k) => k.id === 'brimwick') as KitDef).slots.SPACE;
    expect(slot.effects[0]).toEqual({ type: 'teleport', range: 6, fixed: false });
  });

  it('ends where the bot computed: the sim teleports 6 m away from the target', () => {
    const state = brimwick(5);
    const bot = createBot(0, 'hard', 1);
    let input: PlayerInput | undefined;
    for (let i = 0; i < THINKS && input === undefined; i++) {
      const next = bot.think(state);
      if (next.buttons !== 0) input = copyInput(next);
    }
    expect(input && labelOf(input.buttons)).toBe('SPACE');
    stepWith(state, input as PlayerInput);
    const teleport = state.events.find((e) => e.type === 'teleport');
    if (teleport?.type !== 'teleport') throw new Error('no teleport');
    expect(teleport.blocked).toBe(false);
    expect([teleport.fromX, teleport.fromY]).toEqual([-6, 0]);
    expect([teleport.toX, teleport.toY]).toEqual([-12, 0]);
  });

  it('gives haste to Brimwick and a slow to a target inside 3.5 m with Smoke Pot', () => {
    const state = brimwick(3, { ready: ['R'] });
    const bot = createBot(0, 'hard', 1);
    let input: PlayerInput | undefined;
    for (let i = 0; i < THINKS && input === undefined; i++) {
      const next = bot.think(state);
      if (next.buttons !== 0) input = copyInput(next);
    }
    expect(input && labelOf(input.buttons)).toBe('R');
    stepWith(state, input as PlayerInput);
    const applied = state.events.filter((e) => e.type === 'statusApplied');
    expect(applied.map((e) => e.type === 'statusApplied' && [e.targetId, e.status])).toEqual([
      [0, 'haste'],
      [2, 'slow'],
    ]);
  });
});

// The escape order is one trigger run. A slot with a band also carries its ordinary band run (Reed
// Screen reaches 2.5 m, Smoke Pot 3 m), so an escape gate that read the run of the slot let it jump
// the queue: Reed Screen was pressed before Reed Step, which has no band at 2 m. Every escape slot
// is gated on the number of consecutive escape thinks instead (`EscapeScratch.streak`).
describe('the escape trigger of Ondrel and Brimwick', () => {
  // The bot settles into the kite inside rangeMin with its escape cooling down, and the target then
  // steps to exactly rangeMin (where `d < rangeMin` is false) or 0.5 m past it, inside the
  // hysteresis band: it still kites, and the escape that comes off cooldown is not pressed.
  for (const [id, rangeMin] of [
    ['ondrel', 5],
    ['brimwick', 7],
  ] as const) {
    it(`does not press ${id}'s escape at ${rangeMin} m or ${rangeMin + 0.5} m, where the kite goes on`, () => {
      for (const d of [rangeMin, rangeMin + 0.5]) {
        const state = sceneOf(id, rangeMin - 0.1, { kits: sixKits(), ready: [] });
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
  }
});

describe('the order of an escape does not depend on a band run', () => {
  /**
   * The target stands `far` metres away for long enough to settle an engage, jumps to 2 m (inside
   * the band of R, outside Reed Step's), and its escape slots come off cooldown only on the think
   * after the first one that acts on a kite. Returns the labels pressed, in order.
   */
  function pressedAfterJump(id: string, far: number): string[] {
    const state = sceneOf(id, far, { kits: sixKits(), ready: [] });
    const me = state.champions[0] as ChampionState;
    const target = state.champions[2] as ChampionState;
    const bot = createBot(0, 'hard', 1);
    for (let i = 0; i < TIERS.hard.delay + 4; i++) bot.think(state);
    expect(bot.inspect().intent).not.toBe('kite');
    target.x = me.x + 2;
    const pressed: string[] = [];
    let ready = false;
    for (let i = 0; i < 30; i++) {
      const input = bot.think(state);
      if (input.buttons !== 0) pressed.push(labelOf(input.buttons));
      if (!ready && bot.inspect().intent === 'kite') {
        ready = true;
        for (const slot of ['SPACE', 'R'] as const) me.cooldowns[SLOTS.indexOf(slot)] = 0;
      }
      if (pressed.length > 0) break;
    }
    return pressed;
  }

  it('presses Reed Step, not Reed Screen, when R has a band run from before the kite began', () => {
    expect(pressedAfterJump('ondrel', 7)).toEqual(['SPACE']);
  });

  it('presses Flare Step, not Smoke Pot, when R has a band run from before the kite began', () => {
    expect(pressedAfterJump('brimwick', 9)).toEqual(['SPACE']);
  });
});

// The streak starts again whenever the escape thinks stop or the acted target changes: the press
// comes `castDelay` thinks after the first think of a new streak, not at once on a leftover count.
describe('the escape streak starts again', () => {
  const kits = sixKits();
  const SPACE = SLOTS.indexOf('SPACE');

  for (const [id, near] of [
    ['ondrel', 4.9],
    ['brimwick', 6.9],
  ] as const) {
    it(`after a break: ${id} presses on the fourth think of the new kite, and not on a leftover count`, () => {
      const state = sceneOf(id, near, { kits, ready: [] });
      const me = state.champions[0] as ChampionState;
      const target = state.champions[2] as ChampionState;
      const bot = createBot(0, 'hard', 1);
      // A long kite with the escape cooling down, so the count would be large; then the target is far
      // enough for the bot to engage again, long enough for the acted intent to follow.
      for (let i = 0; i < 40; i++) expect(bot.think(state).buttons).toBe(0);
      target.x = me.x + 12;
      for (let i = 0; i < 40; i++) bot.think(state);
      expect(bot.inspect().intent).not.toBe('kite');
      // Back inside rangeMin with the escape ready: the first kite think is the first of the streak.
      target.x = me.x + near;
      me.cooldowns[SPACE] = 0;
      let kiteThink = -1;
      let pressThink = -1;
      for (let i = 0; i < THINKS && pressThink < 0; i++) {
        const input = bot.think(state);
        if (kiteThink < 0 && bot.inspect().intent === 'kite') kiteThink = i;
        if (input.buttons !== 0) pressThink = i;
      }
      expect(kiteThink).toBeGreaterThanOrEqual(0);
      expect(pressThink - kiteThink).toBe(TIERS.hard.castDelay);
    });
  }

  it('after a change of the acted target: the press comes castDelay thinks after the switch', () => {
    const state = sceneOf('ondrel', 4.9, { kits, ready: [] });
    const me = state.champions[0] as ChampionState;
    const second = state.champions[3] as ChampionState;
    second.alive = true;
    second.x = me.x + 40;
    second.y = me.y;
    const bot = createBot(0, 'hard', 1);
    for (let i = 0; i < 40; i++) expect(bot.think(state).buttons).toBe(0);
    expect(bot.inspect().targetId).toBe(2);
    // The second enemy comes to 2 m with the first still in reach, so every think of the switch is an
    // escape think: the acted target follows after the delay.
    second.x = me.x + 2;
    let switchThink = -1;
    let pressThink = -1;
    for (let i = 0; i < THINKS && pressThink < 0; i++) {
      const input = bot.think(state);
      if (switchThink < 0 && bot.inspect().targetId === 3) {
        switchThink = i;
        me.cooldowns[SPACE] = 0;
      }
      if (input.buttons !== 0) pressThink = i;
    }
    expect(switchThink).toBeGreaterThanOrEqual(0);
    expect(pressThink - switchThink).toBe(TIERS.hard.castDelay);
  });
});
