import arena01Json from '../../../data/arenas/arena01.json';
import { CHAMPION_RADIUS, parseArenaDef } from '../src/index';
import type {
  ArenaDef,
  ChampionState,
  GameState,
  MatchConfig,
  Obstacle,
  PlayerInput,
} from '../src/index';

export const TOLERANCE = 1e-9;

export const arena01: ArenaDef = parseArenaDef(arena01Json);

/** A 30 x 20 arena with the arena01 spawns and the given obstacles. */
export function openArena(obstacles: Obstacle[] = []): ArenaDef {
  return { ...arena01, id: 'open', name: 'Open', obstacles };
}

export function config2v2(): MatchConfig {
  return {
    teamSize: 2,
    players: [
      { championId: 'hargrim', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'lumeth', team: 'B' },
      { championId: 'skerrow', team: 'B' },
    ],
  };
}

export function input(
  moveX: -1 | 0 | 1,
  moveY: -1 | 0 | 1,
  aimX = 0,
  aimY = 0,
  buttons = 0,
): PlayerInput {
  return { moveX, moveY, aimX, aimY, buttons };
}

export function champion(state: GameState, id: number): ChampionState {
  const c = state.champions[id];
  if (!c) throw new Error(`no champion ${id}`);
  return c;
}

export function place(state: GameState, id: number, x: number, y: number): void {
  const c = champion(state, id);
  c.x = x;
  c.y = y;
}

/**
 * An independent oracle for the collision rules. It deliberately does not
 * import the src/collision predicates. Returns one message per violation.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const { width, height } = state.arena.size;
  const r = CHAMPION_RADIUS;
  const tag = (c: ChampionState, what: string) => `tick ${state.tick} champion ${c.id}: ${what}`;

  for (const c of state.champions) {
    for (const key of ['x', 'y', 'vx', 'vy', 'facing', 'health'] as const) {
      if (!Number.isFinite(c[key])) problems.push(tag(c, `${key} is ${c[key]}`));
    }
    if (c.x < -width / 2 + r - TOLERANCE || c.x > width / 2 - r + TOLERANCE) {
      problems.push(tag(c, `x ${c.x} outside the boundary`));
    }
    if (c.y < -height / 2 + r - TOLERANCE || c.y > height / 2 - r + TOLERANCE) {
      problems.push(tag(c, `y ${c.y} outside the boundary`));
    }
    state.arena.obstacles.forEach((o, i) => {
      if (o.type === 'circle') {
        const dist = Math.hypot(c.x - o.x, c.y - o.y);
        if (dist < o.r + r - TOLERANCE) problems.push(tag(c, `overlaps circle ${i} (${dist})`));
      } else {
        const gapX = Math.max(Math.abs(c.x - o.x) - o.w / 2, 0);
        const gapY = Math.max(Math.abs(c.y - o.y) - o.h / 2, 0);
        const dist = Math.hypot(gapX, gapY);
        if (dist < r - TOLERANCE) problems.push(tag(c, `overlaps rect ${i} (${dist})`));
      }
    });
  }
  for (const a of state.champions) {
    for (const b of state.champions) {
      if (b.id <= a.id) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 2 * r - TOLERANCE) {
        problems.push(`tick ${state.tick}: champions ${a.id} and ${b.id} overlap (${dist})`);
      }
    }
  }
  return problems;
}
