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
// The Maglev project runs with `--no-concurrent-recompilation`. V8 optimises a hot function on a
// background thread and installs the code when the job is done, so which code a window of the test
// measures depends on how long the job took. On a busy machine that read 480 B in a block of 15
// thinks (32 B a think) and 32 B a think after the move to -0 in some runs of a clean tree and not
// in others; compiled on the calling thread, the same tree reads the same figures in every run.
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
          execArgv: ['--maglev', '--no-turbofan', '--no-concurrent-recompilation'],
          env: { BOTS_HEAP_TIER: 'maglev' },
          testTimeout: 60000,
        },
      },
    ],
  },
});
