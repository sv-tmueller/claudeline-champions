// The rebindable keys. The mouse buttons and Shift stay fixed (rules.md section 6):
// Shift modifies any slot and is two physical keys for one bit.

/** The ten actions a key can be bound to. Slots are named as in the HUD; selfCast is the held self-cast key. */
export type Action = 'up' | 'left' | 'down' | 'right' | 'SPACE' | 'Q' | 'E' | 'R' | 'F' | 'selfCast';

/** The actions in the order of the keybinding view. */
export const ACTIONS: readonly Action[] = ['up', 'left', 'down', 'right', 'SPACE', 'Q', 'E', 'R', 'F', 'selfCast'];

/** A physical key code (`event.code`) for each action. */
export type Bindings = Readonly<Record<Action, string>>;

/** The table of docs/design/rules.md section 6. */
export const DEFAULT_BINDINGS: Bindings = {
  up: 'KeyW',
  left: 'KeyA',
  down: 'KeyS',
  right: 'KeyD',
  SPACE: 'Space',
  Q: 'KeyQ',
  E: 'KeyE',
  R: 'KeyR',
  F: 'KeyF',
  selfCast: 'KeyC',
};

// Keys that are never game input: the menu, the scoreboard, the debug keys, Shift (the EX
// modifier, fixed) and the command modifiers (the input core ignores any key pressed with one).
const RESERVED = new Set([
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
]);

// The empty code is what `event.code` reads for a key the browser cannot identify: an action
// bound to it could never be pressed again.
function isReserved(code: string): boolean {
  return code === '' || RESERVED.has(code);
}

export type RebindResult =
  | { ok: true; bindings: Bindings }
  | { ok: false; reason: 'duplicate' | 'reserved' };

/**
 * Binds `action` to `code`. A reserved code is refused, and so is a code another
 * action holds (the action's own code is not another action's). Returns a new set
 * and leaves `bindings` alone.
 */
export function rebind(bindings: Bindings, action: Action, code: string): RebindResult {
  if (isReserved(code)) return { ok: false, reason: 'reserved' };
  for (const other of ACTIONS) {
    if (other !== action && bindings[other] === code) return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, bindings: { ...bindings, [action]: code } };
}

/**
 * Reads a stored value as a set of bindings: every action present with a string
 * code that is neither reserved nor shared. Anything else is undefined, so the
 * caller takes the defaults whole (a per-field merge could create a duplicate).
 */
export function parseBindings(value: unknown): Bindings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const read: Partial<Record<Action, string>> = {};
  const seen = new Set<string>();
  for (const action of ACTIONS) {
    if (!Object.hasOwn(value, action)) return undefined;
    const code: unknown = (value as Record<string, unknown>)[action];
    if (typeof code !== 'string' || isReserved(code) || seen.has(code)) return undefined;
    seen.add(code);
    read[action] = code;
  }
  return read as Bindings;
}

const ARROWS: Readonly<Record<string, string>> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

/** The text for a key code: the letter or digit, the arrow's direction, else the code as it is. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return Object.hasOwn(ARROWS, code) ? (ARROWS[code] as string) : code;
}
