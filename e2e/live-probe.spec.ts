import { expect, test, type CDPSession, type Page } from '@playwright/test';
import {
  LIVE_ALLOCATION_LIMIT_BYTES,
  LIVE_BOTS_LIMIT_BYTES,
  PROBE_VIEWPORT,
  PROFILER_SANITY_BYTES,
  allocationsOverAWindow,
  conclude,
  openProbe,
  runWindow,
  type Allocations,
} from './heap-probe';
import { DEFAULT_MATCH, orFail, watchProblems } from './support';

// The second heap-probe scene: the default match, entered on `DEFAULT_MATCH` (a
// bare `/` opens the select) at time scale 1, where the hooks and the HUD change
// in every window (the position and facing of the human on every tick,
// projectiles, hits and bars as the bots fight). The first scene, combat.spec.ts,
// is a steady state. This one counts the table-driven
// change writes with real changes, and the bots' fight through the glue. The
// bots package itself is logged as the sixth figure of the probe line and bounded
// apart from the counted code, on the median of the five windows (see heap-probe.ts).
// Every frame runs through the client's dev-only hook, starting in the warmup phase;
// the fake clock is paused before the page loads and never runs a frame, so the ticks
// are the hook's alone.
//
// The scene is measured late, in the first round that begins after
// WARM_UP_TICKS, with no profiler before it. A live match does not give the
// engine time before its first death (tick 449 on normal bots of f7e10f0): the
// counted code reads 16 to 81 KB per window in the first 200 ticks and 3 to 6 KB
// up to tick 720, the heap numbers of unoptimized code, and is clean only after
// about 2100 ticks (see testing.md). A pointer is present from the first read and
// moves before every window (see POINTERS), so `sampleAim` and the camera module
// run on every frame of every window: the aim sampling used to allocate about
// 2.5 KB per window whenever a pointer existed (issue #87), and the live scene is
// the one that measures it.
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
  /** `data-anim0` to `data-anim3`: what each champion's clips play, one of the nine texts. */
  anims: string[];
}

// The clock is paused far ahead of the page's own clock, which starts at 0, before
// the page loads, as match-end.spec.ts does: no frame of the page runs a tick on
// its own, so the first read is tick 0.
const PAUSE_AT_MS = 60_000;
// The warm-up: plain windows, no profiler, until this tick, then on to the start
// of the next round: round 3, begun by tick 4289 on the bots of #137, with rounds 1 and 2 played.
const WARM_UP_TICKS = 2100;
// The warm-up fails past this tick: the match ended or a round never began. It is
// WARM_UP_TICKS plus the longest round that match-end.spec.ts budgets, a round that
// runs to sudden death, about 7000 ticks: a round in progress at WARM_UP_TICKS can end
// that late, and the next one begins then.
const WARM_UP_BUDGET_TICKS = 9100;
// Plain windows of the round before the measured ones, so that the measured windows
// hold the round's first projectiles and hits, the event paths this scene exists to
// cover. Measured on the bots of #137, which dodge, with the moving pointer of POINTERS
// (3 runs of 17 windows of round 3, begun by tick 4289, the same in all three: the dodge
// lengthens the rounds before it, which began round 3 by tick 2609 on 57dd52f, with the
// dash hold of #98, and by 2879 before it; the aim changes the human's own M1 and its
// facing from round 1 on): the first projectile spawns in window 2 (ticks 4349 to 4379,
// 60 ticks into the windows of the round), the first hits land in window 4 (three at
// once), then 0 to 2 hits land per window (window 6 reads none) and 0 to 2 projectiles are
// live at the reads to the end of the 17 windows (tick 4799). The first death of the round
// is read at tick 4859 (3419 on 57dd52f). The lead is a count of windows, not a tick,
// because windows are the unit the spec runs in; a bots change moves the first projectile,
// and the assertion that the measured windows hold one fails then, so re-measure. The lead
// is 2, the window of the first projectile, by the derivation of #97 (decision 9 of batch
// #134): the measured windows are the first ones of the round's chase, where the bots'
// plans read the most (13 KB and 6 KB of `splitPath`, in windows 2 and 3), and the
// bots limit of heap-probe.ts is derived from them.
const EVENT_LEAD_WINDOWS = 2;
// The windows measured, after the lead: windows 2 to 6 of round 3, ticks 4349 to 4499.
// The median of the five is the asserted figure, as in the sandbox (see testing.md).
// The last of them ends 360 ticks before the first death of the round (the floor is 60).
const MEASURED_WINDOWS = 5;
// The window ticks, 29 to 31: the hook's first frame only starts the loop clock.
const WINDOW_TICKS_MIN = 29;
const WINDOW_TICKS_MAX = 31;
// The first death of the round must come at least this many ticks after the last
// measured window, so a bot change does not turn the live scene into a round that
// ends inside it. The read of the death is up to a window late.
const FIRST_DEATH_MARGIN_TICKS = 60;
// After the end assertions, windows run on to the first death of the round.
const RUN_ON_BUDGET_TICKS = 1200;
// A live attempt is about 4900 frames (the warm-up to tick 4289, the lead, the five
// windows and the run-on to the first death, tick 4859 on the bots of #137; about 3400
// frames and tick 3419 on 57dd52f). It took 6 to 16 s locally on those (3 attempts in
// parallel). On the runner the live test took 41 s to 1.1 min on those per
// attempt (1.1 min, 50.8 s, 40.9 s, 51.3 s, 1.1 min and 47.4 s on 3def3bc, run 37456539110;
// the whole Playwright run of 19 tests took 2.7 to 4.2 min), about 18 ms a frame, so 180 s
// was a margin of about 2.7x; at 4900 frames it is about 2x. The earlier shape took 1.0 to 1.1 min
// (jobs 112201476995 and 112203346352 on 7b80afd). The warm-up budget above (9100
// frames, about 165 s at that rate) is reached only when the spec is already failing,
// and then the timeout may fire first.
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
      anims: [0, 1, 2, 3].map((id) => d[`anim${id}`] ?? ''),
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

// The pointer, in CSS pixels of the 320x180 probe viewport. One of these two pixels
// is set before every window, alternating, so the human's aim changes between windows
// and `main.ts:sampleAim` samples a pointer that moved. They are derived like the
// ground points of walk.spec.ts, 'faces the mouse cursor' (the client's own raycast,
// fitted camera of arena01 at 320x180: project the ground point, round the pixel,
// cast it back):
//   (63, 39) -> ground (-14.05, 9.02) m, north-west, sin facing > 0
//   (45, 97) -> ground (-13.98, -1.04) m, south-west, sin facing < 0
// Both lie west of the walk (x from -11 to -8, y of about 3.9 m), 4 to 6 m to the
// side of the human, so |sin f0| stays over 0.5 and Hargrim's M1 arc points away from
// the enemies, which come from the east. `side` is the sign of sin f0 that a window
// started with the point must end with.
const POINTERS = [
  { x: 63, y: 39, side: 1 },
  { x: 45, y: 97, side: -1 },
] as const;
type PointerPoint = (typeof POINTERS)[number];

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
  let windows = 0;
  let pointer: PointerPoint = POINTERS[0];
  async function press(hooks: Hooks): Promise<void> {
    // The pointer moves first, in the page, as the keys do: the dispatch runs the
    // client's window listener before the call returns, so the window that follows
    // samples it. The real mouse is walk.spec.ts's.
    pointer = POINTERS[windows++ % POINTERS.length] as PointerPoint;
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
    }, pointer);
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
    /** The pointer point set before the latest window. */
    get pointer(): PointerPoint {
      return pointer;
    },
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
    await page.goto(DEFAULT_MATCH);
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    const cdp = await openProbe(page);
    // M1 is held to the end.
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

    // The lead: plain windows, so the measured ones hold the first projectiles and hits.
    for (let window = 0; window < EVENT_LEAD_WINDOWS; window++) {
      await driver.run(hooks);
      hooks = await readHooks(page);
    }

    // The measured windows. Every read is kept, for the end assertions.
    const reads: Hooks[] = [hooks];
    const windows: Allocations[] = [];
    // The pointer point each measured window started with.
    const sides: number[] = [];
    for (let window = 0; window < MEASURED_WINDOWS; window++) {
      windows.push(await driver.measure(hooks));
      sides.push(driver.pointer.side);
      hooks = await readHooks(page);
      console.log(
        `heap probe live window ${window}: tick ${hooks.tick}, ${changes(reads[reads.length - 1] as Hooks, hooks)}`,
      );
      reads.push(hooks);
    }
    const measured = conclude('live', test.info().repeatEachIndex, windows);

    // The same round, still in its round phase, with nobody dead since it began, so
    // the windows covered a live fight and not a round end or a new round.
    for (const read of reads) {
      expect(read.phase, `the phase at tick ${read.tick}`).toBe('round');
      expect(read.round, `the round at tick ${read.tick}`).toBe(roundStart.round);
      expect(read.deaths, `deaths at tick ${read.tick}`).toBe(roundStart.deaths);
    }
    expect(hooks.bars[0], 'the human is alive').not.toBe('x');
    // The windows hold the events: a projectile in flight at some read, and a hit
    // landed between the first read and the last. The counts are in the per-window log.
    expect(Math.max(...reads.map((read) => read.projectiles)), 'a projectile in the measured windows').toBeGreaterThanOrEqual(1);
    expect(hooks.hits - (reads[0] as Hooks).hits, 'hits landed in the measured windows').toBeGreaterThanOrEqual(1);
    // Every window ran its frames, and the hooks written on every tick changed in each.
    for (let i = 1; i < reads.length; i++) {
      const before = reads[i - 1] as Hooks;
      const after = reads[i] as Hooks;
      expect(after.tick - before.tick, `ticks of measured window ${i - 1}`).toBeGreaterThanOrEqual(WINDOW_TICKS_MIN);
      expect(after.tick - before.tick, `ticks of measured window ${i - 1}`).toBeLessThanOrEqual(WINDOW_TICKS_MAX);
      expect(after.p0x, `p0x across measured window ${i - 1}`).not.toBe(before.p0x);
      expect(after.f0, `f0 across measured window ${i - 1}`).not.toBe(before.f0);
    }
    // The aim is off the line of motion, so the facing changes with the walk, and it
    // followed the pointer of each window: the side of the window's point is the sign
    // of sin f0 at the read that ends it, so `sampleAim` took the moved pointer in
    // every measured window.
    reads.slice(1).forEach((read, index) => {
      const sin = Math.sin(Number(read.f0));
      expect(Math.abs(sin), `the facing ${read.f0} at tick ${read.tick}`).toBeGreaterThan(0.5);
      expect(Math.sign(sin), `the side of the facing ${read.f0} at tick ${read.tick}, pointer side ${sides[index]}`).toBe(sides[index]);
    });
    // M1 cast: its icon is on cooldown in at least one read.
    expect(reads.some((read) => read.m1Ready === 'false'), 'M1 never went on cooldown, so no cast ran').toBe(true);
    // The clips follow the match: the human walks in every window, so its clips start with Run at
    // every read (Run or Run+Attack, since M1 is held), a bot is casting in some read and some
    // champion is staggered by a hit in some read. The bots are deterministic and the windows are
    // paced by the hook, so these reads are the same on every attempt.
    for (const read of reads) expect(read.anims[0], `the human's clips at tick ${read.tick}`).toMatch(/^Run/);
    console.log(`heap probe live clips: ${reads.map((read) => `${read.tick} ${read.anims.join('/')}`).join(' | ')}`);
    expect(
      reads.some((read) => read.anims.slice(1).some((text) => text.endsWith('+Cast'))),
      'a bot casting in some measured read',
    ).toBe(true);
    expect(
      reads.some((read) => read.anims.some((text) => text.endsWith('+Hit'))),
      'a champion staggered by a hit in some measured read',
    ).toBe(true);
    const lastTick = hooks.tick;
    expect(measured.lowestOutsideSweep, 'the profiler saw too few allocations outside the sweep files').toBeGreaterThan(
      PROFILER_SANITY_BYTES,
    );
    expect(
      measured.asserted.combat,
      `combat code allocated ${JSON.stringify(measured.asserted.combatByFunction)}`,
    ).toBeLessThan(LIVE_ALLOCATION_LIMIT_BYTES);
    // The bots' bytes, apart from the counted code: the median of the five windows' own figures,
    // not the bots figure of the window that is the median by counted bytes (see LIVE_BOTS_LIMIT_BYTES).
    const botsMedian = windows.map((w) => w.bots).sort((a, b) => a - b)[(MEASURED_WINDOWS - 1) / 2] as number;
    expect(
      botsMedian,
      `bots allocated ${JSON.stringify(windows.find((w) => w.bots === botsMedian)?.botsByFunction)}`,
    ).toBeLessThanOrEqual(LIVE_BOTS_LIMIT_BYTES);

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
    // The victim of the first death lies in Death: its bar is hidden, and its clips read Death.
    const victims = hooks.bars.flatMap((bar, id) => (bar === 'x' ? [id] : []));
    expect(victims, 'one champion died').toHaveLength(1);
    expect(hooks.anims[victims[0] as number], `the clips of the victim, champion ${victims[0]}`).toBe('Death');
  } finally {
    expect(problems).toEqual([]);
  }
});
