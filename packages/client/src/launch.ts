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
}

/**
 * Reads the query string. `kitIds` are the ids with a loaded kit, `dev` is
 * `import.meta.env.DEV`: a production build has one scene, so the sandbox is
 * honoured only when `dev` is true. Takes the string, not the location, so a
 * later platform layer can pass its own launch arguments. The champion is the
 * first kit of the roster order unless the query names another kit; the
 * sandbox ignores it.
 */
export function parseLaunch(search: string, kitIds: readonly string[], dev: boolean): Launch {
  const params = new URLSearchParams(search);
  const fallback = ROSTER_IDS.find((id) => kitIds.includes(id)) ?? kitIds[0] ?? (ROSTER_IDS[0] as string);
  const asked = params.get('champion') ?? '';
  const sandbox = dev && params.get('scene') === 'sandbox';
  const champion = !sandbox && kitIds.includes(asked) ? asked : fallback;
  const difficulty = DIFFICULTIES.find((tier) => tier === params.get('difficulty')) ?? 'normal';
  return { scene: sandbox ? 'sandbox' : 'match', champion, difficulty };
}
