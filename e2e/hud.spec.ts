import { expect, test, type Page } from '@playwright/test';
import { PROBE_VIEWPORT } from './heap-probe';
import { orFail, watchProblems } from './support';

// The shield segment, the scoreboard on Tab and the silence flag, on the dev-only sandbox
// (`/?scene=sandbox`) with a paused clock, like combat.spec.ts: Hargrim (champion 0) with the F4
// shots at Lumeth (2), his R for the 40 absorb, and Tab for the scoreboard. Every wait is a tick
// budget read from `data-tick`. There are no pixel counts, so no arena or palette change can
// move it (the screenshot only shows the picture).
//
// The silence is read false only: no champion of the sandbox silences the human (Skerrow, the
// only silencer, has no kit there). The flag is shown in the headless scripted scene of
// packages/client/src/hud-scene.test.ts, through the real sim (decision 6 of batch #134).

// Playwright's clock fires a frame every 16 ms of fake time and the sim ticks every 16.67 ms, so a
// frame of 17 ms runs about one tick (combat.spec.ts).
const FRAME_MS = 17;
const PAUSE_AT_MS = 60_000;
// The warmup is 180 ticks, WARMUP_TICKS in the sim.
const WARMUP_TICKS = 180;
const WARMUP_BUDGET_TICKS = 40;
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
// Champion 2 is the first enemy and the target of the F4 shots: four hits kill it.
const TARGET = 2;
const SHOTS = 8;
// Ticks of the batch before the death is read frame by frame: a little under the flight of a shot
// from the spawn (-12, 2) to Lumeth at (12, 2), 24 m at 10 m/s, 144 ticks.
const SHOT_FLIGHT_TICKS = 130;
// Hargrim's R (data/kits/hargrim.json): a shield of 40 absorb for 240 ticks on 160 health.
const SHIELD_ABSORB = 40;
const SHIELD_TICKS = 240;
const MAX_HEALTH = 160;
// The sandbox, in champion id order: the roster of match-setup.ts, the local team A first.
const ROSTER = [
  { name: 'Hargrim', team: 'ally' },
  { name: 'Quillon', team: 'ally' },
  { name: 'Lumeth', team: 'enemy' },
  { name: 'Skerrow', team: 'enemy' },
];
const SLOT_COUNT = 7;
// The warmup, the 8 shots and the 240 ticks of the shield run at the probe viewport, where a frame
// costs a sixteenth of the pixels; the reads that need geometry and the screenshot run at 1280x720.
// The test makes 18 hook reads, and the flights and waits are batches of one runFor. Locally it takes
// 5.1 s. On the runner a frame is 17 to 24 ms at the probe viewport (about 560 of them: the warmup,
// the 130 ticks of a shot's flight, the 240 of the shield and about 11 read one by one) and 105 to
// 210 ms at 1280x720 (about 6), and a read costs 32 to 75 ms, so the body takes about 17 s and the
// page load and the screenshot make it about 22 s. The 60 s timeout is more than twice that (the
// rule of testing.md); a run past half of it applies the rule again.
const TEST_TIMEOUT_MS = 60_000;

interface Hooks {
  tick: number;
  phase: string;
  deaths: number;
  shield: { visible: string | null; absorb: string | null };
  /** `data-silenced` of the seven slots in order. */
  silenced: (string | null)[];
}

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    const shield = document.querySelector('[data-part="shield"]');
    return {
      tick: Number(d['tick']),
      phase: d['phase'] ?? '',
      deaths: Number(d['deaths']),
      shield: { visible: shield?.getAttribute('data-visible') ?? null, absorb: shield?.getAttribute('data-absorb') ?? null },
      silenced: [...document.querySelectorAll('[data-slot]')].map((icon) => icon.getAttribute('data-silenced')),
    };
  });
}

interface Board {
  visible: string | null;
  /** Rows in page order, without the header. */
  rows: {
    id: string | null;
    team: string | null;
    alive: string | null;
    name: string;
    teamCell: string;
    state: string;
    kills: string;
    deaths: string;
  }[];
  headerCells: string[];
}

async function readBoard(page: Page): Promise<Board> {
  return page.evaluate(() => {
    const board = document.querySelector('[data-hud="scoreboard"]');
    if (!board) throw new Error('no scoreboard');
    const text = (row: Element, part: string): string => row.querySelector(`[data-part="${part}"]`)?.textContent ?? '';
    return {
      visible: board.getAttribute('data-visible'),
      rows: [...board.querySelectorAll('[data-row]:not([data-row="header"])')].map((row) => ({
        id: row.getAttribute('data-row'),
        team: row.getAttribute('data-team'),
        alive: row.getAttribute('data-alive'),
        name: text(row, 'name'),
        teamCell: text(row, 'team'),
        state: text(row, 'state'),
        kills: text(row, 'kills'),
        deaths: text(row, 'deaths'),
      })),
      headerCells: [...(board.querySelector('[data-row="header"]')?.children ?? [])].map((cell) => cell.textContent ?? ''),
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

async function box(page: Page, selector: string): Promise<{ x: number; width: number }> {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error(`${selector} has no box`);
  return found;
}

test('shows the shield, the scoreboard on Tab and the silence flag', async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    await page.clock.install({ time: 0 });
    await page.goto('/?scene=sandbox');
    await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
    await page.clock.pauseAt(PAUSE_AT_MS);
    await page.setViewportSize(PROBE_VIEWPORT);

    // 1. At the start: the scoreboard is hidden, with a header and four rows, all alive at 0 and 0,
    // the local team first. The shield is hidden at 0 and no slot is silenced.
    let board = await readBoard(page);
    expect(board.visible).toBe('false');
    expect(await page.locator('[data-hud="scoreboard"]').isVisible()).toBe(false);
    expect(board.headerCells).toEqual(['', 'Champion', '', 'K', 'D']);
    expect(board.rows.map((row) => [row.id, row.name, row.team, row.teamCell])).toEqual(
      ROSTER.map((entry, id) => [String(id), entry.name, entry.team, entry.team === 'ally' ? 'Ally' : 'Enemy']),
    );
    for (const row of board.rows) {
      expect([row.alive, row.state, row.kills, row.deaths], row.name).toEqual(['true', 'Alive', '0', '0']);
    }
    let hooks = await readHooks(page);
    expect(hooks.shield).toEqual({ visible: 'false', absorb: '0' });
    expect(hooks.silenced).toEqual(Array.from({ length: SLOT_COUNT }, () => 'false'));
    expect(await page.locator('[data-part="shield"]').isVisible()).toBe(false);

    // 2. F4 shots until Lumeth dies: four hits of the eight, in the round phase.
    await page.clock.runFor(WARMUP_TICKS * FRAME_MS);
    hooks = await runUntil(page, 'the round phase', WARMUP_BUDGET_TICKS, (h) => h.phase === 'round');
    for (let shot = 0; shot < SHOTS; shot++) await page.keyboard.press('F4');
    // The flight of a shot is one batch, and only its end is read frame by frame.
    await runTicks(page, SHOT_FLIGHT_TICKS);
    hooks = await runUntil(page, 'the death of the target', 60, (h) => h.deaths >= 1);
    expect(hooks.deaths).toBe(1);

    // 3. R: the shield shows 40 absorb as the last quarter of the health track, which is full.
    // The key is held for two ticks and released, so the cast is one (its cooldown is 720).
    await page.setViewportSize(SCREENSHOT_VIEWPORT);
    await page.keyboard.down('KeyR');
    hooks = await runUntil(page, 'the shield', 6, (h) => h.shield.visible === 'true');
    await page.keyboard.up('KeyR');
    expect(hooks.shield).toEqual({ visible: 'true', absorb: String(SHIELD_ABSORB) });
    const shieldTick = hooks.tick;
    const track = await box(page, '[data-hud="health-bar"] [data-part="track"]');
    const fill = await box(page, '[data-part="shield-fill"]');
    expect(fill.width / track.width, 'the width of 40 on 160').toBeCloseTo(SHIELD_ABSORB / MAX_HEALTH, 2);
    expect((fill.x - track.x) / track.width, 'the start at 120 of 160').toBeCloseTo(1 - SHIELD_ABSORB / MAX_HEALTH, 2);
    expect(hooks.silenced).toEqual(Array.from({ length: SLOT_COUNT }, () => 'false'));

    // 4. Tab held: the scoreboard shows, Hargrim has the kill and Lumeth the death and is dead.
    await page.keyboard.down('Tab');
    board = await readBoard(page);
    expect(board.visible).toBe('true');
    expect(await page.locator('[data-hud="scoreboard"]').isVisible()).toBe(true);
    expect(board.rows.map((row) => [row.name, row.state, row.alive, row.kills, row.deaths])).toEqual([
      ['Hargrim', 'Alive', 'true', '1', '0'],
      ['Quillon', 'Alive', 'true', '0', '0'],
      ['Lumeth', 'Dead', 'false', '0', '1'],
      ['Skerrow', 'Alive', 'true', '0', '0'],
    ]);
    expect(board.rows[TARGET]?.name).toBe('Lumeth');
    await page.screenshot({ path: testInfo.outputPath('scoreboard.png') });

    // 5. Tab released: hidden again.
    await page.keyboard.up('Tab');
    board = await readBoard(page);
    expect(board.visible).toBe('false');
    expect(await page.locator('[data-hud="scoreboard"]').isVisible()).toBe(false);

    // 6. The shield lasts 240 ticks: it is hidden at 0 once they have run.
    await page.setViewportSize(PROBE_VIEWPORT);
    await runTicks(page, SHIELD_TICKS);
    hooks = await runUntil(page, 'the end of the shield', 10, (h) => h.tick - shieldTick >= SHIELD_TICKS + 2);
    expect(hooks.shield).toEqual({ visible: 'false', absorb: '0' });
    expect(await page.locator('[data-part="shield"]').isVisible()).toBe(false);
    expect(hooks.silenced).toEqual(Array.from({ length: SLOT_COUNT }, () => 'false'));
  } finally {
    expect(problems).toEqual([]);
  }
});
