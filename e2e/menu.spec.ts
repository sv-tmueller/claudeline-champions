import { expect, test, type Page } from '@playwright/test';
import { orFail, watchProblems } from './support';

// The Escape menu: the pause, restart, the champion and arena select, and a rebinding
// that survives a reload. Like match.spec.ts the clock is paused and the test runs it in
// 16 ms frames, reading the hooks between steps, so a slow machine changes the time a
// test takes and never what it sees. A frame is one tick, about: the sim ticks every
// 16.67 ms and the fake clock fires a frame every 16 ms.
const FRAME_MS = 16;
const PAUSE_AT_MS = 60_000;
// The menu is clicked at the viewport of the screenshots, where its keys view fits. The
// frames run at the small probe viewport, where a frame costs 17 to 24 ms on the CI
// runner instead of 105 to 210 ms.
const PROBE_VIEWPORT = { width: 320, height: 180 };
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
const TEST_TIMEOUT_MS = 120_000;
// The pause test: frames run while the menu is open, which must not advance the sim, and
// frames after Resume. With the clock reset of the resume the first frame only stores its
// timestamp, so 10 frames run 9 steps at most (8 or 9 in practice at 60/62.5 ticks per
// frame); without the reset the first frame would catch up the 960 ms of the pause, capped
// at 5 steps, and the 10 frames would run 13 or 14.
const PAUSED_FRAMES = 60;
const RESUMED_FRAMES = 10;
// 5.5 m/s is 9 cm a tick; the first frame only samples the key, so at least 8 ticks of 10
// move the champion, and half of that is a safe floor (as in match.spec.ts).
const WALK_FRAMES = 10;
const WALK_FLOOR_CM = 40;
const ROUND_BUDGET_TICKS = 200;

interface Hooks {
  tick: number;
  phase: string;
  arena: string;
  x: number;
  y: number;
  healthText: string;
  /** How many `data-bar` hooks the canvas has: one per champion. */
  bars: number;
  menuVisible: string | null;
  menuView: string | null;
}

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    const panel = document.querySelector('[data-menu="panel"]');
    return {
      tick: Number(d['tick']),
      phase: d['phase'] ?? '',
      arena: d['arena'] ?? '',
      x: Number(d['p0x']),
      y: Number(d['p0y']),
      healthText: document.querySelector('[data-hud="health-bar"] [data-part="health-text"]')?.textContent ?? '',
      bars: [0, 1, 2, 3, 4, 5, 6, 7].filter((id) => d[`bar${id}`] !== undefined).length,
      menuVisible: panel?.getAttribute('data-visible') ?? null,
      menuView: panel?.getAttribute('data-view') ?? null,
    };
  });
}

async function runFrames(page: Page, frames: number): Promise<void> {
  await page.clock.runFor(frames * FRAME_MS);
}

/** Opens the page on a paused clock at the probe viewport, as match-end.spec.ts does. */
async function open(page: Page, address: string, failed: Promise<never>): Promise<void> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(PAUSE_AT_MS);
  await page.setViewportSize(PROBE_VIEWPORT);
  await page.goto(address);
  await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
}

/** Marks the page, so a test can tell a reloaded page from the old one. */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __menuSpecMark: number }).__menuSpecMark = 1;
  });
}

async function isMarked(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __menuSpecMark?: number }).__menuSpecMark === 1);
}

/** Waits for the page that replaces the marked one, ready to read. */
async function waitForReload(page: Page, failed: Promise<never>): Promise<void> {
  await orFail(page.waitForFunction(() => (window as unknown as { __menuSpecMark?: number }).__menuSpecMark !== 1), failed);
  await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
}

const panel = (page: Page) => page.locator('[data-menu="panel"]');

async function expectMenu(page: Page, visible: boolean, view = 'main'): Promise<void> {
  const hooks = await readHooks(page);
  expect(hooks.menuVisible, 'the menu panel').toBe(visible ? 'true' : 'false');
  if (visible) expect(hooks.menuView, 'the menu view').toBe(view);
  expect(await panel(page).isVisible()).toBe(visible);
}

/** Opens the menu with Escape at the large viewport, where it is clicked. */
async function openMenu(page: Page): Promise<void> {
  await page.setViewportSize(SCREENSHOT_VIEWPORT);
  await page.keyboard.press('Escape');
  await expectMenu(page, true);
}

async function useProbeViewport(page: Page): Promise<void> {
  await page.setViewportSize(PROBE_VIEWPORT);
}

test('pauses the match while the menu is open, and a resume does not catch the pause up', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);
  try {
    await open(page, '/', failed);
    await runFrames(page, 30);
    const before = await readHooks(page);
    expect(before.tick, 'the match was running').toBeGreaterThan(0);
    await expectMenu(page, false);

    await openMenu(page);
    await useProbeViewport(page);
    await runFrames(page, PAUSED_FRAMES);
    const paused = await readHooks(page);
    expect(paused.tick, `${PAUSED_FRAMES} frames ran under the open menu`).toBe(before.tick);
    expect(paused.menuVisible).toBe('true');

    // Resume with its button.
    await page.setViewportSize(SCREENSHOT_VIEWPORT);
    await page.locator('[data-action="resume"]').click();
    await expectMenu(page, false);
    await useProbeViewport(page);
    await runFrames(page, RESUMED_FRAMES);
    const resumed = await readHooks(page);
    const ran = resumed.tick - paused.tick;
    expect(ran, 'the match runs on after Resume').toBeGreaterThan(0);
    expect(ran, 'the 960 ms of the pause were not caught up').toBeLessThanOrEqual(RESUMED_FRAMES);
    console.log(`menu pause: tick ${before.tick} paused for ${PAUSED_FRAMES} frames, ${ran} ticks in ${RESUMED_FRAMES} frames after Resume`);

    // Escape closes it too, and a second Escape opens it again.
    await page.keyboard.press('Escape');
    await expectMenu(page, true);
    await page.keyboard.press('Escape');
    await expectMenu(page, false);
  } finally {
    expect(problems).toEqual([]);
  }
});

test('restarts the match from the menu: a new page on the same arena and champion', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);
  try {
    await open(page, '/?champion=quillon&arena=arena02', failed);
    await runFrames(page, 110);
    await mark(page);
    const before = await readHooks(page);
    expect(before.tick).toBeGreaterThan(100);

    await openMenu(page);
    await page.locator('[data-action="restart"]').click();
    await waitForReload(page, failed);

    expect(await isMarked(page), 'a new page').toBe(false);
    const after = await readHooks(page);
    expect(after.tick, 'the tick went back').toBeLessThan(before.tick);
    expect(after.phase).toBe('warmup');
    expect(after.healthText, 'still Quillon').toBe('120 / 120');
    expect(after.arena, 'still arena02').toBe('arena02');
    expect(after.x, 'on the arena02 spawn').toBe(-1100);
    expect(after.menuVisible, 'the menu is closed again').toBe('false');
  } finally {
    expect(problems).toEqual([]);
  }
});

test('goes back to the select from the menu and relaunches on another arena', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);
  try {
    await open(page, '/', failed);
    await mark(page);
    await openMenu(page);
    await page.locator('[data-menu="panel"] [data-action="select"]').click();
    await expectMenu(page, true, 'select');

    // The select of the menu: the champion links stay on this arena, and both arenas are offered.
    const links = await page.evaluate(() => ({
      champions: [...document.querySelectorAll<HTMLElement>('[data-menu="panel"] [data-champion]')].map((entry) => [
        entry.getAttribute('data-champion'),
        entry.getAttribute('href'),
      ]),
      arenas: [...document.querySelectorAll<HTMLElement>('[data-menu="panel"] [data-arena-id]')].map((entry) => [
        entry.getAttribute('data-arena-id'),
        entry.getAttribute('data-current'),
        entry.getAttribute('href'),
      ]),
      teams: [...document.querySelectorAll<HTMLElement>('[data-menu="panel"] [data-team-size]')].map((entry) => [
        entry.getAttribute('data-team-size'),
        entry.getAttribute('data-current'),
        entry.getAttribute('href'),
        entry.textContent,
      ]),
    }));
    expect(links.champions.map(([id]) => id)).toEqual(['hargrim', 'quillon', 'lumeth', 'skerrow']);
    expect(links.champions.find(([id]) => id === 'quillon')?.[1]).toBe('?champion=quillon&difficulty=normal&arena=arena01&teamsize=2');
    expect(links.arenas).toEqual([
      ['arena01', 'true', '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2'],
      ['arena02', 'false', '?champion=hargrim&difficulty=normal&arena=arena02&teamsize=2'],
    ]);
    // The team row: 2v2 is being played, and each link writes the whole setup with its own size.
    expect(links.teams).toEqual([
      ['2', 'true', '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2', '2v2'],
      ['3', 'false', '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=3', '3v3'],
    ]);
    // The match is still paused behind it.
    const paused = await readHooks(page);
    await page.setViewportSize(PROBE_VIEWPORT);
    await runFrames(page, 20);
    expect((await readHooks(page)).tick).toBe(paused.tick);
    await page.setViewportSize(SCREENSHOT_VIEWPORT);

    await page.locator('[data-menu="panel"] [data-arena-id="arena02"]').click();
    await waitForReload(page, failed);
    expect(await isMarked(page)).toBe(false);
    await orFail(page.waitForSelector('canvas[data-arena="arena02"]'), failed);
    expect((await readHooks(page)).menuVisible).toBe('false');
  } finally {
    expect(problems).toEqual([]);
  }
});

test('relaunches as a 3v3 from the menu select, and a restart keeps the team size', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);
  try {
    await open(page, '/', failed);
    expect((await readHooks(page)).bars, 'a 2v2 has four bars').toBe(4);
    await mark(page);
    await openMenu(page);
    await page.locator('[data-menu="panel"] [data-action="select"]').click();
    await expectMenu(page, true, 'select');
    await page.locator('[data-menu="panel"] [data-team-size="3"]').click();
    await waitForReload(page, failed);
    expect(await isMarked(page), 'a new page').toBe(false);
    await orFail(page.waitForSelector('canvas[data-bar5]'), failed);
    let after = await readHooks(page);
    expect(after.bars, 'a 3v3 has six bars').toBe(6);
    expect(after.menuVisible, 'the menu is closed again').toBe('false');
    expect(new URL(page.url()).search).toBe('?champion=hargrim&difficulty=normal&arena=arena01&teamsize=3');

    // The menu of the 3v3 offers it as the current size, and Restart keeps it.
    await mark(page);
    await openMenu(page);
    await page.locator('[data-menu="panel"] [data-action="select"]').click();
    await expectMenu(page, true, 'select');
    expect(
      await page.locator('[data-menu="panel"] [data-team-size="3"]').getAttribute('data-current'),
      '3v3 is current',
    ).toBe('true');
    await page.locator('[data-menu="panel"] [data-action="back"]').first().click();
    await page.locator('[data-action="restart"]').click();
    await waitForReload(page, failed);
    expect(await isMarked(page), 'a new page').toBe(false);
    await orFail(page.waitForSelector('canvas[data-bar5]'), failed);
    after = await readHooks(page);
    expect(after.bars, 'still a 3v3 after Restart').toBe(6);
    expect(after.phase).toBe('warmup');
  } finally {
    expect(problems).toEqual([]);
  }
});

test('rebinds a key from the menu, refuses a duplicate, and keeps the binding across a reload', async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);
  const keyOf = (action: string) => page.locator(`[data-menu="panel"] [data-binding="${action}"] [data-part="key"]`);
  const rebind = (action: string) => page.locator(`[data-menu="panel"] [data-rebind="${action}"]`);
  const keysSection = page.locator('[data-menu="panel"] [data-section="keys"]');
  const walk = async (code: string): Promise<number> => {
    const before = await readHooks(page);
    await page.keyboard.down(code);
    await runFrames(page, WALK_FRAMES);
    await page.keyboard.up(code);
    await runFrames(page, 2);
    return (await readHooks(page)).x - before.x;
  };
  const runToRound = async (): Promise<void> => {
    for (let ran = 0; ran <= ROUND_BUDGET_TICKS; ran += 10) {
      if ((await readHooks(page)).phase === 'round') return;
      await runFrames(page, 10);
    }
    expect((await readHooks(page)).phase, 'the round phase').toBe('round');
  };
  try {
    // The sandbox: its one bot never comes near, so the positions below depend on no bot.
    await open(page, '/?scene=sandbox', failed);
    await openMenu(page);
    await page.locator('[data-menu="panel"] [data-action="keys"]').click();
    await expectMenu(page, true, 'keys');
    await expect(keyOf('right')).toHaveText('D');

    await rebind('right').click();
    expect(await keysSection.getAttribute('data-capturing')).toBe('right');
    await page.keyboard.press('KeyL');
    await expect(keyOf('right')).toHaveText('L');
    expect(await keysSection.getAttribute('data-capturing')).toBe('none');

    // KeyL is taken now: up on KeyL is refused, nothing changes, and Escape cancels the capture
    // without closing the menu.
    await rebind('up').click();
    await page.keyboard.press('KeyL');
    expect(await keysSection.getAttribute('data-error')).toBe('duplicate');
    await expect(keyOf('up')).toHaveText('W');
    await page.keyboard.press('Escape');
    expect(await keysSection.getAttribute('data-capturing')).toBe('none');
    await expectMenu(page, true, 'keys');
    await page.screenshot({ path: testInfo.outputPath('menu.png') });

    // The binding is saved: a new page reads it back.
    await page.reload();
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    await openMenu(page);
    await page.locator('[data-menu="panel"] [data-action="keys"]').click();
    await expect(keyOf('right')).toHaveText('L');
    await page.keyboard.press('Escape');
    await expectMenu(page, false);

    // In the round, KeyL moves the champion east and the old KeyD does not.
    await page.setViewportSize(PROBE_VIEWPORT);
    await runToRound();
    expect(await walk('KeyL'), 'holding KeyL moved champion 0 east').toBeGreaterThanOrEqual(WALK_FLOOR_CM);
    expect(await walk('KeyD'), 'holding KeyD no longer moves it').toBe(0);

    // Reset puts the defaults back: KeyD moves it again.
    await openMenu(page);
    await page.locator('[data-menu="panel"] [data-action="keys"]').click();
    await page.locator('[data-menu="panel"] [data-action="reset"]').click();
    await expect(keyOf('right')).toHaveText('D');
    await page.keyboard.press('Escape');
    await expectMenu(page, false);
    await page.setViewportSize(PROBE_VIEWPORT);
    expect(await walk('KeyD'), 'holding KeyD moved champion 0 east after the reset').toBeGreaterThanOrEqual(WALK_FLOOR_CM);
  } finally {
    expect(problems).toEqual([]);
  }
});
