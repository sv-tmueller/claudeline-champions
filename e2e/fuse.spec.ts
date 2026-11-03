import { expect, test, type Page } from '@playwright/test';
import { PROBE_VIEWPORT } from './heap-probe';
import { orFail, watchProblems } from './support';

// The armed look of a fused area (rules 2.7), in a browser. No shipped kit has a fuse, so the dev-only
// Shift+F4 key of the sandbox spawns one at the aim: a one-hit area of 2.5 m with a fuse of 90 ticks
// and 30 damage to the enemy team, through `debug.spawnArea`. The aim is the cursor on champion 2, who
// has no kit and no bot and stands still at (12, 2). The area is drawn from the area entity alone, with
// no event: `data-areas` reads 1 through the whole fuse, the picture `fuse.png` is taken while it is
// armed, and `data-areas` reads 0 just after the detonation, which took 30 of the 120 health of
// champion 2 (`data-bar2` 75). The units behind it are entity-views-fuse.test.ts (the armed look, its
// release in the detonation step and at a round decision) and area.test.ts (the fuse itself).
//
// Every wait is a tick budget read from the canvas hooks, `data-tick`, `data-phase` and `data-areas`,
// and the waits are batches of one `runFor`, as in lingering.spec.ts.

// Playwright's clock fires a frame every 16 ms of fake time and the sim ticks every 16.67 ms, so a
// frame of 17 ms runs about one tick (combat.spec.ts).
const FRAME_MS = 17;
const PAUSE_AT_MS = 60_000;
// The warmup is 180 ticks, WARMUP_TICKS in the sim.
const WARMUP_TICKS = 180;
const WARMUP_BUDGET_TICKS = 40;
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
// The fuse of the Shift+F4 area (debug-shot.ts): it detonates on the 91st step after the spawn.
const FUSE_TICKS = 90;
// The ground point (12, 2) of champion 2, as a pixel at the probe viewport: the camera frames the whole
// arena (camera.ts), so a pixel maps to a fixed ground point. The area reaches 3 m, body included, so a
// pixel or two of rounding does not matter.
const TARGET_PIXEL = { x: 253, y: 77 };
// Ticks the armed area is left to run before the picture is taken, and a read inside the fuse.
const FIRST_READ_TICKS = 30;
const PICTURE_AT_TICKS = 60;
// The area is gone within a few ticks of its 90th, and the budget allows for a slow frame.
const DETONATION_BUDGET_TICKS = FUSE_TICKS - PICTURE_AT_TICKS + 15;
// The warmup and the fuse run at the probe viewport, the picture at 1280x720. About 300 frames at 320x180
// (17 to 24 ms each) and a handful at 1280x720 (105 to 210 ms), so 6 to 9 s; with the page load, the
// reads and the screenshot the test takes about 12 s. The 45 s timeout is more than twice that
// (the rule of testing.md); a run past half of it applies the rule again.
const TEST_TIMEOUT_MS = 45_000;

interface Hooks {
  tick: number;
  phase: string;
  /** `data-areas`: the area views shown. */
  areas: number;
  /** `data-bar2`: the fill percent of the health bar of champion 2. */
  bar2: string;
  /** `data-debugAreas`: the Shift+F4 areas spawned. */
  debugAreas: number;
  /** `data-debugShots`: the F4 shots fired. */
  debugShots: number;
}

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    return {
      tick: Number(d['tick']),
      phase: d['phase'] ?? '',
      areas: Number(d['areas']),
      bar2: d['bar2'] ?? '',
      debugAreas: Number(d['debugAreas']),
      debugShots: Number(d['debugShots']),
    };
  });
}

/** Runs one frame at a time until `done` holds, and fails if the sim passes the tick budget. */
async function runUntil(page: Page, label: string, budgetTicks: number, done: (hooks: Hooks) => boolean): Promise<Hooks> {
  let hooks = await readHooks(page);
  const start = hooks.tick;
  for (;;) {
    if (done(hooks)) return hooks;
    expect(hooks.tick - start, `${label}: not reached within ${budgetTicks} ticks`).toBeLessThanOrEqual(budgetTicks);
    await page.clock.runFor(FRAME_MS);
    hooks = await readHooks(page);
  }
}

/** Runs the frames for `ticks` ticks in one call, then finishes frame by frame if the sim is behind. */
async function runTicks(page: Page, ticks: number): Promise<Hooks> {
  const target = (await readHooks(page)).tick + ticks;
  await page.clock.runFor(ticks * FRAME_MS);
  return runUntil(page, `${ticks} ticks`, ticks + 5, (hooks) => hooks.tick >= target);
}

test('draws a fused area armed for its whole fuse, then detonates it on champion 2', async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    // 1. A paused clock and the dev-only sandbox, as in combat.spec.ts: champion 2 has no kit and no
    // bot, so nothing hurts anyone. The warmup runs at the small viewport.
    await page.clock.install({ time: 0 });
    await page.goto('/?scene=sandbox');
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    await page.clock.pauseAt(PAUSE_AT_MS);
    await page.setViewportSize(PROBE_VIEWPORT);
    await page.clock.runFor(WARMUP_TICKS * FRAME_MS);
    let hooks = await runUntil(page, 'the round phase', WARMUP_BUDGET_TICKS, (h) => h.phase === 'round');
    expect(hooks.areas).toBe(0);
    expect(hooks.bar2).toBe('100');

    // 2. The cursor on champion 2, sampled by one frame; then Shift+F4, which spawns the area between
    // steps and no shot. The next frame shows it: one view, spawned armed.
    await page.mouse.move(TARGET_PIXEL.x, TARGET_PIXEL.y);
    await page.clock.runFor(FRAME_MS);
    await page.keyboard.press('Shift+F4');
    hooks = await readHooks(page);
    expect(hooks.debugAreas, 'Shift+F4 spawned the area').toBe(1);
    expect(hooks.debugShots, 'and fired no shot').toBe(0);
    hooks = await runUntil(page, 'the area view', 3, (h) => h.areas > 0);
    expect(hooks.areas).toBe(1);
    const spawnedAt = hooks.tick;

    // 3. Inside its fuse it is the one view and nothing has hurt champion 2.
    hooks = await runTicks(page, FIRST_READ_TICKS);
    expect(hooks.areas).toBe(1);
    expect(hooks.bar2).toBe('100');

    // 4. The picture is taken while it is armed: a frame at 1280x720, then back to the probe viewport.
    hooks = await runTicks(page, PICTURE_AT_TICKS - FIRST_READ_TICKS);
    expect(hooks.areas).toBe(1);
    await page.setViewportSize(SCREENSHOT_VIEWPORT);
    await page.clock.runFor(FRAME_MS);
    await page.screenshot({ path: testInfo.outputPath('fuse.png') });
    await page.setViewportSize(PROBE_VIEWPORT);
    hooks = await readHooks(page);
    expect(hooks.areas, 'still armed when the picture was taken').toBe(1);
    expect(hooks.bar2).toBe('100');
    expect(hooks.tick - spawnedAt, 'the picture is inside the fuse').toBeLessThan(FUSE_TICKS - 10);

    // 5. The detonation: the view is released in the step that hurts champion 2, 30 of 120 health.
    hooks = await runUntil(page, 'the detonation', DETONATION_BUDGET_TICKS, (h) => h.areas === 0);
    expect(hooks.areas).toBe(0);
    expect(hooks.bar2).toBe('75');
    expect(hooks.tick - spawnedAt, 'the fuse burnt its 90 ticks, give or take a frame').toBeGreaterThanOrEqual(FUSE_TICKS - 3);
    expect(hooks.tick - spawnedAt, 'the fuse burnt its 90 ticks, give or take a frame').toBeLessThanOrEqual(FUSE_TICKS + 5);
  } finally {
    expect(problems).toEqual([]);
  }
});
