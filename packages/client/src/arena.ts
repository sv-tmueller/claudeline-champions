// Stopgap reader for data/arenas/*.json. Field names match the JSON so that
// swapping in the sim's arena parser later is a one-import change.

export type Obstacle =
  | { type: 'circle'; x: number; y: number; r: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number };

export interface Arena {
  id: string;
  size: { width: number; height: number };
  spawns: { teamA: [number, number][]; teamB: [number, number][] };
  obstacles: Obstacle[];
}

export type TeamId = 'teamA' | 'teamB';

export interface ArenaInput {
  id: string;
  size: { width: number; height: number };
  spawns: { teamA: number[][]; teamB: number[][] };
  obstacles: { type: string; x: number; y: number; r?: number; w?: number; h?: number }[];
}

export interface Placement {
  team: TeamId;
  x: number;
  y: number;
  /** Radians about three's +Y. The champion model faces +X at 0. */
  facing: number;
}

/** Each team faces exactly along +x or -x, as the sim's match setup does. */
export const TEAM_FACING: Record<TeamId, number> = { teamA: 0, teamB: Math.PI };

function readNumber(value: number | undefined, what: string): number {
  if (value === undefined) throw new Error(`arena: missing ${what}`);
  return value;
}

function readSpawns(tuples: number[][], team: TeamId): [number, number][] {
  return tuples.map((tuple) => {
    const x = tuple[0];
    const y = tuple[1];
    if (x === undefined || y === undefined) throw new Error(`arena: bad spawn in ${team}`);
    return [x, y];
  });
}

function readObstacle(input: ArenaInput['obstacles'][number]): Obstacle {
  const { x, y } = input;
  switch (input.type) {
    case 'circle':
      return { type: 'circle', x, y, r: readNumber(input.r, 'circle r') };
    case 'rect':
      return { type: 'rect', x, y, w: readNumber(input.w, 'rect w'), h: readNumber(input.h, 'rect h') };
    default:
      throw new Error(`arena: unknown obstacle type ${input.type}`);
  }
}

export function readArena(input: ArenaInput): Arena {
  return {
    id: input.id,
    size: { width: input.size.width, height: input.size.height },
    spawns: {
      teamA: readSpawns(input.spawns.teamA, 'teamA'),
      teamB: readSpawns(input.spawns.teamB, 'teamB'),
    },
    obstacles: input.obstacles.map(readObstacle),
  };
}

/** The first two spawns of each team, which is the 2v2 layout. */
export function twoVsTwoPlacements(arena: Arena): Placement[] {
  const placements: Placement[] = [];
  for (const team of ['teamA', 'teamB'] as const) {
    const spawns = arena.spawns[team].slice(0, 2);
    if (spawns.length < 2) throw new Error(`arena: ${team} needs two spawns`);
    for (const [x, y] of spawns) placements.push({ team, x, y, facing: TEAM_FACING[team] });
  }
  return placements;
}
