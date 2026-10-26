import { expect, test, type Page } from '@playwright/test';
import { PROBE_VIEWPORT } from './heap-probe';
import { orFail, watchProblems } from './support';

// The first lingering area a match draws, in a browser: Ondrel's Reed Fence (Q) on the default
// match, `?champion=ondrel`, with a paused clock like hud.spec.ts. Every v1 area and every area of
// Brimwick lasts one tick and never reaches a view, so no other spec shows an area view for more
// than a frame. Q casts two areas: a one-hit circle of 2.5 m (1 tick, never drawn) and the fence,
// 2.5 m for 120 ticks, so `data-areas` reads 1 and not 2. The units behind it are
// entity-views-lingering.test.ts (the six Ondrel paths, the radius and the placement of each, and
// the release at a round decision) and the sync of entity-views-sim.test.ts. There are no pixel
// counts: the screenshot only shows the picture, `lingering.png`.
//
// Every wait is a tick budget read from the canvas hooks, `data-tick`, `data-phase`, `data-anim0`
// and `data-areas`, and the flights and waits are batches of one `runFor`.

// Playwright's clock fires a frame every 16 ms of fake time and the sim ticks every 16.67 ms, so a
// frame of 17 ms runs about one tick (combat.spec.ts).
const FRAME_MS = 17;
const PAUSE_AT_MS = 60_000;
// The warmup is 180 ticks, WARMUP_TICKS in the sim.
const WARMUP_TICKS = 180;
const WARMUP_BUDGET_TICKS = 40;
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
// Reed Fence (data/kits/ondrel.json): an 18 tick windup, then the area, which lasts 120 ticks. A sync
// sees it for 119 of them (entity-views-lingering.test.ts), so a read 40 ticks in is well inside.
const WINDUP_TICKS = 18;
const FENCE_TICKS = 120;
// The cast is read within 3 ticks of the press, the area within the windup and 8 more, and it is
// gone within 20 ticks of the last read.
const CAST_BUDGET_TICKS = 3;
const AREA_BUDGET_TICKS = WINDUP_TICKS + 8;
// The last read inside the life of the fence is this many ticks before its end.
const END_MARGIN_TICKS = 10;
// Ticks the area is left to run before it is read again inside its life, and the picture is taken.
const INSIDE_TICKS = 40;
// The warmup, the windup and the fence run at the probe viewport, and the picture at 1280x720. A frame
// costs 17 to 24 ms at 320x180 on the runner (about 360: the warmup, the 18 ticks of the windup, the
// 120 of the fence and about 40 read one by one) and 105 to 210 ms at 1280x720 (2), so the frames take
// 6 to 9 s; a read costs 32 to 75 ms and there are about 50, so 2 to 4 s; with the page load and the
// screenshot the test takes about 15 s. The 45 s timeout is more than twice that (the rule of
// testing.md); a run past half of it applies the rule again.
const TEST_TIMEOUT_MS = 45_000;

interface Hooks {
  tick: number;
  phase: string;
  /** `data-anim0`: what the clips of the local champion play. */
  anim0: string;
  /** `data-areas`: the area views shown. */
  areas: number;
}

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    return { tick: Number(d['tick']), phase: d['phase'] ?? '', anim0: d['anim0'] ?? '', areas: Number(d['areas']) };
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

test('draws the one lingering area of Ondrel\'s Reed Fence for its life and then none', async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    await page.clock.install({ time: 0 });
    await page.goto('/?champion=ondrel&difficulty=normal&arena=arena01&teamsize=2');
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    await page.clock.pauseAt(PAUSE_AT_MS);
    await page.setViewportSize(PROBE_VIEWPORT);

    // 1. The warmup, then the round: no area is shown, so `data-areas` is 0.
    await page.clock.runFor(WARMUP_TICKS * FRAME_MS);
    let hooks = await runUntil(page, 'the round phase', WARMUP_BUDGET_TICKS, (h) => h.phase === 'round');
    expect(hooks.areas).toBe(0);

    // 2. Q held for two ticks and released, so the cast is one: the windup shows Idle+Cast.
    await page.keyboard.down('KeyQ');
    hooks = await runUntil(page, 'the cast', CAST_BUDGET_TICKS, (h) => h.anim0 === 'Idle+Cast');
    await page.keyboard.up('KeyQ');
    expect(hooks.anim0).toBe('Idle+Cast');

    // 3. The windup ends and the fence is made: one view, not two, since the one-hit circle of the
    // same cast lasts one tick and is gone before a view could be shown.
    hooks = await runUntil(page, 'the area', AREA_BUDGET_TICKS, (h) => h.areas > 0);
    expect(hooks.areas).toBe(1);
    const madeAt = hooks.tick;

    // 4. Inside its 120 ticks it is still the one view, and the picture is taken while it is down:
    // a frame at 1280x720 for the picture, then back to the probe viewport.
    hooks = await runTicks(page, INSIDE_TICKS);
    expect(hooks.areas).toBe(1);
    await page.setViewportSize(SCREENSHOT_VIEWPORT);
    await page.clock.runFor(FRAME_MS);
    await page.screenshot({ path: testInfo.outputPath('lingering.png') });
    await page.setViewportSize(PROBE_VIEWPORT);
    hooks = await readHooks(page);
    expect(hooks.areas).toBe(1);
    expect(hooks.tick - madeAt, 'the picture is inside the life of the fence').toBeLessThan(FENCE_TICKS - 20);

    // 5. Ten ticks before the end it is still the one view; then it is released, within a tick or
    // two of its 120 ticks, and no other area took its place.
    hooks = await runTicks(page, FENCE_TICKS - END_MARGIN_TICKS - (hooks.tick - madeAt));
    expect(hooks.areas).toBe(1);
    hooks = await runUntil(page, 'the end of the fence', 2 * END_MARGIN_TICKS, (h) => h.areas === 0);
    expect(hooks.areas).toBe(0);
    expect(hooks.tick - madeAt, 'the fence lasted its 120 ticks, give or take a frame').toBeGreaterThanOrEqual(FENCE_TICKS - 3);
    expect(hooks.tick - madeAt, 'the fence lasted its 120 ticks, give or take a frame').toBeLessThanOrEqual(FENCE_TICKS + 3);
  } finally {
    expect(problems).toEqual([]);
  }
});
