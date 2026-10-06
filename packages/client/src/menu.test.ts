import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, type Action, type Bindings } from './bindings';
import { createInputCore } from './input';
import { Menu, type MenuHandles } from './menu';
import type { Settings } from './platform';
import { fake, type Fake } from './test-fake';

interface Rig {
  menu: Menu;
  panel: Fake;
  keys: Fake;
  rows: Record<Action, { row: Fake; key: Fake }>;
  calls: string[];
  saved: Settings[];
  input: ReturnType<typeof createInputCore>;
}

function rig(stored: Bindings = DEFAULT_BINDINGS): Rig {
  const panel = fake();
  const keys = fake();
  const rows = Object.fromEntries(ACTIONS.map((action) => [action, { row: fake(), key: fake() }])) as Record<
    Action,
    { row: Fake; key: Fake }
  >;
  const calls: string[] = [];
  const saved: Settings[] = [];
  const input = createInputCore();
  input.setBindings(stored);
  const handles: MenuHandles = { panel, keys, rows };
  const menu = new Menu(
    handles,
    input,
    {
      saveSettings(settings) {
        calls.push('save');
        saved.push(settings);
        return Promise.resolve();
      },
    },
    {
      setPaused: (on) => calls.push(`paused:${on}`),
      restart: () => calls.push('restart'),
      releaseInput: () => calls.push('release'),
    },
  );
  return { menu, panel, keys, rows, calls, saved, input };
}

/** The last value written to an attribute, or undefined. */
function attribute(element: Fake, name: string): string | undefined {
  const writes = element.log.filter((entry) => entry.startsWith(`${name}=`));
  return writes.at(-1)?.slice(name.length + 1);
}

describe('opening the menu', () => {
  it('toggle opens it paused, with the input released and the main view showing', () => {
    const { menu, panel, calls } = rig();
    expect(menu.isOpen).toBe(false);
    menu.toggle();
    expect(menu.isOpen).toBe(true);
    expect(calls).toEqual(['paused:true', 'release']);
    expect(attribute(panel, 'data-visible')).toBe('true');
    expect(attribute(panel, 'data-view')).toBe('main');
  });

  it('closes on the second toggle, unpauses and releases the input again', () => {
    const { menu, panel, calls } = rig();
    menu.toggle();
    calls.length = 0;
    menu.toggle();
    expect(menu.isOpen).toBe(false);
    expect(calls).toEqual(['release', 'paused:false']);
    expect(attribute(panel, 'data-visible')).toBe('false');
  });

  it('resume closes it the same way, and does nothing while it is closed', () => {
    const { menu, calls } = rig();
    menu.resume();
    expect(calls).toEqual([]);
    menu.toggle();
    calls.length = 0;
    menu.resume();
    expect(menu.isOpen).toBe(false);
    expect(calls).toEqual(['release', 'paused:false']);
  });

  it('reopens on the main view, whatever view it was closed on', () => {
    const { menu, panel } = rig();
    menu.toggle();
    menu.showSelect();
    menu.toggle();
    menu.toggle();
    expect(attribute(panel, 'data-view')).toBe('main');
  });
});

describe('the menu actions', () => {
  it('restart calls restart exactly once and nothing else', () => {
    const { menu, calls } = rig();
    menu.toggle();
    calls.length = 0;
    menu.restart();
    expect(calls).toEqual(['restart']);
    expect(menu.isOpen).toBe(true);
  });

  it('back to select shows the select view and keeps the match paused', () => {
    const { menu, panel, calls } = rig();
    menu.toggle();
    calls.length = 0;
    menu.showSelect();
    expect(attribute(panel, 'data-view')).toBe('select');
    expect(menu.isOpen).toBe(true);
    expect(calls).toEqual([]);
  });

  it('back from a view returns to the main view and stays open and paused', () => {
    const { menu, panel, calls } = rig();
    menu.toggle();
    menu.showKeys();
    calls.length = 0;
    menu.showMain();
    expect(attribute(panel, 'data-view')).toBe('main');
    expect(menu.isOpen).toBe(true);
    expect(calls).toEqual([]);
  });

  it('shows a view only while the menu is open', () => {
    const { menu, panel } = rig();
    menu.showSelect();
    menu.showKeys();
    expect(panel.log).toEqual([]);
  });
});

describe('the keys view', () => {
  it('shows the bindings of the input core, not the stored ones', () => {
    const { menu, rows, input } = rig();
    input.setBindings({ ...DEFAULT_BINDINGS, right: 'KeyL' });
    menu.toggle();
    menu.showKeys();
    expect(rows.right.key.textContent).toBe('L');
    expect(rows.up.key.textContent).toBe('W');
    expect(rows.SPACE.key.textContent).toBe('Space');
    expect(ACTIONS.map((action) => rows[action].key.textContent)).toEqual(['W', 'A', 'S', 'L', 'Space', 'Q', 'E', 'R', 'F']);
  });

  it('writes a row only when its text changes', () => {
    const { menu, rows, input } = rig();
    menu.toggle();
    menu.showKeys();
    for (const action of ACTIONS) expect(rows[action].key.log, action).toHaveLength(1);
    menu.showMain();
    menu.showKeys();
    for (const action of ACTIONS) expect(rows[action].key.log, action).toHaveLength(1);
    input.setBindings({ ...DEFAULT_BINDINGS, right: 'KeyL' });
    menu.showMain();
    menu.showKeys();
    expect(rows.right.key.log).toHaveLength(2);
    expect(rows.up.key.log).toHaveLength(1);
  });

  it('applies a captured key, saves once and writes the row', () => {
    const { menu, rows, keys, input, saved } = rig();
    menu.toggle();
    menu.showKeys();
    menu.startCapture('right');
    expect(menu.capturing).toBe('right');
    expect(attribute(keys, 'data-capturing')).toBe('right');
    expect(attribute(rows.right.row, 'data-capturing')).toBe('true');
    menu.capture('KeyL');
    expect(input.bindings).toEqual({ ...DEFAULT_BINDINGS, right: 'KeyL' });
    expect(saved).toEqual([{ version: 1, bindings: { ...DEFAULT_BINDINGS, right: 'KeyL' } }]);
    expect(rows.right.key.textContent).toBe('L');
    expect(menu.capturing).toBeUndefined();
    expect(attribute(keys, 'data-capturing')).toBe('none');
    expect(attribute(rows.right.row, 'data-capturing')).toBe('false');
    expect(attribute(keys, 'data-error')).toBe('none');
  });

  it('refuses a duplicate key: the error shows, nothing is saved or changed', () => {
    const { menu, rows, keys, input, saved } = rig();
    menu.toggle();
    menu.showKeys();
    menu.startCapture('up');
    menu.capture('KeyD');
    expect(attribute(keys, 'data-error')).toBe('duplicate');
    expect(input.bindings).toEqual(DEFAULT_BINDINGS);
    expect(saved).toEqual([]);
    expect(rows.up.key.textContent).toBe('W');
    expect(menu.capturing).toBe('up');
  });

  it('refuses a reserved key the same way', () => {
    const { menu, keys, input, saved } = rig();
    menu.toggle();
    menu.showKeys();
    menu.startCapture('Q');
    menu.capture('Tab');
    expect(attribute(keys, 'data-error')).toBe('reserved');
    expect(input.bindings).toEqual(DEFAULT_BINDINGS);
    expect(saved).toEqual([]);
  });

  it('takes a valid key after an error and clears the error', () => {
    const { menu, keys, saved } = rig();
    menu.toggle();
    menu.showKeys();
    menu.startCapture('up');
    menu.capture('KeyD');
    menu.capture('KeyI');
    expect(attribute(keys, 'data-error')).toBe('none');
    expect(saved).toHaveLength(1);
  });

  it('cancels the capture on Escape and keeps the menu open', () => {
    const { menu, keys, input, saved, calls } = rig();
    menu.toggle();
    menu.showKeys();
    menu.startCapture('right');
    calls.length = 0;
    menu.capture('Escape');
    expect(menu.capturing).toBeUndefined();
    expect(attribute(keys, 'data-capturing')).toBe('none');
    expect(menu.isOpen).toBe(true);
    expect(calls).toEqual([]);
    expect(saved).toEqual([]);
    expect(input.bindings).toEqual(DEFAULT_BINDINGS);
  });

  it('reset restores the defaults and saves them', () => {
    const { menu, rows, input, saved } = rig({ ...DEFAULT_BINDINGS, right: 'KeyL' });
    menu.toggle();
    menu.showKeys();
    expect(rows.right.key.textContent).toBe('L');
    menu.resetBindings();
    expect(input.bindings).toEqual(DEFAULT_BINDINGS);
    expect(saved).toEqual([{ version: 1, bindings: DEFAULT_BINDINGS }]);
    expect(rows.right.key.textContent).toBe('D');
  });

  it('ends a capture when the menu closes', () => {
    const { menu } = rig();
    menu.toggle();
    menu.showKeys();
    menu.startCapture('F');
    menu.toggle();
    expect(menu.capturing).toBeUndefined();
  });

  it('does not start a capture while the menu is closed', () => {
    const { menu } = rig();
    menu.startCapture('F');
    expect(menu.capturing).toBeUndefined();
  });
});

describe('the keyboard', () => {
  it('opens and closes on Escape and ignores a repeat', () => {
    const { menu } = rig();
    expect(menu.onKeyDown('Escape', false)).toBe(true);
    expect(menu.isOpen).toBe(true);
    expect(menu.onKeyDown('Escape', true)).toBe(false);
    expect(menu.isOpen).toBe(true);
    expect(menu.onKeyDown('Escape', false)).toBe(true);
    expect(menu.isOpen).toBe(false);
  });

  it('leaves every other key alone while no capture runs', () => {
    const { menu, saved } = rig();
    expect(menu.onKeyDown('KeyW', false)).toBe(false);
    menu.toggle();
    expect(menu.onKeyDown('KeyW', false)).toBe(false);
    expect(saved).toEqual([]);
  });

  it('gives a key to the capture, and Escape cancels it without closing the menu', () => {
    const { menu, input } = rig();
    menu.toggle();
    menu.showKeys();
    menu.startCapture('right');
    expect(menu.onKeyDown('KeyL', false)).toBe(true);
    expect(input.bindings.right).toBe('KeyL');
    menu.startCapture('up');
    expect(menu.onKeyDown('Escape', false)).toBe(true);
    expect(menu.capturing).toBeUndefined();
    expect(menu.isOpen).toBe(true);
  });

  it('ignores a repeated keydown during a capture', () => {
    const { menu, saved } = rig();
    menu.toggle();
    menu.showKeys();
    menu.startCapture('right');
    expect(menu.onKeyDown('KeyL', true)).toBe(true);
    expect(menu.capturing).toBe('right');
    expect(saved).toEqual([]);
  });
});
