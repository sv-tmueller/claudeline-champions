import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixtureUrl } from './files.ts';

// The CLI as `npm run fixtures:search` runs it: Node's own type stripping, the resolve hooks of
// register.ts (which need Node 22.15 or later) and vitest's `expect` outside the runner, which the
// shared oracle uses.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const HAS_HOOKS = major > 22 || (major === 22 && minor >= 15);

function search(...args: string[]) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', './tools/fixtures/register.ts', 'tools/fixtures/run.ts', ...args],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

describe.skipIf(!HAS_HOOKS)('the fixture search CLI', () => {
  it('writes the committed Hargrim fixture to --out and prints the attempt and the wall time to stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
    try {
      const file = join(dir, 'hargrim.json');
      const run = search('hargrim', '--out', file);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toMatch(/^hargrim: attempt 1\n/);
      expect(run.stdout).toMatch(/wrote .*hargrim\.json in \d+\.\d s\n$/);
      expect(readFileSync(file, 'utf8')).toBe(readFileSync(fixtureUrl('hargrim'), 'utf8'));
      expect(readFileSync(file, 'utf8')).not.toMatch(/\d+\.\d s\b/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('exits 1 with a message and writes nothing when no attempt within --max-attempts covers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
    try {
      const file = join(dir, 'quillon.json');
      const run = search('quillon', '--out', file, '--max-attempts', '3');
      expect(run.status).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/quillon: no attempt of 3 covers everything; attempt \d missed the fewest: /);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('exits 1 with a message and an empty stdout on a missing kit, an unknown kit and bad arguments', () => {
    for (const args of [
      [],
      ['nobody'],
      ['hargrim', '--max-attempts', '0'],
      ['hargrim', '--max-attempts', 'x'],
      ['hargrim', '--out'],
      ['hargrim', '--bogus'],
      ['hargrim', 'quillon'],
    ]) {
      const run = search(...args);
      expect(run.status, args.join(' ')).toBe(1);
      expect(run.stderr.length, args.join(' ')).toBeGreaterThan(0);
      expect(run.stdout, args.join(' ')).toBe('');
    }
  });
});
