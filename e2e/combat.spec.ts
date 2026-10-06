import { expect, test, type Page } from '@playwright/test';
import {
  COMBAT_ALLOCATION_LIMIT_BYTES,
  PROBE_VIEWPORT,
  PROFILER_SANITY_BYTES,
  measureWindows,
  openProbe,
  runWindow,
} from './heap-probe';
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

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    const list = (value: string | undefined): string[] => (value ? value.split(',') : []);
    // One hook per champion, data-bar0 to data-bar3: the fill percent, x for a hidden bar.
    const bars = [0, 1, 2, 3].map((id) => d[`bar${id}`] ?? '');
    return {
      tick: Number(d['tick']),
      projectiles: Number(d['projectiles']),
      areas: Number(d['areas']),
      hits: Number(d['hits']),
      deaths: Number(d['deaths']),
      rings: Number(d['rings']),
      flashing: list(d['flashing']),
      bars,
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

// A shot flies 27 m at 10 m/s, 162 ticks or 5.4 windows, from the spawn to the
// east boundary.
const WINDOWS_PER_FLIGHT = 6;
// Volleys the engine warms up on before the measured one. The depth does not
// change the bad mode of the heap probe (decision 9 of batch #32: 4 and 8
// volleys read alike), so the warm-up is the short one, 12 s less on the runner.
const WARM_UP_VOLLEYS = 4;
// Five windows measured right after the volley, with no settle window: 150 ticks, all
// of them before the first shot ends (162). The asserted figure is the median of the
// five (decision 12 of batch #63, from the isolation of #77, see testing.md): window 0
// holds the first frame's acquire of the volley's eight views and reads 636 to 1068 B
// counted (59 attempts, runner and local, see COMBAT_ALLOCATION_LIMIT_BYTES), and a
// one-off spike in another function can land in any window, so the worst window is not
// a stable figure and the median is.
const MEASURED_WINDOWS = 5;
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

/**
 * Eight shots in the same frame. A key press is dispatched in the page before
 * its call returns, and the shot count is read back, so every shot is in the
 * state before the next window runs.
 */
async function fireVolley(page: Page): Promise<void> {
  const before = (await readHooks(page)).debugShots;
  for (let shot = 0; shot < SHOTS; shot++) await page.keyboard.press('F4');
  expect((await readHooks(page)).debugShots, 'every F4 press of the volley fired').toBe(before + SHOTS);
}

// No retries: the asserted figure is the median of five windows, which a one-off JIT
// spike in one window does not move (the spikes of the isolation, 5 attempts of 24 on
// the runner, were each in one window), and a regression of the sizes measured (784 B
// and up, see COMBAT_ALLOCATION_LIMIT_BYTES) raises every window. The global retries stay 0 in playwright.config.ts.

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
    const cdp = await openProbe(page);
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
    // the engine warms up on volleys. The measured windows hold no new spawn and
    // no end of a shot, only frames with eight shots in flight, and in them the
    // combat code allocates nothing but the hook's boxed numbers (window 0 also
    // acquires the views of the volley). On the CI runner every frame costs 105 to
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
    // The median of the windows is the asserted figure, and the line of the attempt
    // and the functions of every window with counted bytes are in the log.
    const measured = await measureWindows(page, cdp, 'sandbox', test.info().repeatEachIndex, MEASURED_WINDOWS);
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
    expect(measured.lowestOutsideSweep, 'the profiler saw too few allocations outside the sweep files').toBeGreaterThan(
      PROFILER_SANITY_BYTES,
    );
    expect(
      measured.asserted.combat,
      `combat code allocated ${JSON.stringify(measured.asserted.combatByFunction)}`,
    ).toBeLessThan(COMBAT_ALLOCATION_LIMIT_BYTES);
  } finally {
    expect(problems).toEqual([]);
  }
});
