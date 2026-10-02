// Toolkit entry points exposed for tests and client dev tools (batch #32
// decision 2). Gameplay code outside the sim must not call them: kits reach
// the toolkit from inside the sim when abilities arrive.
export { spawnProjectile } from './projectile';
export type { ProjectileSpec } from './projectile';
export { spawnArea } from './area';
export type { AreaSpec } from './area';
