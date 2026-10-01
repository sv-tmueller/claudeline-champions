export type MoveAxis = -1 | 0 | 1;

export interface PlayerInput {
  moveX: MoveAxis;
  moveY: MoveAxis;
  /** World aim position in integer centimeters. */
  aimX: number;
  aimY: number;
  /** Bitmask of `Button` values. */
  buttons: number;
}

// Bit order follows the spec slot order and is wire-stable: never reorder.
export const Button = {
  M1: 1,
  M2: 2,
  SPACE: 4,
  Q: 8,
  E: 16,
  R: 32,
  F: 64,
  SHIFT: 128,
} as const;

const BUTTON_MASK = Object.values(Button).reduce((mask, bit) => mask | bit, 0);

/** Only exactly -1, 0 or 1 is a move axis; anything else is no movement. */
function sanitizeAxis(value: unknown): MoveAxis {
  return value === -1 || value === 1 ? value : 0;
}

/**
 * A non-finite aim coordinate keeps the stored aim. Aim is whole centimeters, so a finite
 * value is rounded. `+ 0` turns -0 into +0, which a JSON round trip would do anyway and
 * which would otherwise change atan2 in `step`.
 */
function sanitizeAim(value: unknown, stored: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) + 0 : stored;
}

/** Anything but a non-negative integer is no buttons; valid bits are masked to the defined ones. */
function sanitizeButtons(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value & BUTTON_MASK
    : 0;
}

/**
 * The missing-input rule (no movement, no buttons, aim unchanged), plus sanitizing: the
 * sim must not trust inputs that will later arrive over the network, so each field is
 * checked at runtime and an invalid one falls back to its neutral value.
 */
export function resolveInput(
  input: PlayerInput | undefined | null,
  aimX: number,
  aimY: number,
): PlayerInput {
  // Anything that is not an object (null, a number, a string) counts as missing.
  if (typeof input !== 'object' || input === null)
    return { moveX: 0, moveY: 0, aimX, aimY, buttons: 0 };
  return {
    moveX: sanitizeAxis(input.moveX),
    moveY: sanitizeAxis(input.moveY),
    aimX: sanitizeAim(input.aimX, aimX),
    aimY: sanitizeAim(input.aimY, aimY),
    buttons: sanitizeButtons(input.buttons),
  };
}
