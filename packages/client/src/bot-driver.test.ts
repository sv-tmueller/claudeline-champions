import { createBot } from '@claudeline/bots';
import { parseArenaDef, step, type PlayerInput } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createBotDriver } from './bot-driver';
import { LOCAL_SEED, createLocalMatch } from './match-setup';
import { TEST_KITS } from './test-kits';

const arena = parseArenaDef(arena01Json);

function setup(teamSize: 2 | 3 = 2) {
  const { state, botIds } = createLocalMatch({ scene: 'match', champion: 'hargrim', difficulty: 'normal', arena: 'arena01', teamSize }, arena, TEST_KITS);
  const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
  return { state, botIds, inputs };
}

/** True when `root` reaches `target` through any chain of properties, arrays included. */
function holdsReference(root: object, target: object): boolean {
  const seen = new Set<object>();
  const walk = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    if (value === target) return true;
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some(walk);
  };
  return walk(root);
}

describe('bot driver', () => {
  it('writes the input of every driven id and leaves the others alone', () => {
    const { state, botIds, inputs } = setup();
    const human: PlayerInput = { moveX: 1, moveY: 0, aimX: 5, aimY: 6, buttons: 0 };
    inputs[0] = human;
    createBotDriver(botIds, 'normal', LOCAL_SEED).think(state, inputs);
    expect(inputs[0]).toBe(human);
    for (const id of botIds) expect(inputs[id], `bot ${id}`).toBeDefined();
  });

  it('drives the five bots of a 3v3 and leaves the human alone', () => {
    const { state, botIds, inputs } = setup(3);
    const human: PlayerInput = { moveX: 1, moveY: 0, aimX: 5, aimY: 6, buttons: 0 };
    inputs[0] = human;
    createBotDriver(botIds, 'normal', LOCAL_SEED).think(state, inputs);
    expect(state.champions).toHaveLength(6);
    expect(inputs[0]).toBe(human);
    expect(botIds).toEqual([1, 2, 3, 4, 5]);
    for (let id = 1; id <= 5; id++) expect(inputs[id], `bot ${id}`).toBeDefined();
    expect(inputs).toHaveLength(6);
  });

  it('writes only the ids it was given', () => {
    const { state, inputs } = setup();
    createBotDriver([2], 'easy', LOCAL_SEED).think(state, inputs);
    expect(inputs.map((input) => input !== undefined)).toEqual([false, false, true, false]);
  });

  it("writes the bot's own record on every call, which step copies", () => {
    const { state, botIds, inputs } = setup();
    const driver = createBotDriver(botIds, 'normal', LOCAL_SEED);
    driver.think(state, inputs);
    const first = inputs[1];
    expect(first).toBeDefined();
    // The bots reuse one record each and overwrite it on their next think.
    driver.think(state, inputs);
    expect(inputs[1]).toBe(first);
    // step copies what it reads: the state keeps no reference to the record the driver wrote, so
    // the bot may overwrite it. A walk over the whole state finds none, and the same walk finds one
    // when a field is made to hold the record, so it is not vacuous.
    if (first === undefined) throw new Error('no input');
    step(state, inputs);
    expect(holdsReference(state, first), 'state after step').toBe(false);
    const probe = { ...state, kept: first };
    expect(holdsReference(probe, first), 'control: a state that keeps it').toBe(true);
  });

  // The reference bots are made the way the driver says it makes them: one
  // per id, with the seed of the local match times 100 plus the id. A driver
  // that thought twice per call, thought in another order or seeded otherwise
  // would drift from them within a few ticks.
  it('thinks once per bot per call, with the seed times 100 plus the id', () => {
    const driven = setup();
    const reference = setup();
    const driver = createBotDriver(driven.botIds, 'hard', LOCAL_SEED);
    const bots = reference.botIds.map((id) => ({ id, bot: createBot(id, 'hard', LOCAL_SEED * 100 + id) }));
    for (let tick = 0; tick < 600; tick++) {
      driver.think(driven.state, driven.inputs);
      for (const { id, bot } of bots) reference.inputs[id] = bot.think(reference.state);
      expect(driven.inputs, `tick ${tick}`).toEqual(reference.inputs);
      step(driven.state, driven.inputs);
      step(reference.state, reference.inputs);
    }
  });

  it('gives two drivers of the same seed the same inputs over 600 stepped ticks', () => {
    const a = setup();
    const b = setup();
    const driverA = createBotDriver(a.botIds, 'normal', LOCAL_SEED);
    const driverB = createBotDriver(b.botIds, 'normal', LOCAL_SEED);
    for (let tick = 0; tick < 600; tick++) {
      driverA.think(a.state, a.inputs);
      driverB.think(b.state, b.inputs);
      expect(a.inputs, `tick ${tick}`).toEqual(b.inputs);
      step(a.state, a.inputs);
      step(b.state, b.inputs);
    }
  });

  it('gives different seeds different inputs somewhere in 600 ticks', () => {
    const a = setup();
    const b = setup();
    const driverA = createBotDriver(a.botIds, 'normal', 1);
    const driverB = createBotDriver(b.botIds, 'normal', 2);
    let differed = false;
    for (let tick = 0; tick < 600 && !differed; tick++) {
      driverA.think(a.state, a.inputs);
      driverB.think(b.state, b.inputs);
      differed = JSON.stringify(a.inputs) !== JSON.stringify(b.inputs);
      step(a.state, a.inputs);
      step(b.state, b.inputs);
    }
    expect(differed).toBe(true);
  });
});
