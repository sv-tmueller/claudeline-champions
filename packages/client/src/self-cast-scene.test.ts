import { createMatch, parseArenaDef, step, type GameState, type PlayerInput, type SimEvent } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createInputCore, type InputCore } from './input';
import { LUMETH_KIT, TEST_KITS } from './test-kits';

// The held self-cast key on the real sim and the real Lumeth kit. Every tick maps the human's input
// with the champion's position and then steps, the two calls main.ts makes per step. The cursor
// stays about 12 m away, at the arena centre. The e2e spec (self-cast.spec.ts) can read only DOM
// hooks, so the landing itself, the events, is asserted here.

const HUMAN = 0;
const NO_MODS = { ctrlKey: false, metaKey: false, altKey: false };

interface Scene {
  state: GameState;
  core: InputCore;
  /** Maps the human's input, steps once, and returns the events of that tick. */
  tick(): readonly SimEvent[];
  /** Ticks until the human's cast fires and returns every event up to and including that tick. */
  untilFired(budget: number): SimEvent[];
}

/** Lumeth (0, at (-12, 2)) and a Quillon on team A against a Hargrim and a Quillon, health of Lumeth 40. */
function scene(): Scene {
  const state = createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'lumeth', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'hargrim', team: 'B' },
        { championId: 'quillon', team: 'B' },
      ],
    },
    parseArenaDef(arena01Json),
    1,
    [...TEST_KITS, LUMETH_KIT],
  );
  expect(state.match).toBeUndefined();
  const lumeth = state.champions[HUMAN];
  if (!lumeth) throw new Error('no human');
  lumeth.health = 40;
  const core = createInputCore();
  const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
  const tick = (): readonly SimEvent[] => {
    inputs[HUMAN] = core.toPlayerInput(0, 0, lumeth);
    step(state, inputs);
    return state.events;
  };
  return {
    state,
    core,
    tick,
    untilFired(budget) {
      const seen: SimEvent[] = [];
      for (let i = 0; i < budget; i++) {
        seen.push(...tick());
        if (state.events.some((event) => event.type === 'castFired' && event.championId === HUMAN)) return seen;
      }
      throw new Error(`no cast fired within ${budget} ticks`);
    },
  };
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
}

function hold(s: Scene, ...codes: string[]): void {
  for (const code of codes) s.core.keyDown(code, NO_MODS);
}

describe('the held self-cast key, with the real sim', () => {
  it('lands Mend Bolt on her while she walks: no bolt, a heal of 6', () => {
    const s = scene();
    hold(s, 'KeyC', 'KeyW');
    s.core.mouseDown(0);
    const seen = s.untilFired(20);
    expect(ofType(seen, 'projectileSpawned')).toEqual([]);
    expect(s.state.projectiles).toEqual([]);
    const [heal, ...rest] = ofType(seen, 'heal');
    expect(rest).toEqual([]);
    expect(heal).toMatchObject({ targetId: HUMAN, sourceId: HUMAN, amount: 6, health: 46 });
    // She walked, so the aim followed her: the cast would have missed a stale aim.
    expect(s.state.champions[HUMAN]?.y).toBeGreaterThan(2);
  });

  it('lands Soothing Surge on her: a heal of 8.4 and a heal over time of 1.2 a pulse', () => {
    const s = scene();
    hold(s, 'KeyC');
    s.core.mouseDown(2);
    const seen = s.untilFired(30);
    expect(ofType(seen, 'projectileSpawned')).toEqual([]);
    const [heal, ...rest] = ofType(seen, 'heal');
    expect(rest).toEqual([]);
    expect([heal?.targetId, heal?.sourceId]).toEqual([HUMAN, HUMAN]);
    // The event amount is the health actually restored, a difference of two sums, so it is close.
    expect(heal?.amount).toBeCloseTo(8.4, 9);
    const hots = ofType(seen, 'statusApplied').filter((e) => e.status === 'hot');
    expect(hots.map((e) => [e.targetId, e.sourceId, e.slot])).toEqual([[HUMAN, HUMAN, 'M2']]);
    expect(s.state.champions[HUMAN]?.statuses.find((x) => x.type === 'hot')).toMatchObject({ perPulse: 1.2 });
  });

  it('lands the EX of Soothing Surge on her with Shift: 13.2 and 1.8 a pulse, 25 energy paid', () => {
    const s = scene();
    const lumeth = s.state.champions[HUMAN];
    if (!lumeth) throw new Error('no human');
    lumeth.energy = 25;
    hold(s, 'KeyC', 'ShiftLeft');
    s.core.mouseDown(2);
    const seen = s.untilFired(30);
    expect(ofType(seen, 'castStarted')).toMatchObject([{ championId: HUMAN, slot: 'M2', ex: true, cost: 25 }]);
    expect(ofType(seen, 'projectileSpawned')).toEqual([]);
    const [heal, ...rest] = ofType(seen, 'heal');
    expect(rest).toEqual([]);
    expect([heal?.targetId, heal?.sourceId]).toEqual([HUMAN, HUMAN]);
    expect(heal?.amount).toBeCloseTo(13.2, 9);
    expect(lumeth.statuses.find((x) => x.type === 'hot')).toMatchObject({ perPulse: 1.8 });
    expect(lumeth.energy).toBe(0);
  });

  it('shields her with Aegis Veil: 30 absorb, the same as without C', () => {
    const s = scene();
    hold(s, 'KeyC', 'KeyR');
    const seen = s.untilFired(3);
    expect(ofType(seen, 'projectileSpawned')).toEqual([]);
    expect(s.state.champions[HUMAN]?.statuses.find((x) => x.type === 'shield')).toMatchObject({ absorb: 30, sourceId: HUMAN });
  });

  it('fires the bolt at the cursor when C is not held (the control)', () => {
    const s = scene();
    s.core.mouseDown(0);
    const seen = s.untilFired(20);
    expect(ofType(seen, 'projectileSpawned').map((e) => e.ownerId)).toEqual([HUMAN]);
    expect(ofType(seen, 'heal')).toEqual([]);
  });

  it('fires the bolt at the cursor when C is released before the cast fires', () => {
    const s = scene();
    hold(s, 'KeyC');
    s.core.mouseDown(2);
    s.tick();
    s.tick();
    s.core.keyUp('KeyC', NO_MODS);
    const seen = s.untilFired(30);
    expect(ofType(seen, 'projectileSpawned').map((e) => e.ownerId)).toEqual([HUMAN]);
    expect(ofType(seen, 'heal')).toEqual([]);
  });
});
