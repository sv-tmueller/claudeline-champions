import { Button } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import { bindInput, createInputCore, type InputCore } from './input';

const NO_MODS = { ctrlKey: false, metaKey: false, altKey: false };

function press(core: InputCore, ...codes: string[]): void {
  for (const code of codes) core.keyDown(code, NO_MODS);
}

function axes(core: InputCore): [number, number] {
  const input = core.toPlayerInput(0, 0);
  return [input.moveX, input.moveY];
}

describe('input core: movement axes', () => {
  it('is idle with nothing held', () => {
    expect(createInputCore().toPlayerInput(0, 0)).toEqual({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 });
  });

  it.each([
    ['KeyD', [1, 0]],
    ['KeyA', [-1, 0]],
    ['KeyW', [0, 1]],
    ['KeyS', [0, -1]],
  ] as const)('%s moves screen-relative, W and D toward positive sim axes', (code, expected) => {
    const core = createInputCore();
    press(core, code);
    expect(axes(core)).toEqual(expected);
  });

  it('combines two keys into a diagonal', () => {
    const core = createInputCore();
    press(core, 'KeyW', 'KeyD');
    expect(axes(core)).toEqual([1, 1]);
  });

  it('cancels opposite keys', () => {
    const core = createInputCore();
    press(core, 'KeyA', 'KeyD', 'KeyW', 'KeyS');
    expect(axes(core)).toEqual([0, 0]);
  });

  it('never yields -0', () => {
    const core = createInputCore();
    press(core, 'KeyA', 'KeyD');
    const input = core.toPlayerInput(0, 0);
    expect(Object.is(input.moveX, 0)).toBe(true);
    expect(Object.is(input.moveY, 0)).toBe(true);
  });

  it('stops on keyup, and one key released leaves the opposite one active', () => {
    const core = createInputCore();
    press(core, 'KeyA', 'KeyD');
    core.keyUp('KeyA', NO_MODS);
    expect(axes(core)).toEqual([1, 0]);
    core.keyUp('KeyD', NO_MODS);
    expect(axes(core)).toEqual([0, 0]);
  });

  it('matches physical key codes, not characters', () => {
    const core = createInputCore();
    press(core, 'KeyX', 'ArrowUp', 'Digit1');
    expect(axes(core)).toEqual([0, 0]);
  });
});

describe('input core: buttons', () => {
  it.each([
    ['Space', Button.SPACE],
    ['KeyQ', Button.Q],
    ['KeyE', Button.E],
    ['KeyR', Button.R],
    ['KeyF', Button.F],
    ['ShiftLeft', Button.SHIFT],
    ['ShiftRight', Button.SHIFT],
  ])('%s sets its button bit', (code, bit) => {
    const core = createInputCore();
    press(core, code);
    expect(core.toPlayerInput(0, 0).buttons).toBe(bit);
    core.keyUp(code, NO_MODS);
    expect(core.toPlayerInput(0, 0).buttons).toBe(0);
  });

  it('maps mouse 0 to M1 and mouse 2 to M2, and ignores the middle button', () => {
    const core = createInputCore();
    core.mouseDown(0);
    core.mouseDown(2);
    core.mouseDown(1);
    expect(core.toPlayerInput(0, 0).buttons).toBe(Button.M1 | Button.M2);
    core.mouseUp(0);
    expect(core.toPlayerInput(0, 0).buttons).toBe(Button.M2);
    core.mouseUp(2);
    expect(core.toPlayerInput(0, 0).buttons).toBe(0);
  });

  it('keeps SHIFT held while the other shift key is released', () => {
    const core = createInputCore();
    press(core, 'ShiftLeft', 'ShiftRight');
    core.keyUp('ShiftLeft', NO_MODS);
    expect(core.toPlayerInput(0, 0).buttons).toBe(Button.SHIFT);
    core.keyUp('ShiftRight', NO_MODS);
    expect(core.toPlayerInput(0, 0).buttons).toBe(0);
  });

  it('ORs several buttons together', () => {
    const core = createInputCore();
    press(core, 'KeyQ', 'KeyR', 'Space');
    core.mouseDown(0);
    expect(core.toPlayerInput(0, 0).buttons).toBe(Button.Q | Button.R | Button.SPACE | Button.M1);
  });
});

describe('input core: aim', () => {
  it('passes the aim through unchanged', () => {
    const input = createInputCore().toPlayerInput(-1100, 250);
    expect([input.aimX, input.aimY]).toEqual([-1100, 250]);
  });
});

describe('input core: preventing the browser default', () => {
  it.each(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ShiftLeft', 'ShiftRight'])(
    'prevents keydown and keyup of %s',
    (code) => {
      const core = createInputCore();
      expect(core.keyDown(code, NO_MODS)).toBe(true);
      expect(core.keyUp(code, NO_MODS)).toBe(true);
    },
  );

  it.each(['F3', 'F5', 'F12', 'Tab', 'Escape', 'KeyX', 'toString', 'constructor'])('never prevents %s', (code) => {
    const core = createInputCore();
    expect(core.keyDown(code, NO_MODS)).toBe(false);
    expect(core.keyUp(code, NO_MODS)).toBe(false);
  });

  it('prevents a repeated keydown and changes nothing', () => {
    const core = createInputCore();
    core.keyDown('KeyD', NO_MODS);
    expect(core.keyDown('KeyD', NO_MODS)).toBe(true);
    expect(axes(core)).toEqual([1, 0]);
    core.keyUp('KeyD', NO_MODS);
    expect(axes(core)).toEqual([0, 0]);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)(
    'lets %s combos through and does not record them',
    (mod) => {
      const core = createInputCore();
      const mods = { ...NO_MODS, [mod]: true };
      expect(core.keyDown('KeyW', mods)).toBe(false);
      expect(axes(core)).toEqual([0, 0]);
      expect(core.keyUp('KeyW', mods)).toBe(false);
    },
  );

  it('clears a held key on keyup even when a modifier is down', () => {
    const core = createInputCore();
    press(core, 'KeyD');
    expect(core.keyUp('KeyD', { ...NO_MODS, ctrlKey: true })).toBe(false);
    expect(axes(core)).toEqual([0, 0]);
  });
});

describe('input core: releaseAll', () => {
  it('clears keys and mouse buttons but keeps the pointer', () => {
    const core = createInputCore();
    press(core, 'KeyW', 'ShiftLeft');
    core.mouseDown(0);
    core.pointerMove(300, 200);
    core.releaseAll();
    expect(core.toPlayerInput(5, 6)).toEqual({ moveX: 0, moveY: 0, aimX: 5, aimY: 6, buttons: 0 });
    expect(core.pointer).toEqual({ clientX: 300, clientY: 200 });
  });
});

describe('input core: pointer', () => {
  it('starts without a pointer and keeps the last position', () => {
    const core = createInputCore();
    expect(core.pointer).toBeNull();
    core.pointerMove(10, 20);
    core.pointerMove(30, 40);
    expect(core.pointer).toEqual({ clientX: 30, clientY: 40 });
  });
});

// A DOM-free stand-in: EventTarget and Event exist in Node, and the binder
// only reads the fields set here.
function fakeEvent(type: string, fields: Record<string, unknown> = {}): Event & Record<string, unknown> {
  const event = new Event(type, { cancelable: true });
  return Object.assign(event, fields);
}

function fakeWindow(): EventTarget & { document: { hidden: boolean } } {
  return Object.assign(new EventTarget(), { document: { hidden: false } });
}

describe('bindInput', () => {
  function setup() {
    const win = fakeWindow();
    const canvas = new EventTarget();
    const core = createInputCore();
    const unbind = bindInput(win, canvas, core);
    return { win, canvas, core, unbind };
  }

  it('translates keyboard and mouse events into the core and prevents mapped keys', () => {
    const { win, core } = setup();
    const down = fakeEvent('keydown', { code: 'KeyD', ...NO_MODS });
    win.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    win.dispatchEvent(fakeEvent('mousedown', { button: 0 }));
    win.dispatchEvent(fakeEvent('mousemove', { clientX: 12, clientY: 34 }));
    expect(core.toPlayerInput(0, 0).moveX).toBe(1);
    expect(core.toPlayerInput(0, 0).buttons).toBe(Button.M1);
    expect(core.pointer).toEqual({ clientX: 12, clientY: 34 });
    const up = fakeEvent('keyup', { code: 'KeyD', ...NO_MODS });
    win.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    win.dispatchEvent(fakeEvent('mouseup', { button: 0 }));
    expect(core.toPlayerInput(0, 0)).toMatchObject({ moveX: 0, buttons: 0 });
  });

  it('does not prevent F3 or the mouse buttons', () => {
    const { win } = setup();
    const f3 = fakeEvent('keydown', { code: 'F3', ...NO_MODS });
    const mouse = fakeEvent('mousedown', { button: 2 });
    win.dispatchEvent(f3);
    win.dispatchEvent(mouse);
    expect(f3.defaultPrevented).toBe(false);
    expect(mouse.defaultPrevented).toBe(false);
  });

  it('prevents the context menu on the canvas', () => {
    const { canvas } = setup();
    const menu = fakeEvent('contextmenu');
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('releases everything on window blur', () => {
    const { win, core } = setup();
    win.dispatchEvent(fakeEvent('keydown', { code: 'KeyW', ...NO_MODS }));
    win.dispatchEvent(fakeEvent('blur'));
    expect(core.toPlayerInput(0, 0).moveY).toBe(0);
  });

  it('releases everything when the page becomes hidden, not when it becomes visible', () => {
    const { win, core } = setup();
    win.dispatchEvent(fakeEvent('keydown', { code: 'KeyW', ...NO_MODS }));
    win.dispatchEvent(fakeEvent('visibilitychange'));
    expect(core.toPlayerInput(0, 0).moveY).toBe(1);
    win.document.hidden = true;
    win.dispatchEvent(fakeEvent('visibilitychange'));
    expect(core.toPlayerInput(0, 0).moveY).toBe(0);
  });

  it('stops listening after unbind', () => {
    const { win, core, unbind } = setup();
    unbind();
    win.dispatchEvent(fakeEvent('keydown', { code: 'KeyW', ...NO_MODS }));
    expect(core.toPlayerInput(0, 0).moveY).toBe(0);
  });
});
