import type { Difficulty } from '@claudeline/bots';
import type { HudElement } from './hud';
import { make } from './hud-dom';
import type { ResultHandles } from './result-screen';
import { ROSTER_IDS, championName } from './roster';

/** One champion of the select. `href` is null while the champion has no kit. */
export interface SelectEntry {
  id: string;
  name: string;
  available: boolean;
  href: string | null;
}

/**
 * One entry per roster id, in roster order. An id with a loaded kit links to a
 * relaunch with that champion and the current difficulty. The href is relative
 * (a query string only), so it works under any base path, and following it
 * reloads the page, so the kill feed, the views and the bots start fresh.
 */
export function selectEntries(kitIds: readonly string[], difficulty: Difficulty): SelectEntry[] {
  return ROSTER_IDS.map((id) => {
    const available = kitIds.includes(id);
    const href = available ? `?${new URLSearchParams({ champion: id, difficulty }).toString()}` : null;
    return { id, name: championName(id), available, href };
  });
}

/**
 * Builds the result panel under `root`, once at startup, hidden. The title and
 * score are written by `ResultScreen`. The select is static: a link per champion
 * with a kit (`data-available="true"`) and a greyed entry for each without one.
 */
export function buildResult(root: HTMLElement, kitIds: readonly string[], difficulty: Difficulty): ResultHandles {
  const panel = make(root, 'div', { 'data-result': 'panel', 'data-visible': 'false' });
  const title = make(panel, 'div', { 'data-part': 'title' });
  const score = make(panel, 'div', { 'data-part': 'score' });
  make(panel, 'div', { 'data-part': 'select-label' }, 'Play again as');
  const select = make(panel, 'div', { 'data-part': 'select' });
  for (const entry of selectEntries(kitIds, difficulty)) {
    const attributes: Record<string, string> = {
      'data-champion': entry.id,
      'data-available': entry.available ? 'true' : 'false',
    };
    if (entry.href !== null) attributes['href'] = entry.href;
    make(select, entry.available ? 'a' : 'span', attributes, entry.name);
  }
  return { panel: panel as HudElement, title: title as HudElement, score: score as HudElement };
}
