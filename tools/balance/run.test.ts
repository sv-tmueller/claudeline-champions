import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPORT_END, REPORT_START } from './harness.ts';

// The CLI as `npm run balance` runs it: Node's own type stripping and the resolve hook of
// register.ts, which need Node 22.15 or later (the hook's own check says so below that).
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const HAS_HOOKS = major > 22 || (major === 22 && minor >= 15);

function balance(...args: string[]) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', './tools/balance/register.ts', 'tools/balance/run.ts', ...args],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

describe.skipIf(!HAS_HOOKS)('the balance CLI', () => {
  it('writes the block of a 1-seed run to --out and prints the wall time to stdout only', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'balance-'));
    try {
      const file = join(dir, 'report.md');
      const run = balance('--seeds', '1', '--out', file);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toMatch(/played 36 matches in \d+\.\d s/);
      const text = readFileSync(file, 'utf8');
      expect(text.startsWith(`${REPORT_START}\n`)).toBe(true);
      expect(text.endsWith(`${REPORT_END}\n`)).toBe(true);
      expect(text.split('\n').filter((line) => /^\| [23]v[23] \|/.test(line))).toHaveLength(24);
      expect(text).not.toMatch(/\d+\.\d s\b/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('exits 1 with a message on an unknown flag, on a bad --seeds and on --check with --out', () => {
    for (const args of [['--bogus'], ['--seeds', '0'], ['--seeds', 'x'], ['--check', '--out', 'x.md']]) {
      const run = balance(...args);
      expect(run.status, args.join(' ')).toBe(1);
      expect(run.stderr.length, args.join(' ')).toBeGreaterThan(0);
      expect(run.stdout, args.join(' ')).toBe('');
    }
  });
});
