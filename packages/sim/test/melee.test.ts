import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/index';
import type { Effect, GameState } from '../src/index';
import { direction } from '../src/geometry';
import { meleeArc } from '../src/melee';
import type { MeleeArcSpec } from '../src/melee';
import { champion, config2v2, openArena, place } from './helpers';

const HIT: Effect[] = [{ type: 'damage', amount: 10 }];

// Champions 0 and 1 are team A, 2 and 3 team B.
function open(): GameState {
  const state = createMatch(config2v2(), openArena(), 1);
  place(state, 0, 0, 0);
  place(state, 1, -3, 5);
  place(state, 2, 2, 0);
  place(state, 3, -2, 0);
  return state;
}

function arc(overrides: Partial<MeleeArcSpec> = {}): MeleeArcSpec {
  return { ownerId: 0, x: 0, y: 0, dirX: 1, dirY: 0, radius: 2, cosHalfAngle: 0.5, effects: HIT, ...overrides };
}

describe('meleeArc targets', () => {
  it('returns the enemies in front inside the half-angle, in id order', () => {
    const state = open();
    place(state, 3, 1, 0.2);
    expect(meleeArc(state, arc())).toEqual([2, 3]);
  });

  it('never hits the owner, an ally or a dead enemy', () => {
    const state = open();
    place(state, 1, 1, 0);
    champion(state, 3).alive = false;
    place(state, 3, 1, 0.1);
    expect(meleeArc(state, arc())).toEqual([2]);
  });

  it('includes a body that overlaps the radius: distance <= radius + 0.5, inclusive', () => {
    const state = open();
    place(state, 2, 2.5, 0);
    expect(meleeArc(state, arc())).toEqual([2]);
    place(state, 2, 2.5 + 1e-9, 0);
    expect(meleeArc(state, arc())).toEqual([]);
  });

  it('measures from the arc origin, not from the owner', () => {
    const state = open();
    place(state, 2, 10, 5);
    expect(meleeArc(state, arc({ x: 9, y: 5 }))).toEqual([2]);
  });

  it('respects the half-angle: inside, on the edge and outside', () => {
    const state = open();
    // cos 0.6 against the direction (1, 0): the edge is the vector (3, 4) / 5.
    place(state, 2, 1.5, 2);
    place(state, 3, 1.5, 2.1);
    expect(meleeArc(state, arc({ radius: 3, cosHalfAngle: 0.6 }))).toEqual([2]);
    place(state, 3, 1.5, 1.9);
    expect(meleeArc(state, arc({ radius: 3, cosHalfAngle: 0.6 }))).toEqual([2, 3]);
  });

  it('turns with the direction and does not need a unit vector', () => {
    const state = open();
    place(state, 2, 0, 1.5);
    place(state, 3, 1.5, 0);
    expect(meleeArc(state, arc({ dirX: 0, dirY: 40 }))).toEqual([2]);
    expect(meleeArc(state, arc({ dirX: 7, dirY: 0 }))).toEqual([3]);
    expect(meleeArc(state, arc({ dirX: -1, dirY: -1, cosHalfAngle: 0 }))).toEqual([]);
  });

  it('counts a target exactly on the half-angle line as a hit with cos 0', () => {
    const state = open();
    place(state, 2, 0, 1.5);
    place(state, 3, -0.1, 1.5);
    expect(meleeArc(state, arc({ cosHalfAngle: 0 }))).toEqual([2]);
  });

  it('hits every direction with a cosine of -1, a 360 degree arc', () => {
    const state = open();
    place(state, 2, -1.5, 0);
    place(state, 3, 0, -1.5);
    expect(meleeArc(state, arc({ cosHalfAngle: -1 }))).toEqual([2, 3]);
    expect(meleeArc(state, arc({ cosHalfAngle: -0.99 }))).toEqual([3]);
  });

  it('counts a target at the origin whatever the angle', () => {
    const state = open();
    place(state, 2, 0, 0);
    expect(meleeArc(state, arc({ cosHalfAngle: 0.99 }))).toEqual([2]);
  });

  it('ignores obstacles', () => {
    const state = createMatch(
      config2v2(),
      openArena([{ type: 'rect', x: 1, y: 0, w: 0.2, h: 10, height: 1, blocksProjectiles: true }]),
      1,
    );
    place(state, 0, 0, 0);
    place(state, 2, 2, 0);
    expect(meleeArc(state, arc())).toEqual([2]);
  });

  it('hits a target exactly behind the owner with a cosine of -1, whatever the direction', () => {
    const state = open();
    // The dot product with this oblique unit direction is -|d| only up to rounding: at 1.3 and
    // 1.9 m a plain `dot >= -1 * |d|` test misses the target, so the -1 shortcut must stay.
    const dir = direction(0.3, 0.7)!;
    place(state, 3, 9, 9);
    for (const behind of [1.3, 1.9]) {
      place(state, 2, -behind * dir.x, -behind * dir.y);
      expect(meleeArc(state, arc({ dirX: 0.3, dirY: 0.7, cosHalfAngle: -1 })), `${behind} m`).toEqual([2]);
    }
  });

  it('may be swung by a dead owner', () => {
    const state = open();
    champion(state, 0).alive = false;
    expect(meleeArc(state, arc())).toEqual([2]);
  });
});

describe('meleeArc events and effects', () => {
  it('emits the arc with its unit direction before the effect events', () => {
    const state = open();
    meleeArc(state, arc({ dirX: 10, dirY: 0 }));
    expect(state.events).toEqual([
      {
        type: 'meleeArc',
        ownerId: 0,
        x: 0,
        y: 0,
        dirX: 1,
        dirY: 0,
        radius: 2,
        cosHalfAngle: 0.5,
        targetIds: [2],
      },
      { type: 'damage', targetId: 2, sourceId: 0, amount: 10, health: 110 },
    ]);
  });

  it('emits an arc with no targets', () => {
    const state = open();
    expect(meleeArc(state, arc({ dirX: 0, dirY: 1 }))).toEqual([]);
    expect(state.events).toMatchObject([{ type: 'meleeArc', targetIds: [] }]);
    expect(state.events).toHaveLength(1);
  });

  it('lists every target before any effect applies, even when an effect kills one', () => {
    const state = open();
    place(state, 3, 1, 0.2);
    meleeArc(state, arc({ effects: [{ type: 'damage', amount: 500 }] }));
    expect(state.events[0]).toMatchObject({ type: 'meleeArc', targetIds: [2, 3] });
    expect(champion(state, 2).alive).toBe(false);
    expect(champion(state, 3).alive).toBe(false);
  });

  it('applies the effects in order to each target in id order', () => {
    const state = open();
    place(state, 3, 1, 0.2);
    meleeArc(state, arc({ effects: [{ type: 'damage', amount: 10 }, { type: 'heal', amount: 5 }] }));
    expect(state.events.slice(1).map((e) => [e.type, e.type === 'damage' || e.type === 'heal' ? e.targetId : -1])).toEqual([
      ['damage', 2],
      ['heal', 2],
      ['damage', 3],
      ['heal', 3],
    ]);
  });

  it('pushes away from the arc origin, not from the owner', () => {
    const state = open();
    place(state, 2, 1, 1);
    meleeArc(state, arc({ x: 1, y: -0.5, dirX: 0, dirY: 1, effects: [{ type: 'knockback', distance: 2, ticks: 8, direction: 'away' }] }));
    expect(champion(state, 2).statuses).toMatchObject([{ type: 'knockback', dirX: 0, dirY: 1 }]);
  });

  it('applies statuses and shields to the targets', () => {
    const state = open();
    meleeArc(state, arc({ effects: [{ type: 'applyStatus', status: { type: 'stun', ticks: 30 } }] }));
    expect(champion(state, 2).statuses).toMatchObject([{ type: 'stun', sourceId: 0, slot: null }]);
  });
});

describe('meleeArc validation', () => {
  it('throws Invalid melee arc for a bad spec, without changing the state', () => {
    const state = open();
    const before = JSON.stringify(state);
    const bad: [string, Partial<MeleeArcSpec>][] = [
      ['unknown owner', { ownerId: 9 }],
      ['NaN x', { x: NaN }],
      ['infinite y', { y: Infinity }],
      ['NaN direction', { dirX: NaN }],
      ['zero direction', { dirX: 0, dirY: 0 }],
      ['zero radius', { radius: 0 }],
      ['negative radius', { radius: -1 }],
      ['infinite radius', { radius: Infinity }],
      ['cosine above 1', { cosHalfAngle: 1.01 }],
      ['cosine below -1', { cosHalfAngle: -1.01 }],
      ['NaN cosine', { cosHalfAngle: NaN }],
      ['effects not an array', { effects: 'x' as never }],
      ['bad effect', { effects: [{ type: 'damage', amount: 0 }] }],
      ['unknown effect', { effects: [{ type: 'burn' } as never] }],
    ];
    for (const [name, overrides] of bad) {
      expect(() => meleeArc(state, arc(overrides)), name).toThrow(/^Invalid melee arc: /);
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('accepts a cosine of exactly 1 and -1', () => {
    const state = open();
    expect(() => meleeArc(state, arc({ cosHalfAngle: 1 }))).not.toThrow();
    expect(() => meleeArc(state, arc({ cosHalfAngle: -1 }))).not.toThrow();
  });

  it('measures a direction beyond the range of length', () => {
    const state = open();
    expect(meleeArc(state, arc({ dirX: 1e200, dirY: 0 }))).toEqual([2]);
  });
});
