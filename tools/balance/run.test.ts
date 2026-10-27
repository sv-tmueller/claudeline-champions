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
  // 120 matches in a spawned process (six kits: 15 pairings on 2 arenas, 4 fills, 1 seed): 6.6 s locally
  // (Apple M5 Pro, Node 22.23.2); 23.6 s on the runner (ubuntu-latest, Node 22; unit job 122091170207).
  // Twice that is 47 s, so the 60 s of the 48-match row this one replaced stands (testing.md, Check suite).
  it('writes the block of a 1-seed 2v2 run to --out and prints the wall time to stdout only', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'balance-'));
    try {
      const file = join(dir, 'report.md');
      const run = balance('--mode', '2v2', '--seeds', '1', '--out', file);
      expect(run.status, run.stderr).toBe(0);
      // Six kits: 15 pairings on 2 arenas, each with 4 fills and 1 seed.
      expect(run.stdout).toMatch(/played 120 matches in \d+\.\d s/);
      const text = readFileSync(file, 'utf8');
      expect(text.startsWith(`${REPORT_START}\n`)).toBe(true);
      expect(text.endsWith(`${REPORT_END}\n`)).toBe(true);
      expect(text.split('\n').filter((line) => /^\| 2v2 \|/.test(line))).toHaveLength(30);
      expect(text.split('\n').filter((line) => /^\| 3v3 \|/.test(line))).toHaveLength(0);
      expect(text).toContain('Seeds 1 to 1 for each config');
      expect(text).not.toMatch(/\d+\.\d s\b/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // The message is pinned, not only the exit code: a parser that rejects `--mode 3v3` fails with "--mode needs
  // one of" and never reaches the last two rows' "never writes the doc", which only a parsed mode gets (the
  // regression of #195, where `--mode 3v3` was always rejected, and which the 3v3 CLI row at 360 matches pinned).
  it('exits 1 with the message of the rule broken, and with no output on stdout', () => {
    const bad: [string[], RegExp][] = [
      [['--bogus'], /unknown argument --bogus/],
      [['--seeds', '0'], /--seeds needs a positive integer/],
      [['--seeds', 'x'], /--seeds needs a positive integer/],
      [['--check', '--out', 'x.md'], /--check and --out do not go together/],
      [['--mode'], /--mode needs one of 2v2, 3v3/],
      [['--mode', '4v4'], /--mode needs one of 2v2, 3v3/],
      [['--mode', '2V2', '--out', 'x.md'], /--mode needs one of 2v2, 3v3/],
      // A single mode never writes the doc: it needs --out or --check.
      [['--mode', '2v2'], /never writes the doc: add --out <file> or --check/],
      [['--mode', '2v2', '--seeds', '1'], /never writes the doc: add --out <file> or --check/],
      [['--mode', '3v3', '--seeds', '1'], /never writes the doc: add --out <file> or --check/],
    ];
    for (const [args, message] of bad) {
      const run = balance(...args);
      expect(run.status, args.join(' ')).toBe(1);
      expect(run.stderr, args.join(' ')).toMatch(message);
      expect(run.stdout, args.join(' ')).toBe('');
    }
  });
});
