import { expect, test } from '@playwright/test';
import { countPixels, orFail, watchProblems } from './support';

test('the client renders the arena and the F3 overlay, and writes two screenshots', async ({ page }, testInfo) => {
  const { problems, failed } = watchProblems(page);

  try {
    await page.goto('/');
    await orFail(page.waitForSelector('canvas[data-arena="arena01"]'), failed);

    const arena = await page.screenshot({ path: testInfo.outputPath('arena.png') });
    const plain = await countPixels(page, arena, []);
    expect(plain.distinctColours).toBeGreaterThan(16);
    expect(plain.overlayPixels).toBe(0);

    await page.keyboard.press('F3');
    await orFail(page.waitForSelector('canvas[data-overlay="on"]'), failed);

    const overlay = await page.screenshot({ path: testInfo.outputPath('arena-overlay.png') });
    const outlined = await countPixels(page, overlay, []);
    expect(outlined.overlayPixels).toBeGreaterThan(200);
  } finally {
    expect(problems).toEqual([]);
  }
});

test('data-arena is set only after the arena is drawn', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  // No frame callback ever runs, so only the draw before the hook can put the
  // arena on the canvas.
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
  });
  // The arena model is held back, so a hook set before the load finishes shows
  // up as a data-arena attribute while the model is still missing.
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/models/arenas/arena01.glb', async (route) => {
    await released;
    await route.continue();
  });

  try {
    await page.goto('/');
    await orFail(page.waitForSelector('canvas[data-rendered="true"]'), failed);
    expect(await page.locator('canvas').getAttribute('data-arena')).toBeNull();
    release();
    await orFail(page.waitForSelector('canvas[data-arena="arena01"]'), failed);
    expect(await page.locator('canvas').getAttribute('data-tick')).toBe('0');

    const first = await page.screenshot();
    expect((await countPixels(page, first, [])).distinctColours).toBeGreaterThan(16);
  } finally {
    release();
    expect(problems).toEqual([]);
  }
});
