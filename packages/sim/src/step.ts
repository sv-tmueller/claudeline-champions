import { BASE_MOVE_SPEED, DT } from './constants';
import { expireAreas, stepAreas } from './area';
import { resolveChampion } from './collision';
import { atan2 } from './dmath';
import { length } from './geometry';
import { upkeepStatuses } from './health';
import { stepForcedMotion } from './motion';
import { resolveInput } from './input';
import type { PlayerInput } from './input';
import { expireProjectiles, stepProjectiles } from './projectile';
import type { GameState } from './state';
import { hasStatus, speedFactor } from './status';

export function step(state: GameState, inputs: readonly (PlayerInput | undefined)[]): void {
  // Read every input before anything changes, so an entry whose property read throws
  // leaves the state exactly as it was.
  const resolved = state.champions.map((c) => resolveInput(inputs[c.id], c.aimX, c.aimY));

  state.events.length = 0;

  for (const champion of state.champions) {
    const input = resolved[champion.id];
    if (!champion.alive || !input) continue;
    champion.aimX = input.aimX;
    champion.aimY = input.aimY;

    const moveLength = length(input.moveX, input.moveY);
    const dirX = moveLength === 0 ? 0 : input.moveX / moveLength;
    const dirY = moveLength === 0 ? 0 : input.moveY / moveLength;
    // Stun, root and a dash take walking away; `+ 0` keeps a blocked velocity from being -0.
    const walking = !(hasStatus(champion, 'stun') || hasStatus(champion, 'root') || champion.dash);
    const speed = walking ? BASE_MOVE_SPEED * speedFactor(champion) : 0;
    champion.vx = dirX * speed + 0;
    champion.vy = dirY * speed + 0;
    const prevX = champion.x;
    const prevY = champion.y;
    champion.x += champion.vx * DT;
    champion.y += champion.vy * DT;

    const toAimX = champion.aimX / 100 - champion.x;
    const toAimY = champion.aimY / 100 - champion.y;
    if (toAimX !== 0 || toAimY !== 0) champion.facing = atan2(toAimY, toAimX);

    resolveChampion(state, champion, prevX, prevY);

    stepForcedMotion(state, champion);
    upkeepStatuses(state, champion);
  }

  stepProjectiles(state);
  stepAreas(state);
  expireProjectiles(state);
  expireAreas(state);

  state.tick += 1;
}
