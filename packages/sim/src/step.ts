import { BASE_MOVE_SPEED, DT, SLOWED_WINDUP_FACTOR } from './constants';
import { expireAreas, stepAreas } from './area';
import {
  abilityOf,
  advanceWindup,
  dropUnusedCasts,
  findKit,
  fireDashThen,
  startCast,
  tickCooldowns,
} from './cast';
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

    tickCooldowns(champion);
    advanceWindup(state, champion);
    startCast(state, champion, input.buttons);

    const moveLength = length(input.moveX, input.moveY);
    const dirX = moveLength === 0 ? 0 : input.moveX / moveLength;
    const dirY = moveLength === 0 ? 0 : input.moveY / moveLength;
    // Stun, root, a dash and a locked windup take walking away; `+ 0` keeps a blocked velocity
    // from being -0. A champion with no kit keeps the exact base speed expression.
    const kit = findKit(state, champion);
    const movement =
      kit && champion.cast ? abilityOf(kit, champion.cast.slot, champion.cast.ex).movement : 'free';
    const walking = !(
      hasStatus(champion, 'stun') ||
      hasStatus(champion, 'root') ||
      champion.dash ||
      movement === 'locked'
    );
    let speed = walking ? (kit ? kit.moveSpeed : BASE_MOVE_SPEED) * speedFactor(champion) : 0;
    if (walking && movement === 'slowed') speed *= SLOWED_WINDUP_FACTOR;
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

    const ended = stepForcedMotion(state, champion);
    if (ended) fireDashThen(state, champion, ended);
    upkeepStatuses(state, champion);
  }

  stepProjectiles(state);
  stepAreas(state);
  expireProjectiles(state);
  expireAreas(state);
  dropUnusedCasts(state);

  state.tick += 1;
}
