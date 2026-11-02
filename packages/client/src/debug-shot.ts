import { debug, type GameState } from '@claudeline/sim';

// Inside the rules.md damage range, and four hits kill a 120 health champion.
const SHOT_DAMAGE = 30;
const SHOT_SPEED = 10;
const SHOT_RADIUS = 0.25;
const SHOT_LIFETIME_TICKS = 180;
// The fused area of Shift+F4 (rules 2.6): no shipped kit has a fuse, so the e2e of the armed look
// spawns one. 90 ticks is inside the 15 to 120 range; one hit of 30 damage, as a shot does.
const AREA_FUSE_TICKS = 90;
const AREA_RADIUS = 2.5;
const AREA_DAMAGE = 30;

/**
 * Spawns a dev-only projectile from the champion towards an aim point in
 * centimeters. Returns its id, or null when there is no direction to fly in.
 * Dev builds only: `main.ts` imports this behind `import.meta.env.DEV`.
 */
export function fireDebugShot(
  state: GameState,
  ownerId: number,
  aimXcm: number,
  aimYcm: number,
): number | null {
  const owner = state.champions[ownerId];
  if (!owner) return null;
  const dirX = aimXcm / 100 - owner.x;
  const dirY = aimYcm / 100 - owner.y;
  // The toolkit throws on a zero direction.
  if (dirX === 0 && dirY === 0) return null;
  return debug.spawnProjectile(state, {
    ownerId,
    x: owner.x,
    y: owner.y,
    dirX,
    dirY,
    speed: SHOT_SPEED,
    radius: SHOT_RADIUS,
    lifetimeTicks: SHOT_LIFETIME_TICKS,
    pierce: false,
    effects: [{ type: 'damage', amount: SHOT_DAMAGE }],
  });
}

/**
 * Spawns a dev-only fused one-hit area at an aim point in centimeters: it sits armed for 90 ticks,
 * then hits the enemy team inside it once. Returns its id, or null for an unknown champion.
 * Dev builds only, like `fireDebugShot`.
 */
export function fireDebugArea(
  state: GameState,
  ownerId: number,
  aimXcm: number,
  aimYcm: number,
): number | null {
  if (!state.champions[ownerId]) return null;
  return debug.spawnArea(state, {
    ownerId,
    x: aimXcm / 100,
    y: aimYcm / 100,
    radius: AREA_RADIUS,
    durationTicks: 1,
    intervalTicks: 1,
    targets: 'enemies',
    effects: [{ type: 'damage', amount: AREA_DAMAGE }],
    fuseTicks: AREA_FUSE_TICKS,
  });
}

/**
 * F4 fires a shot, and Shift+F4 spawns a fused area when `fireArea` is given. Returns a function
 * that removes the listener.
 */
export function bindDebugShot(
  win: EventTarget,
  canvas: { dataset: Record<string, string | undefined> },
  fire: () => number | null,
  fireArea?: () => number | null,
): () => void {
  canvas.dataset['debugShots'] = '0';
  if (fireArea) canvas.dataset['debugAreas'] = '0';
  const listener = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (key.code !== 'F4' || key.repeat || key.altKey || key.ctrlKey || key.metaKey) return;
    event.preventDefault();
    if (key.shiftKey && fireArea) {
      if (fireArea() === null) return;
      canvas.dataset['debugAreas'] = String(Number(canvas.dataset['debugAreas']) + 1);
      return;
    }
    if (fire() === null) return;
    canvas.dataset['debugShots'] = String(Number(canvas.dataset['debugShots']) + 1);
  };
  win.addEventListener('keydown', listener);
  return () => win.removeEventListener('keydown', listener);
}
