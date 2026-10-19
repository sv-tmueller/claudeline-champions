import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixtureUrl, loadKit } from './files.ts';
import { formatFixture } from './format.ts';
import { DEFAULT_MAX_ATTEMPTS, searchFixture } from './search.ts';

// The fixture search CLI: `npm run fixtures:search -- <kit> [--out <file>] [--max-attempts N]`.
// It searches the scripted roster fixture of data/kits/<kit>.json (attempts 1, 2, 3 and so on of
// the seeded random player, the first that covers everything the roster fixture test requires,
// replayed for the checkpoints) and writes it in the committed layout, by default to
// packages/sim/test/fixtures/scripted-roster-<kit>-arena01-2v2.json. It exits 1 and writes nothing
// when the first covering attempt has an oracle problem (a drop for the tuning rules) or when no
// attempt within --max-attempts covers (default 1000). The wall time goes to stdout only; nothing
// time- or platform-dependent goes into the file.

const USAGE = 'usage: npm run fixtures:search -- <kit> [--out <file>] [--max-attempts N]';

interface Options {
  kit: string;
  out: string | null;
  maxAttempts: number;
}

function fail(problem: string): never {
  throw new Error(problem);
}

function parseArgs(args: readonly string[]): Options {
  let kit: string | null = null;
  let out: string | null = null;
  let maxAttempts = DEFAULT_MAX_ATTEMPTS;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--out') {
      const file = args[++i];
      if (file === undefined || file.startsWith('--')) fail(`--out needs a file; ${USAGE}`);
      out = file;
    } else if (arg === '--max-attempts') {
      const n = Number(args[++i]);
      if (!Number.isSafeInteger(n) || n < 1) fail(`--max-attempts needs a positive integer; ${USAGE}`);
      maxAttempts = n;
    } else if (arg.startsWith('--')) {
      fail(`unknown argument ${arg}; ${USAGE}`);
    } else if (kit === null) {
      kit = arg;
    } else {
      fail(`one kit at a time, got ${kit} and ${arg}; ${USAGE}`);
    }
  }
  if (kit === null) fail(`no kit given; ${USAGE}`);
  return { kit, out, maxAttempts };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const kit = loadKit(options.kit);
  const started = performance.now();
  const outcome = searchFixture(kit, { maxAttempts: options.maxAttempts });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (!outcome.ok && outcome.reason === 'oracle') {
    const shown = outcome.problems.slice(0, 5).map((problem) => `\n  ${problem}`);
    const more = outcome.problems.length > 5 ? `\n  (${outcome.problems.length - 5} more)` : '';
    fail(
      `${options.kit}: attempt ${outcome.attempt} covers everything but has ${outcome.problems.length} oracle ` +
        `problem(s), so the candidate is dropped and nothing is written; the first:${shown.join('')}${more}`,
    );
  }
  if (!outcome.ok) {
    const best = outcome.best;
    fail(
      `${options.kit}: no attempt of ${outcome.attempts} covers everything; ` +
        (best === null
          ? 'none was tried'
          : `attempt ${best.attempt} missed the fewest: ${best.missing.join(', ')}`),
    );
  }
  const path = options.out ?? fileURLToPath(fixtureUrl(options.kit));
  writeFileSync(path, formatFixture(outcome.fixture));
  console.log(`${options.kit}: attempt ${outcome.attempt}`);
  console.log(`wrote ${path} in ${seconds} s`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
