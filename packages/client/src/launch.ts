import type { Difficulty } from '@claudeline/bots';
import { ROSTER_IDS } from './roster';

/** The bot tiers, easiest first. A test checks each one against the bots package. */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export type SceneName = 'match' | 'sandbox';

/** What the page address asks for. */
export interface Launch {
  /** `match` is the 2v2 against bots. `sandbox` is the dev-only scene of the e2e specs. */
  scene: SceneName;
  /** The champion the human plays: an id with a loaded kit. */
  champion: string;
  /** The tier of every bot. */
  difficulty: Difficulty;
  /** The arena of the match: an id with a loaded definition. The sandbox always plays arena01. */
  arena: string;
}

/** The arena the page plays when the address names none that exists. */
export const DEFAULT_ARENA = 'arena01';

/**
 * Reads the query string. `kitIds` are the ids with a loaded kit, `arenaIds`
 * the ids with a loaded arena, `dev` is
 * `import.meta.env.DEV`: a production build has one scene, so the sandbox is
 * honoured only when `dev` is true. Takes the string, not the location, so a
 * later platform layer can pass its own launch arguments. The champion is the
 * first kit of the roster order unless the query names another kit; the
 * sandbox ignores it. The arena is the id the query names if it is loaded,
 * else arena01, else the first loaded id; the sandbox ignores it too, since
 * the walk spec and the heap probe stand on the coordinates of arena01.
 */
export function parseLaunch(
  search: string,
  kitIds: readonly string[],
  arenaIds: readonly string[],
  dev: boolean,
): Launch {
  const params = new URLSearchParams(search);
  const fallback = ROSTER_IDS.find((id) => kitIds.includes(id)) ?? kitIds[0] ?? (ROSTER_IDS[0] as string);
  const asked = params.get('champion') ?? '';
  const sandbox = dev && params.get('scene') === 'sandbox';
  const champion = !sandbox && kitIds.includes(asked) ? asked : fallback;
  const difficulty = DIFFICULTIES.find((tier) => tier === params.get('difficulty')) ?? 'normal';
  const fallbackArena = arenaIds.includes(DEFAULT_ARENA) ? DEFAULT_ARENA : (arenaIds[0] ?? DEFAULT_ARENA);
  const askedArena = params.get('arena') ?? '';
  const arena = !sandbox && arenaIds.includes(askedArena) ? askedArena : fallbackArena;
  return { scene: sandbox ? 'sandbox' : 'match', champion, difficulty, arena };
}
