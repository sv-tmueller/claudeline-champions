import { relative } from 'node:path';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

// The unit files that run longest, slowest first, so a Vitest worker never
// starts a two-minute file near the end of the run while the others sit idle
// (#285). Vitest's default order groups files by project name, so the `tools`
// project would start last. The list is every file that took 10 s or more in
// the unit job of main's PR #288 (job 132439224766), except that the bots heap
// check goes first: it has always run first, and its readings depend on the
// load around it (#290). A file that passes 10 s on a slow runner is added at
// its place. docs/architecture/testing.md, Check suite, has the rule.
export const SLOW_FIRST: readonly string[] = [
  'packages/bots/test/allocation.test.ts',
  'packages/bots/test/durnhal.test.ts',
  'packages/bots/test/ondrel.test.ts',
  'tools/balance/harness.test.ts',
  'tools/balance/run.test.ts',
  'packages/client/src/clip-sampler.test.ts',
  'packages/bots/test/lumeth.test.ts',
  'packages/bots/test/brimwick.test.ts',
  'packages/bots/test/headless-kits.test.ts',
  'packages/bots/test/orb-match.test.ts',
  'packages/server/test/loopback.test.ts',
  'packages/bots/test/wrenna.test.ts',
  'tools/fixtures/reproduce.test.ts',
  'packages/sim/test/roster-fixtures.test.ts',
];

// Vitest's own order, with the files on SLOW_FIRST moved to the front in list
// order. Only the order changes: no file is added, dropped or skipped.
export class SlowFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const rank = (spec: TestSpecification): number => {
      const path = relative(this.ctx.config.root, spec.moduleId).split('\\').join('/');
      const at = SLOW_FIRST.indexOf(path);
      return at === -1 ? SLOW_FIRST.length : at;
    };
    // Array.prototype.sort is stable, so the files off the list keep Vitest's order.
    return [...sorted].sort((a, b) => rank(a) - rank(b));
  }
}
