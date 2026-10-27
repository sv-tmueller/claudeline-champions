import { expect, test, type Page } from '@playwright/test';
import { PROBE_VIEWPORT } from './heap-probe';
import { orFail, watchProblems } from './support';

// The held C key, in a browser, on `?champion=lumeth` with a paused clock like lingering.spec.ts.
// While C is held the client sets the aim to the champion's own position, so a self-aimed ally
// projectile lands on her and no bolt is made (rules.md section 6, section 2.5). The spec reads
// DOM hooks only, so it asserts what the page shows: the slot's windup starts and ends (the cast
// fired), and `data-projectiles` stays 0 through the fire tick and 4 ticks after it. Without C a
// bolt flies, and the control at the end reads 1 or more. The landing itself, the events (no
// projectileSpawned, a heal of 6, 8.4 and 13.2, the hot, the shield), is asserted by the headless
// scene packages/client/src/self-cast-scene.test.ts on the real sim, because nothing in the page
// exposes sim events. Steps: Mend Bolt (M1), Soothing Surge (M2), Aegis Veil (R), and the release of
// C. The EX needs 25 energy, which only hits on bots earn, and would tie this spec to bot
// behaviour, so it is covered headless only; Dawnbloom costs 100 energy and C does not change it.
//
// Bot race: a bot projectile also counts in `data-projectiles`. With an idle human the first bot
// projectile of this match is at tick 267, 79 ticks into the round (measured on 2026-10-27 with a
// paused clock at 17 ms frames, round phase read at tick 188). The last read of 0 must be at least
// 20 ticks before that, and a change of the bots that fires sooner fails with a message that says why.
//
// Every wait is a tick budget read from the canvas hooks, and the warmup and the waits are batches
// of one `runFor`. The once-per-tick mapping of main.ts is not pinned here: a paused-clock frame
// runs one tick, and a timescale row would race the bots.

// Playwright's clock fires a frame every 16 ms of fake time and the sim ticks every 16.67 ms, so a
// frame of 17 ms runs about one tick (combat.spec.ts).
const FRAME_MS = 17;
const PAUSE_AT_MS = 60_000;
// The warmup is 180 ticks, WARMUP_TICKS in the sim.
const WARMUP_TICKS = 180;
const WARMUP_BUDGET_TICKS = 40;
// The first bot projectile, in ticks into the round, with an idle human (see the header).
const FIRST_BOT_PROJECTILE_TICKS = 79;
const BOT_MARGIN_TICKS = 20;
// Mend Bolt (data/kits/lumeth.json): 6 ticks of windup. Soothing Surge: 18.
const CAST_BUDGET_TICKS = 3;
const M1_WINDUP_BUDGET_TICKS = 10;
const M2_WINDUP_BUDGET_TICKS = 22;
const SHIELD_BUDGET_TICKS = 3;
// After the cast fires, the bolt of a cast aimed away from her would be on the page within a tick.
const AFTER_FIRE_TICKS = 4;
// Mend Bolt has a cooldown of 36 ticks; it was cast well before the release, so this is a margin.
const M1_READY_BUDGET_TICKS = 40;
const CONTROL_BUDGET_TICKS = 10;
// A frame costs 17 to 24 ms at 320x180 on the runner (about 250: the warmup, the 6 and 18 ticks of
// the windups and about 60 read one by one), so the frames take 4 to 6 s; a read costs 32 to 75 ms
// and there are about 70, so 2 to 5 s; with the page load the test takes about 15 s. The 45 s
// timeout is more than twice that (the rule of testing.md); a run past half of it applies the rule
// again. Measured on 2026-10-27 on Apple silicon: 2.0 to 2.7 s a test, 3.4 s for five in parallel
// (`--repeat-each=5`, no flake); the last read of 0 is 35 ticks into the round, 44 before the first
// bot projectile.
const TEST_TIMEOUT_MS = 45_000;

interface Hooks {
  tick: number;
  phase: string;
  /** `data-projectiles`: the projectile views shown. */
  projectiles: number;
  m1Windup: string | null;
  m1Ready: string | null;
  m2Windup: string | null;
  m2Ready: string | null;
  shieldVisible: string | null;
  shieldAbsorb: string | null;
}

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    const slot = (name: string, attribute: string): string | null =>
      document.querySelector(`[data-slot="${name}"]`)?.getAttribute(attribute) ?? null;
    const shield = document.querySelector('[data-part="shield"]');
    return {
      tick: Number(d['tick']),
      phase: d['phase'] ?? '',
      projectiles: Number(d['projectiles']),
      m1Windup: slot('M1', 'data-windup'),
      m1Ready: slot('M1', 'data-ready'),
      m2Windup: slot('M2', 'data-windup'),
      m2Ready: slot('M2', 'data-ready'),
      shieldVisible: shield?.getAttribute('data-visible') ?? null,
      shieldAbsorb: shield?.getAttribute('data-absorb') ?? null,
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

test("lands Lumeth's own bolts and veil on her while C is held, and sends a bolt to the cursor after", async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    await page.clock.install({ time: 0 });
    await page.goto('/?champion=lumeth&difficulty=normal&arena=arena01&teamsize=2');
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    await page.clock.pauseAt(PAUSE_AT_MS);
    await page.setViewportSize(PROBE_VIEWPORT);
    // 1. The cursor in the middle of the canvas, about 12 m east of her spawn at (-12, 2): far
    // outside her 0.5 m circle, so any bolt that is made flies away from her.
    await page.mouse.move(PROBE_VIEWPORT.width / 2, PROBE_VIEWPORT.height / 2);

    // 2. The warmup in one call, then the round: nothing flies yet.
    await page.clock.runFor(WARMUP_TICKS * FRAME_MS);
    let hooks = await runUntil(page, 'the round phase', WARMUP_BUDGET_TICKS, (h) => h.phase === 'round');
    expect(hooks.projectiles).toBe(0);
    const roundStart = hooks.tick;
    /** Fails with the reason when a read that must be 0 comes too close to the first bot projectile. */
    const beforeBots = (read: Hooks, label: string): void => {
      expect(
        read.tick - roundStart,
        `${label}: a bot may fire from tick ${FIRST_BOT_PROJECTILE_TICKS} of the round and would be counted in data-projectiles; the bots changed or the spec is slow`,
      ).toBeLessThanOrEqual(FIRST_BOT_PROJECTILE_TICKS - BOT_MARGIN_TICKS);
    };

    // 3. C and M1: the windup starts and ends, so the cast fired, and no bolt is on the page at the
    // fire tick or four ticks after it. M1 is not ready: it was cast.
    await page.keyboard.down('KeyC');
    await page.mouse.down({ button: 'left' });
    hooks = await runUntil(page, "Mend Bolt's windup", CAST_BUDGET_TICKS, (h) => h.m1Windup === 'true');
    await page.mouse.up({ button: 'left' });
    hooks = await runUntil(page, "the end of Mend Bolt's windup", M1_WINDUP_BUDGET_TICKS, (h) => h.m1Windup === 'false');
    expect(hooks.projectiles, 'no bolt at the fire tick of a self-cast Mend Bolt').toBe(0);
    expect(hooks.m1Ready, 'Mend Bolt was cast').toBe('false');
    hooks = await runTicks(page, AFTER_FIRE_TICKS);
    expect(hooks.projectiles, 'no bolt four ticks after a self-cast Mend Bolt').toBe(0);
    beforeBots(hooks, 'after Mend Bolt');

    // 4. The same with the right button, Soothing Surge.
    await page.mouse.down({ button: 'right' });
    hooks = await runUntil(page, "Soothing Surge's windup", CAST_BUDGET_TICKS, (h) => h.m2Windup === 'true');
    await page.mouse.up({ button: 'right' });
    hooks = await runUntil(page, "the end of Soothing Surge's windup", M2_WINDUP_BUDGET_TICKS, (h) => h.m2Windup === 'false');
    expect(hooks.projectiles, 'no bolt at the fire tick of a self-cast Soothing Surge').toBe(0);
    expect(hooks.m2Ready, 'Soothing Surge was cast').toBe('false');
    hooks = await runTicks(page, AFTER_FIRE_TICKS);
    expect(hooks.projectiles, 'no bolt four ticks after a self-cast Soothing Surge').toBe(0);
    beforeBots(hooks, 'after Soothing Surge');

    // 5. R with C held: the veil shields her, absorb 30 (the same as without C).
    await page.keyboard.down('KeyR');
    hooks = await runUntil(page, "Aegis Veil's shield", SHIELD_BUDGET_TICKS, (h) => h.shieldVisible === 'true');
    await page.keyboard.up('KeyR');
    expect(hooks.shieldAbsorb).toBe('30');

    // 6. C released: the aim is the cursor again, so the next Mend Bolt flies and one bolt is shown.
    await page.keyboard.up('KeyC');
    hooks = await runUntil(page, 'Mend Bolt ready again', M1_READY_BUDGET_TICKS, (h) => h.m1Ready === 'true');
    await page.mouse.down({ button: 'left' });
    hooks = await runUntil(page, 'the bolt of the control cast', CONTROL_BUDGET_TICKS, (h) => h.projectiles >= 1);
    await page.mouse.up({ button: 'left' });
    expect(hooks.projectiles).toBeGreaterThanOrEqual(1);
    beforeBots(hooks, 'the control cast');
  } finally {
    expect(problems).toEqual([]);
  }
});
