import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_MATCH, orFail, watchProblems } from './support';

// The pre-match select: the page opens on it at a bare address, the picks update the rows and
// the Start link without leaving the page, Start plays the setup, and an address that names a
// key skips it. The match itself is covered by the other specs, which enter with a key.
const ROSTER = ['hargrim', 'quillon', 'lumeth', 'skerrow', 'ondrel', 'brimwick', 'durnhal'];
const PICKED = '?champion=quillon&difficulty=hard&arena=arena02&teamsize=3';
const PANEL = '[data-select="panel"]';
// The bare address, the one that opens the select; every spec that wants the default match
// enters with DEFAULT_MATCH.
const BARE = '/';

interface Row {
  key: string | null;
  current: string | null;
  available: string | null;
  href: string | null;
}

interface SelectRead {
  champions: Row[];
  arenas: Row[];
  teams: Row[];
  difficulties: Row[];
  start: string | null;
  visible: string | null;
}

/** Reads the four rows of the panel under `root`, each entry by its hooks. */
async function readRows(page: Page, root: string): Promise<SelectRead> {
  return page.evaluate((selector) => {
    const rows = (part: string, attribute: string): Row[] =>
      [...document.querySelectorAll<HTMLElement>(`${selector} [data-part="${part}"] > *`)].map((entry) => ({
        key: entry.getAttribute(attribute),
        current: entry.getAttribute('data-current'),
        available: entry.getAttribute('data-available'),
        href: entry.getAttribute('href'),
      }));
    return {
      champions: rows('select', 'data-champion'),
      arenas: rows('arena-select', 'data-arena-id'),
      teams: rows('team-select', 'data-team-size'),
      difficulties: rows('difficulty-select', 'data-difficulty'),
      start: document.querySelector(`${selector} [data-action="start"]`)?.getAttribute('href') ?? null,
      visible: document.querySelector(selector)?.getAttribute('data-visible') ?? null,
    };
  }, root);
}

/** The keys of the entries marked current: one per row. */
function current(rows: Row[]): (string | null)[] {
  return rows.filter((row) => row.current === 'true').map((row) => row.key);
}

test('opens on the select at a bare address, with the defaults current and no canvas', async ({ page }, testInfo) => {
  const { problems, failed } = watchProblems(page);
  try {
    await page.goto(BARE);
    await orFail(page.waitForSelector(`${PANEL}[data-visible="true"]`), failed);
    expect(await page.locator('canvas').count()).toBe(0);
    expect(await page.locator('#select').count()).toBe(1);

    const read = await readRows(page, PANEL);
    // The roster ids in roster order, each available once its kit file exists.
    expect(read.champions.map((row) => row.key)).toEqual(ROSTER);
    for (const row of read.champions) expect(row.available, `${row.key} is available`).toBe('true');
    expect(current(read.champions)).toEqual(['hargrim']);
    expect(current(read.arenas)).toEqual(['arena01']);
    expect(read.arenas.map((row) => row.key)).toEqual(['arena01', 'arena02']);
    expect(current(read.teams)).toEqual(['2']);
    expect(current(read.difficulties)).toEqual(['normal']);
    expect(read.start).toBe(DEFAULT_MATCH.slice(1));
    expect(read.start).toBe('?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2');
    await page.screenshot({ path: testInfo.outputPath('select.png') });
  } finally {
    expect(problems).toEqual([]);
  }
});

test('picks update the rows and the Start link on the page, and Start plays the setup', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  try {
    await page.goto(BARE);
    await orFail(page.waitForSelector(`${PANEL}[data-visible="true"]`), failed);

    await page.click(`${PANEL} [data-champion="quillon"]`);
    await page.click(`${PANEL} [data-arena-id="arena02"]`);
    await page.click(`${PANEL} [data-team-size="3"]`);
    await page.click(`${PANEL} [data-difficulty="hard"]`);

    const picked = await readRows(page, PANEL);
    expect(current(picked.champions)).toEqual(['quillon']);
    expect(current(picked.arenas)).toEqual(['arena02']);
    expect(current(picked.teams)).toEqual(['3']);
    expect(current(picked.difficulties)).toEqual(['hard']);
    expect(picked.start).toBe(PICKED);
    // The picks never leave the page: the address is still the bare one.
    expect(new URL(page.url()).search).toBe('');
    expect(await page.locator('canvas').count()).toBe(0);

    await page.click(`${PANEL} [data-action="start"]`);
    await orFail(page.waitForSelector('canvas[data-arena="arena02"][data-tick]'), failed);
    await orFail(page.waitForSelector('canvas[data-bar5]'), failed);
    expect(new URL(page.url()).search).toBe(PICKED);
    expect(await page.locator('[data-hud="health-bar"] [data-part="health-text"]').textContent()).toBe('120 / 120');
    // The select is emptied, so the page is the page of a parameter launch.
    expect(await page.locator('#select').innerHTML()).toBe('');

    // The choices reached the relaunch links of the result panel and of the menu.
    for (const root of ['[data-result="panel"]', '[data-menu="panel"]']) {
      const read = await readRows(page, root);
      expect(current(read.champions), root).toEqual(['quillon']);
      expect(read.champions.find((row) => row.key === 'quillon')?.href, root).toBe(PICKED);
      expect(current(read.arenas), root).toEqual(['arena02']);
      expect(current(read.teams), root).toEqual(['3']);
      expect(current(read.difficulties), root).toEqual(['hard']);
      for (const row of [...read.arenas, ...read.difficulties]) expect(row.href, root).toContain('champion=quillon');
      expect(read.difficulties.find((row) => row.key === 'hard')?.href, root).toBe(PICKED);
    }

    // A reload goes straight into the same match: the address is the setup.
    await page.reload();
    await orFail(page.waitForSelector('canvas[data-arena="arena02"][data-bar5]'), failed);
    expect(await page.locator(PANEL).count()).toBe(0);
    expect(new URL(page.url()).search).toBe(PICKED);
  } finally {
    expect(problems).toEqual([]);
  }
});

test('skips the select when the address names a key, and opens it for an unrelated one', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  try {
    for (const address of ['/?champion=quillon', '/?difficulty=brutal']) {
      await page.goto(address);
      await orFail(page.waitForSelector('canvas[data-arena][data-tick]'), failed);
      expect(await page.locator(PANEL).count(), address).toBe(0);
    }
    await page.goto('/?foo=1');
    await orFail(page.waitForSelector(`${PANEL}[data-visible="true"]`), failed);
    expect(await page.locator('canvas').count()).toBe(0);
  } finally {
    expect(problems).toEqual([]);
  }
});

test('keeps the keyboard focus on the picked entry after the rows are rebuilt', async ({ page }) => {
  const { problems, failed } = watchProblems(page);
  try {
    await page.goto(BARE);
    await orFail(page.waitForSelector(`${PANEL}[data-visible="true"]`), failed);

    // A pick rebuilds the rows, so the entry that held the focus is a new element: the focus
    // must land on its successor in the same place of the same row, now the current one.
    await page.focus(`${PANEL} [data-champion="quillon"]`);
    await page.keyboard.press('Enter');
    const read = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        champion: active?.getAttribute('data-champion') ?? null,
        current: active?.getAttribute('data-current') ?? null,
        inPanel: active?.closest('[data-select="panel"]') !== null,
      };
    });
    expect(read).toEqual({ champion: 'quillon', current: 'true', inPanel: true });

    // The same on another row, reached by the keyboard alone.
    await page.focus(`${PANEL} [data-difficulty="hard"]`);
    await page.keyboard.press('Enter');
    const hard = await page.evaluate(() => ({
      tier: document.activeElement?.getAttribute('data-difficulty') ?? null,
      current: document.activeElement?.getAttribute('data-current') ?? null,
    }));
    expect(hard).toEqual({ tier: 'hard', current: 'true' });
    expect(new URL(page.url()).search).toBe('');
  } finally {
    expect(problems).toEqual([]);
  }
});
