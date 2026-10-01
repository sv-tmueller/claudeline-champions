import type { Page } from '@playwright/test';

export interface Problems {
  /** Every page error and console error seen so far, for the final assertion. */
  problems: string[];
  /** Rejects on the first problem, so a waiting test reports it at once. */
  failed: Promise<never>;
}

/**
 * Collects page errors and console errors. A missing WebGL context or a failed
 * model load shows up here, so the test fails with that message instead of a
 * timeout on a wait that can never finish.
 */
export function watchProblems(page: Page): Problems {
  const problems: string[] = [];
  const failed = new Promise<never>((_resolve, reject) => {
    const report = (problem: string): void => {
      problems.push(problem);
      reject(new Error(problem));
    };
    page.on('pageerror', (error) => report(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') report(`console: ${message.text()}`);
    });
  });
  // Nobody may be awaiting `failed` when it rejects, which would be an unhandled rejection.
  failed.catch(() => {});
  return { problems, failed };
}

/** Resolves with `wait`, or rejects as soon as a page problem is reported. */
export function orFail<T>(wait: Promise<T>, failed: Promise<never>): Promise<T> {
  // If `failed` wins the race, `wait` may still reject later, when the page closes.
  wait.catch(() => {});
  return Promise.race([wait, failed]);
}
