import { createBot, type Bot, type Difficulty } from '@claudeline/bots';
import type { GameState, PlayerInput } from '@claudeline/sim';

/** Drives the bots of a match, in the main thread. */
export interface BotDriver {
  /**
   * Call once per tick, before `step`: writes `inputs[id]` for every driven id
   * and touches no other entry. Each bot returns its own record, which its next
   * think overwrites (by the bots' API), and the sim copies it in `step`.
   */
  think(state: GameState, inputs: (PlayerInput | undefined)[]): void;
}

interface Driven {
  id: number;
  bot: Bot;
}

/**
 * One bot per id, all on the same difficulty. The bot of champion `id` gets
 * the seed `seed * 100 + id`, so the bots of one match draw from separate
 * streams and the same seed gives the same bots. The list is built once and
 * `think` is an indexed loop over it, since it runs in the frame path: this
 * file is counted by the heap probe in e2e/combat.spec.ts.
 */
export function createBotDriver(ids: readonly number[], difficulty: Difficulty, seed: number): BotDriver {
  const driven: Driven[] = ids.map((id) => ({ id, bot: createBot(id, difficulty, seed * 100 + id) }));
  return {
    think(state, inputs) {
      for (let i = 0; i < driven.length; i++) {
        const entry = driven[i] as Driven;
        inputs[entry.id] = entry.bot.think(state);
      }
    },
  };
}
