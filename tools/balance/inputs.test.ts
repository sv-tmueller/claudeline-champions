import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HARNESS_KITS, loadInputs } from './inputs.ts';

const ROOT = new URL('../../', import.meta.url);

describe('the harness roster', () => {
  it('plays the listed kits of data/kits, in file order, and leaves out the kits not yet joined', () => {
    expect(HARNESS_KITS).toEqual([
      'brimwick',
      'durnhal',
      'hargrim',
      'lumeth',
      'ondrel',
      'quillon',
      'skerrow',
      'wrenna',
    ]);
    const files = readdirSync(fileURLToPath(new URL('data/kits/', ROOT))).filter((n) => n.endsWith('.json'));
    expect(files).toContain('durnhal.json');
    expect(files).toContain('wrenna.json');
    for (const id of HARNESS_KITS) expect(files).toContain(`${id}.json`);
    // A kit joins the harness in its own step, so the files outside the list are exactly the kits
    // built ahead of it. Wrenna joined in step 3.4 of the roster-v3 build order (v3 spec 9.3), so
    // none is left outside the list; Ysmeer's file will be the next one, and this line then names it.
    const unlisted = files.map((n) => n.replace(/\.json$/, '')).filter((id) => !HARNESS_KITS.includes(id));
    expect(unlisted).toEqual([]);
    expect(loadInputs(ROOT).kits.map((kit) => kit.id)).toEqual([...HARNESS_KITS]);
  });

  it('loads the orb point of every arena from data/orbs.json', () => {
    const { orbs } = loadInputs(ROOT);
    expect([...orbs.keys()].sort()).toEqual(['arena01', 'arena02', 'arena03']);
    expect(orbs.get('arena01')).toEqual({ x: 0, y: 2.5 });
    expect(orbs.get('arena02')).toEqual({ x: 0, y: 0 });
    expect(orbs.get('arena03')).toEqual({ x: 0, y: 2.5 });
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
      expect(() => loadInputs(root)).toThrow(new Error('the harness kit lumeth has no file in data/kits'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
