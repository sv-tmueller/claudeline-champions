import { describe, expect, it } from 'vitest';
import { createAnims } from './champion-anim';
import { CombatFeedback } from './feedback';
import { createImpactRings } from './impact-rings';
import { createKillFeed } from './kill-feed';
import { Scoreboard, type ScoreboardHandles } from './scoreboard';
import { fake, type Fake } from './test-fake';

interface Row {
  row: Fake;
  state: Fake;
  kills: Fake;
  deaths: Fake;
}

interface Rig {
  board: Scoreboard;
  feedback: CombatFeedback;
  state: { champions: { alive: boolean }[] };
  root: Fake;
  rows: Row[];
}

const TEAMS_2V2 = [{ team: 'A' }, { team: 'A' }, { team: 'B' }, { team: 'B' }] as const;
const TEAMS_3V3 = [{ team: 'A' }, { team: 'A' }, { team: 'A' }, { team: 'B' }, { team: 'B' }, { team: 'B' }] as const;

function rig(teams: readonly { readonly team: 'A' | 'B' }[] = TEAMS_2V2): Rig {
  const feedback = new CombatFeedback(teams, 'A', createImpactRings(), createKillFeed(), createAnims(teams.length));
  const rows: Row[] = teams.map(() => ({ row: fake(), state: fake(), kills: fake(), deaths: fake() }));
  const root = fake();
  const handles: ScoreboardHandles = { root, rows };
  return {
    board: new Scoreboard(handles, feedback),
    feedback,
    state: { champions: teams.map(() => ({ alive: true })) },
    root,
    rows,
  };
}

function writeCount(rigged: Rig): number {
  return rigged.root.log.length + rigged.rows.reduce((sum, r) => sum + r.row.log.length + r.state.log.length + r.kills.log.length + r.deaths.log.length, 0);
}

function clear(rigged: Rig): void {
  rigged.root.log.length = 0;
  for (const r of rigged.rows) {
    r.row.log.length = 0;
    r.state.log.length = 0;
    r.kills.log.length = 0;
    r.deaths.log.length = 0;
  }
}

describe('Scoreboard', () => {
  it('writes nothing on the first update: it is built with the start values', () => {
    const rigged = rig();
    rigged.board.update(rigged.state);
    expect(writeCount(rigged)).toBe(0);
  });

  it('writes nothing on a steady update', () => {
    const rigged = rig();
    rigged.board.update(rigged.state);
    rigged.board.update(rigged.state);
    rigged.board.update(rigged.state);
    expect(writeCount(rigged)).toBe(0);
  });

  it('writes the two count cells of a death, and the row that died', () => {
    const rigged = rig();
    rigged.board.update(rigged.state);
    rigged.feedback.death(1, 2, 0);
    (rigged.state.champions[2] as { alive: boolean }).alive = false;
    rigged.board.update(rigged.state);
    expect(rigged.rows[0]?.kills.log).toEqual(['text=1']);
    expect(rigged.rows[2]?.deaths.log).toEqual(['text=1']);
    expect(rigged.rows[2]?.row.log).toEqual(['data-alive=false']);
    expect(rigged.rows[2]?.state.log).toEqual(['text=Dead']);
    expect(writeCount(rigged)).toBe(4);
    // Nothing else of any row: the kills of the dead and the deaths of the killer are still 0.
    expect(rigged.rows[0]?.deaths.log).toEqual([]);
    expect(rigged.rows[2]?.kills.log).toEqual([]);
    clear(rigged);
    rigged.board.update(rigged.state);
    expect(writeCount(rigged)).toBe(0);
  });

  it('writes a death of the ring as a death cell only', () => {
    const rigged = rig();
    rigged.feedback.death(1, 3, -1);
    (rigged.state.champions[3] as { alive: boolean }).alive = false;
    rigged.board.update(rigged.state);
    expect(rigged.rows[3]?.deaths.log).toEqual(['text=1']);
    expect(rigged.rows.flatMap((r) => r.kills.log)).toEqual([]);
  });

  it('writes the alive flag and its text once per flip, both ways', () => {
    const rigged = rig();
    rigged.board.update(rigged.state);
    const champion = rigged.state.champions[1] as { alive: boolean };
    champion.alive = false;
    rigged.board.update(rigged.state);
    rigged.board.update(rigged.state);
    expect(rigged.rows[1]?.row.log).toEqual(['data-alive=false']);
    expect(rigged.rows[1]?.state.log).toEqual(['text=Dead']);
    champion.alive = true;
    rigged.board.update(rigged.state);
    expect(rigged.rows[1]?.row.log).toEqual(['data-alive=false', 'data-alive=true']);
    expect(rigged.rows[1]?.state.log).toEqual(['text=Dead', 'text=Alive']);
  });

  it('does not read the counts while the tally has not changed', () => {
    const feedback = new CombatFeedback(TEAMS_2V2, 'A', createImpactRings(), createKillFeed(), createAnims(4));
    let reads = 0;
    const source = {
      get killCounts(): Int32Array {
        reads++;
        return feedback.killCounts;
      },
      get deathCounts(): Int32Array {
        reads++;
        return feedback.deathCounts;
      },
      get tallyChanges(): number {
        return feedback.tallyChanges;
      },
    };
    const rows: Row[] = TEAMS_2V2.map(() => ({ row: fake(), state: fake(), kills: fake(), deaths: fake() }));
    const board = new Scoreboard({ root: fake(), rows }, source);
    const state = { champions: TEAMS_2V2.map(() => ({ alive: true })) };
    board.update(state);
    board.update(state);
    expect(reads).toBe(0);
    feedback.death(1, 2, 0);
    board.update(state);
    expect(reads).toBeGreaterThan(0);
    reads = 0;
    board.update(state);
    expect(reads).toBe(0);
  });

  it('shows and hides once per change', () => {
    const rigged = rig();
    rigged.board.hide();
    expect(rigged.root.log).toEqual([]);
    rigged.board.show();
    rigged.board.show();
    expect(rigged.root.log).toEqual(['data-visible=true']);
    rigged.board.hide();
    rigged.board.hide();
    expect(rigged.root.log).toEqual(['data-visible=true', 'data-visible=false']);
  });

  it('keeps writing while hidden, so showing it needs no catch-up', () => {
    const rigged = rig();
    rigged.feedback.death(1, 2, 0);
    (rigged.state.champions[2] as { alive: boolean }).alive = false;
    rigged.board.update(rigged.state);
    clear(rigged);
    rigged.board.show();
    expect(writeCount(rigged)).toBe(1);
    expect(rigged.root.log).toEqual(['data-visible=true']);
    rigged.board.update(rigged.state);
    expect(writeCount(rigged)).toBe(1);
  });

  it('tallies a match of six champions, one row each', () => {
    const rigged = rig(TEAMS_3V3);
    expect(rigged.rows).toHaveLength(6);
    rigged.board.update(rigged.state);
    rigged.feedback.death(1, 5, 0);
    rigged.feedback.death(2, 4, 0);
    rigged.feedback.death(3, 0, 4);
    (rigged.state.champions[5] as { alive: boolean }).alive = false;
    rigged.board.update(rigged.state);
    expect(rigged.rows.map((r) => r.kills.log.at(-1) ?? 'text=0')).toEqual([
      'text=2',
      'text=0',
      'text=0',
      'text=0',
      'text=1',
      'text=0',
    ]);
    expect(rigged.rows.map((r) => r.deaths.log.at(-1) ?? 'text=0')).toEqual([
      'text=1',
      'text=0',
      'text=0',
      'text=0',
      'text=1',
      'text=1',
    ]);
  });

  it('writes every changed count of one change, each cell once', () => {
    const rigged = rig();
    rigged.board.update(rigged.state);
    rigged.feedback.death(1, 2, 0);
    rigged.feedback.death(1, 3, 0);
    rigged.board.update(rigged.state);
    expect(rigged.rows[0]?.kills.log).toEqual(['text=2']);
    expect(rigged.rows[2]?.deaths.log).toEqual(['text=1']);
    expect(rigged.rows[3]?.deaths.log).toEqual(['text=1']);
  });
});
