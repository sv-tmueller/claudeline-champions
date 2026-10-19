import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_MATCH, orFail, watchProblems } from './support';

// The Escape menu: the pause, restart, the champion, arena, team and difficulty select (the
// team row, the 3v3 relaunch and a Restart that keeps it, the hard-tier relaunch likewise),
// a rebinding that survives a reload, and the sound: the five sounds on their events against
// a counting fake AudioContext, and the mute toggle with its round trip through the saved
// settings. Like match.spec.ts the clock is paused and the test runs it in 16 ms frames,
// reading the hooks between steps, so a slow machine changes the time a test takes and never
// what it sees. A frame is one tick, about: the sim ticks every 16.67 ms and the fake
// clock fires a frame every 16 ms; the sound test runs on the dev-only time scale of
// match-end.spec.ts instead, 96 ticks a frame.
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
// The sound test's time scale (`?timescale=100`, as in match-end.spec.ts): a 16 ms frame is
// 96 ticks, which is under the 180 ticks of the round end, so a read after every frame sees
// the round-end phase once. A round lasts at most 5400 ticks, so 5400 / 96 frames, and the
// budget is that plus the 180 ticks of the warmup and the round end and some slack.
const SOUND_SCALE = 100;
const SOUND_FRAME_BUDGET = Math.ceil(5400 / 96) + 12;
// The saved settings, as the platform writes them (packages/client/src/platform.ts).
const SETTINGS_KEY = 'claudeline-champions.settings';

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
    await open(page, DEFAULT_MATCH, failed);
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
    await open(page, DEFAULT_MATCH, failed);
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
    await open(page, DEFAULT_MATCH, failed);
    expect((await readHooks(page)).bars, 'a 2v2 has four bars').toBe(4);
    await mark(page);
    await openMenu(page);
    await expect(page.locator('[data-menu="panel"] [data-action="select"]')).toHaveText('Champion, arena, teams and difficulty');
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

test('relaunches on the hard tier from the menu select, and a restart keeps the tier', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);
  const hard = () => page.locator('[data-menu="panel"] [data-difficulty="hard"]');
  try {
    await open(page, DEFAULT_MATCH, failed);
    await mark(page);
    await openMenu(page);
    await page.locator('[data-menu="panel"] [data-action="select"]').click();
    await expectMenu(page, true, 'select');
    // The difficulty row: normal is current, and each link writes the whole setup with its tier.
    const row = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-menu="panel"] [data-difficulty]')].map((entry) => [
        entry.getAttribute('data-difficulty'),
        entry.getAttribute('data-current'),
        entry.getAttribute('href'),
        entry.textContent,
      ]),
    );
    expect(row).toEqual([
      ['easy', 'false', '?champion=hargrim&difficulty=easy&arena=arena01&teamsize=2', 'Easy'],
      ['normal', 'true', '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2', 'Normal'],
      ['hard', 'false', '?champion=hargrim&difficulty=hard&arena=arena01&teamsize=2', 'Hard'],
    ]);
    await hard().click();
    await waitForReload(page, failed);
    expect(await isMarked(page), 'a new page').toBe(false);
    expect(new URL(page.url()).search).toBe('?champion=hargrim&difficulty=hard&arena=arena01&teamsize=2');
    expect((await readHooks(page)).menuVisible, 'the menu is closed again').toBe('false');

    // The menu of the hard match offers hard as the current tier, and Restart keeps it.
    await mark(page);
    await openMenu(page);
    await page.locator('[data-menu="panel"] [data-action="select"]').click();
    await expectMenu(page, true, 'select');
    expect(await hard().getAttribute('data-current'), 'hard is current').toBe('true');
    expect(await page.locator('[data-menu="panel"] [data-difficulty="normal"]').getAttribute('data-current')).toBe('false');
    await page.locator('[data-menu="panel"] [data-action="back"]').first().click();
    await page.locator('[data-action="restart"]').click();
    await waitForReload(page, failed);
    expect(await isMarked(page), 'a new page').toBe(false);
    expect(new URL(page.url()).search, 'still hard after Restart').toBe('?champion=hargrim&difficulty=hard&arena=arena01&teamsize=2');
    expect((await readHooks(page)).phase).toBe('warmup');
  } finally {
    expect(problems).toEqual([]);
  }
});

interface FakeAudio {
  contexts: number;
  resumes: number;
  /** One count per voice, in SOUNDS order: hit, cast, death, round start, round end. */
  plays: number[];
}

/**
 * Replaces `AudioContext` with a counting fake before any page script runs, so the platform's
 * factory builds it. The voices are the gains made after the master, in creation order, which is
 * the order of SOUNDS; a play is one `cancelScheduledValues` on its voice's gain (the client's
 * unit test pins that a play makes exactly one). The fake's `currentTime` throws, so the page
 * fails if a play ever reads it.
 */
async function installFakeAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fake: FakeAudio = { contexts: 0, resumes: 0, plays: [0, 0, 0, 0, 0] };
    (window as unknown as { __fakeAudio: FakeAudio }).__fakeAudio = fake;
    class FakeParam {
      value = 0;
      constructor(private readonly voice: number) {}
      cancelScheduledValues(): void {
        if (this.voice >= 0) fake.plays[this.voice] = (fake.plays[this.voice] ?? 0) + 1;
      }
      setValueAtTime(): void {}
      setTargetAtTime(): void {}
    }
    class FakeContext {
      state = 'suspended';
      destination = {};
      private gains = 0;
      constructor() {
        fake.contexts += 1;
      }
      get currentTime(): number {
        throw new Error('a play read currentTime');
      }
      createGain(): { gain: FakeParam; connect(): void } {
        // The first gain is the master, the next five the voices.
        return { gain: new FakeParam(this.gains++ - 1), connect() {} };
      }
      createOscillator(): { type: string; frequency: { value: number }; connect(): void; start(): void } {
        return { type: 'sine', frequency: { value: 0 }, connect() {}, start() {} };
      }
      resume(): Promise<void> {
        fake.resumes += 1;
        this.state = 'running';
        return Promise.resolve();
      }
    }
    (window as unknown as { AudioContext: typeof FakeContext }).AudioContext = FakeContext;
  });
}

async function readAudio(page: Page): Promise<FakeAudio> {
  return page.evaluate(() => {
    const fake = (window as unknown as { __fakeAudio: FakeAudio }).__fakeAudio;
    return { contexts: fake.contexts, resumes: fake.resumes, plays: [...fake.plays] };
  });
}

interface MatchRead {
  phase: string;
  round: number;
  hits: number;
  deaths: number;
}

async function readMatch(page: Page): Promise<MatchRead> {
  return page.evaluate(() => {
    const d = document.querySelector('canvas')?.dataset;
    if (!d) throw new Error('no canvas');
    return { phase: d['phase'] ?? '', round: Number(d['round']), hits: Number(d['hits'] ?? 0), deaths: Number(d['deaths'] ?? 0) };
  });
}

/** Runs 96-tick frames, reading after each, until `done` holds. Fails past the frame budget. */
async function runFramesUntil(page: Page, label: string, done: (read: MatchRead) => boolean): Promise<MatchRead> {
  for (let frames = 0; frames <= SOUND_FRAME_BUDGET; frames++) {
    const read = await readMatch(page);
    if (done(read)) return read;
    await runFrames(page, 1);
  }
  throw new Error(`${label}: not reached within ${SOUND_FRAME_BUDGET} frames, is the time scale on?`);
}

test('plays the five sounds on their events, and the mute survives a reload', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);
  const mute = page.locator('[data-menu="panel"] [data-action="mute"]');
  try {
    await installFakeAudio(page);
    await open(page, `/?timescale=${SOUND_SCALE}`, failed);
    // Nothing is built before a gesture. A key press in the warmup is one, and the warmup runs
    // on to round 1.
    expect(await readAudio(page), 'no context before a gesture').toEqual({ contexts: 0, resumes: 0, plays: [0, 0, 0, 0, 0] });
    await page.keyboard.press('KeyW');
    let audio = await readAudio(page);
    expect(audio.contexts, 'the gesture made the context').toBe(1);
    expect(audio.resumes, 'and resumed it').toBe(1);
    await runFramesUntil(page, 'round 1 to begin', (read) => read.phase === 'round');

    // Hold the mouse for one frame (96 ticks of the round): the human casts. Then run to the end
    // of round 1.
    await page.mouse.down();
    await runFrames(page, 1);
    await page.mouse.up();
    const ended = await runFramesUntil(page, 'round 1 to end', (read) => read.phase === 'roundEnd');
    audio = await readAudio(page);
    const [hit, cast, death, roundStart, roundEnd] = audio.plays as [number, number, number, number, number];
    expect(roundStart, 'a round start per round begun').toBe(ended.round);
    expect(roundEnd, 'one round end').toBe(1);
    expect(death, 'a death sound per death').toBe(ended.deaths);
    expect(ended.deaths, 'round 1 ended in deaths').toBeGreaterThan(0);
    expect(hit, 'a hit sound for every projectile hit').toBeGreaterThanOrEqual(ended.hits);
    expect(hit, 'and some hits').toBeGreaterThan(0);
    expect(cast, 'the local champion cast').toBeGreaterThanOrEqual(1);
    expect(audio.contexts, 'one context').toBe(1);

    // Mute from the menu: the button reads it, and nothing plays through the next round start.
    await openMenu(page);
    await expect(mute).toHaveText('Sound: on');
    await mute.click();
    await expect(mute).toHaveText('Sound: off');
    expect(await mute.getAttribute('data-muted')).toBe('true');
    await page.locator('[data-action="resume"]').click();
    await expectMenu(page, false);
    await useProbeViewport(page);
    const before = (await readAudio(page)).plays;
    await runFramesUntil(page, 'round 2 to begin', (read) => read.round === 2 && read.phase === 'round');
    await runFrames(page, 5);
    expect((await readAudio(page)).plays, 'a muted sound plays nothing').toEqual(before);

    // The mute is saved, and a new page reads it: the button says so and the sound stays silent.
    await page.reload();
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)) ?? 'null') as unknown;
    expect(saved, 'the settings were saved at version 2 with the mute').toMatchObject({ version: 2, muted: true });
    await page.keyboard.press('KeyW');
    expect((await readAudio(page)).contexts, 'the gesture made the context of the new page').toBe(1);
    await runFramesUntil(page, 'round 1 to begin after the reload', (read) => read.phase === 'round');
    expect((await readAudio(page)).plays, 'the stored mute silences the round start').toEqual([0, 0, 0, 0, 0]);

    // Unmute: the round that ends and the round that begins next both play.
    await openMenu(page);
    await expect(mute).toHaveText('Sound: off');
    expect(await mute.getAttribute('data-muted')).toBe('true');
    await mute.click();
    await expect(mute).toHaveText('Sound: on');
    await page.locator('[data-action="resume"]').click();
    await expectMenu(page, false);
    await useProbeViewport(page);
    await runFramesUntil(page, 'round 2 to begin after the unmute', (read) => read.round === 2 && read.phase === 'round');
    const after = (await readAudio(page)).plays;
    expect(after[3], 'the next round start plays once').toBe(1);
    expect(after[4], 'and so did the round end before it').toBe(1);
    const saved2 = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)) ?? 'null') as unknown;
    expect(saved2, 'the unmute is saved').toMatchObject({ version: 2, muted: false });
  } finally {
    expect(problems).toEqual([]);
  }
});
