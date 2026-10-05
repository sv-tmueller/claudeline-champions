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
  /** The match phase, the sim's own string. */
  phase: string;
  /** `data-ready` of the M1 icon. */
  m1Ready: string | null;
  /** The visible kill-feed lines, "killer > victim", oldest first. */
  killFeed: string[];
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
// module, the pose and overlay helpers that run each frame, the loop clock, the
// input sampler, the HUD writer with its views and the kill feed, the champion
// names, the result screen's writer, the client's bot-driving glue
// (bot-driver.ts) and every function in main.ts (stepSim, sampleAim, draw and
// the hook writers). The HUD builder, hud-dom.ts, the result panel's builder,
// result-dom.ts, and the setup modules run once at startup and are not counted.
// The bots package is not counted either: it allocates on every think, by its
// API (a fresh PlayerInput, a decision record per think), which the bots
// package's milestone addresses. Its files get the prefix bots/ in `summarise`,
// as the sim's get sim/, so a bots file such as bot.ts never matches a client
// entry. Bytes of an inlined callee land on its caller, so bots bytes inlined
// into the glue would still show in bot-driver.ts.
// V8 inlines main.ts's frame into three's animation callback, so the bytes of
// frame's own body are attributed to onAnimationFrame: that one three function
// counts too, and nothing else in three does.
const COMBAT_CODE =
  /^(entity-views|health-bars|impact-rings|champion-look|feedback|interpolate|debug-overlay|loop|input|hud|hud-views|kill-feed|roster|bot-driver|result-screen)\.ts:|^main\.ts:|^three\.module[^:]*:onAnimationFrame$/;
// The sweep files of the sim. Their garbage is huge today (about 790 KB per
// window, in projectile.ts and geometry.ts) and #49 removes most of it, so the
// sanity floor below leaves them out and no merge order moves it.
const SWEEP_FILES = /^sim\/(projectile|geometry|area)\.ts:/;
// Measured in a warm steady state: 0 bytes in every counted function but
// onAnimationFrame, which shows 0 to 72 B per window in the clean mode (three's
// own callback and the inlined frame, cause not isolated) and about 1100 B in the
// bad mode (see the retries below). Each of these fails the limit, with the
// figures of the pull request: an escaping array in frame (about 1300 B), a
// template string written to a hook every frame (about 2500 B), a closure made per
// call in routeEvents (about 1700 B), an escaping object in draw (about 10.7 KB), a
// fresh literal from toPlayerInput (about 1350 B), a template string per Hud.update
// call (about 1300 B), an escaping array per BotDriver.think call (about 970 B) and
// a template string per ResultScreen.update call (about 750 B).
// The limit stays just above the clean figure so the small ones are caught. See
// testing.md.
const COMBAT_ALLOCATION_LIMIT_BYTES = 256;
// The profiler must see garbage outside the sweep files in every window: the
// sim's collision, step and sight code, the fake clock's timers and three's
// render. About 344 KB per window was the lowest figure measured on the sandbox
// with the bots casting (344 to 360 KB over 15 windows), so the floor is about a
// quarter of it.
const PROFILER_SANITY_BYTES = 80_000;

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
      rings: Number(d['rings']),
      flashing: list(d['flashing']),
      bars: list(d['bars']),
      debugShots: Number(d['debugShots']),
      phase: d['phase'] ?? '',
      m1Ready: document.querySelector('[data-slot="M1"]')?.getAttribute('data-ready') ?? null,
      killFeed: [...document.querySelectorAll('[data-line][data-visible="true"]')].map(
        (line) =>
          `${line.querySelector('[data-part="killer"]')?.textContent} > ${line.querySelector('[data-part="victim"]')?.textContent}`,
      ),
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

interface ProfileNode {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
}

interface Allocations {
  total: number;
  /** Bytes outside the sweep files of the sim, for the sanity floor. */
  outsideSweep: number;
  combat: number;
  /** Bytes in three's onAnimationFrame, where the inlined frame function lands. */
  onAnimationFrame: number;
  /** Bytes in the fake clock's own requestAnimationFrame, which holds them when it is not inlined. */
  fakeRequestAnimationFrame: number;
  /** Bytes per "file:function" for the combat code, for the failure message. */
  combatByFunction: Record<string, number>;
}

function summarise(root: ProfileNode): Allocations {
  const result: Allocations = { total: 0, outsideSweep: 0, combat: 0, onAnimationFrame: 0, fakeRequestAnimationFrame: 0, combatByFunction: {} };
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    result.total += node.selfSize;
    // The sim has an input.ts of its own (resolveInput) and the bots a bot.ts, so
    // their files get a prefix and never match a client module of the same name.
    const url = node.callFrame.url;
    const prefix = url.includes('/packages/sim/') ? 'sim/' : url.includes('/packages/bots/') ? 'bots/' : '';
    const key = `${prefix}${url.split('/').slice(-1)[0]}:${node.callFrame.functionName}`;
    if (!SWEEP_FILES.test(key)) result.outsideSweep += node.selfSize;
    if (key === ':requestAnimationFrame') result.fakeRequestAnimationFrame += node.selfSize;
    if (node.selfSize > 0 && COMBAT_CODE.test(key)) {
      result.combat += node.selfSize;
      if (key.endsWith(':onAnimationFrame')) result.onAnimationFrame += node.selfSize;
      result.combatByFunction[key] = (result.combatByFunction[key] ?? 0) + node.selfSize;
    }
    pending.push(...node.children);
  }
  return result;
}

// Playwright's clock fires one animation frame per 16 ms of fake time, so
// runFor(480) fires exactly 30 frames (counted with a requestAnimationFrame
// loop: 30 callbacks and 29 to 30 sim ticks), where thirty runFor(17) fire 31
// or 32. A window is one runFor call with no hook read between its frames.
const WINDOW_FRAMES = 30;
const WINDOW_MS = WINDOW_FRAMES * 16;
// A window is 28 to 29 ticks. A shot flies 27 m at 10 m/s, 162 ticks or 5.6 to
// 5.8 windows, from the spawn to the east boundary.
const WINDOWS_PER_FLIGHT = 6;
// Volleys the engine warms up on before the measured one. The depth does not
// change the bad mode of the heap probe (decision 9 of batch #32: 4 and 8
// volleys read alike), so the warm-up is the short one, 12 s less on the runner.
const WARM_UP_VOLLEYS = 4;
// One window after the volley, then the measured ones. All of them end before the first shot does.
const SETTLE_WINDOWS = 1;
const MEASURED_WINDOWS = 3;
// A sixteenth of the pixels of the 1280x720 viewport that the screenshots need.
const PROBE_VIEWPORT = { width: 320, height: 180 };
// The viewport of the screenshots, which is also the default of playwright.config.ts.
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
// The warmup is 180 ticks, WARMUP_TICKS in the sim.
const WARMUP_BUDGET_TICKS = 200;
// The CI job timed out at the default 30 s on 2026-10-02 (run 36967340392).
// On the runner (2 cores, SwiftShader) steps 1 to 7 take about 45 s, because a
// frame renders in 105 to 210 ms at 1280x720 and each tick-exact frame also
// pays a hook read of 32 to 75 ms. Step 8 took about 30 s at 320x180 with 8
// warm-up volleys, where a frame is 17 to 24 ms, and about 18 s with 4. That is
// about 63 s in all, plus the warmup wait of step 1 (180 ticks at 320x180, about
// 5 s), so 240 s is a margin of more than 3x.
const TEST_TIMEOUT_MS = 240_000;

/** Runs one window of frames, 480 ms of fake time, in one call. */
async function runWindow(page: Page): Promise<void> {
  await page.clock.runFor(WINDOW_MS);
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

// The heap probe has two modes, on the CI runner (about 3 runs in 10, decision 9
// of batch #32) and, with a fresh browser for step 8 under four parallel
// workers, locally (decision 10; the investigation of package #41 measured 12 of
// 20 attempts). In the clean mode onAnimationFrame reads 0 to 48 B per window.
// In the bad mode it reads 970 to 1200 B (about 36 B per frame), in every window
// of the run. The bytes only move. Playwright's fake clock hands out ids of 1e12
// and up, which are not small integers, so each requestAnimationFrame call boxes
// about three heap numbers (36 B). In the clean mode the fake clock's own
// requestAnimationFrame function holds them (about 1075 B per window); in the bad
// mode Maglev inlines it into three's onAnimationFrame and that function holds
// them, while the fake function reads 0. The totals are equal (about 790 KB per
// window in both modes), and turning Maglev's inlining off removes the mode (0 of
// 16 attempts), so the client allocates nothing in either mode. Making the loop
// clock's fields doubles from creation (10 of 20 bad) and having draw read the
// clock itself (9 of 20) changed nothing, and neither was kept. Nothing in the
// client or the test controls the inlining. Each attempt logs total,
// onAnimationFrame and fake requestAnimationFrame bytes per window, so a log
// shows which mode it was in.
// Two retries are a net. The bad mode only adds bytes, so a regression of more
// than 256 B fails every clean attempt, and every bad attempt fails anyway; only
// a marginal one near the limit can pass on a retry. A regression of the sizes
// measured (1304 B and up) fails all three attempts. The global retries stay 0 in
// playwright.config.ts.
test.describe.configure({ retries: 2 });

test('the F4 debug shot hits, flashes, rings, kills and leaves no views behind', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    // 1. A paused clock, so every frame below is one the test ran. The dev-only
    // sandbox is the probe scene: the roster of this test with match flow and the
    // two kits, where only champion 3 is a bot and has no kit, so nothing hurts the
    // others. The warmup locks the champions for 180 ticks, which run at the small
    // viewport, since a frame there costs a sixteenth of the pixels.
    await page.clock.install({ time: 0 });
    await page.goto('/?scene=sandbox');
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    await page.clock.pauseAt(PAUSE_AT_MS);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await page.setViewportSize(PROBE_VIEWPORT);
    await runUntil(page, 'the round phase', WARMUP_BUDGET_TICKS, (h) => h.phase === 'round');
    await page.setViewportSize(SCREENSHOT_VIEWPORT);

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

    // 5. The fourth hit kills it, and its bar goes away.
    hooks = await runUntil(page, 'the death', 60, (h) => h.deaths >= 1);
    expect(hooks.deaths).toBe(1);
    expect(hooks.bars[TARGET]).toBe('x');
    // The kill feed names the killer (champion 0, Hargrim) and the victim (champion 2, Lumeth).
    expect(hooks.killFeed).toEqual(['Hargrim > Lumeth']);
    const deathTick = hooks.tick;

    // 6. The other shots pass through the dead champion and end at the east
    // boundary, and their views end with them.
    hooks = await runUntil(page, 'the last projectile', 60, (h) => h.projectiles === 0);
    expect(hooks.hits).toBe(4);
    expect(hooks.areas).toBe(0);

    // 7. Every ring ends. Only the draw call retires a ring, so a ring that
    // never grows and fades stays on screen and this fails. The last shot just
    // ended at the boundary, so no ring can start after this.
    expect(hooks.rings, 'a ring shows for the last shot').toBeGreaterThanOrEqual(1);
    hooks = await runUntil(page, 'the rings to end', RING_TICKS + RING_SLACK_TICKS, (h) => h.rings === 0);
    expect(hooks.rings).toBe(0);

    // 8. Steady state: eight shots in flight and nothing to hit, the loop at
    // its busiest. The shots pass through the dead champion 2. Code warmed up
    // on an empty arena is thrown away when the first projectile arrives, so
    // the engine warms up on volleys. The measured windows hold no spawn and no
    // end of a shot, only frames with eight shots in flight, and in them the
    // combat code allocates nothing. On the CI runner every frame costs 105 to
    // 210 ms of software rendering at 1280x720 whether or not hooks are read
    // between frames, and the heap probe counts JavaScript allocations and
    // never looks at pixels, so the canvas shrinks first. The resize is
    // outside every measured window.
    await page.setViewportSize(PROBE_VIEWPORT);
    // M1 is held from the first volley to the end of the measured windows. It is
    // Hargrim's arc: a 36-tick cooldown, a reach of 3 m and nothing in reach, so it
    // casts again and again and the windows cover startCast, the windup, castFired,
    // the arc and the HUD's windup and cooldown reads. No projectile or area spawns
    // in them.
    await page.mouse.down();
    for (let volley = 0; volley < WARM_UP_VOLLEYS; volley++) {
      await fireVolley(page);
      for (let window = 0; window < WINDOWS_PER_FLIGHT; window++) await runWindow(page);
    }
    await fireVolley(page);
    for (let window = 0; window < SETTLE_WINDOWS; window++) await runWindow(page);
    let worst: Allocations | undefined;
    let lowestOutsideSweep = Infinity;
    const figures: string[] = [];
    for (let window = 0; window < MEASURED_WINDOWS; window++) {
      const allocations = await allocationsOverAWindow(page, cdp);
      lowestOutsideSweep = Math.min(lowestOutsideSweep, allocations.outsideSweep);
      if (!worst || allocations.combat > worst.combat) worst = allocations;
      figures.push(
        `${allocations.total}/${allocations.onAnimationFrame}/${allocations.fakeRequestAnimationFrame}/${allocations.outsideSweep}`,
      );
    }
    // One line per attempt, so every log shows which mode the run was in.
    console.log(
      `heap probe attempt ${test.info().retry}: bytes per window, total/onAnimationFrame/fake requestAnimationFrame/outside the sweep files: ${figures.join(' ')}`,
    );
    await page.mouse.up();
    hooks = await readHooks(page);
    // The death line is long gone: the kill feed expires after 300 ticks.
    expect(hooks.tick - deathTick).toBeGreaterThanOrEqual(300);
    expect(hooks.killFeed).toEqual([]);
    expect(hooks.hits).toBe(4);
    expect(hooks.projectiles, 'every shot of the volley is still in flight').toBe(SHOTS);
    // Nothing else happened to the match: still the same round, one death, the
    // bot untouched and no flash, so the arc and the shots hurt nobody, and M1
    // was cast (its icon is on cooldown), so the windows covered the casting.
    expect(hooks.phase).toBe('round');
    expect(hooks.deaths).toBe(1);
    expect(hooks.bars[3], 'the bot was hit').toBe('100');
    expect(hooks.flashing).toEqual([]);
    expect(hooks.m1Ready, 'M1 never went on cooldown, so no cast ran').toBe('false');
    expect(lowestOutsideSweep, 'the profiler saw too few allocations outside the sweep files').toBeGreaterThan(PROFILER_SANITY_BYTES);
    expect(
      worst?.combat,
      `combat code allocated ${JSON.stringify(worst?.combatByFunction)}`,
    ).toBeLessThan(COMBAT_ALLOCATION_LIMIT_BYTES);
  } finally {
    expect(problems).toEqual([]);
  }
});
