import { existsSync, readFileSync } from 'node:fs';
import type { KitDef } from '@claudeline/sim';

/** The repo root as a directory URL. */
export const ROOT = new URL('../../', import.meta.url);

/** A kit id is a file name stem of data/kits: lower case letters, digits and hyphens. */
function checkKitId(id: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`"${id}" is not a kit id (the name of a file in data/kits)`);
}

/** Where the scripted roster fixture of a kit is committed. */
export function fixtureUrl(id: string, root: URL = ROOT): URL {
  checkKitId(id);
  return new URL(`packages/sim/test/fixtures/scripted-roster-${id}-arena01-2v2.json`, root);
}

/** The raw JSON of data/kits/<id>.json, as the client hands it to `createMatch`, which validates it. */
export function loadKit(id: string, root: URL = ROOT): KitDef {
  checkKitId(id);
  const url = new URL(`data/kits/${id}.json`, root);
  if (!existsSync(url)) throw new Error(`no kit file data/kits/${id}.json`);
  return JSON.parse(readFileSync(url, 'utf8')) as KitDef;
}
