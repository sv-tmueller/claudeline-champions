import { Button, type MoveAxis, type PlayerInput } from '@claudeline/sim';
import { ACTIONS, DEFAULT_BINDINGS, type Bindings } from './bindings';

// Keys match on `event.code` (the physical key), so WASD works on any layout. The
// tables below are keyed by the default code of each action, whatever it is bound
// to: `held` holds default codes, and the core translates the physical code of an
// event into one (`translation`), so `toPlayerInput` never sees a rebinding.
const KEY_BUTTONS: Readonly<Record<string, number>> = {
  Space: Button.SPACE,
  KeyQ: Button.Q,
  KeyE: Button.E,
  KeyR: Button.R,
  KeyF: Button.F,
  ShiftLeft: Button.SHIFT,
  ShiftRight: Button.SHIFT,
};
// The codes of KEY_BUTTONS in a plain array, so a frame walks it by index.
const KEY_CODES: readonly string[] = Object.keys(KEY_BUTTONS);
// Shift is not rebindable (rules.md section 6): both keys stay on the one bit.
const FIXED_CODES: readonly string[] = ['ShiftLeft', 'ShiftRight'];
const MOUSE_BUTTONS: Readonly<Record<number, number>> = { 0: Button.M1, 2: Button.M2 };

export interface KeyMods {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface InputCore {
  /** The key bindings in use: the defaults until `setBindings`. */
  readonly bindings: Bindings;
  /**
   * Replaces the bindings. A key held at the time keeps its action, so the caller
   * releases first (`releaseAll`); the menu does on open and on close.
   */
  setBindings(bindings: Bindings): void;
  /** Returns whether the caller should call preventDefault. */
  keyDown(code: string, mods: KeyMods): boolean;
  /** Clears the action the code is bound to, with or without a modifier. Returns whether to call preventDefault. */
  keyUp(code: string, mods: KeyMods): boolean;
  mouseDown(button: number): void;
  mouseUp(button: number): void;
  /** Last pointer position in CSS pixels, or null before the first move. */
  readonly pointer: { clientX: number; clientY: number } | null;
  pointerMove(clientX: number, clientY: number): void;
  /** Focus loss: drops every held key and mouse button. The pointer stays. */
  releaseAll(): void;
  /**
   * The input for this frame. Every call overwrites and returns the same
   * object, so a frame allocates nothing. `step` copies it through
   * `resolveInput`, so sharing is safe there; a caller that keeps inputs
   * (a replay, a bot) must copy them.
   */
  toPlayerInput(aimX: number, aimY: number): PlayerInput;
}

/** Physical code to the default code of its action, and the fixed Shift keys to themselves. */
function translationOf(bindings: Bindings): Map<string, string> {
  const map = new Map<string, string>();
  for (const action of ACTIONS) map.set(bindings[action], DEFAULT_BINDINGS[action]);
  for (const code of FIXED_CODES) map.set(code, code);
  return map;
}

function hasCommandModifier(mods: KeyMods): boolean {
  return mods.ctrlKey || mods.metaKey || mods.altKey;
}

/**
 * Held-state only, sampled once per frame. There is no press latch, so a tap
 * shorter than one frame can be missed; the ability framework decides whether
 * that matters. macOS swallows keyup while Cmd is held, so Cmd combos are not
 * recorded at all.
 */
export function createInputCore(): InputCore {
  const held = new Set<string>();
  let bindings = DEFAULT_BINDINGS;
  let translation = translationOf(bindings);
  let mouseBits = 0;
  let pointer: { clientX: number; clientY: number } | null = null;
  const out: PlayerInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 };

  const axis = (positive: string, negative: string): MoveAxis =>
    ((held.has(positive) ? 1 : 0) - (held.has(negative) ? 1 : 0)) as MoveAxis;

  return {
    get bindings() {
      return bindings;
    },
    setBindings(next) {
      bindings = next;
      translation = translationOf(next);
    },
    keyDown(code, mods) {
      const action = translation.get(code);
      if (action === undefined || hasCommandModifier(mods)) return false;
      held.add(action);
      return true;
    },
    keyUp(code, mods) {
      const action = translation.get(code);
      if (action === undefined) return false;
      held.delete(action);
      return !hasCommandModifier(mods);
    },
    mouseDown(button) {
      mouseBits |= MOUSE_BUTTONS[button] ?? 0;
    },
    mouseUp(button) {
      mouseBits &= ~(MOUSE_BUTTONS[button] ?? 0);
    },
    get pointer() {
      return pointer;
    },
    pointerMove(clientX, clientY) {
      pointer = { clientX, clientY };
    },
    releaseAll() {
      held.clear();
      mouseBits = 0;
    },
    toPlayerInput(aimX, aimY) {
      let buttons = mouseBits;
      for (let i = 0; i < KEY_CODES.length; i++) {
        const code = KEY_CODES[i] as string;
        if (held.has(code)) buttons |= KEY_BUTTONS[code] ?? 0;
      }
      // The subtraction of two 0/1 values is never -0.
      out.moveX = axis('KeyD', 'KeyA');
      out.moveY = axis('KeyW', 'KeyS');
      out.aimX = aimX;
      out.aimY = aimY;
      out.buttons = buttons;
      return out;
    },
  };
}

export type InputTarget = EventTarget & { document: { hidden: boolean } };

/** Translates DOM events into the core. Returns a function that removes the listeners. */
export function bindInput(win: InputTarget, canvas: EventTarget, core: InputCore): () => void {
  const listeners: [EventTarget, string, (event: Event) => void][] = [
    [win, 'keydown', (e) => {
      if (core.keyDown((e as KeyboardEvent).code, e as KeyboardEvent)) e.preventDefault();
    }],
    [win, 'keyup', (e) => {
      if (core.keyUp((e as KeyboardEvent).code, e as KeyboardEvent)) e.preventDefault();
    }],
    [win, 'mousemove', (e) => core.pointerMove((e as MouseEvent).clientX, (e as MouseEvent).clientY)],
    [win, 'mousedown', (e) => core.mouseDown((e as MouseEvent).button)],
    [win, 'mouseup', (e) => core.mouseUp((e as MouseEvent).button)],
    [win, 'blur', () => core.releaseAll()],
    [win, 'visibilitychange', () => {
      if (win.document.hidden) core.releaseAll();
    }],
    // Right click is M2, so the browser menu must not open (rules, section 6).
    [canvas, 'contextmenu', (e) => e.preventDefault()],
  ];
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
  return () => {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
  };
}
