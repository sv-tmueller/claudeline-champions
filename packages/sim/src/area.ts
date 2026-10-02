import { CHAMPION_RADIUS } from './constants';
import { length } from './geometry';
import { applyEffects, copyEffects } from './health';
import { nextId } from './state';
import type { AreaState, AreaTargets, Effect, GameState, TeamId } from './state';

export interface AreaSpec {
  ownerId: number;
  x: number;
  y: number;
  radius: number;
  durationTicks: number;
  /** Ticks between applications; the first one happens on the first step. */
  intervalTicks: number;
  targets: AreaTargets;
  effects: readonly Effect[];
}

function fail(problem: string): never {
  throw new Error(`Invalid area: ${problem}`);
}

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Spawns a circular area and returns its id. It acts from the next `step` on. */
export function spawnArea(state: GameState, spec: AreaSpec): number {
  const owner = state.champions[spec.ownerId];
  if (!owner) return fail(`unknown owner ${spec.ownerId}`);
  for (const key of ['x', 'y', 'radius'] as const) {
    if (!Number.isFinite(spec[key])) return fail(`${key} is not a finite number`);
  }
  if (spec.radius <= 0) return fail('radius must be above 0');
  if (!isPositiveInteger(spec.durationTicks)) {
    return fail('durationTicks must be a positive integer');
  }
  if (!isPositiveInteger(spec.intervalTicks)) {
    return fail('intervalTicks must be a positive integer');
  }
  if (spec.targets !== 'enemies' && spec.targets !== 'allies' && spec.targets !== 'all') {
    return fail(`unknown targets ${String(spec.targets)}`);
  }
  const effects = copyEffects(spec.effects, fail);

  const area: AreaState = {
    id: nextId(state),
    type: 'circle',
    ownerId: spec.ownerId,
    team: owner.team,
    x: spec.x + 0,
    y: spec.y + 0,
    radius: spec.radius,
    targets: spec.targets,
    remainingTicks: spec.durationTicks,
    intervalTicks: spec.intervalTicks,
    ticksToNextApply: 0,
    effects,
  };
  state.areas.push(area);
  state.events.push({
    type: 'areaSpawned',
    areaId: area.id,
    ownerId: area.ownerId,
    x: area.x,
    y: area.y,
    radius: area.radius,
  });
  return area.id;
}

function affects(area: AreaState, team: TeamId): boolean {
  if (area.targets === 'all') return true;
  return area.targets === 'allies' ? team === area.team : team !== area.team;
}

/** Phase 5: areas in id order apply their effects when their interval is due. */
export function stepAreas(state: GameState): void {
  for (const area of state.areas) {
    if (area.ticksToNextApply === 0) {
      const reach = area.radius + CHAMPION_RADIUS;
      // The list is fixed before any effect runs.
      const targetIds = state.champions
        .filter(
          (c) =>
            c.alive && affects(area, c.team) && length(c.x - area.x, c.y - area.y) <= reach,
        )
        .map((c) => c.id);
      state.events.push({ type: 'areaTick', areaId: area.id, targetIds });
      for (const targetId of targetIds) {
        applyEffects(state, area.ownerId, targetId, area.effects, area);
      }
      area.ticksToNextApply = area.intervalTicks;
    }
    area.ticksToNextApply -= 1;
  }
}

/** Phase 6: an area that has run its duration ends. */
export function expireAreas(state: GameState): void {
  state.areas = state.areas.filter((area) => {
    area.remainingTicks -= 1;
    if (area.remainingTicks > 0) return true;
    state.events.push({ type: 'areaExpired', areaId: area.id });
    return false;
  });
}
