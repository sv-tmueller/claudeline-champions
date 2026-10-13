import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, type Action } from './bindings';
import { createInputCore } from './input';
import { Menu } from './menu';
import { bindMenu, type MenuButtons } from './menu-dom';
import { fake } from './test-fake';

function setup() {
  const calls: string[] = [];
  const input = createInputCore();
  const handles = {
    panel: fake(),
    keys: fake(),
    rows: Object.fromEntries(ACTIONS.map((action) => [action, { row: fake(), key: fake() }])) as never,
  };
  const menu = new Menu(
    handles,
    input,
    { saveSettings: () => Promise.resolve() },
    {
      setPaused: (on) => calls.push(`paused:${on}`),
      restart: () => calls.push('restart'),
      releaseInput: () => calls.push('release'),
    },
    false,
  );
  const win = new EventTarget();
  const buttons: MenuButtons = {
    resume: new EventTarget(),
    restart: new EventTarget(),
    select: new EventTarget(),
    keys: new EventTarget(),
    backFromSelect: new EventTarget(),
    backFromKeys: new EventTarget(),
    reset: new EventTarget(),
    rebind: Object.fromEntries(ACTIONS.map((action) => [action, new EventTarget()])) as Record<Action, EventTarget>,
  };
  const unbind = bindMenu(win, menu, buttons);
  return { calls, input, menu, win, buttons, unbind };
}

function keydown(code: string, repeat = false): Event & { code: string; repeat: boolean } {
  return Object.assign(new Event('keydown', { cancelable: true }), { code, repeat });
}

const click = (): Event => new Event('click');

describe('bindMenu', () => {
  it('opens on Escape and stops the browser default', () => {
    const { menu, win } = setup();
    const event = keydown('Escape');
    win.dispatchEvent(event);
    expect(menu.isOpen).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves other keys to the browser while no capture runs', () => {
    const { menu, win } = setup();
    const event = keydown('KeyW');
    win.dispatchEvent(event);
    expect(menu.isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('resumes on the Resume button', () => {
    const { menu, win, buttons } = setup();
    win.dispatchEvent(keydown('Escape'));
    buttons.resume.dispatchEvent(click());
    expect(menu.isOpen).toBe(false);
  });

  it('restarts on the Restart button, once', () => {
    const { calls, win, buttons } = setup();
    win.dispatchEvent(keydown('Escape'));
    calls.length = 0;
    buttons.restart.dispatchEvent(click());
    expect(calls).toEqual(['restart']);
  });

  it('shows the select and the keys views and goes back from each', () => {
    const { menu, win, buttons } = setup();
    win.dispatchEvent(keydown('Escape'));
    buttons.select.dispatchEvent(click());
    expect(menu.view).toBe('select');
    buttons.backFromSelect.dispatchEvent(click());
    expect(menu.view).toBe('main');
    buttons.keys.dispatchEvent(click());
    expect(menu.view).toBe('keys');
    buttons.backFromKeys.dispatchEvent(click());
    expect(menu.view).toBe('main');
  });

  it('rebinds through the button of a row and the next key, then resets', () => {
    const { input, menu, win, buttons } = setup();
    win.dispatchEvent(keydown('Escape'));
    buttons.keys.dispatchEvent(click());
    buttons.rebind.right.dispatchEvent(click());
    expect(menu.capturing).toBe('right');
    const key = keydown('KeyL');
    win.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(input.bindings.right).toBe('KeyL');
    buttons.reset.dispatchEvent(click());
    expect(input.bindings).toEqual(DEFAULT_BINDINGS);
  });

  it('gives each row button its own action', () => {
    const { menu, win, buttons } = setup();
    win.dispatchEvent(keydown('Escape'));
    for (const action of ACTIONS) {
      buttons.rebind[action].dispatchEvent(click());
      expect(menu.capturing, action).toBe(action);
    }
  });

  it('stops listening after unbind', () => {
    const { menu, win, buttons, unbind } = setup();
    unbind();
    win.dispatchEvent(keydown('Escape'));
    expect(menu.isOpen).toBe(false);
    menu.toggle();
    buttons.resume.dispatchEvent(click());
    expect(menu.isOpen).toBe(true);
  });
});
