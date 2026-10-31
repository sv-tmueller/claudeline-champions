// The energy orb (rules.md section 3.3, v3 design section 6). The unit tests jump the phase clock
// of a live match to the tick they want; the scripted fixture (`orb-fixture.test.ts`) plays the
// whole flow. The oracle numbers are written out here again, not imported from the source.
import { describe, expect, it } from 'vitest';
import orbsJson from '../../../data/orbs.json';
import arena02Json from '../../../data/arenas/arena02.json';
import { createMatch, orbPointFor, parseArenaDef, step } from '../src/index';
import type { ArenaDef, GameState, MatchConfig, SimEvent } from '../src/index';
import { nextRandom } from '../src/rng';
import { arena01, champion, config2v2, openArena, place } from './helpers';

const arena02 = parseArenaDef(arena02Json);
const POINT = { x: 0, y: 2.5 };

function orbConfig(extra: Partial<MatchConfig> = {}): MatchConfig {
  return { ...config2v2(), roundsToWin: 2, energyOrb: POINT, ...extra };
}

/** A match with the orb on, stepped into round 1 (phaseTicks 0), every champion at its spawn. */
function inRound(config: MatchConfig = orbConfig(), seed = 1, arena: ArenaDef = arena01): GameState {
  const state = createMatch(config, arena, seed);
  while (state.match?.phase !== 'round') step(state, []);
  return state;
}

function orbOf(state: GameState) {
  const orb = state.match?.orb;
  if (!orb) throw new Error('no orb');
  return orb;
}

function setClock(state: GameState, phaseTicks: number): void {
  if (!state.match) throw new Error('no match');
  state.match.phaseTicks = phaseTicks;
}

function orbEvents(state: GameState): SimEvent[] {
  return state.events.filter((e) => e.type === 'orbSpawn' || e.type === 'orbTaken');
}

/** Ids 0 and 2 (one per team) next to the point, both touching it; the rest stay at their spawns. */
function standOnOrb(state: GameState, ids: number[] = [0, 2]): void {
  ids.forEach((id, i) => place(state, id, i === 0 ? -0.6 : 0.6, 2.5));
}

describe('the orb switch', () => {
  it('leaves no key and no events when the config has no energyOrb', () => {
    const state = createMatch({ ...config2v2(), roundsToWin: 2 }, arena01, 1);
    for (let i = 0; i < 1600; i++) {
      step(state, []);
      expect(orbEvents(state)).toEqual([]);
    }
    expect(state.match?.phase).toBe('round');
    expect('orb' in (state.match ?? {})).toBe(false);
  });

  it('puts the orb into the match state, not taken, as copies of the point', () => {
    const config = orbConfig();
    const state = createMatch(config, arena01, 1);
    expect(state.match?.orb).toEqual({ x: 0, y: 2.5, taken: false });
    expect(state.match?.orb).not.toBe(config.energyOrb);
    expect(Object.keys(state.match ?? {}).sort()).toEqual(
      ['orb', 'phase', 'phaseTicks', 'ring', 'round', 'roundsToWin', 'score'],
    );
  });

  it('gives free play no orb even with a point', () => {
    const state = createMatch({ ...config2v2(), energyOrb: POINT }, arena01, 1);
    expect('match' in state).toBe(false);
    for (let i = 0; i < 100; i++) step(state, []);
    expect(orbEvents(state)).toEqual([]);
  });

  it('never stores an undefined energyOrb', () => {
    const state = createMatch({ ...config2v2(), roundsToWin: 2, energyOrb: undefined }, arena01, 1);
    expect('orb' in (state.match ?? {})).toBe(false);
  });
});

describe('the warning', () => {
  it('comes at phaseTicks 1020 of every round, once, with the point and the round', () => {
    const state = inRound();
    expect(state.match?.round).toBe(1);
    expect(state.tick).toBe(180);
    const seen: [number, SimEvent][] = [];
    for (let i = 0; i < 1100; i++) {
      step(state, []);
      for (const e of orbEvents(state)) seen.push([state.tick, e]);
    }
    // The step that sees phaseTicks 1020 makes tick 180 + 1020 + 1.
    expect(seen).toEqual([[1201, { type: 'orbSpawn', round: 1, x: 0, y: 2.5 }]]);
  });

  it('comes in the next round too, after the orb reset', () => {
    const state = inRound();
    setClock(state, 1200);
    standOnOrb(state);
    step(state, []);
    expect(orbOf(state).taken).toBe(true);
    // Force the round end by killing team B, then run the pause into round 2.
    for (const id of [2, 3]) {
      const c = champion(state, id);
      c.alive = false;
      c.health = 0;
    }
    step(state, []);
    expect(state.match?.phase).toBe('roundEnd');
    expect(orbOf(state).taken).toBe(true);
    while (state.match?.phase !== 'round') step(state, []);
    expect(state.match?.round).toBe(2);
    expect(orbOf(state).taken).toBe(false);
    setClock(state, 1019);
    step(state, []);
    expect(orbEvents(state)).toEqual([]);
    step(state, []);
    expect(orbEvents(state)).toEqual([{ type: 'orbSpawn', round: 2, x: 0, y: 2.5 }]);
  });

  it('does not come once the orb is taken', () => {
    const state = inRound();
    setClock(state, 1020);
    orbOf(state).taken = true;
    step(state, []);
    expect(orbEvents(state)).toEqual([]);
  });
});

describe('the pickup', () => {
  it('takes nothing before 1200, whoever stands on the point', () => {
    const state = inRound();
    setClock(state, 1198);
    standOnOrb(state, [0]);
    step(state, []);
    expect(state.match?.phaseTicks).toBe(1199);
    expect(orbOf(state).taken).toBe(false);
    step(state, []);
    expect(orbOf(state).taken).toBe(false);
    expect(champion(state, 0).energy).toBe(0);
  });

  it('is taken in the step that sees phaseTicks 1200: +25 energy and one orbTaken', () => {
    const state = inRound();
    setClock(state, 1199);
    standOnOrb(state, [0]);
    step(state, []);
    expect(orbEvents(state)).toEqual([]);
    step(state, []);
    expect(orbOf(state).taken).toBe(true);
    expect(champion(state, 0).energy).toBe(25);
    expect(orbEvents(state)).toEqual([
      { type: 'orbTaken', round: 1, championId: 0, amount: 25, energy: 25 },
    ]);
  });

  it('takes the first collectible step of round 1 at tick 1381', () => {
    const state = inRound();
    standOnOrb(state, [0]);
    let takenAt = 0;
    for (let i = 0; i < 1300 && takenAt === 0; i++) {
      step(state, []);
      if (orbEvents(state).some((e) => e.type === 'orbTaken')) takenAt = state.tick;
    }
    expect(takenAt).toBe(1381);
  });

  it('counts a champion whose circle just touches the orb, and not one a hair away', () => {
    const near = inRound();
    setClock(near, 1200);
    place(near, 0, 1, 2.5);
    step(near, []);
    expect(orbOf(near).taken).toBe(true);
    const far = inRound();
    setClock(far, 1200);
    place(far, 0, 1.0000001, 2.5);
    step(far, []);
    expect(orbOf(far).taken).toBe(false);
  });

  it('adds the room left under 100 when the champion is above 75', () => {
    const state = inRound();
    setClock(state, 1200);
    champion(state, 0).energy = 90;
    standOnOrb(state, [0]);
    step(state, []);
    expect(champion(state, 0).energy).toBe(100);
    expect(orbEvents(state)).toEqual([
      { type: 'orbTaken', round: 1, championId: 0, amount: 10, energy: 100 },
    ]);
  });

  it('is still taken by a champion at 100, with amount 0', () => {
    const state = inRound();
    setClock(state, 1200);
    champion(state, 0).energy = 100;
    standOnOrb(state, [0]);
    step(state, []);
    expect(orbOf(state).taken).toBe(true);
    expect(champion(state, 0).energy).toBe(100);
    expect(orbEvents(state)).toEqual([
      { type: 'orbTaken', round: 1, championId: 0, amount: 0, energy: 100 },
    ]);
  });

  it('is not taken by a dead champion standing on it', () => {
    const state = inRound();
    setClock(state, 1200);
    standOnOrb(state, [0]);
    const c = champion(state, 0);
    c.alive = false;
    c.health = 0;
    step(state, []);
    expect(orbOf(state).taken).toBe(false);
    expect(orbEvents(state)).toEqual([]);
  });

  it('is one orb per round: a second toucher after the pickup gets nothing', () => {
    const state = inRound();
    setClock(state, 1200);
    standOnOrb(state, [0]);
    step(state, []);
    place(state, 2, 0.6, 2.5);
    for (let i = 0; i < 20; i++) {
      step(state, []);
      expect(orbEvents(state)).toEqual([]);
    }
    expect(champion(state, 2).energy).toBe(0);
    expect(champion(state, 0).energy).toBe(25);
  });

  it('stays up, untaken, until the round ends and is untaken again in the next round', () => {
    const state = inRound();
    setClock(state, 3000);
    for (let i = 0; i < 50; i++) step(state, []);
    expect(orbOf(state).taken).toBe(false);
    for (const id of [2, 3]) {
      const c = champion(state, id);
      c.alive = false;
      c.health = 0;
    }
    step(state, []);
    expect(state.match?.phase).toBe('roundEnd');
    expect(orbOf(state).taken).toBe(false);
    while (state.match?.phase !== 'round') step(state, []);
    expect(orbOf(state)).toEqual({ x: 0, y: 2.5, taken: false });
  });

  it('stands on a deciding tick: the pickup of the step that ends the round counts', () => {
    const state = inRound();
    setClock(state, 1200);
    standOnOrb(state, [0]);
    for (const id of [2, 3]) {
      const c = champion(state, id);
      c.alive = false;
      c.health = 0;
    }
    step(state, []);
    expect(state.match?.phase).toBe('roundEnd');
    expect(orbOf(state).taken).toBe(true);
    expect(champion(state, 0).energy).toBe(25);
    expect(state.events.map((e) => e.type)).toEqual(['orbTaken', 'roundEnded']);
  });
});

describe('the pick among touchers', () => {
  it('draws nothing from the rng for one toucher', () => {
    const state = inRound();
    setClock(state, 1200);
    standOnOrb(state, [0]);
    const rng = state.rng;
    step(state, []);
    expect(orbOf(state).taken).toBe(true);
    expect(state.rng).toBe(rng);
  });

  it('makes exactly one draw for two touchers and gives the orb to the k-th in id order', () => {
    const winners = new Set<number>();
    for (let seed = 1; seed <= 32; seed++) {
      const state = inRound(orbConfig(), seed);
      setClock(state, 1200);
      standOnOrb(state, [0, 2]);
      const probe = { rng: state.rng };
      const r = nextRandom(probe);
      const k = r * 2 >= 1 ? 1 : 0;
      step(state, []);
      expect(state.rng, `seed ${seed}`).toBe(probe.rng);
      const taken = state.events.find((e) => e.type === 'orbTaken');
      expect(taken?.type === 'orbTaken' ? taken.championId : -1, `seed ${seed}`).toBe([0, 2][k]);
      winners.add(taken?.type === 'orbTaken' ? taken.championId : -1);
    }
    // Neither the lowest nor the highest id always wins.
    expect([...winners].sort()).toEqual([0, 2]);
  });

  it('draws for a tie inside one team as well, and picks the k-th of three', () => {
    const winners = new Set<number>();
    for (let seed = 1; seed <= 48; seed++) {
      const state = inRound(orbConfig(), seed);
      setClock(state, 1200);
      // Ids 0 and 1 (team A) and id 2 (team B), a triangle around the point, all touching.
      place(state, 0, -0.6, 2.5);
      place(state, 1, 0, 3.4);
      place(state, 2, 0.7, 2.2);
      const probe = { rng: state.rng };
      const r = nextRandom(probe);
      let k = 0;
      for (let j = 1; j <= 2; j++) if (r * 3 >= j) k++;
      step(state, []);
      expect(state.rng, `seed ${seed}`).toBe(probe.rng);
      const taken = state.events.find((e) => e.type === 'orbTaken');
      const who = taken?.type === 'orbTaken' ? taken.championId : -1;
      expect(who, `seed ${seed}`).toBe(k);
      winners.add(who);
    }
    expect([...winners].sort()).toEqual([0, 1, 2]);
  });

  it('is replayable: the same seed and the same standing give the same taker', () => {
    const run = () => {
      const state = inRound(orbConfig(), 7);
      setClock(state, 1200);
      standOnOrb(state);
      step(state, []);
      return JSON.stringify(state.events);
    };
    expect(run()).toBe(run());
  });
});

describe('the orb point', () => {
  const bad = (point: unknown, arena: ArenaDef = arena01) =>
    createMatch({ ...config2v2(), roundsToWin: 2, energyOrb: point as { x: number; y: number } }, arena, 1);

  it('rejects a point off the mirror axis', () => {
    expect(() => bad({ x: 0.1, y: 2.5 })).toThrow('Invalid match: energyOrb');
  });

  it('rejects a point on the pillar', () => {
    expect(() => bad({ x: 0, y: 1.9 })).toThrow('Invalid match: energyOrb');
    expect(() => bad({ x: 0, y: 0 })).toThrow('Invalid match: energyOrb');
  });

  it('accepts a disc that touches the pillar', () => {
    expect(() => bad({ x: 0, y: 2 })).not.toThrow();
    expect(() => bad({ x: 0, y: -2 })).not.toThrow();
  });

  it('rejects a point whose disc leaves the end circle', () => {
    expect(() => bad({ x: 0, y: 2.6 })).toThrow('Invalid match: energyOrb');
    expect(() => bad({ x: 0, y: 2.5 })).not.toThrow();
  });

  it('rejects a disc that overlaps a rect obstacle, whatever it blocks', () => {
    const arena = openArena([
      { type: 'rect', x: 0, y: 2.5, w: 2, h: 1, height: 0.6, blocksProjectiles: false },
    ]);
    expect(() => bad({ x: 0, y: 2.5 }, arena)).toThrow('Invalid match: energyOrb');
    const far = openArena([
      { type: 'rect', x: 0, y: 3, w: 2, h: 1, height: 0.6, blocksProjectiles: false },
    ]);
    // The rect spans y 2.5 to 3.5, so the disc at y 1.9 touches nothing and 2.1 would overlap.
    expect(() => bad({ x: 0, y: 1.9 }, far)).not.toThrow();
    expect(() => bad({ x: 0, y: 2.1 }, far)).toThrow('Invalid match: energyOrb');
  });

  it('rejects a disc that leaves the playable rectangle', () => {
    const arena = { ...openArena(), ring: { startRadius: 18, endRadius: 40, damagePerSecond: 10 } };
    expect(() => bad({ x: 0, y: 9.5 }, arena)).not.toThrow();
    expect(() => bad({ x: 0, y: 9.6 }, arena)).toThrow('Invalid match: energyOrb');
  });

  it('rejects a point that is not two finite numbers', () => {
    for (const point of [null, 5, { x: 0 }, { y: 2.5 }, { x: 0, y: NaN }, { x: 0, y: Infinity }, { x: '0', y: 2.5 }]) {
      expect(() => bad(point), JSON.stringify(point)).toThrow('Invalid match: energyOrb');
    }
  });

  it('accepts a negative y and a -0 x, and stores x without a negative zero', () => {
    const state = bad({ x: -0, y: -2.5 });
    expect(Object.is(state.match?.orb?.x, 0)).toBe(true);
    expect(state.match?.orb?.y).toBe(-2.5);
  });
});

describe('data/orbs.json and orbPointFor', () => {
  it('holds a row that passes for every arena file, and nothing else', () => {
    expect(Object.keys(orbsJson).sort()).toEqual(['arena01', 'arena02']);
    for (const arena of [arena01, arena02]) {
      const point = orbPointFor(orbsJson, arena);
      expect(point).toEqual((orbsJson as Record<string, unknown>)[arena.id]);
      expect(() =>
        createMatch({ ...config2v2(), roundsToWin: 2, energyOrb: point }, arena, 1),
      ).not.toThrow();
    }
    expect(orbPointFor(orbsJson, arena01)).toEqual({ x: 0, y: 2.5 });
    expect(orbPointFor(orbsJson, arena02)).toEqual({ x: 0, y: 0 });
  });

  it('gives undefined for an arena with no row, and does not read the prototype', () => {
    expect(orbPointFor(orbsJson, { ...arena01, id: 'arena99' })).toBeUndefined();
    expect(orbPointFor({}, arena01)).toBeUndefined();
    expect(orbPointFor(orbsJson, { ...arena01, id: 'toString' })).toBeUndefined();
    expect(orbPointFor(orbsJson, { ...arena01, id: '__proto__' })).toBeUndefined();
  });

  it('throws on a table that is not an object and on a bad row', () => {
    for (const table of [null, 5, 'x', [], undefined]) {
      expect(() => orbPointFor(table, arena01), String(table)).toThrow('Invalid orb table');
    }
    expect(() => orbPointFor({ arena01: { x: 0.1, y: 2.5 } }, arena01)).toThrow('Invalid orb table: arena01');
    expect(() => orbPointFor({ arena01: { x: 0, y: 1 } }, arena01)).toThrow('Invalid orb table: arena01');
    expect(() => orbPointFor({ arena01: 5 }, arena01)).toThrow('Invalid orb table: arena01');
  });

  it('copies the row, so the point does not alias the table', () => {
    const table = { arena01: { x: 0, y: 2.5 } };
    const point = orbPointFor(table, arena01);
    expect(point).toEqual(table.arena01);
    expect(point).not.toBe(table.arena01);
  });

  it('gives a match built from the table the same orb as a literal point', () => {
    const fromTable = createMatch(
      { ...config2v2(), roundsToWin: 2, energyOrb: orbPointFor(orbsJson, arena01) },
      arena01,
      1,
    );
    expect(fromTable.match?.orb).toEqual({ x: 0, y: 2.5, taken: false });
  });
});

describe('the orb on arena02', () => {
  it('sits at the centre and is taken there', () => {
    const state = inRound(
      { ...config2v2(), roundsToWin: 2, energyOrb: orbPointFor(orbsJson, arena02) },
      3,
      arena02,
    );
    setClock(state, 1200);
    place(state, 1, 0.5, 0.5);
    step(state, []);
    expect(champion(state, 1).energy).toBe(25);
  });
});
