import { expect, test, type Page } from '@playwright/test';
import { orFail, watchProblems, type Problems } from './support';

// The sim state the canvas exposes: tick, champion 0 position in cm and facing.
interface Sim {
  tick: number;
  x: number;
  y: number;
  facing: number;
}

const START_X = -1200;
const START_Y = 200;
// 5.5 m/s at 60 ticks per second, in centimeters per tick.
const CM_PER_TICK = 550 / 60;

async function readSim(page: Page): Promise<Sim> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const [x, y] = (canvas.dataset['p0'] ?? '').split(',').map(Number);
    return {
      tick: Number(canvas.dataset['tick']),
      x: x ?? NaN,
      y: y ?? NaN,
      facing: Number(canvas.dataset['f0']),
    };
  });
}

async function waitForTick(page: Page, tick: number, failed: Problems['failed']): Promise<void> {
  await orFail(
    page.waitForFunction(
      (target) => Number(document.querySelector('canvas')?.dataset['tick']) >= target,
      tick,
    ),
    failed,
  );
}

/** Opens the page, waits for the first ticks and checks the spawn state. */
async function openMatch(page: Page, failed: Problems['failed']): Promise<Sim> {
  await page.goto('/');
  await orFail(page.waitForSelector('canvas[data-arena="arena01"][data-tick]'), failed);
  await waitForTick(page, 2, failed);
  const start = await readSim(page);
  expect([start.x, start.y]).toEqual([START_X, START_Y]);
  expect(start.facing).toBe(0);
  return start;
}

test('walks east at 5.5 m/s while D is held and stops on release', async ({ page }, testInfo) => {
  const { problems, failed } = watchProblems(page);
  try {
    await openMatch(page, failed);

    await page.keyboard.down('KeyD');
    const pressed = await readSim(page);
    // Two ticks give the key event a frame to reach the sampled input.
    await waitForTick(page, pressed.tick + 2, failed);
    const a = await readSim(page);
    await waitForTick(page, a.tick + 30, failed);
    const b = await readSim(page);
    await page.keyboard.up('KeyD');
    await waitForTick(page, b.tick + 2, failed);
    const c = await readSim(page);
    await waitForTick(page, c.tick + 5, failed);
    const d = await readSim(page);

    // Exact sim speed between two reads, within the 1 cm rounding of the hook.
    expect(Math.abs(b.x - a.x - (b.tick - a.tick) * CM_PER_TICK)).toBeLessThanOrEqual(1);
    expect(b.y).toBe(START_Y);
    // Stopped: no movement after release.
    expect(d.x).toBe(c.x);
    expect(d.y).toBe(START_Y);
    // About 2.75 m for the 30 ticks from a to b, plus the ticks around them.
    const walked = c.x - START_X;
    expect(walked).toBeGreaterThanOrEqual(274);
    expect(walked).toBeLessThanOrEqual(275 + 15 * CM_PER_TICK);
    // Never more than the ticks that passed since the key went down.
    expect(walked).toBeLessThanOrEqual((c.tick - pressed.tick) * CM_PER_TICK + 1);

    await page.keyboard.press('F3');
    await orFail(page.waitForSelector('canvas[data-overlay="on"]'), failed);
    await page.screenshot({ path: testInfo.outputPath('walk.png') });
  } finally {
    expect(problems).toEqual([]);
  }
});

test('stops against the north wall at y = 9.5 m', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  try {
    await openMatch(page, failed);

    await page.keyboard.down('KeyW');
    const pressed = await readSim(page);
    // 7.5 m to the wall takes about 82 ticks; 100 leaves margin and some ticks pressed against it.
    await waitForTick(page, pressed.tick + 100, failed);
    const atWall = await readSim(page);
    await page.keyboard.up('KeyW');

    expect(atWall.y).toBe(950);
    expect(atWall.x).toBe(START_X);
  } finally {
    expect(problems).toEqual([]);
  }
});

test('faces the mouse cursor', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  try {
    await openMatch(page, failed);

    // The viewport is 1280x720 (16:9). The fitted camera is about 30.65 m from
    // the origin, and the screen centre looks at the ground origin. Champion 0
    // stands at sim (-12, 2). The ground points under these pixels, from the
    // same raycast the client uses, are about:
    //   (64, 360)  -> (-17.9, 0)  facing cos -0.95
    //   (1152, 360) -> (15.9, 0)  facing cos 0.997
    //   (640, 72)  -> (0, 13.7)   facing sin 0.70
    //   (640, 648) -> (0, -9.1)   facing sin -0.68
    // The thresholds below leave room for rounding.
    const targets = [
      { x: 64, y: 360, check: (f: number) => expect(Math.cos(f)).toBeLessThan(-0.8) },
      { x: 1152, y: 360, check: (f: number) => expect(Math.cos(f)).toBeGreaterThan(0.9) },
      { x: 640, y: 72, check: (f: number) => expect(Math.sin(f)).toBeGreaterThan(0.5) },
      { x: 640, y: 648, check: (f: number) => expect(Math.sin(f)).toBeLessThan(-0.5) },
    ];
    for (const target of targets) {
      await page.mouse.move(target.x, target.y);
      const moved = await readSim(page);
      await waitForTick(page, moved.tick + 2, failed);
      target.check((await readSim(page)).facing);
    }
  } finally {
    expect(problems).toEqual([]);
  }
});
