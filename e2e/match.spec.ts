import { expect, test, type Page } from '@playwright/test';
import { orFail, watchProblems } from './support';

// The default match: the local Hargrim and an ally Quillon against an enemy
// Hargrim and Quillon, all three bots on normal. The 3v3 rows play the same round
// with an ally Quillon more and an enemy Quillon more, five bots. The clock is paused and the
// test runs it in window-sized steps at the probe viewport, reading the hooks
// between steps only, so a slow machine changes the time the test takes and
// never what it sees. Every bots change moves the ticks of the round, so every
// wait here is a tick budget and no assertion names an exact tick.
interface Hooks {
  tick: number;
  phase: string;
  round: string;
  /** Champion 0 in centimeters. */
  x: number;
  y: number;
  projectiles: number;
  hits: number;
  /** One per champion, as many as the match has. */
  bars: string[];
  /** Whether the canvas has a bar hook beyond the match's champions. */
  extraBar: boolean;
  timer: string;
  resultVisible: string | null;
}

const WARMUP_TICKS = 180;
const ROUND_TICKS = 5400;
const TICK_RATE = 60;
// The sim ticks every 16.67 ms and the fake clock fires a frame every 16 ms, so
// 16 ms of fake time is one frame and about one tick.
const FRAME_MS = 16;
const PAUSE_AT_MS = 60_000;
const PROBE_VIEWPORT = { width: 320, height: 180 };
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
// The steps between two reads: ten frames, or about a sixth of a second of play.
const STEP_FRAMES = 10;
// Budgets, in ticks. The first death of the bots' match was measured at tick
// 584 counted from tick 0, so these are about three times what it needs.
const ROUND_BUDGET_TICKS = 200;
const PROJECTILE_BUDGET_TICKS = 600;
const HIT_BUDGET_TICKS = 1800;
const WALK_FRAMES = 10;
// 5.5 m/s is 9 cm a tick; the first frame only samples the key, so at least
// 8 ticks of 10 move the champion, and half of that is a safe floor.
const WALK_FLOOR_CM = 40;
const TEST_TIMEOUT_MS = 240_000;

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    return {
      tick: Number(d['tick']),
      phase: d['phase'] ?? '',
      round: d['round'] ?? '',
      x: Number(d['p0x']),
      y: Number(d['p0y']),
      projectiles: Number(d['projectiles']),
      hits: Number(d['hits']),
      bars: [0, 1, 2, 3, 4, 5].filter((id) => d[`bar${id}`] !== undefined).map((id) => d[`bar${id}`] ?? ''),
      extraBar: d['bar6'] !== undefined,
      timer: document.querySelector('[data-hud="round-timer"]')?.textContent ?? '',
      resultVisible: document.querySelector('[data-result="panel"]')?.getAttribute('data-visible') ?? null,
    };
  });
}

/** The timer of the first round at a tick: the clock starts with the round. */
function timerText(tick: number): string {
  const seconds = Math.max(0, Math.ceil((ROUND_TICKS - Math.max(0, tick - WARMUP_TICKS)) / TICK_RATE));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** While round 1 runs, the timer shows the full round minus the ticks since the round began. */
function expectTimerFollowsTick(hooks: Hooks): void {
  if (hooks.phase === 'round' && hooks.round === '1') {
    expect(hooks.timer, `the timer at tick ${hooks.tick}`).toBe(timerText(hooks.tick));
  }
}

async function runFrames(page: Page, frames: number): Promise<void> {
  await page.clock.runFor(frames * FRAME_MS);
}

/** Runs step-sized windows until `done` holds, reading between them, and fails past the budget. */
async function runUntil(
  page: Page,
  label: string,
  budgetTicks: number,
  done: (hooks: Hooks) => boolean,
): Promise<Hooks> {
  let hooks = await readHooks(page);
  const start = hooks.tick;
  for (;;) {
    expectTimerFollowsTick(hooks);
    if (done(hooks)) return hooks;
    expect(hooks.tick - start, `${label}: not reached within ${budgetTicks} ticks`).toBeLessThanOrEqual(budgetTicks);
    await runFrames(page, STEP_FRAMES);
    hooks = await readHooks(page);
  }
}

// The same round on each arena and each team size. The arena02 row proves the bots and the sim play it
// from the address, not only that the page loads it: its first death is a tick budget like arena01's.
// The 3v3 rows read six bars. `projectile` and `hit` are the ticks measured headless on 57dd52f, the
// same figures as the log lines of these rows. They are logged and never asserted: the 2v2 rows assert
// budgets only too, and every bots change moves them. arena01 267 and 301, arena02 275 and 307, as on
// 9612bff: the dash hold of #98 changes no first projectile or hit. The budgets stay 600 and 1800.
const ROWS = [
  { id: 'arena01', size: 2, address: '/', picture: 'match.png' },
  { id: 'arena02', size: 2, address: '/?arena=arena02', picture: 'match-arena02.png' },
  { id: 'arena01', size: 3, address: '/?teamsize=3', picture: 'match-3v3.png', projectile: 267, hit: 301 },
  { id: 'arena02', size: 3, address: '/?arena=arena02&teamsize=3', picture: 'match-3v3-arena02.png', projectile: 275, hit: 307 },
] as const;

for (const arena of ROWS) {
  const title =
    arena.size === 2
      ? `plays the first round of a match against bots on ${arena.id}`
      : `plays the first round of a 3v3 match against bots on ${arena.id}`;
  test(title, async ({ page }, testInfo) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const { problems, failed } = watchProblems(page);

    try {
      const startedAt = Date.now();
      await page.clock.install({ time: 0 });
      await page.goto(arena.address);
      await orFail(page.waitForSelector(`canvas[data-arena="${arena.id}"][data-tick]`), failed);
      await page.clock.pauseAt(PAUSE_AT_MS);
      await page.setViewportSize(PROBE_VIEWPORT);

      // The warmup, then the round.
      let hooks = await runUntil(page, 'the round phase', ROUND_BUDGET_TICKS, (h) => h.phase === 'round');
      expect(hooks.round).toBe('1');
      expect(hooks.resultVisible).toBe('false');
      // A bar hook per champion: four in a 2v2, six in a 3v3, and no more.
      expect(hooks.bars, `the bars of the ${arena.size}v${arena.size}`).toEqual(Array(2 * arena.size).fill('100'));
      expect(hooks.extraBar).toBe(false);

      // Input reaches the champion: D moves it east.
      const before = await readHooks(page);
      await page.keyboard.down('KeyD');
      await runFrames(page, WALK_FRAMES);
      await page.keyboard.up('KeyD');
      await runFrames(page, 2);
      hooks = await readHooks(page);
      expect(hooks.x - before.x, 'holding D moved champion 0 east').toBeGreaterThanOrEqual(WALK_FLOOR_CM);

      // The bots fight: a projectile flies within 600 ticks of the round start, and
      // a hit lands within 1800. These two need the bots to cast (#58).
      hooks = await runUntil(
        page,
        'a projectile',
        PROJECTILE_BUDGET_TICKS - (hooks.tick - WARMUP_TICKS),
        (h) => h.projectiles > 0 || h.hits > 0,
      );
      if (arena.size === 3) console.log(`first projectile on ${arena.id} 3v3: tick ${hooks.tick}, headless ${arena.projectile}`);
      hooks = await runUntil(
        page,
        'a hit or a bar below 100',
        HIT_BUDGET_TICKS - (hooks.tick - WARMUP_TICKS),
        (h) => h.hits > 0 || h.bars.some((bar) => bar !== '100'),
      );
      console.log(
        `first hit on ${arena.id}${arena.size === 3 ? ' 3v3' : ''}: tick ${hooks.tick}${arena.size === 3 ? `, headless ${arena.hit}` : ''}, ${Date.now() - startedAt} ms`,
      );

      // The result panel stays hidden until the match ends.
      expectTimerFollowsTick(hooks);
      expect(hooks.resultVisible).toBe('false');
      expect(await page.locator('[data-result="panel"]').isVisible()).toBe(false);

      await page.setViewportSize(SCREENSHOT_VIEWPORT);
      await runFrames(page, 2);
      await page.screenshot({ path: testInfo.outputPath(arena.picture) });
    } finally {
      expect(problems).toEqual([]);
    }
  });
}
