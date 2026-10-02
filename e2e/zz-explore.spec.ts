// TEMPORARY exploration of the runner's bimodal onAnimationFrame figure. Removed before merge.
import { chromium, test, type Page, type CDPSession } from '@playwright/test';

const COMBAT_CODE =
  /^(entity-views|health-bars|impact-rings|champion-look|feedback|interpolate|debug-overlay|loop)\.ts:|^main\.ts:|^three\.module[^:]*:onAnimationFrame$/;

interface Node {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: Node[];
}

function combatBytes(root: Node): number {
  let total = 0;
  const pending = [root];
  for (let n = pending.pop(); n; n = pending.pop()) {
    const key = `${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.functionName}`;
    if (n.selfSize > 0 && COMBAT_CODE.test(key)) total += n.selfSize;
    pending.push(...n.children);
  }
  return total;
}

async function windowBytes(page: Page, cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 16,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await page.clock.runFor(480);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  return combatBytes(profile.head as Node);
}

const VARIANTS: Record<string, { flags: string[]; waitMs: number }> = {
  default: { flags: [], waitMs: 0 },
  noturbofan: { flags: ['--js-flags=--no-turbofan'], waitMs: 0 },
  wait: { flags: [], waitMs: 3000 },
};

for (const [name, variant] of Object.entries(VARIANTS)) {
  for (let repeat = 1; repeat <= 3; repeat++) {
    test.describe(`explore ${name} ${repeat}`, () => {
      test('probe', async () => {
        test.setTimeout(240_000);
        const browser = await chromium.launch({ args: variant.flags });
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const page = await context.newPage();
        await page.clock.install({ time: 0 });
        await page.goto('http://127.0.0.1:5173/');
        await page.waitForSelector('canvas[data-arena][data-tick]');
        await page.clock.pauseAt(60_000);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('HeapProfiler.enable');
        await page.setViewportSize({ width: 320, height: 180 });
        for (let volley = 0; volley < 8; volley++) {
          for (let shot = 0; shot < 8; shot++) await page.keyboard.press('F4');
          for (let w = 0; w < 6; w++) await page.clock.runFor(480);
        }
        for (let shot = 0; shot < 8; shot++) await page.keyboard.press('F4');
        await page.clock.runFor(480);
        if (variant.waitMs) await page.waitForTimeout(variant.waitMs);
        const figures: number[] = [];
        for (let w = 0; w < 3; w++) figures.push(await windowBytes(page, cdp));
        console.log(`EXPLORE ${name} ${repeat}: ${figures.join(' ')}`);
        await browser.close();
      });
    });
  }
}
