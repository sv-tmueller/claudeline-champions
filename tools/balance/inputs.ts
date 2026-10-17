import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArenaDef } from '@claudeline/sim';
import type { ArenaDef, KitDef } from '@claudeline/sim';

/** What a run plays on and with: every kit and every arena of data/, in file name order. */
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
 * Reads data/kits/*.json and data/arenas/*.json under `root` (the repo root as a directory URL).
 * The kits stay the raw JSON, as the client hands them to `createMatch`, which validates them; the
 * arenas go through `parseArenaDef`.
 */
export function loadInputs(root: URL): Inputs {
  const kits = jsonFiles(new URL('data/kits/', root)) as KitDef[];
  const arenas = jsonFiles(new URL('data/arenas/', root)).map((json) => parseArenaDef(json));
  return { kits, arenas };
}
