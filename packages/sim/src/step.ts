import { BASE_MOVE_SPEED, DT } from './constants';
import { resolveChampion } from './collision';
import { resolveInput } from './input';
import type { PlayerInput } from './input';
import type { GameState } from './state';

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

    const length = Math.hypot(input.moveX, input.moveY);
    const dirX = length === 0 ? 0 : input.moveX / length;
    const dirY = length === 0 ? 0 : input.moveY / length;
    champion.vx = dirX * BASE_MOVE_SPEED;
    champion.vy = dirY * BASE_MOVE_SPEED;
    const prevX = champion.x;
    const prevY = champion.y;
    champion.x += champion.vx * DT;
    champion.y += champion.vy * DT;

    const toAimX = champion.aimX / 100 - champion.x;
    const toAimY = champion.aimY / 100 - champion.y;
    if (toAimX !== 0 || toAimY !== 0) champion.facing = Math.atan2(toAimY, toAimX);

    resolveChampion(state, champion, prevX, prevY);
  }

  state.tick += 1;
}
