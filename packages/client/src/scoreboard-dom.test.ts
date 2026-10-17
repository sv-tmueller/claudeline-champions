import { describe, expect, it } from 'vitest';
import { bindScoreboard } from './scoreboard-dom';

interface KeyInit {
  code: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

function key(type: 'keydown' | 'keyup', init: KeyInit): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...init,
  });
}

function setup(menuOpen = false) {
  const calls: string[] = [];
  const state = { menuOpen };
  const win = new EventTarget();
  const unbind = bindScoreboard(
    win,
    { show: () => calls.push('show'), hide: () => calls.push('hide') },
    () => state.menuOpen,
  );
  return { calls, state, win, unbind };
}

describe('bindScoreboard', () => {
  it('shows on Tab down and stops the browser default', () => {
    const { calls, win } = setup();
    const event = key('keydown', { code: 'Tab' });
    win.dispatchEvent(event);
    expect(calls).toEqual(['show']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows again on the repeats of a held Tab, and stops their default too', () => {
    const { calls, win } = setup();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    const repeat = key('keydown', { code: 'Tab', repeat: true });
    win.dispatchEvent(repeat);
    expect(calls).toEqual(['show', 'show']);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('hides on Tab up', () => {
    const { calls, win } = setup();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    win.dispatchEvent(key('keyup', { code: 'Tab' }));
    expect(calls).toEqual(['show', 'hide']);
  });

  it('ignores the other keys', () => {
    const { calls, win } = setup();
    const down = key('keydown', { code: 'KeyW' });
    win.dispatchEvent(down);
    win.dispatchEvent(key('keyup', { code: 'KeyW' }));
    expect(calls).toEqual([]);
    expect(down.defaultPrevented).toBe(false);
  });

  it('ignores Tab with Ctrl, Alt or Meta held, and leaves the default to the browser', () => {
    const { calls, win } = setup();
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      const event = key('keydown', { code: 'Tab', [modifier]: true });
      win.dispatchEvent(event);
      expect(event.defaultPrevented, modifier).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('shows with Shift held, since Shift+Tab is the same key to the player', () => {
    const { calls, win } = setup();
    win.dispatchEvent(Object.assign(key('keydown', { code: 'Tab' }), { shiftKey: true }));
    expect(calls).toEqual(['show']);
  });

  it('does nothing while the menu is open, and does not stop the default', () => {
    const { calls, win } = setup(true);
    const down = key('keydown', { code: 'Tab' });
    win.dispatchEvent(down);
    win.dispatchEvent(key('keyup', { code: 'Tab' }));
    expect(calls).toEqual([]);
    expect(down.defaultPrevented).toBe(false);
  });

  it('acts again once the menu has closed', () => {
    const { calls, state, win } = setup(true);
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    state.menuOpen = false;
    const event = key('keydown', { code: 'Tab' });
    win.dispatchEvent(event);
    expect(calls).toEqual(['show']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('hides when the window loses focus', () => {
    const { calls, win } = setup();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    win.dispatchEvent(new Event('blur'));
    expect(calls).toEqual(['show', 'hide']);
  });

  it('hides when the page changes visibility: the event bubbles from the document to the window', () => {
    const { calls, win } = setup();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    win.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual(['show', 'hide']);
  });

  it('stops listening after the returned function runs', () => {
    const { calls, win, unbind } = setup();
    unbind();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    win.dispatchEvent(key('keyup', { code: 'Tab' }));
    win.dispatchEvent(new Event('blur'));
    expect(calls).toEqual([]);
  });
});
