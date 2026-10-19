import type { ArenaDef } from '@claudeline/sim';
import { make } from './hud-dom';
import { parseLaunch, relaunch, type Launch } from './launch';
import { buildSelect } from './result-dom';

/** The arenas the select lists: `buildSelect` needs the spawns to grey a team size an arena cannot play. */
type SelectArena = Pick<ArenaDef, 'id' | 'name' | 'spawns'>;

/** Whether a click is a plain primary click: a modified one belongs to the browser (a new tab, a download). */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

/**
 * Shows the pre-match select under `root` and resolves once Start is clicked,
 * with the page address written to the chosen setup. The panel is
 * `data-select="panel"` with `data-visible`, holding a title, the select of
 * the result panel and the menu (`buildSelect`, so there is no third copy of
 * the rows) and the Start link, `data-action="start"`, whose `href` is the
 * setup, a relative query string like every other link.
 *
 * A pick is a plain click on a row entry. The entry's href already is the next
 * whole setup, so the click is read back by `parseLaunch` from it (a greyed entry
 * is a span without an href, so availability comes for free) and the rows are
 * built again from the new choice; the keyboard focus is put back on the same
 * place of the same row. A click with a modifier key is left to the browser, so
 * it opens that setup in a new tab, straight into a match. Start writes the
 * address with `history.replaceState`, empties `root` and resolves: `main.ts`
 * then reads the address like any parameter launch. It runs before any renderer
 * exists and never in a frame, so none of it is counted by the heap probe.
 */
export function runSelect(
  root: HTMLElement,
  kitIds: readonly string[],
  arenas: readonly SelectArena[],
  first: Launch,
): Promise<void> {
  const arenaIds = arenas.map((arena) => arena.id);
  const panel = make(root, 'div', { 'data-select': 'panel', 'data-visible': 'true' });
  make(panel, 'div', { 'data-part': 'title' }, 'Claudeline Champions');
  const rows = make(panel, 'div', { 'data-part': 'rows' });
  const start = make(panel, 'a', { 'data-action': 'start' }, 'Start');
  let choice = first;

  function show(): void {
    rows.replaceChildren();
    buildSelect(rows, kitIds, arenas, choice, 'Play as');
    start.setAttribute('href', relaunch(choice.champion, choice.difficulty, choice.arena, choice.teamSize));
  }
  show();

  return new Promise<void>((resolve) => {
    panel.addEventListener('click', (event) => {
      if (!isPlainClick(event)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!link || !panel.contains(link)) return;
      event.preventDefault();
      const href = link.getAttribute('href') ?? '';
      if (link === start) {
        history.replaceState(null, '', href);
        root.replaceChildren();
        resolve();
        return;
      }
      // Remember where the focus sat in its row, since the rows are built again.
      const row = link.parentElement;
      const index = row ? [...row.children].indexOf(link) : -1;
      const part = row?.getAttribute('data-part') ?? '';
      const focused = document.activeElement === link;
      choice = parseLaunch(href, kitIds, arenaIds, false);
      show();
      if (focused && index >= 0) {
        const again = rows.querySelector(`[data-part="${part}"]`)?.children[index];
        if (again instanceof HTMLElement) again.focus();
      }
    });
  });
}
