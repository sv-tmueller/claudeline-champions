import { expect, test, type Page } from '@playwright/test';
import { countPixels, orFail, watchProblems, type ColourRange } from './support';

// Two tests on a dev-only time scale (`?timescale=100`, packages/client/src/dev-launch.ts):
// the default match played to its result screen, and the ring warning in the sandbox.
// Both pause the fake clock like match.spec.ts and run it in frames of 16 ms. At scale
// 100 one frame is 96 ticks, so a match of about 3000 ticks is some 30 frames, where
// the same match at scale 1 would be thousands of frames and fail the timeout. Reads
// come every 5 frames at the probe viewport, and every wait is a tick budget.
const SCALE = 100;
const FRAME_MS = 16;
const PAUSE_AT_MS = 60_000;
const STEP_FRAMES = 5;
const PROBE_VIEWPORT = { width: 320, height: 180 };
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };
// The sim's clock, in ticks (spec section 4, rules.md section 1): the warmup, the round, and the 10 s countdown.
const WARMUP_TICKS = 180;
const ROUND_TICKS = 5400;
const TICK_RATE = 60;
const COUNTDOWN_TICKS = 600;
const SUDDEN_DEATH_TICKS = 1800;
const RING_START_M = 18;
const RING_END_M = 3;
// The match: this test's own run ended at tick 5184 on the bots of #137 (read in frames of
// 96 ticks, with an idle human; 4936 in the headless run of match-setup.test.ts; on 57dd52f
// it read 5184 too, with 5053 headless; 5476 headless on the bots of #213). Bot output moves with
// the bots package, so re-measure it when the bots change. The budget is 15 000 ticks. Its base is
// the headless 5476, the convention of every other row: 5476 plus two more rounds of about 1000
// each and one round to sudden death of about 7000 is 14 476 (13 936 on the 4936 of #137). Passing
// it fails the test.
const MATCH_BUDGET_TICKS = 15_000;
// The same budget in frames: at scale 100 a 16 ms frame runs 96 ticks, so 15 000 ticks
// are at most 157 frames, and the budget is that plus 25. Without the scale the match
// takes thousands of frames, and this fails the test at once, where the 60 s timeout
// alone would only fail it on a slow machine (a frame costs 2 ms here and 17 to 24 ms
// at this viewport on the CI runner).
const MATCH_BUDGET_FRAMES = Math.ceil(MATCH_BUDGET_TICKS / 96) + 25;
// The ring test needs 5581 ticks to the ring and 700 more to reach the human, 6300 in all.
const RING_BUDGET_TICKS = 8000;
const RING_BUDGET_FRAMES = 100;
// The human stands at (-12, 2): the ring passes it when its radius falls below sqrt(148) m.
const HUMAN_DISTANCE_M = Math.sqrt(12 * 12 + 2 * 2);
const ROSTER = ['hargrim', 'quillon', 'lumeth', 'skerrow', 'ondrel', 'brimwick'];
// Red pixels: the red edge is #ff4d4f at about 70 % over the dark background at its
// rim and fainter inwards. The box keeps green and blue under 100, which an orange
// edge (the energy colour) at that strength would pass. Anything else red in the
// picture (the enemy bars, the HUD text) is in the picture without the edge too.
const RED: ColourRange = { min: [140, 30, 30], max: [255, 100, 100] };
const TEST_TIMEOUT_MS = 60_000;
// The match test runs once per arena and team size. `query` leads the address and ends in `&` when it
// is not empty. The budgets of arena01 are the two constants above. arena02 has its own headless run
// (match-setup.test.ts, ARENA02_END_TICK) and its budget is built the same way: that tick plus
// two more rounds of about 1000 each and one round to sudden death of about 7000, rounded up to
// 1000: 5 381 + 2000 + 7000 = 14 381, so 15 000 ticks, and frames = ceil(15 000 / 96) + 25 = 182
// (22 000 and 255 with the 12 191 of #137, 14 000 and 171 with the 4198 of #98, 13 000 and 161 with
// the 3474 of #86; a first round of 6453 ticks went to sudden death since the dodge).
// The 3v3 rows have their own headless runs (match-setup.test.ts, ARENA01_3V3_END_TICK and
// ARENA02_3V3_END_TICK) and the same formula with a longer round, since the longest non-sudden 3v3
// round measured is 2801 ticks (a healer on each team keeps a round going, and the dodge lengthens
// it), rounded up to 2900: end tick + 2 * 2900 + 7000, rounded up to 1000.
//   arena01: 10 470 + 5800 + 7000 = 23 270, so 24 000 ticks; frames = ceil(24 000 / 96) + 25 = 275.
//   arena02: 11 903 + 5800 + 7000 = 24 703, so 25 000 ticks; frames = ceil(25 000 / 96) + 25 = 286.
// (On the bots of #137 they were 5 774 with 19 000 and 223, and 15 773 with 29 000 and 328; on the bots of #112 the figures were 5 349 with 17 000 and 203 on arena01, and 11 095 with 23 000
// and 265 on arena02; with two Quillons a side 12 431 with 23 000 and 265 on arena01, and 7 125 with
// 18 000 and 213 on arena02, and 10 631 with 21 000 and 244 and 7 119 in #86 and #96.)
// The headless runs end in a Victory 3 : 2 on arena01 (round 5) and a Defeat 2 : 3 on arena02 (round 5). The rows read the result off the page and log it next to those
// figures. The exact outcome is not pinned: the 2v2 rows derive it from the score the same way, and
// every bots change moves it. The headless match-setup tests log the end tick and fail once a match
// passes its budget. Each row logs its wall time, and a row over 40 s gets its own
// test.setTimeout. None does: the 3v3 rows ran in 0.7 s here (the runner's frame costs
// about ten times more, so about 7 s), under the 60 s default.
const ROWS = [
  { id: 'arena01', size: 2, query: '', budgetTicks: MATCH_BUDGET_TICKS, budgetFrames: MATCH_BUDGET_FRAMES },
  { id: 'arena02', size: 2, query: 'arena=arena02&', budgetTicks: 15_000, budgetFrames: 182 },
  { id: 'arena01', size: 3, query: 'teamsize=3&', budgetTicks: 24_000, budgetFrames: 275, expected: 'Victory 3 : 2 at about tick 10 470' },
  { id: 'arena02', size: 3, query: 'arena=arena02&teamsize=3&', budgetTicks: 25_000, budgetFrames: 286, expected: 'Defeat 2 : 3 at about tick 11 903' },
] as const;

interface Hooks {
  tick: number;
  phase: string;
  round: number;
  /** "a : b" and "first to N" of the round score element. */
  score: string;
  firstTo: number;
  panelVisible: string | null;
  title: string;
  resultScore: string;
  entries: { champion: string | null; available: string | null; href: string | null; tag: string }[];
  /** `data-bar0` to `data-bar6` that exist on the canvas, as the ids. */
  barIds: number[];
  ring: {
    visible: string | null;
    counting: string | null;
    outside: string | null;
    countdown: string;
    radius: string;
    distance: string;
  };
}

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    const text = (selector: string): string => document.querySelector(selector)?.textContent ?? '';
    const scoreElement = document.querySelector('[data-hud="round-score"]');
    const ring = document.querySelector('[data-hud="ring-warning"]');
    return {
      tick: Number(d['tick']),
      phase: d['phase'] ?? '',
      round: Number(d['round']),
      score: scoreElement?.querySelector('[data-part="score"]')?.textContent ?? '',
      firstTo: Number(/first to (\d+)/.exec(scoreElement?.textContent ?? '')?.[1]),
      panelVisible: document.querySelector('[data-result="panel"]')?.getAttribute('data-visible') ?? null,
      title: text('[data-result="panel"] [data-part="title"]'),
      resultScore: text('[data-result="panel"] [data-part="score"]'),
      entries: [...document.querySelectorAll<HTMLElement>('[data-result="panel"] [data-champion]')].map((entry) => ({
        champion: entry.getAttribute('data-champion'),
        available: entry.getAttribute('data-available'),
        href: entry.getAttribute('href'),
        tag: entry.tagName,
      })),
      barIds: [0, 1, 2, 3, 4, 5, 6].filter((id) => d[`bar${id}`] !== undefined),
      ring: {
        visible: ring?.getAttribute('data-visible') ?? null,
        counting: ring?.getAttribute('data-counting') ?? null,
        outside: ring?.getAttribute('data-outside') ?? null,
        countdown: text('[data-part="ring-countdown"]'),
        radius: text('[data-part="ring-radius"]'),
        distance: text('[data-part="ring-distance"]'),
      },
    };
  });
}

/** The scoreboard's visibility and its two columns, and the canvas's own count of deaths. */
async function readTotals(page: Page): Promise<{ visible: string | null; kills: number[]; deaths: number[]; hook: number }> {
  return page.evaluate(() => {
    const board = document.querySelector('[data-hud="scoreboard"]');
    const column = (part: string): number[] =>
      [...(board?.querySelectorAll(`[data-row]:not([data-row="header"]) [data-part="${part}"]`) ?? [])].map((cell) =>
        Number(cell.textContent),
      );
    return {
      visible: board?.getAttribute('data-visible') ?? null,
      kills: column('kills'),
      deaths: column('deaths'),
      hook: Number(document.querySelector('canvas')?.dataset['deaths']),
    };
  });
}

async function runFrames(page: Page, frames: number): Promise<void> {
  await page.clock.runFor(frames * FRAME_MS);
}

/**
 * Opens the page on a paused clock at the probe viewport. The clock is paused
 * before the page loads, unlike match.spec.ts, since at a time scale every frame the
 * page runs on its own is 96 ticks of the match, and a slow load would play some of it
 * before the first read.
 */
async function open(page: Page, address: string, failed: Promise<never>): Promise<void> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(PAUSE_AT_MS);
  await page.setViewportSize(PROBE_VIEWPORT);
  await page.goto(address);
  await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
}

/**
 * Runs 5-frame steps and reads after each, calling `onRead` with every read
 * (including the first) until `done` holds, and fails past the tick or frame budget. Returns
 * the last read and the frames run.
 */
async function runUntil(
  page: Page,
  label: string,
  budgetTicks: number,
  budgetFrames: number,
  done: (hooks: Hooks) => boolean,
  onRead: (hooks: Hooks) => void,
): Promise<{ hooks: Hooks; frames: number }> {
  let hooks = await readHooks(page);
  const start = hooks.tick;
  let frames = 0;
  for (;;) {
    onRead(hooks);
    if (done(hooks)) return { hooks, frames };
    expect(hooks.tick - start, `${label}: not reached within ${budgetTicks} ticks`).toBeLessThanOrEqual(budgetTicks);
    expect(frames, `${label}: not reached within ${budgetFrames} frames, is the time scale on?`).toBeLessThanOrEqual(
      budgetFrames,
    );
    await runFrames(page, STEP_FRAMES);
    frames += STEP_FRAMES;
    hooks = await readHooks(page);
  }
}

for (const arena of ROWS) {
  const title =
    arena.size === 2
      ? `plays the default match on ${arena.id} to the result screen and relaunches from its select`
      : `plays the 3v3 match on ${arena.id} to the result screen and relaunches from its select`;
  test(title, async ({ page }, testInfo) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const { problems, failed } = watchProblems(page);

    try {
      const startedAt = Date.now();
      await open(page, `/?${arena.query}timescale=${SCALE}`, failed);

      // The human sends no input. Until the phase is matchEnd the panel stays hidden.
      const { hooks, frames } = await runUntil(
        page,
        'the match end',
        arena.budgetTicks,
        arena.budgetFrames,
        (h) => h.phase === 'matchEnd',
        (h) => {
          if (h.phase !== 'matchEnd') expect(h.panelVisible, `the panel at tick ${h.tick}, phase ${h.phase}`).toBe('false');
        },
      );

      // The panel is up, with Victory exactly when the local score reached "first to N".
      const [local, other] = hooks.score.split(' : ').map(Number) as [number, number];
      expect(hooks.panelVisible).toBe('true');
      expect(await page.locator('[data-result="panel"]').isVisible()).toBe(true);
      expect(hooks.firstTo).toBe(3);
      expect(hooks.title).toBe(local === hooks.firstTo ? 'Victory' : 'Defeat');
      expect(hooks.resultScore, 'the result score is the HUD score').toBe(hooks.score);
      expect(Math.max(local, other)).toBe(hooks.firstTo);
      expect(hooks.round, 'every won round was played').toBeGreaterThanOrEqual(local + other);
      console.log(
        `match end on ${arena.id} ${arena.size}v${arena.size}: tick ${hooks.tick}, score ${hooks.score}, ${hooks.title}, ${frames} frames, ${Date.now() - startedAt} ms${'expected' in arena ? `, headless ${arena.expected}` : ''}`,
      );
      // One bar hook per champion, and no more.
      expect(hooks.barIds, 'the bar hooks').toEqual(Array.from({ length: 2 * arena.size }, (_, id) => id));

      // The select: the roster in order, a link per champion with a kit and no link for the rest.
      expect(hooks.entries.map((entry) => entry.champion)).toEqual(ROSTER);
      for (const entry of hooks.entries) {
        if (entry.available === 'true') {
          expect(entry.tag, entry.champion ?? '').toBe('A');
          expect(entry.href, entry.champion ?? '').toBe(
            `?champion=${entry.champion}&difficulty=normal&arena=${arena.id}&teamsize=${arena.size}`,
          );
        } else {
          expect(entry.available, entry.champion ?? '').toBe('false');
          expect(entry.href, entry.champion ?? '').toBeNull();
        }
      }
      const available = hooks.entries.filter((entry) => entry.available === 'true').map((entry) => entry.champion);
      expect(available).toContain('hargrim');
      expect(available).toContain('quillon');

      // The scoreboard works in every phase, so over the result panel too: held at the match end
      // it shows the final tally. Every death counts for its victim, so the deaths column is the
      // canvas's own count of deaths, and a ring death credits no kill, so the kills column is at
      // most that. (The scoreboard's rows are hud.spec.ts's.) Tab up hides it again.
      if (arena.id === 'arena01' && arena.size === 2) {
        await page.keyboard.down('Tab');
        const held = await readTotals(page);
        expect(held.visible, 'the scoreboard at the match end').toBe('true');
        expect(held.deaths).toHaveLength(2 * arena.size);
        expect(held.deaths.reduce((sum, count) => sum + count, 0), 'the deaths column sums to data-deaths').toBe(held.hook);
        expect(held.hook, 'a match has deaths').toBeGreaterThan(0);
        expect(held.kills.reduce((sum, count) => sum + count, 0), 'no more kills than deaths').toBeLessThanOrEqual(held.hook);
        await page.keyboard.up('Tab');
        expect((await readTotals(page)).visible).toBe('false');
      }

      await page.setViewportSize(SCREENSHOT_VIEWPORT);
      await runFrames(page, 2);
      await page.screenshot({ path: testInfo.outputPath('result.png') });

      // Following a link reloads the page as that champion on the same arena and team size:
      // Quillon has 120 health, the new match has the same number of bars, and it starts with
      // the panel hidden.
      await page.locator('[data-result="panel"] [data-champion="quillon"]').click();
      await orFail(page.waitForSelector(`canvas[data-arena="${arena.id}"][data-tick]`), failed);
      const reloaded = await readHooks(page);
      expect(reloaded.panelVisible).toBe('false');
      expect(page.url()).toContain(`teamsize=${arena.size}`);
      await orFail(page.waitForSelector(`canvas[data-bar${2 * arena.size - 1}]`), failed);
      expect((await readHooks(page)).barIds, 'the bars after the reload').toEqual(
        Array.from({ length: 2 * arena.size }, (_, id) => id),
      );
      expect(await page.locator('[data-hud="health-bar"] [data-part="health-text"]').textContent()).toBe('120 / 120');
      expect(reloaded.phase).not.toBe('matchEnd');
    } finally {
      expect(problems).toEqual([]);
    }
  });
}

/** The sim's ring radius in metres at a tick, from the rules (the ring is made at 180 + 5400 ticks, and shrinks over 1800). */
function simRadius(tick: number): number {
  const e = tick - (WARMUP_TICKS + ROUND_TICKS + 1);
  if (e <= 0) return RING_START_M;
  if (e >= SUDDEN_DEATH_TICKS) return RING_END_M;
  return RING_START_M + ((RING_END_M - RING_START_M) * e) / SUDDEN_DEATH_TICKS;
}

test('warns of the ring in the sandbox: a countdown, the falling radius, and the red edge outside', async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const { problems, failed } = watchProblems(page);

  try {
    const startedAt = Date.now();
    // The sandbox: champion 3 has no kit, so nobody can die before the ring.
    await open(page, `/?scene=sandbox&timescale=${SCALE}`, failed);

    const radii: number[] = [];
    const outsideReads: boolean[] = [];
    let counted = 0;
    const { hooks, frames } = await runUntil(
      page,
      'the red edge',
      RING_BUDGET_TICKS,
      RING_BUDGET_FRAMES,
      (h) => h.ring.outside === 'true',
      (h) => {
        if (h.phase !== 'round') return;
        const roundTick = h.tick - WARMUP_TICKS;
        if (roundTick < ROUND_TICKS - COUNTDOWN_TICKS) {
          // Hidden until the countdown starts, 600 ticks before the ring.
          expect(h.ring.visible, `the warning at tick ${h.tick}`).toBe('false');
          return;
        }
        expect(h.ring.visible, `the warning at tick ${h.tick}`).toBe('true');
        if (h.ring.counting === 'true') {
          // 10 down to 1, from the ticks left in the round.
          expect(Number(h.ring.countdown), `the countdown at tick ${h.tick}`).toBe(
            Math.max(1, Math.ceil((ROUND_TICKS - roundTick) / TICK_RATE)),
          );
          expect(h.ring.outside).toBe('false');
          counted++;
          return;
        }
        // The ring exists: the radius text is the sim radius at this tick, within 0.1 m.
        const radius = Number.parseFloat(h.ring.radius);
        expect(h.ring.radius).toMatch(/^\d+\.\d m$/);
        expect(Math.abs(radius - simRadius(h.tick)), `the radius at tick ${h.tick}`).toBeLessThanOrEqual(0.1);
        if (radii.length > 0) expect(radius, 'the radius falls from read to read').toBeLessThan(radii[radii.length - 1] as number);
        radii.push(radius);
        // The human is outside once the radius passes its distance from the centre.
        if (h.ring.outside === 'false') {
          expect(radius, `inside at ${radius} m`).toBeGreaterThanOrEqual(HUMAN_DISTANCE_M - 0.1);
        } else {
          expect(radius, `outside at ${radius} m`).toBeLessThanOrEqual(HUMAN_DISTANCE_M + 0.1);
        }
        outsideReads.push(h.ring.outside === 'true');
      },
    );
    expect(counted, 'a read landed in the countdown').toBeGreaterThanOrEqual(1);
    expect(radii.length, 'a read landed between the ring and the edge').toBeGreaterThanOrEqual(1);
    // The flag flipped once, from false to true, and the distance is the distance past the edge.
    expect(outsideReads.filter((outside) => !outside).length).toBeGreaterThanOrEqual(1);
    expect(outsideReads.at(-1)).toBe(true);
    expect(outsideReads.indexOf(true)).toBe(outsideReads.length - 1);
    const past = Number.parseFloat(hooks.ring.distance);
    expect(hooks.ring.distance).toMatch(/^\d+\.\d m$/);
    expect(Math.abs(past - (HUMAN_DISTANCE_M - Number.parseFloat(hooks.ring.radius)))).toBeLessThanOrEqual(0.15);

    // The picture: the red edge adds red pixels to the screen (the enemy bar is the other red).
    await page.setViewportSize(SCREENSHOT_VIEWPORT);
    await runFrames(page, 2);
    const outsidePicture = await page.screenshot({ path: testInfo.outputPath('ring.png') });
    const now = await readHooks(page);
    expect(now.ring.outside, 'still outside when the picture was taken').toBe('true');
    const withoutEdge = (await countPixels(page, await pictureWithoutEdge(page), [RED])).matches[0] ?? NaN;
    const withEdge = (await countPixels(page, outsidePicture, [RED])).matches[0] ?? NaN;
    // The floor is far under the edge: the 1.5u spread band alone is about
    // 2 x (1280 + 720) x 19 = 76 000 px at 1280x720 (u is 12.8 px), and the picture
    // measured about 96 000 red pixels more than the one without it.
    expect(withEdge - withoutEdge, 'the red edge shows').toBeGreaterThan(5000);
    console.log(
      `ring: outside at tick ${hooks.tick}, radius ${hooks.ring.radius}, ${withEdge - withoutEdge} red edge pixels, ${frames} frames, ${Date.now() - startedAt} ms`,
    );
  } finally {
    expect(problems).toEqual([]);
  }
});

/** A picture of the same moment with the red edge switched off, for the baseline of red pixels. */
async function pictureWithoutEdge(page: Page): Promise<Buffer> {
  await page.addStyleTag({ content: '[data-hud="ring-warning"][data-outside="true"] { box-shadow: none !important; }' });
  return page.screenshot();
}
