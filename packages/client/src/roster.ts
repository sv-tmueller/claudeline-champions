/** The four v1 champions in the order of docs/design/roster-v1.md. */
export const ROSTER_IDS: readonly string[] = ['hargrim', 'quillon', 'lumeth', 'skerrow'];

// Display names of the four v1 champions, from docs/design/roster-v1.md.
const NAMES: Readonly<Record<string, string>> = {
  hargrim: 'Hargrim',
  quillon: 'Quillon',
  lumeth: 'Lumeth',
  skerrow: 'Skerrow',
};

/** The name to show for a champion id. An unknown id shows as itself. */
export function championName(championId: string): string {
  return Object.hasOwn(NAMES, championId) ? (NAMES[championId] as string) : championId;
}
