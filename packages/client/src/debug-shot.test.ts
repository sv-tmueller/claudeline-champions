import { createMatch, parseArenaDef, step, type GameState } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { bindDebugShot, fireDebugArea, fireDebugShot } from './debug-shot';

function match(): GameState {
  return createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'a', team: 'A' },
        { championId: 'b', team: 'A' },
        { championId: 'c', team: 'B' },
        { championId: 'd', team: 'B' },
      ],
    },
    parseArenaDef(arena01Json),
    1,
  );
}

describe('fireDebugShot', () => {
  it('spawns a 30 damage projectile that flies from the champion towards the aim', () => {
    const state = match();
    const id = fireDebugShot(state, 0, -1100, 200);
    expect(id).toBe(state.projectiles[0]?.id);
    expect(state.projectiles).toHaveLength(1);
    const shot = state.projectiles[0];
    expect([shot?.x, shot?.y]).toEqual([-12, 2]);
    expect(shot?.ownerId).toBe(0);
    expect(shot?.vx).toBeCloseTo(10, 12);
    expect(shot?.vy).toBeCloseTo(0, 12);
    expect(shot?.radius).toBe(0.25);
    expect(shot?.remainingTicks).toBe(180);
    expect(shot?.pierce).toBe(false);
    expect(shot?.effects).toEqual([{ type: 'damage', amount: 30 }]);
  });

  it('aims at the point, not only along an axis', () => {
    const state = match();
    fireDebugShot(state, 0, -1200, 700);
    const shot = state.projectiles[0];
    expect(shot?.vx).toBeCloseTo(0, 12);
    expect(shot?.vy).toBeCloseTo(10, 12);
  });

  it('returns null and spawns nothing when the aim is on the champion', () => {
    const state = match();
    expect(fireDebugShot(state, 0, -1200, 200)).toBeNull();
    expect(state.projectiles).toHaveLength(0);
  });

  it('returns null for a champion that does not exist', () => {
    const state = match();
    expect(fireDebugShot(state, 9, 0, 0)).toBeNull();
  });

  it('hits champion 2 from the default aim after about 140 ticks, four hits to kill', () => {
    const state = match();
    for (let i = 0; i < 4; i++) fireDebugShot(state, 0, -1100, 200);
    let hitTick = -1;
    for (let tick = 0; tick < 200 && hitTick < 0; tick++) {
      step(state, []);
      if (state.events.some((event) => event.type === 'projectileHit')) hitTick = state.tick;
    }
    expect(hitTick).toBeGreaterThanOrEqual(135);
    expect(hitTick).toBeLessThanOrEqual(145);
    expect(state.champions[2]?.health).toBe(0);
    expect(state.champions[2]?.alive).toBe(false);
    expect(state.champions[3]?.health).toBe(120);
  });
});

describe('fireDebugArea', () => {
  it('spawns a fused one-hit area at the aim: fuse 90, radius 2.5, 30 damage to enemies', () => {
    const state = match();
    const id = fireDebugArea(state, 0, -1100, 200);
    expect(id).toBe(state.areas[0]?.id);
    expect(state.areas).toHaveLength(1);
    const area = state.areas[0];
    expect([area?.x, area?.y]).toEqual([-11, 2]);
    expect(area?.ownerId).toBe(0);
    expect(area?.radius).toBe(2.5);
    expect(area?.targets).toBe('enemies');
    expect(area?.fuseTicks).toBe(90);
    expect(area?.ticksToNextApply).toBe(90);
    expect(area?.remainingTicks).toBe(91);
    expect(area?.effects).toEqual([{ type: 'damage', amount: 30 }]);
  });

  it('detonates on the 91st step and hurts the champion standing in it', () => {
    const state = match();
    const target = state.champions[2];
    if (!target) throw new Error('no champion 2');
    fireDebugArea(state, 0, target.x * 100, target.y * 100);
    for (let n = 1; n <= 90; n++) {
      step(state, []);
      expect(state.champions[2]?.health).toBe(120);
    }
    expect(state.areas).toHaveLength(1);
    step(state, []);
    expect(state.champions[2]?.health).toBe(90);
    expect(state.areas).toHaveLength(0);
  });

  it('returns null and spawns nothing for a champion that does not exist', () => {
    const state = match();
    expect(fireDebugArea(state, 9, 0, 0)).toBeNull();
    expect(state.areas).toHaveLength(0);
  });
});

function fakeEvent(fields: Record<string, unknown>): Event & Record<string, unknown> {
  return Object.assign(new Event('keydown', { cancelable: true }), fields);
}

const KEYS = { code: 'F4', repeat: false, altKey: false, ctrlKey: false, metaKey: false };

describe('bindDebugShot', () => {
  function setup(result: number | null = 5) {
    const win = new EventTarget();
    const canvas = { dataset: {} as Record<string, string | undefined> };
    let fired = 0;
    const unbind = bindDebugShot(win, canvas, () => {
      fired += 1;
      return result;
    });
    return { win, canvas, unbind, fired: () => fired };
  }

  it('fires on F4, prevents the default and counts the shot', () => {
    const { win, canvas, fired } = setup();
    const event = fakeEvent(KEYS);
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(fired()).toBe(1);
    expect(canvas.dataset['debugShots']).toBe('1');
    win.dispatchEvent(fakeEvent(KEYS));
    expect(canvas.dataset['debugShots']).toBe('2');
  });

  it('starts the counter at 0 before the first shot', () => {
    const { canvas } = setup();
    expect(canvas.dataset['debugShots']).toBe('0');
  });

  it.each([
    ['another key', { code: 'F3' }],
    ['a repeat', { repeat: true }],
    ['Alt held', { altKey: true }],
    ['Ctrl held', { ctrlKey: true }],
    ['Meta held', { metaKey: true }],
  ])('ignores %s', (_name, change) => {
    const { win, canvas, fired } = setup();
    const event = fakeEvent({ ...KEYS, ...change });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(fired()).toBe(0);
    expect(canvas.dataset['debugShots']).toBe('0');
  });

  it('does not count a shot that was not fired', () => {
    const { win, canvas, fired } = setup(null);
    win.dispatchEvent(fakeEvent(KEYS));
    expect(fired()).toBe(1);
    expect(canvas.dataset['debugShots']).toBe('0');
  });

  it('stops listening after unbind', () => {
    const { win, unbind, fired } = setup();
    unbind();
    win.dispatchEvent(fakeEvent(KEYS));
    expect(fired()).toBe(0);
  });
});

describe('bindDebugShot with Shift held', () => {
  function setup() {
    const win = new EventTarget();
    const canvas = { dataset: {} as Record<string, string | undefined> };
    let shots = 0;
    let areas = 0;
    bindDebugShot(win, canvas, () => ++shots, () => ++areas);
    return { win, canvas, count: () => ({ shots, areas }) };
  }

  it('spawns an area on Shift+F4 and no shot, counting it in debugAreas', () => {
    const { win, canvas, count } = setup();
    expect(canvas.dataset['debugAreas']).toBe('0');
    const event = fakeEvent({ ...KEYS, shiftKey: true });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(count()).toEqual({ shots: 0, areas: 1 });
    expect(canvas.dataset['debugAreas']).toBe('1');
    expect(canvas.dataset['debugShots']).toBe('0');
  });

  it('keeps F4 alone a shot', () => {
    const { win, canvas, count } = setup();
    win.dispatchEvent(fakeEvent({ ...KEYS, shiftKey: false }));
    expect(count()).toEqual({ shots: 1, areas: 0 });
    expect(canvas.dataset['debugShots']).toBe('1');
    expect(canvas.dataset['debugAreas']).toBe('0');
  });

  it('ignores Shift+F4 with Alt, Ctrl, Meta or a repeat', () => {
    const { win, count } = setup();
    for (const change of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true }]) {
      win.dispatchEvent(fakeEvent({ ...KEYS, shiftKey: true, ...change }));
    }
    expect(count()).toEqual({ shots: 0, areas: 0 });
  });
});
