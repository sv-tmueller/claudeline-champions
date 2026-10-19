import type { Difficulty } from '@claudeline/bots';
import type { ArenaDef } from '@claudeline/sim';
import type { HudElement } from './hud';
import { make } from './hud-dom';
import { DIFFICULTIES, relaunch, type Launch } from './launch';
import { playableTeamSize } from './match-setup';
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
 * relaunch with that champion, the current difficulty, the arena being
 * played and the team size asked for. The href is relative (a query string only), so it works under any
 * base path, and following it reloads the page, so the kill feed, the views and
 * the bots start fresh.
 */
export function selectEntries(
  kitIds: readonly string[],
  difficulty: Difficulty,
  arena: string,
  teamSize: 2 | 3,
): SelectEntry[] {
  return ROSTER_IDS.map((id) => {
    const available = kitIds.includes(id);
    const href = available ? relaunch(id, difficulty, arena, teamSize) : null;
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
 * Each links to a relaunch on that arena with the current champion, difficulty
 * and team size.
 */
export function arenaEntries(
  arenas: readonly Pick<ArenaDef, 'id' | 'name'>[],
  champion: string,
  difficulty: Difficulty,
  arena: string,
  teamSize: 2 | 3,
): ArenaEntry[] {
  return arenas.map((entry) => ({
    id: entry.id,
    name: entry.name,
    current: entry.id === arena,
    href: relaunch(champion, difficulty, entry.id, teamSize),
  }));
}

/** One team size of the select. `href` is null while the arena cannot play it. */
export interface TeamEntry {
  size: 2 | 3;
  label: string;
  /** The size being played: the asked one, or 2 on an arena that cannot play 3v3. */
  current: boolean;
  available: boolean;
  href: string | null;
}

const TEAM_SIZES: readonly (2 | 3)[] = [2, 3];

/**
 * 2v2 and 3v3, in that order. Each links to a relaunch with the current champion,
 * difficulty and arena and its own team size. An arena with fewer than three spawns on
 * a team plays 2v2 (`playableTeamSize`), so its 3v3 entry is greyed without a link.
 * `asked` is the size of the address.
 */
export function teamEntries(
  champion: string,
  difficulty: Difficulty,
  arena: string,
  asked: 2 | 3,
  played: Pick<ArenaDef, 'spawns'>,
): TeamEntry[] {
  const current = playableTeamSize(asked, played);
  return TEAM_SIZES.map((size) => {
    const available = playableTeamSize(size, played) === size;
    return {
      size,
      label: `${size}v${size}`,
      current: size === current,
      available,
      href: available ? relaunch(champion, difficulty, arena, size) : null,
    };
  });
}

/** One difficulty tier of the select. */
export interface DifficultyEntry {
  tier: Difficulty;
  label: string;
  /** The tier of the launch: the one every bot plays. */
  current: boolean;
  href: string;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

/**
 * Easy, normal and hard, in that order. Each links to a relaunch with the
 * current champion and arena, its own tier and the team size asked for.
 */
export function difficultyEntries(
  champion: string,
  difficulty: Difficulty,
  arena: string,
  asked: 2 | 3,
): DifficultyEntry[] {
  return DIFFICULTIES.map((tier) => ({
    tier,
    label: DIFFICULTY_LABELS[tier],
    current: tier === difficulty,
    href: relaunch(champion, tier, arena, asked),
  }));
}

/**
 * Builds the select under `parent`: a champion row, `data-part="select"`, an
 * arena row, `data-part="arena-select"`, a team row, `data-part="team-select"`,
 * and a difficulty row, `data-part="difficulty-select"`.
 * Static: a link per champion with a kit (`data-available="true"`, `data-current` on
 * the launch's champion, which only select.css draws), a greyed entry for each without one, a link per arena (`data-arena-id`, `data-current` on the
 * one being played), a link per team size (`data-team-size`, `data-current` on
 * the one being played, greyed for 3v3 on an arena that cannot play it) and a link
 * per tier (`data-difficulty`, `data-current` on the launch's tier, always available).
 * Every link writes the whole setup, the team size the address asked for included. The result
 * panel and the menu both build it, each with its own copy and its own heading.
 */
export function buildSelect(
  parent: HTMLElement,
  kitIds: readonly string[],
  arenas: readonly Pick<ArenaDef, 'id' | 'name' | 'spawns'>[],
  launch: Launch,
  championLabel: string,
): void {
  make(parent, 'div', { 'data-part': 'select-label' }, championLabel);
  const select = make(parent, 'div', { 'data-part': 'select' });
  for (const entry of selectEntries(kitIds, launch.difficulty, launch.arena, launch.teamSize)) {
    const attributes: Record<string, string> = {
      'data-champion': entry.id,
      'data-current': entry.id === launch.champion ? 'true' : 'false',
      'data-available': entry.available ? 'true' : 'false',
    };
    if (entry.href !== null) attributes['href'] = entry.href;
    make(select, entry.available ? 'a' : 'span', attributes, entry.name);
  }
  make(parent, 'div', { 'data-part': 'select-label' }, 'Arena');
  const arenaSelect = make(parent, 'div', { 'data-part': 'arena-select' });
  for (const entry of arenaEntries(arenas, launch.champion, launch.difficulty, launch.arena, launch.teamSize)) {
    make(
      arenaSelect,
      'a',
      { 'data-arena-id': entry.id, 'data-current': entry.current ? 'true' : 'false', href: entry.href },
      entry.name,
    );
  }
  const played = arenas.find((candidate) => candidate.id === launch.arena);
  if (!played) throw new Error(`the arena "${launch.arena}" is not loaded`);
  make(parent, 'div', { 'data-part': 'select-label' }, 'Teams');
  const teamSelect = make(parent, 'div', { 'data-part': 'team-select' });
  for (const entry of teamEntries(launch.champion, launch.difficulty, launch.arena, launch.teamSize, played)) {
    const attributes: Record<string, string> = {
      'data-team-size': String(entry.size),
      'data-current': entry.current ? 'true' : 'false',
      'data-available': entry.available ? 'true' : 'false',
    };
    if (entry.href !== null) attributes['href'] = entry.href;
    make(teamSelect, entry.available ? 'a' : 'span', attributes, entry.label);
  }
  make(parent, 'div', { 'data-part': 'select-label' }, 'Difficulty');
  const difficultySelect = make(parent, 'div', { 'data-part': 'difficulty-select' });
  for (const entry of difficultyEntries(launch.champion, launch.difficulty, launch.arena, launch.teamSize)) {
    make(
      difficultySelect,
      'a',
      { 'data-difficulty': entry.tier, 'data-current': entry.current ? 'true' : 'false', href: entry.href },
      entry.label,
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
  arenas: readonly Pick<ArenaDef, 'id' | 'name' | 'spawns'>[],
  launch: Launch,
): ResultHandles {
  const panel = make(root, 'div', { 'data-result': 'panel', 'data-visible': 'false' });
  const title = make(panel, 'div', { 'data-part': 'title' });
  const score = make(panel, 'div', { 'data-part': 'score' });
  buildSelect(panel, kitIds, arenas, launch, 'Play again as');
  return { panel: panel as HudElement, title: title as HudElement, score: score as HudElement };
}
