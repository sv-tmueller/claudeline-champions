import { expect, test, type Page } from '@playwright/test';
import { colourNear, countPixels, orFail, watchProblems } from './support';

// The energy orb in the standard match (rules.md 3.3, client.md Scene): the warning ring from the
// `orbSpawn` event 17 s into the round, the orb itself from 20 s, and a kill-feed line of kind orb
// when somebody takes it. The match is Hargrim on arena01 with the bots on easy, the orb on: the
// easy bots leave an idle or a walking human alive long enough, where the normal ones kill it
// before the orb. The clock is paused and the test runs it in frames on the dev time scale
// (`?timescale=10`, packages/client/src/dev-launch.ts): a 16 ms frame is about 10 ticks, so the 180
// ticks of the warning are 18 frames and a read after every frame sees each mode of the hook
// `data-orb`. The picture is `orb.png`, taken while the orb is up. Every wait is a tick budget and
// nothing names a tick: the bots change (and the bots do not contest the orb yet), so the second
// test takes any taker, and a change that kills the walking human first fails it by name.
//
// The units behind it are orb-view.test.ts (the modes against the real sim's events and the first
// collectible step), kill-feed.test.ts and hud.test.ts (the line) and the loopback orb spec of the
// server (the events over the codec).
const SCALE = 10;
const FRAME_MS = 16;
const PAUSE_AT_MS = 60_000;
const PROBE_VIEWPORT = { width: 320, height: 180 };
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
// The sim's clock (rules.md section 1, 3.3): the warmup, then the round, the warning at 1020 ticks
// into it and the orb from 1200.
const WARMUP_TICKS = 180;
const ORB_WARNING_TICKS = 1020;
const ORB_COLLECTIBLE_TICKS = 1200;
// The budget to the first warning: the warmup and the warning of the first round, with a margin
// for a round that ends before 17 s, where the next round's warning is 1200 ticks later.
const WARNING_BUDGET_TICKS = WARMUP_TICKS + 3 * ORB_WARNING_TICKS;
// The orb is gone by the end of the round it warned in: 5400 ticks of round and the sudden death.
const MATCH_BUDGET_TICKS = 10_000;
const TEST_TIMEOUT_MS = 120_000;
// The orb colour (orb-view.ts, ORB_COLOUR #2f4bff): the box has a tolerance of 24 a channel. No
// other colour of the client is in it (the blue of the ally projectile is #5cd6ff).
const ORB_BOX = colourNear([0x2f, 0x4b, 0xff], 24);
// The sphere of 0.5 m radius is about 30 px wide at 1280x720, so the orb and its ring are
// several hundred pixels.
const MIN_ORB_PIXELS = 100;

interface Line {
  kind: string | null;
  killer: string;
  killerTeam: string | null;
  victim: string;
}

interface Hooks {
  tick: number;
  phase: string;
  round: number;
  /** `data-orb`: hidden, warning or up. */
  orb: string;
  /** The champion 0's x in cm. */
  x: number;
  lines: Line[];
}

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    const lines = [...document.querySelectorAll('[data-hud="kill-feed"] [data-line][data-visible="true"]')].map((line) => ({
      kind: line.getAttribute('data-kind'),
      killer: line.querySelector('[data-part="killer"]')?.textContent ?? '',
      killerTeam: line.querySelector('[data-part="killer"]')?.getAttribute('data-team') ?? null,
      victim: line.querySelector('[data-part="victim"]')?.textContent ?? '',
    }));
    return {
      tick: Number(d['tick']),
      phase: d['phase'] ?? '',
      round: Number(d['round']),
      orb: d['orb'] ?? '',
      x: Number(d['p0x']),
      lines,
    };
  });
}

/** The paused clock, the probe viewport and the page at the match on the time scale. */
async function open(page: Page, failed: Promise<never>): Promise<void> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(PAUSE_AT_MS);
  await page.setViewportSize(PROBE_VIEWPORT);
  await page.goto(`/?champion=hargrim&difficulty=easy&arena=arena01&teamsize=2&timescale=${SCALE}`);
  await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
}

/** Runs one frame at a time until `done` holds and fails past the tick budget. `onRead` sees every read. */
async function runUntil(
  page: Page,
  label: string,
  budgetTicks: number,
  done: (hooks: Hooks) => boolean,
  onRead: (hooks: Hooks) => void = () => {},
): Promise<Hooks> {
  let hooks = await readHooks(page);
  const start = hooks.tick;
  for (;;) {
    onRead(hooks);
    if (done(hooks)) return hooks;
    expect(hooks.tick - start, `${label}: not reached within ${budgetTicks} ticks`).toBeLessThanOrEqual(budgetTicks);
    await page.clock.runFor(FRAME_MS);
    hooks = await readHooks(page);
  }
}

async function orbPixels(page: Page, png: Buffer): Promise<number> {
  const counts = await countPixels(page, png, [ORB_BOX]);
  return counts.matches[0] ?? NaN;
}

test('shows the warning ring, then the orb, and draws it on the field', async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    await open(page, failed);
    const modes: string[] = [];
    const record = (hooks: Hooks): void => {
      if (modes.at(-1) !== hooks.orb) modes.push(hooks.orb);
    };

    // 1. Hidden through the warmup and the first 17 s of the round, and no orb-coloured pixel in the
    // picture of a hidden orb.
    let hooks = await runUntil(page, 'the round phase', WARMUP_TICKS + 40, (h) => h.phase === 'round', record);
    expect(hooks.orb).toBe('hidden');
    await page.setViewportSize(SCREENSHOT_VIEWPORT);
    await page.clock.runFor(FRAME_MS);
    expect(await orbPixels(page, await page.screenshot()), 'orb-coloured pixels before the warning').toBe(0);
    await page.setViewportSize(PROBE_VIEWPORT);

    // 2. The warning: the first read of `warning` is inside the first ten ticks past tick 1020 of a round.
    hooks = await runUntil(page, 'the warning', WARNING_BUDGET_TICKS, (h) => h.orb === 'warning', record);
    expect(modes, 'hidden before the warning').toEqual(['hidden', 'warning']);

    // 3. The orb itself, from tick 1200 of the round, unless somebody took it or the round ended first.
    // The bots do not go for the orb, so with an idle human it is up for at least one read.
    hooks = await runUntil(page, 'the orb', ORB_COLLECTIBLE_TICKS - ORB_WARNING_TICKS + 60, (h) => h.orb !== 'warning', record);
    expect(hooks.orb, 'the warning became the orb').toBe('up');
    expect(modes).toEqual(['hidden', 'warning', 'up']);

    // 4. The picture of the orb on the field.
    await page.setViewportSize(SCREENSHOT_VIEWPORT);
    await page.clock.runFor(FRAME_MS);
    const now = await readHooks(page);
    if (now.orb === 'up') {
      const picture = await page.screenshot({ path: testInfo.outputPath('orb.png') });
      const pixels = await orbPixels(page, picture);
      expect(pixels, 'orb-coloured pixels with the orb up').toBeGreaterThan(MIN_ORB_PIXELS);
      console.log(`orb: up at tick ${now.tick}, ${pixels} orb-coloured pixels`);
    }
    expect(now.orb, 'the orb stays up while nobody takes it').toBe('up');
    await page.setViewportSize(PROBE_VIEWPORT);

    // 5. It goes: taken by somebody, with a feed line of kind orb that names the taker, or hidden by
    // the end of the round.
    hooks = await runUntil(page, 'the end of the orb', MATCH_BUDGET_TICKS, (h) => h.orb === 'hidden', record);
    expect(modes).toEqual(['hidden', 'warning', 'up', 'hidden']);
    const orbLines = hooks.lines.filter((line) => line.kind === 'orb');
    console.log(`orb: hidden again at tick ${hooks.tick}, phase ${hooks.phase}, ${orbLines.length} orb lines`);
    if (hooks.phase === 'round') {
      // Taken: one line of kind orb, a champion's name and a side, with the orb as the other part.
      expect(orbLines).toHaveLength(1);
      expect(orbLines[0]?.killerTeam).toMatch(/^(ally|enemy)$/);
      expect(orbLines[0]?.killer).toMatch(/^(Hargrim|Quillon)$/);
      expect(orbLines[0]?.victim).toBe('Energy orb');
    } else {
      expect(orbLines, 'no line for a round that ended with the orb up').toHaveLength(0);
    }
  } finally {
    expect(problems).toEqual([]);
  }
});

test('puts a kill-feed line of kind orb on the screen when the orb is taken', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    await open(page, failed);
    // The human stands at its spawn, (-12, 2), until the warning, and then walks right along the
    // x axis to a touch of the orb at (0, 2.5): a distance of 1 m between the centres, so x of
    // -0.5 m is inside. 12 m take 131 ticks, inside the 180 of the warning. The key is released
    // by the read that sees the human at x of -0.5 m or more.
    const STOP_X_CM = -50;
    const warned = await runUntil(page, 'the warning', WARNING_BUDGET_TICKS, (h) => h.orb === 'warning');
    await page.keyboard.down('KeyD');
    const arrived = await runUntil(page, 'the orb point', 400, (h) => h.x >= STOP_X_CM || h.orb === 'hidden');
    await page.keyboard.up('KeyD');
    console.log(`orb: warning at tick ${warned.tick}, the human at x ${arrived.x} cm by tick ${arrived.tick}`);

    // Whoever stands in reach takes the orb on the first step it can: the pickup hides it and adds the
    // line. The round ending first (the human or the bots decided it) leaves no line and fails here.
    let sawOrb = warned.orb !== 'hidden';
    const taken = await runUntil(
      page,
      'the pickup',
      ORB_COLLECTIBLE_TICKS + 120,
      (h) => sawOrb && h.orb === 'hidden',
      (h) => {
        if (h.orb !== 'hidden') sawOrb = true;
      },
    );
    const orbLines = taken.lines.filter((line) => line.kind === 'orb');
    console.log(`orb: hidden at tick ${taken.tick}, phase ${taken.phase}, lines ${JSON.stringify(taken.lines)}`);
    expect(taken.phase, 'the orb was taken in the round, not hidden by its end').toBe('round');
    expect(orbLines).toHaveLength(1);
    expect(orbLines[0]?.killer).toMatch(/^(Hargrim|Quillon)$/);
    expect(orbLines[0]?.killerTeam).toMatch(/^(ally|enemy)$/);
    expect(orbLines[0]?.victim).toBe('Energy orb');
  } finally {
    expect(problems).toEqual([]);
  }
});
