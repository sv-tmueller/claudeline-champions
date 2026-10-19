import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArenaDef } from '@claudeline/sim';
import type { ArenaDef, KitDef } from '@claudeline/sim';

/**
 * The kits the harness plays: the four v1 kits. data/kits holds more (Ondrel and Brimwick are data
 * but not in the harness roster until the six-kit report), so this list, not the directory, fixes the
 * run, the committed block and the CI times.
 */
export const HARNESS_KITS: readonly string[] = ['hargrim', 'lumeth', 'quillon', 'skerrow'];

/** What a run plays on and with: the HARNESS_KITS of data/kits and every arena of data/arenas, in file name order. */
export interface Inputs {
  kits: KitDef[];
  arenas: ArenaDef[];
}

function jsonFiles(dir: URL): unknown[] {
  const names = readdirSync(fileURLToPath(dir))
    .filter((name) => name.endsWith('.json'))
    .sort();
  return names.map((name) => JSON.parse(readFileSync(fileURLToPath(new URL(name, dir)), 'utf8')) as unknown);
}

/**
 * Reads data/kits/*.json and data/arenas/*.json under `root` (the repo root as a directory URL),
 * keeps the kits of HARNESS_KITS and throws on a listed id with no file.
 * The kits stay the raw JSON, as the client hands them to `createMatch`, which validates them; the
 * arenas go through `parseArenaDef`.
 */
export function loadInputs(root: URL): Inputs {
  const files = jsonFiles(new URL('data/kits/', root)) as KitDef[];
  for (const id of HARNESS_KITS) {
    if (!files.some((kit) => kit.id === id)) throw new Error(`the harness kit ${id} has no file in data/kits`);
  }
  const kits = files.filter((kit) => HARNESS_KITS.includes(kit.id));
  const arenas = jsonFiles(new URL('data/arenas/', root)).map((json) => parseArenaDef(json));
  return { kits, arenas };
}
