import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { colourNear, countPixels, orFail, watchProblems } from './support';

// The canvas hooks the client writes. All ticks come from data-tick, so no
// assertion depends on how fast the machine is.
interface Hooks {
  tick: number;
  projectiles: number;
  areas: number;
  hits: number;
  deaths: number;
  flashing: string[];
  bars: string[];
  debugShots: number;
}

// Playwright's clock fires a frame every 16 ms of fake time and the sim ticks
// every 16.67 ms, so a frame of 17 ms runs about one tick.
const FRAME_MS = 17;
// Far ahead of the page's own clock, which starts at 0, so the pause happens
// as soon as the page is ready, however slow the load was.
const PAUSE_AT_MS = 60_000;
const WHITE = colourNear([255, 255, 255], 5);
// The impact ring colour #ffd23f.
const RING = colourNear([0xff, 0xd2, 0x3f], 8);
// Champion 2 is the first enemy and the target of the F4 shots.
const TARGET = 2;
const SHOTS = 8;

// The functions whose allocations the heap probe counts: the combat render
// modules, and the three main.ts functions that call them every frame.
const COMBAT_CODE =
  /^(entity-views|health-bars|impact-rings|champion-look|feedback)\.ts:|^main\.ts:(draw|stepSim|writeCombatHooks)$/;
// Measured in a warm steady state: 0 bytes with the views as written, and over
// 10 KB when draw makes one { x, y } literal per projectile per frame. See the
// pull request for the numbers.
const COMBAT_ALLOCATION_LIMIT_BYTES = 2048;
// Anything counted at all proves the profiler saw the sim's own garbage.
const PROFILER_SANITY_BYTES = 100_000;

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    const list = (value: string | undefined): string[] => (value ? value.split(',') : []);
    return {
      tick: Number(d['tick']),
      projectiles: Number(d['projectiles']),
      areas: Number(d['areas']),
      hits: Number(d['hits']),
      deaths: Number(d['deaths']),
      flashing: list(d['flashing']),
      bars: list(d['bars']),
      debugShots: Number(d['debugShots']),
    };
  });
}

/** Runs one frame at a time until `done` holds, and fails if the sim passes the tick budget. */
async function runUntil(
  page: Page,
  label: string,
  budgetTicks: number,
  done: (hooks: Hooks) => boolean,
): Promise<Hooks> {
  const start = (await readHooks(page)).tick;
  for (;;) {
    const hooks = await readHooks(page);
    if (done(hooks)) return hooks;
    expect(hooks.tick - start, `${label}: not reached within ${budgetTicks} ticks`).toBeLessThanOrEqual(
      budgetTicks,
    );
    await page.clock.runFor(FRAME_MS);
  }
}

async function runTicks(page: Page, ticks: number): Promise<Hooks> {
  const target = (await readHooks(page)).tick + ticks;
  return runUntil(page, `${ticks} ticks`, ticks + 5, (hooks) => hooks.tick >= target);
}

interface ProfileNode {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
}

interface Allocations {
  total: number;
  combat: number;
  /** Bytes per "file:function" for the combat code, for the failure message. */
  combatByFunction: Record<string, number>;
}

function summarise(root: ProfileNode): Allocations {
  const result: Allocations = { total: 0, combat: 0, combatByFunction: {} };
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    result.total += node.selfSize;
    const key = `${node.callFrame.url.split('/').slice(-1)[0]}:${node.callFrame.functionName}`;
    if (node.selfSize > 0 && COMBAT_CODE.test(key)) {
      result.combat += node.selfSize;
      result.combatByFunction[key] = (result.combatByFunction[key] ?? 0) + node.selfSize;
    }
    pending.push(...node.children);
  }
  return result;
}

/**
 * Runs 500 ms of fake time under the sampling heap profiler, which counts
 * garbage as well as live objects. A plain heap delta cannot be used: the sim
 * allocates inside `step` on every projectile sweep, far more than any view.
 */
async function allocationsOverHalfASecond(page: Page, cdp: CDPSession): Promise<Allocations> {
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 16,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await page.clock.runFor(500);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  return summarise(profile.head as ProfileNode);
}

test('the F4 debug shot hits, flashes, rings, kills and leaves no views behind', async ({ page }) => {
  const { problems, failed } = watchProblems(page);

  try {
    // 1. A paused clock, so every frame below is one the test ran.
    await page.clock.install({ time: 0 });
    await page.goto('/');
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    await page.clock.pauseAt(PAUSE_AT_MS);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');

    // 2. The baseline picture has no flash and no ring.
    const baseline = await countPixels(page, await page.screenshot(), [WHITE, RING]);
    const [baselineWhite = NaN, baselineRing = NaN] = baseline.matches;
    let hooks = await readHooks(page);
    expect(hooks.projectiles).toBe(0);
    expect(hooks.hits).toBe(0);
    expect(hooks.bars).toEqual(['100', '100', '100', '100']);

    // 3. Idle frames for the engine to warm up on.
    await page.clock.runFor(3000);

    // 4. F4 spawns between steps, so only the array diff can show the shot.
    await page.keyboard.press('F4');
    await runTicks(page, 1);
    hooks = await readHooks(page);
    expect(hooks.projectiles).toBe(1);
    expect(hooks.debugShots).toBe(1);
    for (let shot = 1; shot < SHOTS; shot++) {
      await page.keyboard.press('F4');
      await runTicks(page, 1);
    }
    hooks = await readHooks(page);
    expect(hooks.projectiles).toBe(SHOTS);
    expect(hooks.debugShots).toBe(SHOTS);

    // 5. The same loop with eight shots in flight, once it is warm, allocates
    // nothing in the combat code. About 100 ticks fit before the first hit.
    await allocationsOverHalfASecond(page, cdp);
    await allocationsOverHalfASecond(page, cdp);
    const allocations = await allocationsOverHalfASecond(page, cdp);
    hooks = await readHooks(page);
    expect(hooks.hits).toBe(0);
    expect(hooks.projectiles).toBe(SHOTS);
    expect(allocations.total, 'the profiler saw no allocations at all').toBeGreaterThan(
      PROFILER_SANITY_BYTES,
    );
    expect(
      allocations.combat,
      `combat code allocated ${JSON.stringify(allocations.combatByFunction)}`,
    ).toBeLessThan(COMBAT_ALLOCATION_LIMIT_BYTES);

    // 6. The first hit: the picture shows a white champion and a yellow ring.
    hooks = await runUntil(page, 'the first hit', 200, (h) => h.hits >= 1);
    const combat = await page.screenshot({ path: test.info().outputPath('combat.png') });
    const picture = await countPixels(page, combat, [WHITE, RING]);
    const [white = NaN, ring = NaN] = picture.matches;
    expect(picture.distinctColours).toBeGreaterThan(16);
    expect(white - baselineWhite).toBeGreaterThanOrEqual(150);
    expect(ring - baselineRing).toBeGreaterThanOrEqual(50);
    expect(hooks.flashing).toContain(String(TARGET));
    expect(hooks.bars[TARGET]).toBe(String(100 - 25 * hooks.hits));

    // 7. The fourth hit kills it, and its bar goes away.
    hooks = await runUntil(page, 'the death', 60, (h) => h.deaths >= 1);
    expect(hooks.deaths).toBe(1);
    expect(hooks.bars[TARGET]).toBe('x');

    // 8. The other shots pass through the dead champion and end at the east
    // boundary, and their views end with them.
    hooks = await runUntil(page, 'the last projectile', 60, (h) => h.projectiles === 0);
    expect(hooks.hits).toBe(4);
    expect(hooks.areas).toBe(0);
  } finally {
    expect(problems).toEqual([]);
  }
});
