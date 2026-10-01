import { BASE_MOVE_SPEED, DT } from './constants';
import { resolveInput } from './input';
import type { PlayerInput } from './input';
import type { GameState } from './state';

export function step(state: GameState, inputs: readonly (PlayerInput | undefined)[]): void {
  state.events.length = 0;

  for (const champion of state.champions) {
    const input = resolveInput(inputs[champion.id], champion.aimX, champion.aimY);
    champion.aimX = input.aimX;
    champion.aimY = input.aimY;

    const length = Math.hypot(input.moveX, input.moveY);
    const dirX = length === 0 ? 0 : input.moveX / length;
    const dirY = length === 0 ? 0 : input.moveY / length;
    champion.vx = dirX * BASE_MOVE_SPEED;
    champion.vy = dirY * BASE_MOVE_SPEED;
    champion.x += champion.vx * DT;
    champion.y += champion.vy * DT;

    const toAimX = champion.aimX / 100 - champion.x;
    const toAimY = champion.aimY / 100 - champion.y;
    if (toAimX !== 0 || toAimY !== 0) champion.facing = Math.atan2(toAimY, toAimX);
  }

  state.tick += 1;
}
