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

// The sandbox of the e2e specs: its roster has Lumeth and Skerrow on team B, and
// the scene names exactly the Hargrim and Quillon kits itself, so a kit file that
// joins the match later never changes the scene (champion 3 stays a bot without a
// kit, which deals no damage).
const SANDBOX_PLAYERS: readonly PlayerConfig[] = [
  { championId: 'hargrim', team: 'A' },
  { championId: 'quillon', team: 'A' },
  { championId: 'lumeth', team: 'B' },
  { championId: 'skerrow', team: 'B' },
];
const SANDBOX_KIT_IDS = ['hargrim', 'quillon'];
const SANDBOX_BOT_IDS: readonly number[] = [3];

// Team B of each size, in champion order. Team A is the pick plus this row without the
// pick's own entry (without its first entry when the pick is not in the row), so each team
// holds one of each kit the row names and the 3v3 of the Hargrim pick is the headless 3v3
// of the bots package (hargrim and two quillons a side).
const ENEMY_ROSTER: Readonly<Record<2 | 3, readonly string[]>> = {
  2: ['hargrim', 'quillon'],
  3: ['hargrim', 'quillon', 'quillon'],
};

/**
 * The team size the match plays: the asked 3 only on an arena with three spawns on both
 * teams, else 2. The sim throws when a spawn is missing, so an arena file with two spawns a
 * team (legal for an arena, arenas.md section 3) plays 2v2 and never reaches the throw.
 */
export function playableTeamSize(asked: 2 | 3, arena: Pick<ArenaDef, 'spawns'>): 2 | 3 {
  return asked === 3 && arena.spawns.teamA.length >= 3 && arena.spawns.teamB.length >= 3 ? 3 : 2;
}

function kitById(kits: readonly KitDef[], id: string): KitDef {
  const kit = kits.find((candidate) => candidate.id === id);
  if (!kit) throw new Error(`the sandbox needs the kit "${id}", which is not loaded`);
  return kit;
}

/**
 * The match the page starts, 2v2 or 3v3 (`playableTeamSize`). Champion 0 is the pick
 * of the launch on team A, the next champions of team A are its ally bots and the
 * champions of team B are the enemy bots, by `ENEMY_ROSTER`. The local team is always
 * A. Every champion needs a kit. The scene `sandbox` is the dev-only scene of the heap probe
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
  const teamSize = playableTeamSize(launch.teamSize, arena);
  const enemies = ENEMY_ROSTER[teamSize];
  const own = enemies.indexOf(launch.champion);
  const allies = enemies.filter((_, index) => index !== (own < 0 ? 0 : own));
  const players: PlayerConfig[] = [
    { championId: launch.champion, team: 'A' },
    ...allies.map((championId): PlayerConfig => ({ championId, team: 'A' })),
    ...enemies.map((championId): PlayerConfig => ({ championId, team: 'B' })),
  ];
  const state = createMatch({ teamSize, players, roundsToWin }, arena, LOCAL_SEED, kits);
  return { state, botIds: Array.from({ length: 2 * teamSize - 1 }, (_, index) => index + 1) };
}
