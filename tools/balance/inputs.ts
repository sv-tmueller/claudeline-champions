import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { orbPointFor, parseArenaDef } from '@claudeline/sim';
import type { ArenaDef, KitDef, OrbPoint } from '@claudeline/sim';

/**
 * The kits the harness plays: the kits of data/kits that are listed here, in file name order
 * (loadInputs returns them in that order, and inputs.test.ts pins it). The list, not the directory,
 * fixes the run, the committed block and the CI times, so a kit added to data/kits joins the report
 * only when it is listed here. Durnhal joined it at step 1.3 of the roster-v3 build order (#244).
 * Wrenna has a kit file (#270) and joins in step 3.4, so inputs.test.ts pins the kit files outside
 * the list by name.
 */
export const HARNESS_KITS: readonly string[] = [
  'brimwick',
  'durnhal',
  'hargrim',
  'lumeth',
  'ondrel',
  'quillon',
  'skerrow',
];

/** What a run plays on and with: the HARNESS_KITS of data/kits, every arena of data/arenas, and the orb point of each arena. */
export interface Inputs {
  kits: KitDef[];
  arenas: ArenaDef[];
  /** The orb point of each arena with a row in data/orbs.json, by arena id; the harness plays every match with it. */
  orbs: ReadonlyMap<string, OrbPoint>;
}

function jsonFiles(dir: URL): unknown[] {
  const names = readdirSync(fileURLToPath(dir))
    .filter((name) => name.endsWith('.json'))
    .sort();
  return names.map((name) => JSON.parse(readFileSync(fileURLToPath(new URL(name, dir)), 'utf8')) as unknown);
}

/** The parsed data/orbs.json under `root`, or an empty table when the file does not exist. */
function readOrbTable(root: URL): unknown {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL('data/orbs.json', root)), 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/**
 * Reads data/kits/*.json, data/arenas/*.json and data/orbs.json under `root` (the repo root as a
 * directory URL), keeps the kits of HARNESS_KITS and throws on a listed id with no file.
 * The kits stay the raw JSON, as the client hands them to `createMatch`, which validates them; the
 * arenas go through `parseArenaDef`; each arena's orb point goes through `orbPointFor` (a bad row
 * throws here, and an arena without a row simply has no orb), the point the harness plays with.
 */
export function loadInputs(root: URL): Inputs {
  const files = jsonFiles(new URL('data/kits/', root)) as KitDef[];
  for (const id of HARNESS_KITS) {
    if (!files.some((kit) => kit.id === id)) throw new Error(`the harness kit ${id} has no file in data/kits`);
  }
  const kits = files.filter((kit) => HARNESS_KITS.includes(kit.id));
  const arenas = jsonFiles(new URL('data/arenas/', root)).map((json) => parseArenaDef(json));
  const orbTable = readOrbTable(root);
  const orbs = new Map<string, OrbPoint>();
  for (const arena of arenas) {
    const orb = orbPointFor(orbTable, arena);
    if (orb !== undefined) orbs.set(arena.id, orb);
  }
  return { kits, arenas, orbs };
}
