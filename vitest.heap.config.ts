import { defineConfig } from 'vitest/config';

// The bots' heap check (packages/bots/test/allocation.test.ts) in the two tiers it needs: V8's
// default tiers, and Maglev alone. V8 flags apply per process, and Vitest's command line cannot
// pass them, so the Maglev project is its own forks pool with its own execArgv. The workers run
// the node of the parent: run this config with the Node the Maglev limits were measured on
// (26.7.0, V8 14.6; see packages/bots/test/allocation.test.ts and docs/architecture/bots.md).
//
//   npx vitest run --config vitest.heap.config.ts
//   npx vitest run --config vitest.heap.config.ts --project bots-heap
//
// The Maglev project runs with `--no-concurrent-recompilation --no-use-osr`. V8 optimises a hot
// function on a background thread and installs the code when the job is done, and replaces a hot
// loop of the test on the stack (OSR) with code that has `think` inlined, so which code a window of
// the test measures can depend on timing. On a busy machine that read 480 B in a block of 15 thinks
// (32 B a think) and 32 B a think after the move to -0 in some runs of a clean tree and not in
// others (six copies in parallel: 4 of 18 and 15 of 36 tests red), and once in about twenty runs
// on the runner, with --no-concurrent-recompilation alone. Compiled on the calling thread and
// without OSR the same tree read the same figures in every run (0 of 27 copies red locally, 5 of 5
// runs of the job green on the runner). That timing is the likely cause and not a proven one
// (Rosetta and Docker did not reproduce the runner, a hardware difference is not excluded). The
// browser keeps both on, so this project measures what Maglev's code boxes and not how the browser
// tiers the bots up: that is the live probe's job.
//
// The Maglev project needs Node 26: on Node 22 its guard and its checks fail on V8 12.4, so the
// whole config is red there by design, and the Node 22 command is `--project bots-heap`.
//
// `npm run test` runs the default tier in the `bots` project of vitest.config.ts as well.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'bots-heap',
          environment: 'node',
          include: ['packages/bots/test/allocation.test.ts'],
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: 'bots-heap-maglev',
          environment: 'node',
          include: ['packages/bots/test/allocation.test.ts'],
          pool: 'forks',
          execArgv: ['--maglev', '--no-turbofan', '--no-concurrent-recompilation', '--no-use-osr'],
          env: { BOTS_HEAP_TIER: 'maglev' },
          testTimeout: 60000,
        },
      },
    ],
  },
});
