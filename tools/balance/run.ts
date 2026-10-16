import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playCells, renderReport, reportBlock, sameReport, withReport, withoutHead } from './harness.ts';
import { loadInputs } from './inputs.ts';

// The balance CLI: `npm run balance [-- --seeds N] [--out <file>] [--check]`.
//   (no flag)  plays every cell and writes the block of docs/design/balance.md.
//   --out FILE writes the block to FILE instead and touches no doc (for explorations).
//   --check    regenerates the block in memory and compares it with the committed one, except for
//              the head line; exit 1 on a difference.
//   --seeds N  plays the seeds 1 to N (default 100).
// The wall time goes to stdout only; nothing time- or platform-dependent goes into a file.

const ROOT = new URL('../../', import.meta.url);
const DOC = 'docs/design/balance.md';
/** What a written report reads: a change to any of these makes the committed block stale. */
const SOURCES = ['data', 'packages/sim/src', 'packages/bots/src', 'tools/balance'];

interface Options {
  seeds: number;
  out: string | null;
  check: boolean;
}

function fail(problem: string): never {
  throw new Error(problem);
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = { seeds: 100, out: null, check: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--seeds') {
      const n = Number(args[++i]);
      if (!Number.isSafeInteger(n) || n < 1) fail('--seeds needs a positive integer');
      options.seeds = n;
    } else if (arg === '--out') {
      const file = args[++i];
      if (file === undefined || file.startsWith('--')) fail('--out needs a file');
      options.out = file;
    } else {
      fail(`unknown argument ${String(arg)}; usage: [--seeds N] [--out <file>] [--check]`);
    }
  }
  if (options.check && options.out !== null) fail('--check and --out do not go together');
  return options;
}

function git(...args: string[]): string {
  return execFileSync('git', ['-C', fileURLToPath(ROOT), ...args], { encoding: 'utf8' }).trim();
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const docPath = fileURLToPath(new URL(DOC, ROOT));
  if (!options.check && options.out === null) {
    const dirty = git('status', '--porcelain', '--', ...SOURCES);
    if (dirty !== '') {
      fail(
        `refusing to write ${DOC}: these differ from HEAD, so the head line would lie ` +
          `(use --out to explore)\n${dirty}`,
      );
    }
  }
  const inputs = loadInputs(ROOT);
  const started = performance.now();
  const cells = playCells(inputs, options.seeds);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const report = renderReport({
    head: git('rev-parse', '--short', 'HEAD'),
    seeds: options.seeds,
    kitIds: inputs.kits.map((kit) => kit.id),
    cells,
  });
  console.log(`played ${cells.reduce((n, c) => n + c.played.length, 0)} matches in ${seconds} s`);

  if (options.check) {
    const committed = reportBlock(readFileSync(docPath, 'utf8'));
    if (committed === null) fail(`${DOC} has no balance:report block`);
    if (sameReport(committed, report)) {
      console.log(`${DOC} reproduces (the head line is not compared)`);
      return;
    }
    const was = withoutHead(committed);
    const now = withoutHead(report);
    let at = 0;
    while (at < Math.max(was.length, now.length) && was[at] === now[at]) at++;
    fail(
      `${DOC} differs from a fresh run at line ${at + 1} of the block (the head line left out):\n` +
        `  committed: ${was[at] ?? '(end of block)'}\n  fresh:     ${now[at] ?? '(end of block)'}`,
    );
  }
  if (options.out !== null) {
    writeFileSync(options.out, `${report}\n`);
    console.log(`wrote ${options.out}`);
    return;
  }
  writeFileSync(docPath, withReport(readFileSync(docPath, 'utf8'), report));
  console.log(`wrote the block of ${DOC}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
