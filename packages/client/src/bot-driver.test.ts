import { createBot } from '@claudeline/bots';
import { parseArenaDef, step, type PlayerInput } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createBotDriver } from './bot-driver';
import { LOCAL_SEED, createLocalMatch } from './match-setup';
import { TEST_KITS } from './test-kits';

const arena = parseArenaDef(arena01Json);

function setup() {
  const { state, botIds } = createLocalMatch({ scene: 'match', champion: 'hargrim', difficulty: 'normal' }, arena, TEST_KITS);
  const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
  return { state, botIds, inputs };
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

  it('writes only the ids it was given', () => {
    const { state, inputs } = setup();
    createBotDriver([2], 'easy', LOCAL_SEED).think(state, inputs);
    expect(inputs.map((input) => input !== undefined)).toEqual([false, false, true, false]);
  });

  it('writes the bot own record on every call, which step copies', () => {
    const { state, botIds, inputs } = setup();
    const driver = createBotDriver(botIds, 'normal', LOCAL_SEED);
    driver.think(state, inputs);
    const first = inputs[1];
    expect(first).toBeDefined();
    // The bots reuse one record each and overwrite it on their next think.
    driver.think(state, inputs);
    expect(inputs[1]).toBe(first);
    // step copies what it reads: garbage written into the record afterwards changes nothing.
    step(state, inputs);
    const aim = [state.champions[1]?.aimX, state.champions[1]?.aimY];
    if (first === undefined) throw new Error('no input');
    first.aimX = 123456;
    first.aimY = -654321;
    expect([state.champions[1]?.aimX, state.champions[1]?.aimY]).toEqual(aim);
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
