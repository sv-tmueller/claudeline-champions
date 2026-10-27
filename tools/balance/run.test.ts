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
  // 24 matches in a spawned process: 1.5 s locally (Apple M5 Pro, Node 22.23.2). The 60 s is the timeout
  // of the 48-match row this one replaced, kept: it reads HARNESS_KITS, so #189 re-times it at six kits
  // (120 matches) and applies the rule of testing.md, Check suite.
  it('writes the block of a 1-seed 2v2 run to --out and prints the wall time to stdout only', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'balance-'));
    try {
      const file = join(dir, 'report.md');
      const run = balance('--mode', '2v2', '--seeds', '1', '--out', file);
      expect(run.status, run.stderr).toBe(0);
      // Four kits: 6 pairings on 2 arenas, each with 2 fills and 1 seed.
      expect(run.stdout).toMatch(/played 24 matches in \d+\.\d s/);
      const text = readFileSync(file, 'utf8');
      expect(text.startsWith(`${REPORT_START}\n`)).toBe(true);
      expect(text.endsWith(`${REPORT_END}\n`)).toBe(true);
      expect(text.split('\n').filter((line) => /^\| 2v2 \|/.test(line))).toHaveLength(12);
      expect(text.split('\n').filter((line) => /^\| 3v3 \|/.test(line))).toHaveLength(0);
      expect(text).toContain('Seeds 1 to 1 for each config');
      expect(text).not.toMatch(/\d+\.\d s\b/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // 24 matches: 2.4 s locally, 5.3 s on the runner (ubuntu-latest, Node 22; unit job 122044371924). Twice
  // the runner time would be 11 s; the 60 s is kept as above, and at six kits it plays 360 matches (about
  // 32 s locally), so #189 re-times it or replaces the row.
  it('writes the block of a 1-seed 3v3 run to --out: 3v3 rows and no 2v2 row', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'balance-'));
    try {
      const file = join(dir, 'report.md');
      const run = balance('--mode', '3v3', '--seeds', '1', '--out', file);
      expect(run.status, run.stderr).toBe(0);
      // Four kits: 6 pairings on 2 arenas, each with 2 ordered fills and 1 seed.
      expect(run.stdout).toMatch(/played 24 matches in \d+\.\d s/);
      const lines = readFileSync(file, 'utf8').split('\n');
      expect(lines.filter((line) => /^\| 3v3 \|/.test(line))).toHaveLength(12);
      expect(lines.filter((line) => /^\| 2v2 \|/.test(line))).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('exits 1 with a message on an unknown flag, a bad --seeds, a bad --mode, --check with --out and --mode alone', () => {
    const bad = [
      ['--bogus'],
      ['--seeds', '0'],
      ['--seeds', 'x'],
      ['--check', '--out', 'x.md'],
      ['--mode'],
      ['--mode', '4v4'],
      ['--mode', '2V2', '--out', 'x.md'],
      // A single mode never writes the doc: it needs --out or --check.
      ['--mode', '2v2'],
      ['--mode', '3v3', '--seeds', '1'],
    ];
    for (const args of bad) {
      const run = balance(...args);
      expect(run.status, args.join(' ')).toBe(1);
      expect(run.stderr.length, args.join(' ')).toBeGreaterThan(0);
      expect(run.stdout, args.join(' ')).toBe('');
    }
  });
});
