import { describe, expect, it } from 'vitest';
import { createMatch } from '@claudeline/sim';
import type { GameState, PlayerInput, SimEvent } from '@claudeline/sim';
import type { Bot } from '../src/bot';
import {
  arena01,
  configMirror,
  createRun,
  createTeleportTally,
  jsonKits,
  runMatch,
  tallyTeleports,
} from './helpers';

/**
 * A bot that owns one input record and rewrites it on every think, as the real bots do: a caller
 * that keeps the returned object sees it change on the next think.
 */
function reusingBot(): Bot {
  const own: PlayerInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };
  let n = 0;
  return {
    think(state: GameState): PlayerInput {
      n++;
      own.aimX = n;
      own.aimY = state.tick;
      return own;
    },
    inspect: () => ({ intent: 'idle', targetId: -1 }),
  };
}

describe('createRun', () => {
  it('records a copy of each bot input, so a bot that reuses its record does not alias the stream', () => {
    const run = createRun([1, 2, 3, 4], ['easy', 'easy', 'easy', 'easy'], 7, {
      makeBot: () => reusingBot(),
    });
    for (let t = 0; t < 5; t++) run.advance();
    expect(run.inputs.map((tick) => tick.map((i) => i.aimX))).toEqual([
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
      [4, 4, 4, 4],
      [5, 5, 5, 5],
    ]);
    expect(new Set(run.inputs.flat()).size).toBe(5 * 4);
  });

  it('gives one distinct input object per bot per tick on real bots', () => {
    const run = runMatch([101, 102, 103, 104], ['easy', 'normal', 'hard', 'normal'], 60);
    expect(new Set(run.inputs.flat()).size).toBe(60 * 4);
  });
});

describe('jsonKits', () => {
  it('holds the three shipped kits, and a match keeps only the kits its players use', () => {
    expect(jsonKits().map((kit) => kit.id)).toEqual(['hargrim', 'quillon', 'skerrow']);
    const state = createMatch(configMirror(), arena01, 7, jsonKits());
    expect(state.kits.map((kit) => kit.id)).toEqual(['hargrim', 'quillon']);
  });
});

describe('tallyTeleports', () => {
  const teleport = (championId: number, blocked: boolean): SimEvent => ({
    type: 'teleport',
    championId,
    fromX: 0,
    fromY: 0,
    toX: blocked ? 0 : 4,
    toY: 0,
    blocked,
  });

  it('counts the teleport of an escaper as an escape, and any other apart', () => {
    const tally = createTeleportTally();
    const found = tallyTeleports(tally, [teleport(1, false), teleport(0, false)], [1]);
    expect(tally).toEqual({ escapes: 1, blockedEscapes: 0, others: 1, blockedOthers: 0 });
    expect(found).toEqual([teleport(1, false)]);
  });

  it('counts a blocked escape and a blocked other each in its own column', () => {
    const tally = createTeleportTally();
    tallyTeleports(tally, [teleport(1, true), teleport(0, true)], [1]);
    expect(tally).toEqual({ escapes: 1, blockedEscapes: 1, others: 1, blockedOthers: 1 });
    tallyTeleports(tally, [teleport(0, true)], []);
    expect(tally).toEqual({ escapes: 1, blockedEscapes: 1, others: 2, blockedOthers: 2 });
  });

  it('takes the last teleport of an escaper as its escape: a windup that fires on the same tick comes first', () => {
    const tally = createTeleportTally();
    const found = tallyTeleports(tally, [teleport(1, true), teleport(1, false)], [1]);
    expect(tally).toEqual({ escapes: 1, blockedEscapes: 0, others: 1, blockedOthers: 1 });
    expect(found[0]?.blocked).toBe(false);
  });

  it('returns undefined for an escaper the sim started no teleport for, and counts nothing', () => {
    const tally = createTeleportTally();
    expect(tallyTeleports(tally, [], [2])).toEqual([undefined]);
    expect(tally).toEqual(createTeleportTally());
  });
});
