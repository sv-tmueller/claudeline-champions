import { defineConfig } from 'vitest/config';
import { SlowFirstSequencer } from './tests/vitest-sequencer.ts';

// Includes are scoped per project so Vitest never picks up e2e/**/*.spec.ts.
export default defineConfig({
  test: {
    // Starts the slow files first (tests/vitest-sequencer.ts).
    sequence: { sequencer: SlowFirstSequencer },
    projects: [
      {
        test: {
          name: 'sim',
          environment: 'node',
          include: ['packages/sim/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'bots',
          environment: 'node',
          include: ['packages/bots/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'protocol',
          environment: 'node',
          include: ['packages/protocol/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['packages/server/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'client',
          environment: 'node',
          include: ['packages/client/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'tools',
          environment: 'node',
          include: ['tools/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'repo',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
    ],
  },
});
