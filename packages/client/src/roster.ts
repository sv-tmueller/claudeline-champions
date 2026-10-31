/** The seven champions: the four v1 ones in the order of docs/design/roster-v1.md, then the two of docs/design/roster-v2.md, then the one of docs/design/roster-v3.md. */
export const ROSTER_IDS: readonly string[] = ['hargrim', 'quillon', 'lumeth', 'skerrow', 'ondrel', 'brimwick', 'durnhal'];

// Display names of the seven champions, from docs/design/roster-v1.md, roster-v2.md and roster-v3.md.
const NAMES: Readonly<Record<string, string>> = {
  hargrim: 'Hargrim',
  quillon: 'Quillon',
  lumeth: 'Lumeth',
  skerrow: 'Skerrow',
  ondrel: 'Ondrel',
  brimwick: 'Brimwick',
  durnhal: 'Durnhal',
};

/** The name to show for a champion id. An unknown id shows as itself. */
export function championName(championId: string): string {
  return Object.hasOwn(NAMES, championId) ? (NAMES[championId] as string) : championId;
}
