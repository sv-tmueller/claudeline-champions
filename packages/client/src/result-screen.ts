import type { MatchState, TeamId } from '@claudeline/sim';
import type { HudElement } from './hud';

/** The elements of the result panel that change: the panel itself, the title and the score. */
export interface ResultHandles {
  panel: HudElement;
  title: HudElement;
  score: HudElement;
}

/** What `update` reads from the game state. */
export interface ResultState {
  match?: MatchState;
}

const VICTORY = 'Victory';
const DEFEAT = 'Defeat';
const TRUE = 'true';
const FALSE = 'false';

/**
 * Shows the result panel at the end of the match: Victory or Defeat for the
 * local team against the team that reached the rounds to win, and the final
 * score with the local team first. The panel is built hidden, so nothing is
 * written until the phase is `matchEnd`. Like the HUD it compares integers held
 * in cache fields and touches the DOM only on a change, so it is counted by the
 * heap probe in e2e/combat.spec.ts. The cache starts at 0, hidden, as built.
 */
export class ResultScreen {
  private visible = 0;
  private won = -1;
  private localScore = -1;
  private otherScore = -1;

  constructor(
    private readonly handles: ResultHandles,
    private readonly localTeam: TeamId,
  ) {}

  update(state: ResultState): void {
    const match = state.match;
    if (match === undefined || match.phase !== 'matchEnd') {
      if (this.visible !== 0) {
        this.visible = 0;
        this.handles.panel.setAttribute('data-visible', FALSE);
      }
      return;
    }
    const local = this.localTeam === 'A' ? match.score.A : match.score.B;
    const other = this.localTeam === 'A' ? match.score.B : match.score.A;
    const won = local >= match.roundsToWin ? 1 : 0;
    if (won !== this.won) {
      this.won = won;
      this.handles.title.textContent = won === 1 ? VICTORY : DEFEAT;
    }
    if (local !== this.localScore || other !== this.otherScore) {
      this.localScore = local;
      this.otherScore = other;
      this.handles.score.textContent = `${local} : ${other}`;
    }
    if (this.visible !== 1) {
      this.visible = 1;
      this.handles.panel.setAttribute('data-visible', TRUE);
    }
  }
}
