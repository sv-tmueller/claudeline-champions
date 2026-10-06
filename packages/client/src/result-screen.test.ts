import { parseArenaDef, step, type MatchPhase, type MatchState, type PlayerInput } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createBotDriver } from './bot-driver';
import { LOCAL_SEED, createLocalMatch } from './match-setup';
import { ResultScreen, type ResultHandles } from './result-screen';
import { fake } from './test-fake';
import { TEST_KITS } from './test-kits';

function rig() {
  const elements = { panel: fake(), title: fake(), score: fake() };
  const handles: ResultHandles = elements;
  return { screen: new ResultScreen(handles, 'A', 3), elements };
}

function matchAt(phase: MatchPhase, score: { A: number; B: number }, roundsToWin = 3): { match: MatchState } {
  return { match: { phase, phaseTicks: 0, round: score.A + score.B, roundsToWin, score, ring: null } };
}

function writes(elements: ReturnType<typeof rig>['elements']): number {
  return elements.panel.log.length + elements.title.log.length + elements.score.log.length;
}

describe('result screen', () => {
  it.each(['warmup', 'round', 'roundEnd'] as const)('stays hidden in the %s phase, with no writes', (phase) => {
    const { screen, elements } = rig();
    screen.update(matchAt(phase, { A: 2, B: 2 }));
    screen.update(matchAt(phase, { A: 3, B: 0 }));
    expect(writes(elements)).toBe(0);
  });

  it('stays hidden for a state without match flow', () => {
    const { screen, elements } = rig();
    screen.update({});
    expect(writes(elements)).toBe(0);
  });

  it('shows Victory and the score once when the local team won', () => {
    const { screen, elements } = rig();
    screen.update(matchAt('matchEnd', { A: 3, B: 1 }));
    expect(elements.title.log).toEqual(['text=Victory']);
    expect(elements.score.log).toEqual(['text=3 : 1']);
    expect(elements.panel.log).toEqual(['data-visible=true']);
  });

  it('shows Defeat when the other team reached the rounds to win', () => {
    const { screen, elements } = rig();
    screen.update(matchAt('matchEnd', { A: 1, B: 3 }));
    expect(elements.title.log).toEqual(['text=Defeat']);
    expect(elements.score.log).toEqual(['text=1 : 3']);
  });

  it('shows the score of the local team first', () => {
    const elements = { panel: fake(), title: fake(), score: fake() };
    new ResultScreen(elements, 'B', 3).update(matchAt('matchEnd', { A: 1, B: 3 }));
    expect(elements.title.log).toEqual(['text=Victory']);
    expect(elements.score.log).toEqual(['text=3 : 1']);
  });

  it('writes nothing on a repeat update', () => {
    const { screen, elements } = rig();
    const state = matchAt('matchEnd', { A: 3, B: 0 });
    screen.update(state);
    const before = writes(elements);
    screen.update(state);
    screen.update(state);
    expect(writes(elements)).toBe(before);
  });

  it('hides the panel again when the phase leaves the match end', () => {
    const { screen, elements } = rig();
    screen.update(matchAt('matchEnd', { A: 3, B: 0 }));
    screen.update(matchAt('warmup', { A: 0, B: 0 }));
    expect(elements.panel.log).toEqual(['data-visible=true', 'data-visible=false']);
  });
});

describe('a match played to its result', () => {
  it('ends with the panel visible, written once', { timeout: 60_000 }, () => {
    const { state, botIds } = createLocalMatch(
      { scene: 'match', champion: 'hargrim', difficulty: 'normal' },
      parseArenaDef(arena01Json),
      TEST_KITS,
      1,
    );
    const driver = createBotDriver(botIds, 'normal', LOCAL_SEED);
    const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
    const { screen, elements } = rig();
    while (state.match?.phase !== 'matchEnd' && state.tick < 30_000) {
      driver.think(state, inputs);
      step(state, inputs);
      screen.update(state);
    }
    expect(state.match?.phase).toBe('matchEnd');
    expect(elements.panel.log).toEqual(['data-visible=true']);
    expect(elements.title.log).toHaveLength(1);
    expect(elements.score.log).toHaveLength(1);
    const winner = (state.match?.score.A ?? 0) >= 1 ? 'Victory' : 'Defeat';
    expect(elements.title.log).toEqual([`text=${winner}`]);
  });
});
