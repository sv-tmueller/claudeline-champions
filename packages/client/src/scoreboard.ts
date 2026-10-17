import { intText } from './hook-text';
import type { HudElement } from './hud';

/** The elements the scoreboard writes. `HudElement` is what a counting fake also satisfies. */
export interface ScoreboardHandles {
  root: HudElement;
  /** One row per champion, indexed by champion id: the row root and the three cells that change. */
  rows: readonly { row: HudElement; state: HudElement; kills: HudElement; deaths: HudElement }[];
}

/**
 * What the scoreboard reads of the match's tally: `CombatFeedback`'s own fields. `tallyChanges`
 * counts the deaths that changed a count, so a steady frame does not read the arrays.
 */
export interface ScoreboardSource {
  readonly killCounts: ArrayLike<number>;
  readonly deathCounts: ArrayLike<number>;
  readonly tallyChanges: number;
}

/** What `update` reads from the game state. */
export interface ScoreboardState {
  readonly champions: readonly { readonly alive: boolean }[];
}

const TRUE = 'true';
const FALSE = 'false';
const ALIVE_TEXT = 'Alive';
const DEAD_TEXT = 'Dead';

/**
 * Writes every champion's state, kills and deaths into the scoreboard (rules.md section 6, Tab),
 * and shows or hides it. Like the `Hud`, every value is compared with the last one written and the
 * DOM is touched only on a change, so a steady frame writes and allocates nothing. It writes while
 * hidden too, so showing it needs no catch-up. The DOM is built with the start values (alive, 0,
 * 0, hidden), and the caches start at them, so the first update writes nothing. The caches hold
 * integers only.
 */
export class Scoreboard {
  private readonly alive: Int8Array;
  private readonly kills: Int32Array;
  private readonly deaths: Int32Array;
  private tallyChanges = 0;
  private visible = 0;

  constructor(
    private readonly handles: ScoreboardHandles,
    private readonly source: ScoreboardSource,
  ) {
    this.alive = new Int8Array(handles.rows.length).fill(1);
    this.kills = new Int32Array(handles.rows.length);
    this.deaths = new Int32Array(handles.rows.length);
  }

  update(state: ScoreboardState): void {
    const rows = this.handles.rows;
    const champions = state.champions;
    for (let i = 0; i < rows.length; i++) {
      const champion = champions[i];
      if (champion === undefined) continue;
      const alive = champion.alive ? 1 : 0;
      if (alive === this.alive[i]) continue;
      this.alive[i] = alive;
      const handle = rows[i] as ScoreboardHandles['rows'][number];
      handle.row.setAttribute('data-alive', alive === 1 ? TRUE : FALSE);
      handle.state.textContent = alive === 1 ? ALIVE_TEXT : DEAD_TEXT;
    }
    if (this.source.tallyChanges === this.tallyChanges) return;
    this.tallyChanges = this.source.tallyChanges;
    const killCounts = this.source.killCounts;
    const deathCounts = this.source.deathCounts;
    for (let i = 0; i < rows.length; i++) {
      const handle = rows[i] as ScoreboardHandles['rows'][number];
      const kills = killCounts[i] ?? 0;
      if (kills !== this.kills[i]) {
        this.kills[i] = kills;
        handle.kills.textContent = intText(kills);
      }
      const deaths = deathCounts[i] ?? 0;
      if (deaths !== this.deaths[i]) {
        this.deaths[i] = deaths;
        handle.deaths.textContent = intText(deaths);
      }
    }
  }

  /** Shows the scoreboard while Tab is held. Writes only on a change. */
  show(): void {
    if (this.visible === 1) return;
    this.visible = 1;
    this.handles.root.setAttribute('data-visible', TRUE);
  }

  hide(): void {
    if (this.visible === 0) return;
    this.visible = 0;
    this.handles.root.setAttribute('data-visible', FALSE);
  }
}
