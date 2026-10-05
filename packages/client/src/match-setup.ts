import {
  DEFAULT_ROUNDS_TO_WIN,
  createMatch,
  type ArenaDef,
  type GameState,
  type KitDef,
  type PlayerConfig,
} from '@claudeline/sim';
import type { Launch } from './launch';

/** The seed of the local match. The bots derive their own from it. */
export const LOCAL_SEED = 1;

export interface LocalMatch {
  state: GameState;
  /** The champion ids a bot plays. Champion 0 is the human. */
  botIds: readonly number[];
}

// The sandbox of the e2e specs: Lumeth and Skerrow have no kit file yet and
// must not get one later by accident, so the scene names its two kits itself.
const SANDBOX_PLAYERS: readonly PlayerConfig[] = [
  { championId: 'hargrim', team: 'A' },
  { championId: 'quillon', team: 'A' },
  { championId: 'lumeth', team: 'B' },
  { championId: 'skerrow', team: 'B' },
];
const SANDBOX_KIT_IDS = ['hargrim', 'quillon'];
const SANDBOX_BOT_IDS: readonly number[] = [3];

function kitById(kits: readonly KitDef[], id: string): KitDef {
  const kit = kits.find((candidate) => candidate.id === id);
  if (!kit) throw new Error(`the sandbox needs the kit "${id}", which is not loaded`);
  return kit;
}

/**
 * The match the page starts. Champion 0 is the pick of the launch on team A,
 * champion 1 is its ally bot (the other of the two kits) and champions 2 and
 * 3 are the enemy bots, Hargrim and Quillon. The local team is always A. All
 * four need a kit. The scene `sandbox` is the dev-only scene of the heap probe
 * and the walk spec: the old four-champion roster with the two kits and one bot.
 * Both run the match flow, `roundsToWin` rounds to win.
 */
export function createLocalMatch(
  launch: Launch,
  arena: ArenaDef,
  kits: readonly KitDef[],
  roundsToWin: number = DEFAULT_ROUNDS_TO_WIN,
): LocalMatch {
  if (launch.scene === 'sandbox') {
    const sandboxKits = SANDBOX_KIT_IDS.map((id) => kitById(kits, id));
    const state = createMatch({ teamSize: 2, players: [...SANDBOX_PLAYERS], roundsToWin }, arena, LOCAL_SEED, sandboxKits);
    return { state, botIds: SANDBOX_BOT_IDS };
  }
  const ally = launch.champion === 'quillon' ? 'hargrim' : 'quillon';
  const players: PlayerConfig[] = [
    { championId: launch.champion, team: 'A' },
    { championId: ally, team: 'A' },
    { championId: 'hargrim', team: 'B' },
    { championId: 'quillon', team: 'B' },
  ];
  const state = createMatch({ teamSize: 2, players, roundsToWin }, arena, LOCAL_SEED, kits);
  return { state, botIds: [1, 2, 3] };
}
