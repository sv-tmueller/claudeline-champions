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
      if (b.id <= a.id || !a.alive || !b.alive) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 2 * r - TOLERANCE) {
        problems.push(`tick ${state.tick}: champions ${a.id} and ${b.id} overlap (${dist})`);
      }
    }
  }
  return problems;
}

export type ContactKind =
  | 'boundary'
  | 'boundarySlide'
  | 'circle'
  | 'circleSlide'
  | 'rect'
  | 'rectSlide'
  | 'rectCorner'
  | 'pair'
  | 'pairPinned';

export const ALL_CONTACT_KINDS: ContactKind[] = [
  'boundary',
  'boundarySlide',
  'circle',
  'circleSlide',
  'rect',
  'rectSlide',
  'rectCorner',
  'pair',
  'pairPinned',
];

const CONTACT_TOLERANCE = 1e-6;

/**
 * Which contacts the champions are in right now. A contact counts only at
 * contact distance (within 1e-6) with the walk velocity pointing into the
 * surface, so a champion that merely runs tangent to a wall does not count.
 */
export function contactKinds(state: GameState): Set<ContactKind> {
  const found = new Set<ContactKind>();
  const r = CHAMPION_RADIUS;
  const limitX = state.arena.size.width / 2 - r;
  const limitY = state.arena.size.height / 2 - r;
  const pointsInto = (c: ChampionState, tx: number, ty: number) =>
    c.vx * (tx - c.x) + c.vy * (ty - c.y) > 0;
  const atBoundary = (c: ChampionState) =>
    Math.abs(c.x) >= limitX - CONTACT_TOLERANCE || Math.abs(c.y) >= limitY - CONTACT_TOLERANCE;

  for (const c of state.champions) {
    const intoX = (c.x >= limitX - CONTACT_TOLERANCE && c.vx > 0) || (c.x <= -limitX + CONTACT_TOLERANCE && c.vx < 0);
    const intoY = (c.y >= limitY - CONTACT_TOLERANCE && c.vy > 0) || (c.y <= -limitY + CONTACT_TOLERANCE && c.vy < 0);
    if (intoX || intoY) found.add('boundary');
    if ((intoX && c.vy !== 0) || (intoY && c.vx !== 0)) found.add('boundarySlide');
    for (const o of state.arena.obstacles) {
      if (o.type === 'circle') {
        const dist = Math.hypot(c.x - o.x, c.y - o.y);
        if (Math.abs(dist - (o.r + r)) <= CONTACT_TOLERANCE && pointsInto(c, o.x, o.y)) {
          found.add('circle');
          const cross = c.vx * (o.y - c.y) - c.vy * (o.x - c.x);
          if (Math.abs(cross) > 1e-3) found.add('circleSlide');
        }
      } else {
        const qx = Math.min(Math.max(c.x, o.x - o.w / 2), o.x + o.w / 2);
        const qy = Math.min(Math.max(c.y, o.y - o.h / 2), o.y + o.h / 2);
        const dx = c.x - qx;
        const dy = c.y - qy;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && Math.abs(dist - r) <= CONTACT_TOLERANCE && pointsInto(c, qx, qy)) {
          found.add('rect');
          if (dx !== 0 && dy !== 0) found.add('rectCorner');
          if ((dx === 0 && c.vx !== 0) || (dy === 0 && c.vy !== 0)) found.add('rectSlide');
        }
      }
    }
    for (const other of state.champions) {
      if (other.id === c.id) continue;
      const dist = Math.hypot(c.x - other.x, c.y - other.y);
      if (Math.abs(dist - 2 * r) <= CONTACT_TOLERANCE && pointsInto(c, other.x, other.y)) {
        found.add('pair');
        if (atBoundary(other)) found.add('pairPinned');
      }
    }
  }
  return found;
}
