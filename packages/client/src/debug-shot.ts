import { debug, type GameState } from '@claudeline/sim';

// Inside the rules.md damage range, and four hits kill a 120 health champion.
const SHOT_DAMAGE = 30;
const SHOT_SPEED = 10;
const SHOT_RADIUS = 0.25;
const SHOT_LIFETIME_TICKS = 180;

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

/** F4 fires a shot. Returns a function that removes the listener. */
export function bindDebugShot(
  win: EventTarget,
  canvas: { dataset: Record<string, string | undefined> },
  fire: () => number | null,
): () => void {
  canvas.dataset['debugShots'] = '0';
  const listener = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (key.code !== 'F4' || key.repeat || key.altKey || key.ctrlKey || key.metaKey) return;
    event.preventDefault();
    if (fire() === null) return;
    canvas.dataset['debugShots'] = String(Number(canvas.dataset['debugShots']) + 1);
  };
  win.addEventListener('keydown', listener);
  return () => win.removeEventListener('keydown', listener);
}
