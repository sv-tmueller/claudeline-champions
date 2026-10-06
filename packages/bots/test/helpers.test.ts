import { describe, expect, it } from 'vitest';
import { createMatch } from '@claudeline/sim';
import type { GameState, PlayerInput } from '@claudeline/sim';
import type { Bot } from '../src/bot';
import { arena01, configMirror, createRun, jsonKits, runMatch } from './helpers';

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
