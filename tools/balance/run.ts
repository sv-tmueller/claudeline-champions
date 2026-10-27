import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MODES,
  modeLines,
  playCells,
  renderReport,
  reportBlock,
  sameModeReport,
  sameReport,
  seedSchedule,
  withReport,
  withoutHead,
} from './harness.ts';
import type { Mode, SeedSchedule } from './harness.ts';
import { loadInputs } from './inputs.ts';

// The balance CLI: `npm run balance [-- --seeds N] [--mode 2v2|3v3] [--out <file>] [--check]`.
//   (no flag)  plays every cell and writes the block of docs/design/balance.md.
//   --out FILE writes the block to FILE instead and touches no doc (for explorations).
//   --check    regenerates the block in memory and compares it with the committed one, except for
//              the head line; exit 1 on a difference.
//   --seeds N  plays the seeds 1 to N in every mode played, instead of the schedule: the largest
//              even number at or under 200 over the cell's fills, per mode (100 and 100 at four kits).
//   --mode M   plays the cells of one mode only (2v2 or 3v3). With --check it compares that mode's
//              cell rows and budget-hit lines only; without it, it needs --out, so a single mode
//              never writes the doc.
// The wall time goes to stdout only; nothing time- or platform-dependent goes into a file.

const ROOT = new URL('../../', import.meta.url);
const DOC = 'docs/design/balance.md';
/** What a written report reads: a change to any of these makes the committed block stale. */
const SOURCES = ['data', 'packages/sim/src', 'packages/bots/src', 'tools/balance'];

interface Options {
  /** The seeds of every mode played, instead of the schedule; null for the schedule. */
  seeds: number | null;
  mode: Mode | null;
  out: string | null;
  check: boolean;
}

function fail(problem: string): never {
  throw new Error(problem);
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = { seeds: null, mode: null, out: null, check: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--seeds') {
      const n = Number(args[++i]);
      if (!Number.isSafeInteger(n) || n < 1) fail('--seeds needs a positive integer');
      options.seeds = n;
    } else if (arg === '--mode') {
      const mode = MODES.find((m) => m === args[++i]);
      if (mode === undefined) fail(`--mode needs one of ${MODES.join(', ')}`);
      options.mode = mode;
    } else if (arg === '--out') {
      const file = args[++i];
      if (file === undefined || file.startsWith('--')) fail('--out needs a file');
      options.out = file;
    } else {
      fail(`unknown argument ${String(arg)}; usage: [--seeds N] [--mode 2v2|3v3] [--out <file>] [--check]`);
    }
  }
  if (options.check && options.out !== null) fail('--check and --out do not go together');
  if (options.mode !== null && !options.check && options.out === null) {
    fail('--mode plays one mode, which never writes the doc: add --out <file> or --check');
  }
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
  const planned = seedSchedule(inputs.kits.length);
  const schedule: SeedSchedule = {};
  for (const mode of MODES) {
    if (options.mode !== null && options.mode !== mode) continue;
    schedule[mode] = options.seeds ?? planned[mode];
  }
  const cells = playCells(inputs, schedule);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const report = renderReport({
    head: git('rev-parse', '--short', 'HEAD'),
    seeds: schedule,
    kitIds: inputs.kits.map((kit) => kit.id),
    cells,
  });
  console.log(`played ${cells.reduce((n, c) => n + c.played.length, 0)} matches in ${seconds} s`);

  if (options.check) {
    const committed = reportBlock(readFileSync(docPath, 'utf8'));
    if (committed === null) fail(`${DOC} has no balance:report block`);
    const mode = options.mode;
    if (mode === null ? sameReport(committed, report) : sameModeReport(committed, report, mode)) {
      console.log(
        mode === null
          ? `${DOC} reproduces (the head line is not compared)`
          : `${DOC} reproduces in ${mode} (its cell rows and budget-hit lines)`,
      );
      return;
    }
    const was = mode === null ? withoutHead(committed) : modeLines(committed, mode);
    const now = mode === null ? withoutHead(report) : modeLines(report, mode);
    let at = 0;
    while (at < Math.max(was.length, now.length) && was[at] === now[at]) at++;
    fail(
      `${DOC} differs from a fresh run at line ${at + 1} of ${
        mode === null ? 'the block (the head line left out)' : `the ${mode} rows (cell rows and budget-hit lines)`
      }:\n` +
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
