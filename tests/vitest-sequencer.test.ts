import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification, Vitest } from 'vitest/node';
import config from '../vitest.config';
import { SLOW_FIRST, SlowFirstSequencer } from './vitest-sequencer';

// The sequencer starts the slow files first so no Vitest worker is left idle
// at the end of the run (#285, docs/architecture/testing.md, Check suite).

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// The two things sort() reads from a spec and from the Vitest context: enough
// of both for BaseSequencer.sort to run with no cache entries.
function spec(project: string, file: string): TestSpecification {
  return {
    moduleId: resolve(ROOT, file),
    project: { name: project, config: { isolate: true, sequence: { groupOrder: 0 } } },
  } as unknown as TestSpecification;
}

const context = {
  config: { root: ROOT },
  cache: { getFileTestResults: () => undefined, getFileStats: () => undefined },
} as unknown as Vitest;

function relativePaths(specs: TestSpecification[]): string[] {
  return specs.map((s) => s.moduleId.slice(ROOT.length + 1));
}

describe('SLOW_FIRST', () => {
  it('lists only files that exist, so a rename cannot drop one back to the end', () => {
    const missing = SLOW_FIRST.filter((file) => !existsSync(resolve(ROOT, file)));
    expect(missing).toEqual([]);
  });

  it('lists each file once, with forward slashes', () => {
    expect(new Set(SLOW_FIRST).size).toBe(SLOW_FIRST.length);
    expect(SLOW_FIRST.filter((file) => file.includes('\\'))).toEqual([]);
  });

  it('starts with the bots heap check, which has always run first', () => {
    expect(SLOW_FIRST[0]).toBe('packages/bots/test/allocation.test.ts');
  });
});

describe('SlowFirstSequencer', () => {
  const others = [
    spec('client', 'packages/client/src/camera.test.ts'),
    spec('bots', 'packages/bots/test/aim.test.ts'),
    spec('sim', 'packages/sim/test/area.test.ts'),
    spec('tools', 'tools/fixtures/format.test.ts'),
  ];
  const listed = SLOW_FIRST.map((file) => spec('x', file));

  it('puts the listed files first, in list order, whatever order they arrive in', async () => {
    const arrival = [...others.slice(0, 2), ...[...listed].reverse(), ...others.slice(2)];
    const sorted = await new SlowFirstSequencer(context).sort(arrival);
    expect(relativePaths(sorted).slice(0, SLOW_FIRST.length)).toEqual([...SLOW_FIRST]);
  });

  it('leaves every other file in the order the default sequencer gives', async () => {
    const arrival = [...others, ...listed];
    const sorted = await new SlowFirstSequencer(context).sort(arrival);
    const rest = relativePaths(sorted).slice(SLOW_FIRST.length);
    const byDefault = relativePaths(await new BaseSequencer(context).sort(others));
    expect(rest).toEqual(byDefault);
  });

  it('drops and adds no file', async () => {
    const arrival = [...others, ...listed];
    const sorted = await new SlowFirstSequencer(context).sort(arrival);
    expect(relativePaths(sorted).sort()).toEqual(relativePaths(arrival).sort());
  });
});

describe('vitest.config.ts', () => {
  it('registers the sequencer for the whole run', () => {
    expect(config.test?.sequence?.sequencer).toBe(SlowFirstSequencer);
  });
});
