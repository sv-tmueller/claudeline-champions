import { readdirSync, readFileSync } from 'node:fs';
import { parseArenaDef } from '@claudeline/sim';
import type { ArenaDef, KitDef } from '@claudeline/sim';
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

/**
 * Reads `kits/` and `arenas/` under `root` (a URL ending in a slash). The kits are plain data that
 * `createMatch` validates. An arena goes through `parseArenaDef`. `maxTeamSize` is the smaller of
 * the two spawn counts, at most 3, and an arena with fewer than two spawns a team is left out.
 * Throws when no arena is left: that is a defect of the data, not of any message.
 */
export function loadRoomData(root: URL = DATA_ROOT): RoomData {
  const kits = jsonFiles(root, 'kits/')
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as KitDef)
    .sort(byId);
  const arenas: ArenaDef[] = [];
  const listings: ArenaListing[] = [];
  const parsed = jsonFiles(root, 'arenas/')
    .map((file) => parseArenaDef(JSON.parse(readFileSync(file, 'utf8')) as unknown))
    .sort(byId);
  for (const arena of parsed) {
    const spawns = Math.min(arena.spawns.teamA.length, arena.spawns.teamB.length);
    if (spawns < 2) continue;
    arenas.push(arena);
    listings.push({ id: arena.id, name: arena.name, maxTeamSize: spawns >= 3 ? 3 : 2 });
  }
  if (arenas.length === 0) throw new Error('data/arenas has no arena with two spawns a team');
  return { kits, arenas, roster: kits.map((k) => k.id), listings };
}
