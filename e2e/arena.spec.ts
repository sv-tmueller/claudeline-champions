import { expect, test, type Page } from '@playwright/test';
import { orFail, watchProblems } from './support';

interface PixelStats {
  distinctColours: number;
  overlayPixels: number;
}

// Decodes the PNG in the page, so the test needs no image library.
async function pixelStats(page: Page, png: Buffer): Promise<PixelStats> {
  return page.evaluate(async (base64) => {
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
    let overlayPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      colours.add((r << 16) | (g << 8) | b);
      // Magenta overlay: red and blue both well above green.
      if (r - g > 50 && b - g > 50) overlayPixels++;
    }
    return { distinctColours: colours.size, overlayPixels };
  }, png.toString('base64'));
}

test('the client renders the arena and the F3 overlay, and writes two screenshots', async ({ page }, testInfo) => {
  const { problems, failed } = watchProblems(page);

  try {
    await page.goto('/');
    await orFail(page.waitForSelector('canvas[data-arena="arena01"]'), failed);

    const arena = await page.screenshot({ path: testInfo.outputPath('arena.png') });
    const plain = await pixelStats(page, arena);
    expect(plain.distinctColours).toBeGreaterThan(16);
    expect(plain.overlayPixels).toBe(0);

    await page.keyboard.press('F3');
    await orFail(page.waitForSelector('canvas[data-overlay="on"]'), failed);

    const overlay = await page.screenshot({ path: testInfo.outputPath('arena-overlay.png') });
    const outlined = await pixelStats(page, overlay);
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
    expect((await pixelStats(page, first)).distinctColours).toBeGreaterThan(16);
  } finally {
    release();
    expect(problems).toEqual([]);
  }
});
