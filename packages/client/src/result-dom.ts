import type { Difficulty } from '@claudeline/bots';
import type { ArenaDef } from '@claudeline/sim';
import type { HudElement } from './hud';
import { make } from './hud-dom';
import type { Launch } from './launch';
import type { ResultHandles } from './result-screen';
import { ROSTER_IDS, championName } from './roster';

/** One champion of the select. `href` is null while the champion has no kit. */
export interface SelectEntry {
  id: string;
  name: string;
  available: boolean;
  href: string | null;
}

/** The query of a relaunch: the setup is the address, so a link is the whole choice. */
function relaunch(champion: string, difficulty: Difficulty, arena: string): string {
  return `?${new URLSearchParams({ champion, difficulty, arena }).toString()}`;
}

/**
 * One entry per roster id, in roster order. An id with a loaded kit links to a
 * relaunch with that champion, the current difficulty and the arena being
 * played. The href is relative (a query string only), so it works under any
 * base path, and following it reloads the page, so the kill feed, the views and
 * the bots start fresh.
 */
export function selectEntries(kitIds: readonly string[], difficulty: Difficulty, arena: string): SelectEntry[] {
  return ROSTER_IDS.map((id) => {
    const available = kitIds.includes(id);
    const href = available ? relaunch(id, difficulty, arena) : null;
    return { id, name: championName(id), available, href };
  });
}

/** One arena of the select. */
export interface ArenaEntry {
  id: string;
  name: string;
  /** The arena being played. */
  current: boolean;
  href: string;
}

/**
 * One entry per arena, in the order given (the loaded list is sorted by id).
 * Each links to a relaunch on that arena with the current champion and difficulty.
 */
export function arenaEntries(
  arenas: readonly Pick<ArenaDef, 'id' | 'name'>[],
  champion: string,
  difficulty: Difficulty,
  arena: string,
): ArenaEntry[] {
  return arenas.map((entry) => ({
    id: entry.id,
    name: entry.name,
    current: entry.id === arena,
    href: relaunch(champion, difficulty, entry.id),
  }));
}

/**
 * Builds the select under `parent`: a champion row, `data-part="select"`, and an
 * arena row, `data-part="arena-select"`. Static: a link per champion with a kit
 * (`data-available="true"`), a greyed entry for each without one, and a link per
 * arena (`data-arena-id`, `data-current` on the one being played). The result
 * panel and the menu both build it, each with its own copy and its own heading.
 */
export function buildSelect(
  parent: HTMLElement,
  kitIds: readonly string[],
  arenas: readonly Pick<ArenaDef, 'id' | 'name'>[],
  launch: Launch,
  championLabel: string,
): void {
  make(parent, 'div', { 'data-part': 'select-label' }, championLabel);
  const select = make(parent, 'div', { 'data-part': 'select' });
  for (const entry of selectEntries(kitIds, launch.difficulty, launch.arena)) {
    const attributes: Record<string, string> = {
      'data-champion': entry.id,
      'data-available': entry.available ? 'true' : 'false',
    };
    if (entry.href !== null) attributes['href'] = entry.href;
    make(select, entry.available ? 'a' : 'span', attributes, entry.name);
  }
  make(parent, 'div', { 'data-part': 'select-label' }, 'Arena');
  const arenaSelect = make(parent, 'div', { 'data-part': 'arena-select' });
  for (const entry of arenaEntries(arenas, launch.champion, launch.difficulty, launch.arena)) {
    make(
      arenaSelect,
      'a',
      { 'data-arena-id': entry.id, 'data-current': entry.current ? 'true' : 'false', href: entry.href },
      entry.name,
    );
  }
}

/**
 * Builds the result panel under `root`, once at startup, hidden. The title and
 * score are written by `ResultScreen`. The select is `buildSelect`.
 */
export function buildResult(
  root: HTMLElement,
  kitIds: readonly string[],
  arenas: readonly Pick<ArenaDef, 'id' | 'name'>[],
  launch: Launch,
): ResultHandles {
  const panel = make(root, 'div', { 'data-result': 'panel', 'data-visible': 'false' });
  const title = make(panel, 'div', { 'data-part': 'title' });
  const score = make(panel, 'div', { 'data-part': 'score' });
  buildSelect(panel, kitIds, arenas, launch, 'Play again as');
  return { panel: panel as HudElement, title: title as HudElement, score: score as HudElement };
}
