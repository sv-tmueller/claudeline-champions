import arena01Json from '../../../data/arenas/arena01.json';
import { parseArenaDef } from '../src/index';
import type { ArenaDef, MatchConfig, Obstacle, PlayerInput } from '../src/index';

export const arena01: ArenaDef = parseArenaDef(arena01Json);

/** A 30 x 20 arena with the arena01 spawns and the given obstacles. */
export function openArena(obstacles: Obstacle[] = []): ArenaDef {
  return { ...arena01, id: 'open', name: 'Open', obstacles };
}

export function config2v2(): MatchConfig {
  return {
    teamSize: 2,
    players: [
      { championId: 'hargrim', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'lumeth', team: 'B' },
      { championId: 'skerrow', team: 'B' },
    ],
  };
}

export function input(
  moveX: -1 | 0 | 1,
  moveY: -1 | 0 | 1,
  aimX = 0,
  aimY = 0,
  buttons = 0,
): PlayerInput {
  return { moveX, moveY, aimX, aimY, buttons };
}
