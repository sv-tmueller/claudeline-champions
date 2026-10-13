import { ACTIONS, DEFAULT_BINDINGS, keyLabel, rebind, type Action } from './bindings';
import type { HudElement } from './hud';
import type { InputCore } from './input';
import type { Platform } from './platform';

/** The three views of the menu panel, shown one at a time by `data-view` on the panel. */
export type MenuView = 'main' | 'select' | 'keys';

/** The elements the menu writes. Built once by `menu-dom.ts`. */
export interface MenuHandles {
  /** Carries `data-visible` and `data-view`. */
  panel: HudElement;
  /** The keys view: `data-capturing` (the action being bound, or `none`) and `data-error` (`duplicate`, `reserved` or `none`). */
  keys: HudElement;
  /** One row per action: the row carries `data-capturing`, the key element shows the key text. */
  rows: Readonly<Record<Action, { row: HudElement; key: HudElement }>>;
}

/** What the page does for the menu. The menu holds no renderer, clock or location itself. */
export interface MenuActions {
  /** Stops or restarts the frame loop. The sim, the bots and the views stop with it. */
  setPaused(on: boolean): void;
  /** Reloads the page: the address is the setup, so the match starts again. */
  restart(): void;
  /** Drops every held key and mouse button of the input core. */
  releaseInput(): void;
}

const TRUE = 'true';
const FALSE = 'false';
const NONE = 'none';

/**
 * The Escape menu (rules.md section 6). It pauses by stopping the animation
 * loop, through `actions.setPaused`, so no frame runs while it is open. It is
 * pure state and writes: events call it, and nothing in it runs per frame. It
 * opens in every phase, and the input is released on open and on close so a key
 * held across the menu, or across a rebinding, never sticks.
 */
export class Menu {
  private open = false;
  private current: MenuView = 'main';
  private activeCapture: Action | undefined;
  // The text last written to each key element, so a row is written only when it changes.
  private readonly shown: Record<Action, string> = {
    up: '',
    left: '',
    down: '',
    right: '',
    SPACE: '',
    Q: '',
    E: '',
    R: '',
    F: '',
  };

  constructor(
    private readonly handles: MenuHandles,
    private readonly input: Pick<InputCore, 'bindings' | 'setBindings'>,
    private readonly platform: Pick<Platform, 'saveSettings'>,
    private readonly actions: MenuActions,
    /** Whether the sound is off: the stored value, which every save carries. */
    private readonly muted: boolean,
  ) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** The view the panel shows. */
  get view(): MenuView {
    return this.current;
  }

  /** The action whose key is being captured, if any. */
  get capturing(): Action | undefined {
    return this.activeCapture;
  }

  toggle(): void {
    if (this.open) this.resume();
    else this.show();
  }

  private show(): void {
    this.open = true;
    this.actions.setPaused(true);
    this.actions.releaseInput();
    this.setView('main');
    this.handles.panel.setAttribute('data-visible', TRUE);
  }

  /** Closes the menu and runs the game on. Does nothing while it is closed. */
  resume(): void {
    if (!this.open) return;
    this.endCapture();
    this.open = false;
    this.handles.panel.setAttribute('data-visible', FALSE);
    this.actions.releaseInput();
    this.actions.setPaused(false);
  }

  /** Starts the match again. Only the page reload follows, so the menu changes nothing else. */
  restart(): void {
    this.actions.restart();
  }

  showMain(): void {
    if (this.open) this.setView('main');
  }

  /** The champion and arena links of the result panel, with the match still paused. */
  showSelect(): void {
    if (this.open) this.setView('select');
  }

  showKeys(): void {
    if (!this.open) return;
    this.refreshRows();
    this.setView('keys');
  }

  /** Waits for the next key to bind to `action`. */
  startCapture(action: Action): void {
    if (!this.open) return;
    this.endCapture();
    this.activeCapture = action;
    this.handles.keys.setAttribute('data-error', NONE);
    this.handles.keys.setAttribute('data-capturing', action);
    this.handles.rows[action].row.setAttribute('data-capturing', TRUE);
  }

  /**
   * Gives the capture a key. Escape cancels it. A key that is refused (a duplicate
   * or a reserved key) shows the error and keeps waiting; nothing is changed or
   * saved. A key that applies is saved once.
   */
  capture(code: string): void {
    const action = this.activeCapture;
    if (action === undefined) return;
    if (code === 'Escape') {
      this.endCapture();
      return;
    }
    const result = rebind(this.input.bindings, action, code);
    if (!result.ok) {
      this.handles.keys.setAttribute('data-error', result.reason);
      return;
    }
    this.input.setBindings(result.bindings);
    this.endCapture();
    this.refreshRows();
    this.save();
  }

  /** Puts the default keys back and saves them. */
  resetBindings(): void {
    this.endCapture();
    this.input.setBindings(DEFAULT_BINDINGS);
    this.refreshRows();
    this.save();
  }

  /**
   * The window keydown. Returns whether the menu used the key, so the caller
   * stops the browser's default. During a capture every key goes to it (a repeat
   * is swallowed), otherwise Escape opens or closes the menu and a repeat is ignored.
   */
  onKeyDown(code: string, repeat: boolean): boolean {
    if (this.activeCapture !== undefined) {
      if (!repeat) this.capture(code);
      return true;
    }
    if (code !== 'Escape' || repeat) return false;
    this.toggle();
    return true;
  }

  private setView(view: MenuView): void {
    this.endCapture();
    this.current = view;
    this.handles.panel.setAttribute('data-view', view);
  }

  private endCapture(): void {
    const action = this.activeCapture;
    if (action === undefined) return;
    this.activeCapture = undefined;
    this.handles.keys.setAttribute('data-capturing', NONE);
    this.handles.keys.setAttribute('data-error', NONE);
    this.handles.rows[action].row.setAttribute('data-capturing', FALSE);
  }

  private refreshRows(): void {
    const bindings = this.input.bindings;
    for (const action of ACTIONS) {
      const text = keyLabel(bindings[action]);
      if (text === this.shown[action]) continue;
      this.shown[action] = text;
      this.handles.rows[action].key.textContent = text;
    }
  }

  private save(): void {
    void this.platform.saveSettings({ version: 2, bindings: this.input.bindings, muted: this.muted });
  }
}
