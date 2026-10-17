import { expect, test, type Page } from '@playwright/test';
import { orFail, waitForPhase, watchProblems } from './support';

// The slots in the order of SLOTS in the sim, which is the order on screen.
const SLOT_NAMES = ['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'];
const HUD_ELEMENTS = [
  'health-bar',
  'energy-bar',
  'cooldown-icons',
  'round-score',
  'round-timer',
  'ring-warning',
  'kill-feed',
  'scoreboard',
];
// A round is 5400 ticks (90 s at 60 Hz) and the warmup before round 1 is 180 ticks.
const ROUND_TICKS = 5400;
const TICK_RATE = 60;
const WARMUP_TICKS = 180;

interface HudRead {
  slots: {
    name: string | null;
    ready: string | null;
    windup: string | null;
    blocked: string | null;
    silenced: string | null;
    seconds: string;
  }[];
  healthText: string;
  marks: { name: string | null; ready: string | null }[];
  score: string;
  timer: string;
  tick: number;
  phase: string | undefined;
  round: string | undefined;
  visibleLines: number;
  hudElements: (string | null)[];
  result: {
    visible: string | null;
    entries: { champion: string | null; available: string | null; href: string | null; text: string }[];
    arenas: { id: string | null; current: string | null; href: string | null; text: string }[];
    teams: { size: string | null; current: string | null; available: string | null; href: string | null; text: string }[];
    difficulties: { tier: string | null; current: string | null; href: string | null; text: string }[];
  };
}

// One evaluate reads everything, so the tick and the timer come from the same frame.
async function readHud(page: Page): Promise<HudRead> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const text = (selector: string): string => document.querySelector(selector)?.textContent ?? '';
    return {
      slots: [...document.querySelectorAll<HTMLElement>('[data-slot]')].map((icon) => ({
        name: icon.getAttribute('data-slot'),
        ready: icon.getAttribute('data-ready'),
        windup: icon.getAttribute('data-windup'),
        blocked: icon.getAttribute('data-blocked'),
        silenced: icon.getAttribute('data-silenced'),
        seconds: icon.querySelector('[data-part="seconds"]')?.textContent ?? '?',
      })),
      healthText: text('[data-hud="health-bar"] [data-part="health-text"]'),
      marks: [...document.querySelectorAll<HTMLElement>('[data-mark]')].map((mark) => ({
        name: mark.getAttribute('data-mark'),
        ready: mark.getAttribute('data-ready'),
      })),
      score: text('[data-hud="round-score"]'),
      timer: text('[data-hud="round-timer"]'),
      tick: Number(canvas.dataset['tick']),
      phase: canvas.dataset['phase'],
      round: canvas.dataset['round'],
      visibleLines: document.querySelectorAll('[data-line][data-visible="true"]').length,
      hudElements: [...document.querySelectorAll('[data-hud]')].map((el) => el.getAttribute('data-hud')),
      result: {
        visible: document.querySelector('[data-result="panel"]')?.getAttribute('data-visible') ?? null,
        entries: [...document.querySelectorAll<HTMLElement>('[data-result="panel"] [data-champion]')].map((entry) => ({
          champion: entry.getAttribute('data-champion'),
          available: entry.getAttribute('data-available'),
          href: entry.getAttribute('href'),
          text: entry.textContent ?? '',
        })),
        arenas: [...document.querySelectorAll<HTMLElement>('[data-result="panel"] [data-arena-id]')].map((entry) => ({
          id: entry.getAttribute('data-arena-id'),
          current: entry.getAttribute('data-current'),
          href: entry.getAttribute('href'),
          text: entry.textContent ?? '',
        })),
        teams: [...document.querySelectorAll<HTMLElement>('[data-result="panel"] [data-team-size]')].map((entry) => ({
          size: entry.getAttribute('data-team-size'),
          current: entry.getAttribute('data-current'),
          available: entry.getAttribute('data-available'),
          href: entry.getAttribute('href'),
          text: entry.textContent ?? '',
        })),
        difficulties: [...document.querySelectorAll<HTMLElement>('[data-result="panel"] [data-difficulty]')].map((entry) => ({
          tier: entry.getAttribute('data-difficulty'),
          current: entry.getAttribute('data-current'),
          href: entry.getAttribute('href'),
          text: entry.textContent ?? '',
        })),
      },
    };
  });
}

/** The timer of the first round at a tick: the full round in the warmup, then the ticks since round 1 began. */
function timerText(tick: number): string {
  const seconds = Math.max(0, Math.ceil((ROUND_TICKS - Math.max(0, tick - WARMUP_TICKS)) / TICK_RATE));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function slotWidth(page: Page): Promise<number> {
  const box = await page.locator('[data-slot="M1"]').boundingBox();
  if (!box) throw new Error('the M1 icon has no box');
  return box.width;
}

test('renders the scene and the HUD', async ({ page }, testInfo) => {
  // The assertion sits in finally so the collected errors are reported even
  // when the canvas never renders and the wait fails.
  const { problems, failed } = watchProblems(page);

  try {
    await page.goto('/');
    // data-arena is set after the first HUD write.
    await orFail(page.waitForSelector('canvas[data-arena="arena01"]'), failed);

    const hud = await readHud(page);
    expect(hud.hudElements).toEqual(HUD_ELEMENTS);
    expect(hud.slots.map((slot) => slot.name)).toEqual(SLOT_NAMES);
    for (const slot of hud.slots) {
      expect(slot.ready, `${slot.name} is ready`).toBe('true');
      expect(slot.windup, `${slot.name} is not winding up`).toBe('false');
      expect(slot.seconds, `${slot.name} shows no cooldown`).toBe('');
      // Only the ultimate is blocked: the energy starts at 0.
      expect(slot.blocked, `${slot.name} blocked`).toBe(slot.name === 'F' ? 'true' : 'false');
      // Nobody silences the human at the start, and the silence flag is its own: F is not silenced.
      expect(slot.silenced, `${slot.name} silenced`).toBe('false');
    }
    // The pick is Hargrim, with 160 health.
    expect(hud.healthText).toBe('160 / 160');
    expect(hud.marks).toEqual([
      { name: 'ex', ready: 'false' },
      { name: 'ultimate', ready: 'false' },
    ]);
    expect(hud.score).toContain('0 : 0');
    expect(hud.score).toContain('first to 3');
    expect(hud.timer).toBe(timerText(hud.tick));
    expect(hud.visibleLines).toBe(0);
    // The ring warning exists and stays hidden until the countdown before sudden death.
    expect(await page.locator('[data-hud="ring-warning"]').getAttribute('data-visible')).toBe('false');
    expect(await page.locator('[data-hud="ring-warning"]').isVisible()).toBe(false);
    // The scoreboard exists and stays hidden until Tab is held (hud.spec.ts).
    expect(await page.locator('[data-hud="scoreboard"]').getAttribute('data-visible')).toBe('false');
    expect(await page.locator('[data-hud="scoreboard"]').isVisible()).toBe(false);
    // The result panel exists and stays hidden until the match ends. Its select
    // lists the roster in order: the champions with a kit link to a relaunch on the
    // arena being played, the others are greyed and have no link. The arena row
    // lists both arenas in id order, each linking with the current champion. Every
    // link writes the team size, 2 included, and the team row has 2v2 as the current. The
    // difficulty row lists the three tiers with normal as the current, each link writing
    // the whole setup with its own tier.
    expect(hud.result.visible).toBe('false');
    expect(hud.result.entries).toEqual([
      { champion: 'hargrim', available: 'true', href: '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2', text: 'Hargrim' },
      { champion: 'quillon', available: 'true', href: '?champion=quillon&difficulty=normal&arena=arena01&teamsize=2', text: 'Quillon' },
      { champion: 'lumeth', available: 'true', href: '?champion=lumeth&difficulty=normal&arena=arena01&teamsize=2', text: 'Lumeth' },
      { champion: 'skerrow', available: 'true', href: '?champion=skerrow&difficulty=normal&arena=arena01&teamsize=2', text: 'Skerrow' },
    ]);
    expect(hud.result.arenas).toEqual([
      { id: 'arena01', current: 'true', href: '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2', text: 'Arena 1' },
      { id: 'arena02', current: 'false', href: '?champion=hargrim&difficulty=normal&arena=arena02&teamsize=2', text: 'Arena 2' },
    ]);
    expect(hud.result.teams).toEqual([
      { size: '2', current: 'true', available: 'true', href: '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2', text: '2v2' },
      { size: '3', current: 'false', available: 'true', href: '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=3', text: '3v3' },
    ]);
    expect(hud.result.difficulties).toEqual([
      { tier: 'easy', current: 'false', href: '?champion=hargrim&difficulty=easy&arena=arena01&teamsize=2', text: 'Easy' },
      { tier: 'normal', current: 'true', href: '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2', text: 'Normal' },
      { tier: 'hard', current: 'false', href: '?champion=hargrim&difficulty=hard&arena=arena01&teamsize=2', text: 'Hard' },
    ]);
    expect(await page.locator('[data-result="panel"]').isVisible()).toBe(false);

    // The timer follows the phase: the full round in the warmup, then the round clock.
    await waitForPhase(page, 'round', failed);
    const round = await readHud(page);
    expect(round.round).toBe('1');
    expect(round.timer).toBe(timerText(round.tick));

    // A right click must reach the canvas, so no HUD element takes the pointer.
    const icon = await page.locator('[data-slot="Q"]').boundingBox();
    if (!icon) throw new Error('the Q icon has no box');
    const topmost = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? null,
      { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 },
    );
    expect(topmost).toBe('CANVAS');

    // The HUD scales with the window: at half the size an icon is half as wide.
    const full = await slotWidth(page);
    await page.setViewportSize({ width: 640, height: 360 });
    const half = await slotWidth(page);
    expect(Math.abs(full - 2 * half)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.screenshot({ path: testInfo.outputPath('scene.png') });
  } finally {
    expect(problems).toEqual([]);
  }
});

test('starts as Quillon from the launch address', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  try {
    await page.goto('/?champion=quillon');
    await orFail(page.waitForSelector('canvas[data-arena="arena01"]'), failed);
    expect((await readHud(page)).healthText).toBe('120 / 120');
  } finally {
    expect(problems).toEqual([]);
  }
});

test('starts on arena02 from the launch address', async ({ page }, testInfo) => {
  const { problems, failed } = watchProblems(page);
  try {
    await page.goto('/?arena=arena02');
    await orFail(page.waitForSelector('canvas[data-arena="arena02"]'), failed);
    // The sim got arena02, not only the hook: the human stands on its first team A spawn, (-11, 2).
    const canvas = page.locator('canvas');
    expect(Number(await canvas.getAttribute('data-p0x'))).toBe(-1100);
    expect(Number(await canvas.getAttribute('data-p0y'))).toBe(200);
    // The select carries the arena: the champion links stay on it, and arena02 is the current one.
    const hud = await readHud(page);
    expect(hud.result.entries.map((entry) => entry.href)).toEqual([
      '?champion=hargrim&difficulty=normal&arena=arena02&teamsize=2',
      '?champion=quillon&difficulty=normal&arena=arena02&teamsize=2',
      '?champion=lumeth&difficulty=normal&arena=arena02&teamsize=2',
      '?champion=skerrow&difficulty=normal&arena=arena02&teamsize=2',
    ]);
    expect(hud.result.arenas.map((entry) => [entry.id, entry.current])).toEqual([
      ['arena01', 'false'],
      ['arena02', 'true'],
    ]);
    await page.screenshot({ path: testInfo.outputPath('scene-arena02.png') });
  } finally {
    expect(problems).toEqual([]);
  }
});

test('starts a 3v3 from the launch address', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  try {
    await page.goto('/?teamsize=3');
    // Every bar is written once, so data-bar5 is there after the first frame.
    await orFail(page.waitForSelector('canvas[data-arena="arena01"][data-bar5]'), failed);
    const canvas = page.locator('canvas');
    // Six champions, so six bars at full health and no seventh. Bars are written when
    // their percent changes, and nobody has been hurt in the warmup.
    for (let id = 0; id < 6; id++) expect(await canvas.getAttribute(`data-bar${id}`), `bar ${id}`).toBe('100');
    expect(await canvas.getAttribute('data-bar6')).toBeNull();
    // The human stands on the first team A spawn, (-12, 2).
    expect(Number(await canvas.getAttribute('data-p0x'))).toBe(-1200);
    expect(Number(await canvas.getAttribute('data-p0y'))).toBe(200);
    // The select keeps the size: 3v3 is the current one, and every link carries it.
    const hud = await readHud(page);
    expect(hud.result.teams.map((entry) => [entry.size, entry.current])).toEqual([
      ['2', 'false'],
      ['3', 'true'],
    ]);
    expect(hud.result.entries.map((entry) => entry.href)).toEqual([
      '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=3',
      '?champion=quillon&difficulty=normal&arena=arena01&teamsize=3',
      '?champion=lumeth&difficulty=normal&arena=arena01&teamsize=3',
      '?champion=skerrow&difficulty=normal&arena=arena01&teamsize=3',
    ]);
    expect(hud.result.arenas.map((entry) => entry.href)).toEqual([
      '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=3',
      '?champion=hargrim&difficulty=normal&arena=arena02&teamsize=3',
    ]);
    expect(hud.result.teams.map((entry) => entry.href)).toEqual([
      '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2',
      '?champion=hargrim&difficulty=normal&arena=arena01&teamsize=3',
    ]);
  } finally {
    expect(problems).toEqual([]);
  }
});

test('starts on the hard tier from the launch address, and reads an unknown tier as normal', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  try {
    await page.goto('/?champion=quillon&difficulty=hard&arena=arena02&teamsize=3');
    await orFail(page.waitForSelector('canvas[data-arena="arena02"][data-bar5]'), failed);
    // Hard is the current tier, and every link outside the difficulty row carries it, with the
    // rest of the setup.
    const hud = await readHud(page);
    expect(hud.result.difficulties.map((entry) => [entry.tier, entry.current])).toEqual([
      ['easy', 'false'],
      ['normal', 'false'],
      ['hard', 'true'],
    ]);
    const outside = [...hud.result.entries, ...hud.result.arenas, ...hud.result.teams].map((entry) => entry.href);
    expect(outside).toHaveLength(8);
    for (const href of outside) expect(href, 'a link keeps the tier').toContain('difficulty=hard');
    // The difficulty row's own links write each tier, with the champion, the arena and the size kept.
    expect(hud.result.difficulties.map((entry) => entry.href)).toEqual([
      '?champion=quillon&difficulty=easy&arena=arena02&teamsize=3',
      '?champion=quillon&difficulty=normal&arena=arena02&teamsize=3',
      '?champion=quillon&difficulty=hard&arena=arena02&teamsize=3',
    ]);

    await page.goto('/?difficulty=brutal');
    await orFail(page.waitForSelector('canvas[data-arena="arena01"]'), failed);
    const unknown = await readHud(page);
    expect(unknown.result.difficulties.map((entry) => [entry.tier, entry.current])).toEqual([
      ['easy', 'false'],
      ['normal', 'true'],
      ['hard', 'false'],
    ]);
  } finally {
    expect(problems).toEqual([]);
  }
});
