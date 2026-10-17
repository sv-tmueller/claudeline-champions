import type { TeamId } from '@claudeline/sim';
import type { HudElement } from './hud';
import { make } from './hud-dom';
import { championName } from './roster';
import type { Scoreboard, ScoreboardHandles } from './scoreboard';

/**
 * Builds the scoreboard under `root` (#hud), once at startup, hidden: the eighth HUD element of
 * rules.md section 8, `data-hud="scoreboard"` with `data-visible`. A header row (`data-row="header"`)
 * and one row per champion, `data-row=<id>`, the local team first and each team in id order. A row
 * carries `data-team` (`ally` or `enemy`, coloured by the HUD's team rules) and `data-alive`. Its
 * cells are `data-part` `team` (Ally or Enemy), `name`, `state` (Alive or Dead), `kills` and
 * `deaths`. Nothing but those states is written again. The handles are indexed by champion id,
 * whatever the order of the rows on the page.
 */
export function buildScoreboard(
  root: HTMLElement,
  champions: readonly { championId: string; team: TeamId }[],
  localTeam: TeamId,
): ScoreboardHandles {
  const board = make(root, 'div', { 'data-hud': 'scoreboard', 'data-visible': 'false' });
  const header = make(board, 'div', { 'data-row': 'header' });
  make(header, 'span', { 'data-part': 'team' });
  make(header, 'span', { 'data-part': 'name' }, 'Champion');
  make(header, 'span', { 'data-part': 'state' });
  make(header, 'span', { 'data-part': 'kills' }, 'K');
  make(header, 'span', { 'data-part': 'deaths' }, 'D');

  const rows: ScoreboardHandles['rows'][number][] = [];
  const order = champions.map((_, id) => id);
  // Stable: the local team first, each team in id order.
  order.sort((a, b) => {
    const aLocal = champions[a]?.team === localTeam ? 0 : 1;
    const bLocal = champions[b]?.team === localTeam ? 0 : 1;
    return aLocal - bLocal || a - b;
  });
  for (const id of order) {
    const champion = champions[id];
    if (champion === undefined) continue;
    const ally = champion.team === localTeam;
    const row = make(board, 'div', {
      'data-row': String(id),
      'data-team': ally ? 'ally' : 'enemy',
      'data-alive': 'true',
    });
    make(row, 'span', { 'data-part': 'team' }, ally ? 'Ally' : 'Enemy');
    make(row, 'span', { 'data-part': 'name' }, championName(champion.championId));
    const state = make(row, 'span', { 'data-part': 'state' }, 'Alive');
    const kills = make(row, 'span', { 'data-part': 'kills' }, '0');
    const deaths = make(row, 'span', { 'data-part': 'deaths' }, '0');
    rows[id] = { row: row as HudElement, state: state as HudElement, kills: kills as HudElement, deaths: deaths as HudElement };
  }
  return { root: board as HudElement, rows };
}

/**
 * Connects Tab: a keydown of Tab (repeats included, and not with Ctrl, Alt or Meta held) shows
 * the scoreboard and stops the browser's focus movement, a keyup hides it, and so do a blur and a
 * visibility change, which can swallow the keyup. While the menu is open it neither acts nor
 * stops the default, so Tab keeps moving focus in the menu. Returns a function that removes the
 * listeners. The input core ignores Tab, which is reserved (bindings.ts), so nothing else reads it.
 */
export function bindScoreboard(
  win: EventTarget,
  scoreboard: Pick<Scoreboard, 'show' | 'hide'>,
  isMenuOpen: () => boolean,
): () => void {
  const listeners: [string, (event: Event) => void][] = [
    [
      'keydown',
      (event) => {
        const key = event as KeyboardEvent;
        if (key.code !== 'Tab' || key.ctrlKey || key.altKey || key.metaKey || isMenuOpen()) return;
        event.preventDefault();
        scoreboard.show();
      },
    ],
    [
      'keyup',
      (event) => {
        if ((event as KeyboardEvent).code === 'Tab' && !isMenuOpen()) scoreboard.hide();
      },
    ],
    ['blur', () => scoreboard.hide()],
    // The event fires at the document and bubbles to the window.
    ['visibilitychange', () => scoreboard.hide()],
  ];
  for (const [type, listener] of listeners) win.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of listeners) win.removeEventListener(type, listener);
  };
}
