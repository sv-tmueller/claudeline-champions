import { expect, test } from '@playwright/test';

test('the client renders the ground plane and writes a screenshot', async ({ page }, testInfo) => {
  // A missing WebGL context shows up as a console error or page error here,
  // so the test fails instead of saving a blank screenshot. The assertion sits
  // in finally so the collected errors are reported even when the canvas never
  // renders and the wait times out.
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });

  try {
    await page.goto('/');
    await page.waitForSelector('canvas[data-rendered="true"]');

    await expect(page.locator('#hud')).toBeAttached();
    await expect(page.locator('#hud')).toBeEmpty();

    await page.screenshot({ path: testInfo.outputPath('ground-plane.png') });
  } finally {
    expect(problems).toEqual([]);
  }
});
