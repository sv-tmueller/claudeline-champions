import { expect, test, type Page } from '@playwright/test';
import { orFail, waitForPhase, watchProblems } from './support';

// The slots in the order of SLOTS in the sim, which is the order on screen.
const SLOT_NAMES = ['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'];
const HUD_ELEMENTS = ['health-bar', 'energy-bar', 'cooldown-icons', 'round-score', 'round-timer', 'kill-feed'];
// A round is 5400 ticks (90 s at 60 Hz) and the warmup before round 1 is 180 ticks.
const ROUND_TICKS = 5400;
const TICK_RATE = 60;
const WARMUP_TICKS = 180;

interface HudRead {
  slots: { name: string | null; ready: string | null; windup: string | null; blocked: string | null; seconds: string }[];
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
    // The result panel exists and stays hidden until the match ends. Its select
    // lists the roster in order: the champions with a kit link to a relaunch, the
    // others are greyed and have no link.
    expect(hud.result.visible).toBe('false');
    expect(hud.result.entries).toEqual([
      { champion: 'hargrim', available: 'true', href: '?champion=hargrim&difficulty=normal', text: 'Hargrim' },
      { champion: 'quillon', available: 'true', href: '?champion=quillon&difficulty=normal', text: 'Quillon' },
      { champion: 'lumeth', available: 'false', href: null, text: 'Lumeth' },
      { champion: 'skerrow', available: 'false', href: null, text: 'Skerrow' },
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
