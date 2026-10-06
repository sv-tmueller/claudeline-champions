import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, keyLabel, parseBindings, rebind, type Action } from './bindings';

describe('the default bindings', () => {
  // The table of docs/design/rules.md section 6.
  it('are the keys of the rules: WASD, Space, Q, E, R and F', () => {
    expect(DEFAULT_BINDINGS).toEqual({
      up: 'KeyW',
      left: 'KeyA',
      down: 'KeyS',
      right: 'KeyD',
      SPACE: 'Space',
      Q: 'KeyQ',
      E: 'KeyE',
      R: 'KeyR',
      F: 'KeyF',
    });
  });

  it('list nine actions, each with its own code', () => {
    expect(ACTIONS).toEqual(['up', 'left', 'down', 'right', 'SPACE', 'Q', 'E', 'R', 'F']);
    expect(new Set(Object.values(DEFAULT_BINDINGS)).size).toBe(9);
  });
});

describe('rebind', () => {
  it('applies a free code and leaves the other actions alone', () => {
    const result = rebind(DEFAULT_BINDINGS, 'right', 'KeyL');
    expect(result).toEqual({ ok: true, bindings: { ...DEFAULT_BINDINGS, right: 'KeyL' } });
  });

  it('does not change the set it was given', () => {
    rebind(DEFAULT_BINDINGS, 'right', 'KeyL');
    expect(DEFAULT_BINDINGS.right).toBe('KeyD');
  });

  it('rejects a code that another action holds as a duplicate', () => {
    expect(rebind(DEFAULT_BINDINGS, 'up', 'KeyD')).toEqual({ ok: false, reason: 'duplicate' });
    expect(rebind(DEFAULT_BINDINGS, 'SPACE', 'KeyQ')).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('accepts the code an action already holds', () => {
    expect(rebind(DEFAULT_BINDINGS, 'up', 'KeyW')).toEqual({ ok: true, bindings: DEFAULT_BINDINGS });
  });

  it('frees the old code of a rebound action', () => {
    const moved = rebind(DEFAULT_BINDINGS, 'right', 'KeyL');
    if (!moved.ok) throw new Error('right to KeyL should apply');
    expect(rebind(moved.bindings, 'up', 'KeyD')).toEqual({ ok: true, bindings: { ...moved.bindings, up: 'KeyD' } });
  });

  it.each([
    '',
    'Escape',
    'Tab',
    'F3',
    'F4',
    'ShiftLeft',
    'ShiftRight',
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight',
  ])('rejects %j as reserved', (code) => {
    expect(rebind(DEFAULT_BINDINGS, 'Q', code)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('names a reserved code that is also bound as reserved, not as a duplicate', () => {
    const odd = { ...DEFAULT_BINDINGS, up: 'Escape' };
    expect(rebind(odd, 'left', 'Escape')).toEqual({ ok: false, reason: 'reserved' });
  });

  it('lets every action take any ordinary key', () => {
    for (const action of ACTIONS) {
      const result = rebind(DEFAULT_BINDINGS, action as Action, 'KeyZ');
      expect(result.ok, action).toBe(true);
    }
  });
});

describe('parseBindings', () => {
  it('reads a whole set', () => {
    expect(parseBindings({ ...DEFAULT_BINDINGS, right: 'KeyL' })).toEqual({ ...DEFAULT_BINDINGS, right: 'KeyL' });
  });

  it('reads no action from the prototype', () => {
    expect(parseBindings(Object.create(DEFAULT_BINDINGS))).toBeUndefined();
  });
});

describe('keyLabel', () => {
  it.each([
    ['KeyW', 'W'],
    ['Space', 'Space'],
    ['Digit5', '5'],
    ['Numpad3', 'Num 3'],
    ['ArrowLeft', 'Left'],
    ['Semicolon', 'Semicolon'],
  ])('shows %s as %s', (code, label) => {
    expect(keyLabel(code)).toBe(label);
  });
});
