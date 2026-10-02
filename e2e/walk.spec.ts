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
// Where the champion circle stops against the east wall, in cm.
const EAST_WALL_X = 1100;
// Upper bound for x once the champion has stopped after the release, in cm.
const RELEASE_X_CAP = 500;
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

    // Read the tick before the key goes down: a frame can step the sim between
    // the key event and a later read, and those steps still count as walking.
    const pressed = await readSim(page);
    await page.keyboard.down('KeyD');
    // Two ticks give the key event a frame to reach the sampled input.
    await waitForTick(page, pressed.tick + 2, failed);
    const a = await readSim(page);
    await waitForTick(page, a.tick + 30, failed);
    const b = await readSim(page);
    await page.keyboard.up('KeyD');
    // The release reaches the sim after an unknown wall-clock delay, so poll
    // once per tick until x has held still for three readings in a row.
    const releasedAt = (await readSim(page)).tick;
    let last = await readSim(page);
    let stopTick: number | undefined;
    let unchanged = 0;
    while (unchanged < 2 && last.tick - releasedAt <= 300) {
      await waitForTick(page, last.tick + 1, failed);
      const next = await readSim(page);
      if (next.x === last.x) {
        stopTick ??= next.tick;
        unchanged += 1;
      } else {
        stopTick = undefined;
        unchanged = 0;
      }
      last = next;
    }
    expect(stopTick, 'x never settled within 300 ticks of the release').toBeDefined();
    const stopped = last;
    // Stopped: no movement after release.
    await waitForTick(page, stopped.tick + 5, failed);
    const after = await readSim(page);
    expect(after.x).toBe(stopped.x);
    expect(after.y).toBe(START_Y);

    // Exact sim speed between two reads, within the 1 cm rounding of the hook.
    expect(Math.abs(b.x - a.x - (b.tick - a.tick) * CM_PER_TICK)).toBeLessThanOrEqual(1);
    expect(b.y).toBe(START_Y);
    // About 2.75 m for the 30 ticks from a to b, plus the ticks around them.
    const walked = stopped.x - START_X;
    expect(walked).toBeGreaterThanOrEqual(274);
    // Never more than the ticks that passed from the key down to the stop.
    expect(walked).toBeLessThanOrEqual((stopTick! - pressed.tick) * CM_PER_TICK + 1);
    // The tick bound grows with the stop tick, so a stuck key that walks into
    // the east wall would satisfy it. Two absolute checks close that gap.
    // The settle must not be the wall: x is strictly short of the wall stop.
    expect(stopped.x).toBeLessThan(EAST_WALL_X);
    // And x stays below a cap a stuck key cannot meet but a slow runner can.
    // From the start at -1200 cm, 30 held ticks cover about 275 cm and a
    // prompt release stops near -925 cm. The cap of 500 cm allows 1700 cm of
    // walking, about 185 ticks (3 s), so a release up to about 150 ticks late
    // still passes, while the wall at 1100 cm sits 2300 cm (251 ticks) away.
    expect(stopped.x).toBeLessThan(RELEASE_X_CAP);

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
