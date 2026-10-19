import type { Page } from '@playwright/test';

/**
 * The address the pre-match select's Start writes for its defaults (Hargrim, normal, arena01,
 * 2v2). A bare `/` opens the select, so a spec that wants the default match enters here: the
 * launch is the same one, so the match, the bots, the seeds and the ticks are too.
 */
export const DEFAULT_MATCH = '/?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2';

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

/** An inclusive RGB box. A pixel matches when each channel is inside it. */
export interface ColourRange {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface PixelCounts {
  distinctColours: number;
  /** Pixels of the magenta debug overlay: red and blue both more than 50 above green. */
  overlayPixels: number;
  /** One count per range, in the order given. */
  matches: number[];
}

/** A box of `tolerance` around a colour, clamped to the byte range. */
export function colourNear(rgb: readonly [number, number, number], tolerance: number): ColourRange {
  const clamp = (v: number): number => Math.min(255, Math.max(0, v));
  return {
    min: [clamp(rgb[0] - tolerance), clamp(rgb[1] - tolerance), clamp(rgb[2] - tolerance)],
    max: [clamp(rgb[0] + tolerance), clamp(rgb[1] + tolerance), clamp(rgb[2] + tolerance)],
  };
}

/**
 * Decodes a PNG in the page, so the test needs no image library, and counts
 * the distinct colours, the magenta overlay pixels and the pixels inside each
 * colour range.
 */
export async function countPixels(
  page: Page,
  png: Buffer,
  ranges: readonly ColourRange[],
): Promise<PixelCounts> {
  return page.evaluate(
    async ({ base64, boxes }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const colours = new Set<number>();
      const matches = boxes.map(() => 0);
      let overlayPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        colours.add((r << 16) | (g << 8) | b);
        if (r - g > 50 && b - g > 50) overlayPixels++;
        for (let k = 0; k < boxes.length; k++) {
          const box = boxes[k];
          if (!box) continue;
          if (
            r >= box.min[0] && r <= box.max[0] &&
            g >= box.min[1] && g <= box.max[1] &&
            b >= box.min[2] && b <= box.max[2]
          ) {
            matches[k] = (matches[k] ?? 0) + 1;
          }
        }
      }
      return { distinctColours: colours.size, overlayPixels, matches };
    },
    { base64: png.toString('base64'), boxes: ranges },
  );
}

/**
 * Waits for the match phase hook, `data-phase` on the canvas. The sim's phase
 * strings: warmup, round, roundEnd and matchEnd. Rejects as soon as a page
 * problem is reported.
 */
export async function waitForPhase(page: Page, phase: string, failed: Problems['failed']): Promise<void> {
  await orFail(page.waitForSelector(`canvas[data-phase="${phase}"]`), failed);
}
