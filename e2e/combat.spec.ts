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
  rings: number;
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
// RING_TICKS in the client's impact-rings.ts: how long a ring lives, in sim ticks.
const RING_TICKS = 18;
// Ticks of slack after a ring's life, for the frame that retires it.
const RING_SLACK_TICKS = 4;

// The functions whose allocations the heap probe counts: every combat render
// module, the pose and overlay helpers that run each frame, the loop clock, and
// every function in main.ts (stepSim, sampleAim, draw and the hook writers).
// V8 inlines main.ts's frame into three's animation callback, so the bytes of
// frame's own body are attributed to onAnimationFrame: that one three function
// counts too, and nothing else in three does.
const COMBAT_CODE =
  /^(entity-views|health-bars|impact-rings|champion-look|feedback|interpolate|debug-overlay|loop)\.ts:|^main\.ts:|^three\.module[^:]*:onAnimationFrame$/;
// Measured in a warm steady state: 0 bytes in every counted function but
// onAnimationFrame, which shows 24 to 48 B per window (three's own callback and
// the inlined frame, cause not isolated). Each of these fails the limit: a template string
// written to a hook every frame (about 800 B), a closure made per call in
// routeEvents (about 1500 B), an escaping array in frame (about 1300 B), and an
// object literal per projectile per frame in draw that escapes (about 11 KB).
// The limit stays just above the clean figure so the small ones are caught. See
// the pull request.
const COMBAT_ALLOCATION_LIMIT_BYTES = 256;
// Anything counted at all proves the profiler saw the sim's own garbage.
const PROFILER_SANITY_BYTES = 100_000;

// Phase timing for the CI investigation: frames run and hook reads so far.
let framesRun = 0;
let hookReads = 0;
let phaseStart = Date.now();
let phaseFrames = 0;
let phaseReads = 0;
let frameMs = 0;
let readMs = 0;
let phaseFrameMs = 0;
let phaseReadMs = 0;

/** `frames` frames of 17 ms in one call, timed as a batch. */
async function runBatch(page: Page, frames: number): Promise<void> {
  framesRun += frames;
  const t0 = Date.now();
  await page.clock.runFor(frames * FRAME_MS);
  frameMs += Date.now() - t0;
}

/** One frame of fake time, timed on its own. Logs every 25 frames so a timeout still leaves figures. */
async function runFrame(page: Page): Promise<void> {
  framesRun++;
  const t0 = Date.now();
  await page.clock.runFor(FRAME_MS);
  frameMs += Date.now() - t0;
  if (framesRun % 25 === 0) {
    console.log(`PROGRESS frame ${framesRun}: frames ${frameMs} ms, reads ${readMs} ms over ${hookReads} reads`);
  }
}

/** Logs the wall-clock ms, frames and hook reads since the last phase line. */
function phase(label: string): void {
  const now = Date.now();
  const ms = now - phaseStart;
  const frames = framesRun - phaseFrames;
  const reads = hookReads - phaseReads;
  const fMs = frameMs - phaseFrameMs;
  const rMs = readMs - phaseReadMs;
  console.log(
    `PHASE ${label}: ${ms} ms, ${frames} frames (${fMs} ms, ${frames ? (fMs / frames).toFixed(1) : '-'} ms/frame), ${reads} reads (${rMs} ms, ${reads ? (rMs / reads).toFixed(1) : '-'} ms/read)`,
  );
  phaseFrameMs = frameMs;
  phaseReadMs = readMs;
  phaseStart = now;
  phaseFrames = framesRun;
  phaseReads = hookReads;
}

async function readHooks(page: Page): Promise<Hooks> {
  hookReads++;
  const t0 = Date.now();
  const result = await readHooksRaw(page);
  readMs += Date.now() - t0;
  return result;
}

async function readHooksRaw(page: Page): Promise<Hooks> {
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
      rings: Number(d['rings']),
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
  let hooks = await readHooks(page);
  const start = hooks.tick;
  for (;;) {
    if (done(hooks)) return hooks;
    expect(hooks.tick - start, `${label}: not reached within ${budgetTicks} ticks`).toBeLessThanOrEqual(
      budgetTicks,
    );
    await runFrame(page);
    hooks = await readHooks(page);
  }
}

/** Runs the frames for `ticks` ticks in one call, then finishes frame by frame if the sim is behind. */
async function runTicks(page: Page, ticks: number): Promise<Hooks> {
  const target = (await readHooks(page)).tick + ticks;
  await runBatch(page, ticks);
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

// Playwright's clock fires one animation frame per 16 ms of fake time, so
// runFor(480) fires exactly 30 frames (counted with a requestAnimationFrame
// loop: 30 callbacks and 29 to 30 sim ticks), where thirty runFor(17) fire 31
// to 32. A window is one runFor call, with no hook read between its frames.
const WINDOW_FRAMES = 30;
const WINDOW_MS = WINDOW_FRAMES * 16;
// A shot flies 27 m at 10 m/s, 162 ticks or 5.4 windows, from the spawn to the east boundary.
const WINDOWS_PER_FLIGHT = 6;
// Volleys the engine warms up on before the measured one.
const WARM_UP_VOLLEYS = 4;
// One window after the volley, then the measured ones. All of them end before the first shot does.
const SETTLE_WINDOWS = 1;
const MEASURED_WINDOWS = 3;
// A sixteenth of the pixels of the 1280x720 viewport the screenshots need.
const PROBE_VIEWPORT = { width: 320, height: 180 };

/** Runs one window of frames, 480 ms of fake time, in one call. */
async function runWindow(page: Page): Promise<void> {
  framesRun += WINDOW_FRAMES;
  const t0 = Date.now();
  await page.clock.runFor(WINDOW_MS);
  frameMs += Date.now() - t0;
}

/** Eight shots in the same frame. */
async function fireVolley(page: Page): Promise<void> {
  for (let shot = 0; shot < SHOTS; shot++) await page.keyboard.press('F4');
}

/**
 * Runs one window under the sampling heap profiler, which counts garbage as
 * well as live objects. A plain heap delta cannot be used: the sim allocates
 * inside `step` on every projectile sweep, far more than any view.
 */
async function allocationsOverAWindow(page: Page, cdp: CDPSession): Promise<Allocations> {
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 16,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await runWindow(page);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  return summarise(profile.head as ProfileNode);
}

test('the F4 debug shot hits, flashes, rings, kills and leaves no views behind', async ({ page }) => {
  test.setTimeout(300_000);
  const { problems, failed } = watchProblems(page);
  phaseStart = Date.now();
  phaseFrames = framesRun;
  phaseReads = hookReads;

  try {
    // 1. A paused clock, so every frame below is one the test ran.
    await page.clock.install({ time: 0 });
    await page.goto('/');
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    await page.clock.pauseAt(PAUSE_AT_MS);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    phase('load');

    // 2. The baseline picture has no flash and no ring.
    const baseline = await countPixels(page, await page.screenshot(), [WHITE, RING]);
    const [baselineWhite = NaN, baselineRing = NaN] = baseline.matches;
    let hooks = await readHooks(page);
    expect(hooks.projectiles).toBe(0);
    expect(hooks.hits).toBe(0);
    expect(hooks.bars).toEqual(['100', '100', '100', '100']);

    // 3. F4 spawns between steps, so only the array diff can show the shot.
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
    phase('eight shots');

    // 4. The first hit: the picture shows a white champion and a yellow ring.
    hooks = await runUntil(page, 'the first hit', 200, (h) => h.hits >= 1);
    const combat = await page.screenshot({ path: test.info().outputPath('combat.png') });
    const picture = await countPixels(page, combat, [WHITE, RING]);
    const [white = NaN, ring = NaN] = picture.matches;
    expect(picture.distinctColours).toBeGreaterThan(16);
    expect(white - baselineWhite).toBeGreaterThanOrEqual(150);
    expect(ring - baselineRing).toBeGreaterThanOrEqual(50);
    expect(hooks.flashing).toContain(String(TARGET));
    expect(hooks.bars[TARGET]).toBe(String(100 - 25 * hooks.hits));
    expect(hooks.rings, 'a ring shows right after the hit').toBeGreaterThanOrEqual(1);
    phase('first hit');

    // 5. The fourth hit kills it, and its bar goes away.
    hooks = await runUntil(page, 'the death', 60, (h) => h.deaths >= 1);
    expect(hooks.deaths).toBe(1);
    expect(hooks.bars[TARGET]).toBe('x');
    phase('death');

    // 6. The other shots pass through the dead champion and end at the east
    // boundary, and their views end with them.
    hooks = await runUntil(page, 'the last projectile', 60, (h) => h.projectiles === 0);
    expect(hooks.hits).toBe(4);
    expect(hooks.areas).toBe(0);
    phase('last projectile');

    // 7. Every ring ends. Only the draw call retires a ring, so a ring that
    // never grows and fades stays on screen and this fails. The last shot just
    // ended at the boundary, so no ring can start after this.
    expect(hooks.rings, 'a ring shows for the last shot').toBeGreaterThanOrEqual(1);
    hooks = await runUntil(page, 'the rings to end', RING_TICKS + RING_SLACK_TICKS, (h) => h.rings === 0);
    expect(hooks.rings).toBe(0);
    phase('rings');

    // 8. Steady state: eight shots in flight and nothing to hit, the loop at
    // its busiest. The shots pass through the dead champion 2. Code warmed up
    // on an empty arena is thrown away when the first projectile arrives, so
    // the engine warms up on volleys. The measured windows hold no spawn and no
    // end of a shot, only frames with eight shots in flight, and in them the
    // combat code allocates nothing. On the CI runner every frame costs about
    // 190 ms of software rendering at 1280x720 whatever the batching, and the
    // heap probe does not look at pixels, so the canvas shrinks first. The
    // resize is outside every measured window.
    await page.setViewportSize(PROBE_VIEWPORT);
    for (let volley = 0; volley < WARM_UP_VOLLEYS; volley++) {
      await fireVolley(page);
      for (let window = 0; window < WINDOWS_PER_FLIGHT; window++) await runWindow(page);
      phase(`warm-up volley ${volley + 1}`);
    }
    await fireVolley(page);
    for (let window = 0; window < SETTLE_WINDOWS; window++) await runWindow(page);
    phase('settle');
    let worst: Allocations | undefined;
    let sawGarbage = 0;
    for (let window = 0; window < MEASURED_WINDOWS; window++) {
      const allocations = await allocationsOverAWindow(page, cdp);
      phase(`measured window ${window + 1}`);
      console.log(`PROBE volley ${WARM_UP_VOLLEYS + 1} window ${window + 1}: combat ${allocations.combat} ${JSON.stringify(allocations.combatByFunction)} total ${allocations.total}`);
      sawGarbage = Math.max(sawGarbage, allocations.total);
      if (!worst || allocations.combat > worst.combat) worst = allocations;
    }
    hooks = await readHooks(page);
    // EXPLORATION, to be removed: how many more volleys until the figure is clean.
    for (let volley = WARM_UP_VOLLEYS + 2; volley <= 12; volley++) {
      await runWindow(page);
      await runWindow(page);
      await fireVolley(page);
      await runWindow(page);
      for (let window = 0; window < MEASURED_WINDOWS; window++) {
        const a = await allocationsOverAWindow(page, cdp);
        console.log(`PROBE volley ${volley} window ${window + 1}: combat ${a.combat} ${JSON.stringify(a.combatByFunction)} total ${a.total}`);
      }
      await runWindow(page);
      await runWindow(page);
    }
    expect(hooks.hits).toBe(4);
    expect(hooks.projectiles, 'every shot of the volley is still in flight').toBe(SHOTS);
    expect(sawGarbage, 'the profiler saw no allocations at all').toBeGreaterThan(PROFILER_SANITY_BYTES);
    expect(
      worst?.combat,
      `combat code allocated ${JSON.stringify(worst?.combatByFunction)}`,
    ).toBeLessThan(COMBAT_ALLOCATION_LIMIT_BYTES);
  } finally {
    expect(problems).toEqual([]);
  }
});
