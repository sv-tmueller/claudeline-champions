import type { TeamId } from '@claudeline/sim';
import type { HudElement } from './hud';
import { make } from './hud-dom';
import { championName } from './roster';
import type { Scoreboard, ScoreboardHandles } from './scoreboard';

/** One row of the scoreboard, before it is built. */
export interface ScoreboardEntry {
  id: number;
  championId: string;
  side: 'ally' | 'enemy';
}

/**
 * The rows in the order they show: the local team first, each team in id order. Pure, so a test
 * can say it for a local team that is not A (the online client's, P4b of the online design).
 */
export function scoreboardEntries(
  champions: readonly { championId: string; team: TeamId }[],
  localTeam: TeamId,
): ScoreboardEntry[] {
  const entries: ScoreboardEntry[] = champions.map((champion, id) => ({
    id,
    championId: champion.championId,
    side: champion.team === localTeam ? 'ally' : 'enemy',
  }));
  return entries.sort((a, b) => (a.side === b.side ? a.id - b.id : a.side === 'ally' ? -1 : 1));
}

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
  for (const { id, side, championId } of scoreboardEntries(champions, localTeam)) {
    const ally = side === 'ally';
    const row = make(board, 'div', {
      'data-row': String(id),
      'data-team': ally ? 'ally' : 'enemy',
      'data-alive': 'true',
    });
    make(row, 'span', { 'data-part': 'team' }, ally ? 'Ally' : 'Enemy');
    make(row, 'span', { 'data-part': 'name' }, championName(championId));
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
