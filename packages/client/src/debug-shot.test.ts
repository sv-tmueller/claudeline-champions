import { createMatch, parseArenaDef, step, type GameState } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { bindDebugShot, fireDebugShot } from './debug-shot';

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
