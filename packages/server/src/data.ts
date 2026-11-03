import { readdirSync, readFileSync } from 'node:fs';
import { orbPointFor, parseArenaDef } from '@claudeline/sim';
import type { ArenaDef, KitDef, OrbPoint } from '@claudeline/sim';
import type { ArenaListing } from '@claudeline/protocol';

/** What a room knows about the game: the server is the authority on data (online design section 5). */
export interface RoomData {
  /** Every kit in `data/kits`, sorted by id: what `createMatch` and `matchStart` get. */
  kits: KitDef[];
  /** The arenas a team of two fits, sorted by id, parallel to `listings`. */
  arenas: ArenaDef[];
  /** The champion ids in roster order, which is the kit ids sorted. */
  roster: string[];
  listings: ArenaListing[];
  /** The energy orb point of each arena that has a row in `orbs.json`, by arena id (rules.md 3.3). */
  orbs: ReadonlyMap<string, OrbPoint>;
}

/** The repository's `data/` directory, found from this file: `packages/server/src/data.ts`. */
export const DATA_ROOT = new URL('../../../data/', import.meta.url);

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function jsonFiles(root: URL, dir: string): URL[] {
  return readdirSync(new URL(dir, root))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => new URL(`${dir}${name}`, root));
}

/** The parsed `orbs.json` under `root`, or an empty table when the file does not exist. */
function readOrbTable(root: URL): unknown {
  try {
    return JSON.parse(readFileSync(new URL('orbs.json', root), 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/**
 * Reads `kits/`, `arenas/` and `orbs.json` under `root` (a URL ending in a slash). The kits are plain data that
 * `createMatch` validates. An arena goes through `parseArenaDef`. `maxTeamSize` is the smaller of
 * the two spawn counts, at most 3, and an arena with fewer than two spawns a team is left out.
 * The orb point of each kept arena goes through `orbPointFor`, so a bad row throws at load; a
 * missing file or an arena without a row has no orb. Throws when no arena is left: that is a
 * defect of the data, not of any message.
 */
export function loadRoomData(root: URL = DATA_ROOT): RoomData {
  const kits = jsonFiles(root, 'kits/')
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as KitDef)
    .sort(byId);
  const arenas: ArenaDef[] = [];
  const listings: ArenaListing[] = [];
  const orbs = new Map<string, OrbPoint>();
  const orbTable = readOrbTable(root);
  const parsed = jsonFiles(root, 'arenas/')
    .map((file) => parseArenaDef(JSON.parse(readFileSync(file, 'utf8')) as unknown))
    .sort(byId);
  for (const arena of parsed) {
    const spawns = Math.min(arena.spawns.teamA.length, arena.spawns.teamB.length);
    if (spawns < 2) continue;
    arenas.push(arena);
    const orb = orbPointFor(orbTable, arena);
    if (orb !== undefined) orbs.set(arena.id, orb);
    listings.push({ id: arena.id, name: arena.name, maxTeamSize: spawns >= 3 ? 3 : 2 });
  }
  if (arenas.length === 0) throw new Error('data/arenas has no arena with two spawns a team');
  return { kits, arenas, roster: kits.map((k) => k.id), listings, orbs };
}
