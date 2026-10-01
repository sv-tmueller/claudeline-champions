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

/** The missing-input rule: no movement, no buttons, aim unchanged. */
export function resolveInput(
  input: PlayerInput | undefined,
  aimX: number,
  aimY: number,
): PlayerInput {
  return input ?? { moveX: 0, moveY: 0, aimX, aimY, buttons: 0 };
}
