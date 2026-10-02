// Toolkit entry points exposed for tests and client dev tools (batch #32
// decision 2). Gameplay code outside the sim must not call them: kits reach
// the toolkit from inside the sim through `cast.ts`.
//
// A spawn made here belongs to no cast, so its hits earn no energy and its statuses carry no
// slot. The wrappers have two parameters on purpose: the cast id of `spawnProjectile` and
// `spawnArea` is for `cast.ts`, and a dev tool cannot pass one.
import { spawnArea as spawnAreaForCast } from './area';
import type { AreaSpec } from './area';
import { spawnProjectile as spawnProjectileForCast } from './projectile';
import type { ProjectileSpec } from './projectile';
import type { GameState } from './state';

export type { ProjectileSpec } from './projectile';
export type { AreaSpec } from './area';

export function spawnProjectile(state: GameState, spec: ProjectileSpec): number {
  return spawnProjectileForCast(state, spec, null);
}

export function spawnArea(state: GameState, spec: AreaSpec): number {
  return spawnAreaForCast(state, spec, null);
}
