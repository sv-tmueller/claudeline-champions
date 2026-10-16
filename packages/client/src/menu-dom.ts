import type { ArenaDef } from '@claudeline/sim';
import { ACTIONS, type Action } from './bindings';
import type { HudElement } from './hud';
import { make } from './hud-dom';
import type { Launch } from './launch';
import type { Menu, MenuHandles } from './menu';
import { buildSelect } from './result-dom';

/** The text of each action in the keys view. */
const ACTION_LABELS: Readonly<Record<Action, string>> = {
  up: 'Move up',
  left: 'Move left',
  down: 'Move down',
  right: 'Move right',
  SPACE: 'Mobility',
  Q: 'Q',
  E: 'E',
  R: 'R',
  F: 'Ultimate',
};

/** The things the menu listens to for a click. Elements in the page, event targets in a test. */
export interface MenuButtons {
  resume: EventTarget;
  restart: EventTarget;
  select: EventTarget;
  keys: EventTarget;
  mute: EventTarget;
  backFromSelect: EventTarget;
  backFromKeys: EventTarget;
  reset: EventTarget;
  rebind: Readonly<Record<Action, EventTarget>>;
}

/**
 * Builds the menu under `root`, once at startup, hidden. The panel is
 * `data-menu="panel"` with `data-visible` and `data-view` (`main`, `select` or
 * `keys`), and each view is a `data-section`. The buttons carry `data-action`
 * (`resume`, `restart`, `select`, `keys`, `mute`, `back`, `reset`), a binding row is
 * `data-binding=<action>` with a `data-rebind` button, and the select view is
 * the select of the result panel, built by `buildSelect`. Nothing here is
 * written again except through `Menu`, on events.
 */
export function buildMenu(
  root: HTMLElement,
  kitIds: readonly string[],
  arenas: readonly Pick<ArenaDef, 'id' | 'name' | 'spawns'>[],
  launch: Launch,
): { handles: MenuHandles; buttons: MenuButtons } {
  const panel = make(root, 'div', { 'data-menu': 'panel', 'data-visible': 'false', 'data-view': 'main' });
  make(panel, 'div', { 'data-part': 'title' }, 'Paused');

  const main = make(panel, 'div', { 'data-section': 'main' });
  const resume = make(main, 'button', { 'data-action': 'resume' }, 'Resume');
  const restart = make(main, 'button', { 'data-action': 'restart' }, 'Restart');
  const select = make(main, 'button', { 'data-action': 'select' }, 'Champion, arena, teams and difficulty');
  const keys = make(main, 'button', { 'data-action': 'keys' }, 'Keys');
  // `Menu` writes its `data-muted` and its text, since the settings load after the build.
  const mute = make(main, 'button', { 'data-action': 'mute', 'data-muted': 'false' });

  const selectSection = make(panel, 'div', { 'data-section': 'select' });
  buildSelect(selectSection, kitIds, arenas, launch, 'Play as');
  const backFromSelect = make(selectSection, 'button', { 'data-action': 'back' }, 'Back');

  const keysSection = make(panel, 'div', { 'data-section': 'keys', 'data-capturing': 'none', 'data-error': 'none' });
  const bindings = make(keysSection, 'div', { 'data-part': 'bindings' });
  const rows = {} as Record<Action, { row: HudElement; key: HudElement }>;
  const rebind = {} as Record<Action, HTMLElement>;
  for (const action of ACTIONS) {
    const row = make(bindings, 'div', { 'data-binding': action, 'data-capturing': 'false' });
    make(row, 'span', { 'data-part': 'action' }, ACTION_LABELS[action]);
    const key = make(row, 'span', { 'data-part': 'key' });
    rebind[action] = make(row, 'button', { 'data-rebind': action }, 'Change');
    rows[action] = { row: row as HudElement, key: key as HudElement };
  }
  make(keysSection, 'div', { 'data-part': 'error', 'data-for': 'duplicate' }, 'That key is already in use.');
  make(keysSection, 'div', { 'data-part': 'error', 'data-for': 'reserved' }, 'That key is reserved.');
  const reset = make(keysSection, 'button', { 'data-action': 'reset' }, 'Reset to defaults');
  const backFromKeys = make(keysSection, 'button', { 'data-action': 'back' }, 'Back');

  return {
    handles: { panel: panel as HudElement, keys: keysSection as HudElement, rows, mute: mute as HudElement },
    buttons: { resume, restart, select, keys, mute, backFromSelect, backFromKeys, reset, rebind },
  };
}

/**
 * Connects the menu: the window keydown (Escape, and the key of a capture, with
 * the browser default stopped when the menu used it) and a click on each button.
 * Plain DOM click events, so the menu adds no pointer read of its own. Returns
 * a function that removes the listeners.
 */
export function bindMenu(win: EventTarget, menu: Menu, buttons: MenuButtons): () => void {
  const listeners: [EventTarget, string, (event: Event) => void][] = [
    [win, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (menu.onKeyDown(key.code, key.repeat)) event.preventDefault();
    }],
    [buttons.resume, 'click', () => menu.resume()],
    [buttons.restart, 'click', () => menu.restart()],
    [buttons.select, 'click', () => menu.showSelect()],
    [buttons.keys, 'click', () => menu.showKeys()],
    [buttons.mute, 'click', () => menu.toggleMute()],
    [buttons.backFromSelect, 'click', () => menu.showMain()],
    [buttons.backFromKeys, 'click', () => menu.showMain()],
    [buttons.reset, 'click', () => menu.resetBindings()],
  ];
  for (const action of ACTIONS) listeners.push([buttons.rebind[action], 'click', () => menu.startCapture(action)]);
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
  return () => {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
  };
}
