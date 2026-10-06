import { expect, test, type CDPSession, type Page } from '@playwright/test';
import {
  LIVE_ALLOCATION_LIMIT_BYTES,
  PROBE_VIEWPORT,
  PROFILER_SANITY_BYTES,
  allocationsOverAWindow,
  conclude,
  openProbe,
  runWindow,
  type Allocations,
} from './heap-probe';
import { orFail, watchProblems } from './support';

// The second heap-probe scene: the default match, `/` at time scale 1, where the
// hooks and the HUD change in every window (the position and facing of the
// human on every tick, projectiles, hits and bars as the bots fight). The first
// scene, combat.spec.ts, is a steady state. This one counts the table-driven
// change writes with real changes, and the bots' fight through the glue. The
// bots package itself is logged as the sixth figure of the probe line and never
// counted (see heap-probe.ts). Every frame runs through the client's dev-only
// hook, starting in the warmup phase; the fake clock is paused before the page
// loads and never runs a frame, so the ticks are the hook's alone.
//
// The scene is measured late, in the first round that begins after
// WARM_UP_TICKS, with no pointer and no profiler before it. A live match does
// not give the engine time before its first death (tick 449 on normal bots):
// the counted code reads 16 to 81 KB per window in the first 200 ticks and 3 to
// 6 KB up to tick 720, the heap numbers of unoptimized code, and is clean only
// after about 2100 ticks (see testing.md). The pointer is never moved, because
// `sampleAim` allocates about 2.5 KB per window whenever a pointer exists
// (issue #87), so the aim stays at its start, (-11, 2) m, and the human walks off
// the line y = 2 to make its facing change.
interface Hooks {
  tick: number;
  phase: string;
  round: string;
  deaths: number;
  hits: number;
  projectiles: number;
  /** Champion 0 in centimetres, the text of the hook. */
  p0x: string;
  f0: string;
  bars: string[];
  /** `data-ready` of the M1 icon. */
  m1Ready: string | null;
}

// The clock is paused far ahead of the page's own clock, which starts at 0, before
// the page loads, as match-end.spec.ts does: no frame of the page runs a tick on
// its own, so the first read is tick 0.
const PAUSE_AT_MS = 60_000;
// The warm-up: plain windows, no profiler, until this tick, then on to the start
// of the next round. About 2300 ticks locally, with rounds 1 and 2 played.
const WARM_UP_TICKS = 2100;
// The warm-up fails past this tick: the match ended or a round never began.
const WARM_UP_BUDGET_TICKS = 6000;
// The windows measured, from the first window of the round. The first death of a
// round came about 240 ticks after its start on f7e10f0.
const MEASURED_WINDOWS = 3;
// The window ticks, 29 to 31: the hook's first frame only starts the loop clock.
const WINDOW_TICKS_MIN = 29;
const WINDOW_TICKS_MAX = 31;
// The first death of the round must come at least this many ticks after the last
// measured window, so a bot change does not turn the live scene into a round that
// ends inside it. The read of the death is up to a window late.
const FIRST_DEATH_MARGIN_TICKS = 60;
// After the end assertions, windows run on to the first death of the round.
const RUN_ON_BUDGET_TICKS = 1200;
// The warm-up is about 2300 frames, 17 to 24 ms each on the runner, so 45 to 60 s.
const TEST_TIMEOUT_MS = 180_000;

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    return {
      tick: Number(d['tick']),
      phase: d['phase'] ?? '',
      round: d['round'] ?? '',
      deaths: Number(d['deaths']),
      hits: Number(d['hits']),
      projectiles: Number(d['projectiles']),
      p0x: d['p0x'] ?? '',
      f0: d['f0'] ?? '',
      bars: [0, 1, 2, 3].map((id) => d[`bar${id}`] ?? ''),
      m1Ready: document.querySelector('[data-slot="M1"]')?.getAttribute('data-ready') ?? null,
    };
  });
}

/** What changed between two reads, for the log. */
function changes(before: Hooks, after: Hooks): string {
  const bars = after.bars.map((bar, id) => (bar === before.bars[id] ? '' : ` bar${id} ${before.bars[id]}>${bar}`)).join('');
  return `projectiles ${before.projectiles}>${after.projectiles} hits ${before.hits}>${after.hits}${bars}`;
}

// The keys of the windows of a round, in turn: the first walks north and east off
// the spawn line, the rest alternate A and D at y of about 3.9 m, west of the
// block of the arena (x = -8). Hargrim's M1 windup is `slowed`, so the walk goes on
// under the cast.
const WALK = [['KeyW', 'KeyD'], ['KeyA'], ['KeyD']] as const;

/**
 * Drives the windows. A window that starts in the warmup, the round end or the
 * match end walks nowhere, since the human is locked or dead. A release and the
 * next press are dispatched in the page before the call returns, so the window
 * that follows samples them. The walk starts again with every round.
 */
function createDriver(page: Page, cdp: CDPSession) {
  let held: readonly string[] = [];
  let round = '';
  let roundWindows = 0;
  async function press(hooks: Hooks): Promise<void> {
    if (hooks.round !== round) {
      round = hooks.round;
      roundWindows = 0;
    }
    let keys: readonly string[] = [];
    if (hooks.phase === 'round') {
      const index = roundWindows++;
      keys = index === 0 ? (WALK[0] as readonly string[]) : (WALK[1 + ((index - 1) % 2)] as readonly string[]);
    }
    for (const key of held) if (!keys.includes(key)) await page.keyboard.up(key);
    for (const key of keys) if (!held.includes(key)) await page.keyboard.down(key);
    held = keys;
  }
  return {
    /** One window with no profiler, from a read. */
    async run(hooks: Hooks): Promise<void> {
      await press(hooks);
      await runWindow(page);
    },
    /** One window under the profiler, from a read. */
    async measure(hooks: Hooks): Promise<Allocations> {
      await press(hooks);
      return allocationsOverAWindow(page, cdp);
    },
  };
}

test('the live match: the writes of a changing match allocate under the limit', async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(PAUSE_AT_MS);
    await page.setViewportSize(PROBE_VIEWPORT);
    await page.goto('/');
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    const cdp = await openProbe(page);
    // M1 is held to the end. The pointer never moves.
    await page.mouse.down();
    const driver = createDriver(page, cdp);

    // The warm-up: plain windows from tick 0, reads between them only, to the first
    // round that begins after WARM_UP_TICKS.
    let hooks = await readHooks(page);
    expect(hooks.tick, 'the page has run no tick of its own').toBe(0);
    for (;;) {
      const before = hooks;
      await driver.run(before);
      hooks = await readHooks(page);
      if (hooks.tick >= WARM_UP_TICKS && hooks.phase === 'round' && (before.phase !== 'round' || before.round !== hooks.round)) break;
      expect(hooks.phase, `the match ended at tick ${hooks.tick} before a round began after the warm-up`).not.toBe('matchEnd');
      expect(hooks.tick, 'a round began after the warm-up').toBeLessThanOrEqual(WARM_UP_BUDGET_TICKS);
    }
    const roundStart = hooks;
    console.log(`heap probe live warm-up: round ${hooks.round} began by tick ${hooks.tick}, deaths ${hooks.deaths}`);

    // The measured windows, the first of the round. Every read is kept, for the end assertions.
    const reads: Hooks[] = [hooks];
    const windows: Allocations[] = [];
    for (let window = 0; window < MEASURED_WINDOWS; window++) {
      windows.push(await driver.measure(hooks));
      hooks = await readHooks(page);
      console.log(
        `heap probe live window ${window}: tick ${hooks.tick}, ${changes(reads[reads.length - 1] as Hooks, hooks)}`,
      );
      reads.push(hooks);
    }
    const measured = conclude('live', test.info().retry, windows, 'worst');

    // The same round, still in its round phase, with nobody dead since it began, so
    // the windows covered a live fight and not a round end or a new round.
    for (const read of reads) {
      expect(read.phase, `the phase at tick ${read.tick}`).toBe('round');
      expect(read.round, `the round at tick ${read.tick}`).toBe(roundStart.round);
      expect(read.deaths, `deaths at tick ${read.tick}`).toBe(roundStart.deaths);
    }
    expect(hooks.bars[0], 'the human is alive').not.toBe('x');
    // Every window ran its frames, and the hooks written on every tick changed in each.
    for (let i = 1; i < reads.length; i++) {
      const before = reads[i - 1] as Hooks;
      const after = reads[i] as Hooks;
      expect(after.tick - before.tick, `ticks of measured window ${i - 1}`).toBeGreaterThanOrEqual(WINDOW_TICKS_MIN);
      expect(after.tick - before.tick, `ticks of measured window ${i - 1}`).toBeLessThanOrEqual(WINDOW_TICKS_MAX);
      expect(after.p0x, `p0x across measured window ${i - 1}`).not.toBe(before.p0x);
      expect(after.f0, `f0 across measured window ${i - 1}`).not.toBe(before.f0);
    }
    // The aim is off the line of motion, so the facing changes with the walk.
    for (const read of reads.slice(1)) {
      expect(Math.abs(Math.sin(Number(read.f0))), `the facing ${read.f0} at tick ${read.tick}`).toBeGreaterThan(0.5);
    }
    // M1 cast: its icon is on cooldown in at least one read.
    expect(reads.some((read) => read.m1Ready === 'false'), 'M1 never went on cooldown, so no cast ran').toBe(true);
    const lastTick = hooks.tick;
    expect(measured.lowestOutsideSweep, 'the profiler saw too few allocations outside the sweep files').toBeGreaterThan(
      PROFILER_SANITY_BYTES,
    );
    expect(
      measured.asserted.combat,
      `combat code allocated ${JSON.stringify(measured.asserted.combatByFunction)}`,
    ).toBeLessThan(LIVE_ALLOCATION_LIMIT_BYTES);

    // Windows run on to the first death of the round, so every log shows how far the
    // last measured window is from it, and the margin is asserted.
    while (hooks.deaths === roundStart.deaths && hooks.phase === 'round' && hooks.tick - lastTick <= RUN_ON_BUDGET_TICKS) {
      await driver.run(hooks);
      hooks = await readHooks(page);
    }
    console.log(
      `heap probe live first death: tick ${hooks.tick} (deaths ${hooks.deaths}, phase ${hooks.phase}), last measured window ended at tick ${lastTick}, margin ${hooks.tick - lastTick} ticks, floor ${FIRST_DEATH_MARGIN_TICKS}`,
    );
    expect(hooks.tick - lastTick, 'the first death of the round came too soon after the measured windows').toBeGreaterThanOrEqual(
      FIRST_DEATH_MARGIN_TICKS,
    );
  } finally {
    expect(problems).toEqual([]);
  }
});
