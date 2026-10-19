import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HARNESS_KITS, loadInputs } from './inputs.ts';

const ROOT = new URL('../../', import.meta.url);

describe('the harness roster', () => {
  it('plays the four v1 kits, whatever else data/kits holds', () => {
    expect(HARNESS_KITS).toEqual(['hargrim', 'lumeth', 'quillon', 'skerrow']);
    const files = readdirSync(fileURLToPath(new URL('data/kits/', ROOT))).filter((n) => n.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(HARNESS_KITS.length);
    for (const id of HARNESS_KITS) expect(files).toContain(`${id}.json`);
    expect(loadInputs(ROOT).kits.map((kit) => kit.id)).toEqual([...HARNESS_KITS]);
  });

  it('throws on a listed kit with no file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inputs-'));
    try {
      mkdirSync(join(dir, 'data', 'kits'), { recursive: true });
      mkdirSync(join(dir, 'data', 'arenas'), { recursive: true });
      for (const id of HARNESS_KITS.slice(0, 3)) {
        cpSync(fileURLToPath(new URL(`data/kits/${id}.json`, ROOT)), join(dir, 'data', 'kits', `${id}.json`));
      }
      const root = pathToFileURL(`${dir}/`);
      expect(() => loadInputs(root)).toThrow(/skerrow/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
