import { expect, test } from '@playwright/test';
import { orFail, watchProblems } from './support';

test('renders the scene', async ({ page }, testInfo) => {
  // The assertion sits in finally so the collected errors are reported even
  // when the canvas never renders and the wait fails.
  const { problems, failed } = watchProblems(page);

  try {
    await page.goto('/');
    await orFail(page.waitForSelector('canvas[data-rendered="true"]'), failed);

    await expect(page.locator('#hud')).toBeAttached();
    await expect(page.locator('#hud')).toBeEmpty();

    await page.screenshot({ path: testInfo.outputPath('scene.png') });
  } finally {
    expect(problems).toEqual([]);
  }
});
