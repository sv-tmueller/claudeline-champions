// Plain relative strings, not `import.meta.env.BASE_URL`: that is '/' in dev
// and './' in a build, so dev URLs would get a leading slash. Relative URLs
// resolve against the page, which works in dev and under any subdirectory.
export function arenaModelUrl(id: string): string {
  return `models/arenas/${id}.glb`;
}

export const PLACEHOLDER_CHAMPION_URL = 'models/champions/placeholder.glb';
