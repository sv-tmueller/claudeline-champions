import { ROSTER_IDS } from './roster';

// Plain relative strings, not `import.meta.env.BASE_URL`: that is '/' in dev
// and './' in a build, so dev URLs would get a leading slash. Relative URLs
// resolve against the page, which works in dev and under any subdirectory.
export function arenaModelUrl(id: string): string {
  return `models/arenas/${id}.glb`;
}

export const PLACEHOLDER_CHAMPION_URL = 'models/champions/placeholder.glb';

/**
 * The model of a champion. A roster id has its own file; anything else gets the
 * placeholder. The fallback goes by the id list and not by a failed load, since
 * a 404 is a console error and the e2e specs treat that as a failure.
 */
export function championModelUrl(id: string): string {
  return ROSTER_IDS.includes(id) ? `models/champions/${id}.glb` : PLACEHOLDER_CHAMPION_URL;
}
