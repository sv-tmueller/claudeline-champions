import type { ArenaDef } from './arena';
import { DEFAULT_MAX_HEALTH } from './constants';
import type { ChampionState, GameState, MatchConfig, TeamId } from './state';

function fail(problem: string): never {
  throw new Error(`Invalid match: ${problem}`);
}

export function createMatch(config: MatchConfig, arena: ArenaDef, seed: number): GameState {
  const { teamSize, players } = config;
  if (teamSize !== 2 && teamSize !== 3) fail('teamSize must be 2 or 3');
  if (players.length !== 2 * teamSize) {
    fail(`expected ${2 * teamSize} players, got ${players.length}`);
  }
  if (!Number.isInteger(seed)) fail('seed must be an integer');

  const teams: TeamId[] = ['A', 'B'];
  for (const team of teams) {
    const count = players.filter((p) => p.team === team).length;
    if (count !== teamSize) fail(`team ${team} has ${count} players, expected ${teamSize}`);
    const spawns = team === 'A' ? arena.spawns.teamA : arena.spawns.teamB;
    if (spawns.length < teamSize) {
      fail(`team ${team} has ${spawns.length} spawns, needs ${teamSize}`);
    }
  }

  const placed: Record<TeamId, number> = { A: 0, B: 0 };
  const champions: ChampionState[] = players.map((player, id) => {
    const slot = placed[player.team]++;
    const spawns = player.team === 'A' ? arena.spawns.teamA : arena.spawns.teamB;
    const [x, y] = spawns[slot] as [number, number];
    const ahead = player.team === 'A' ? 100 : -100;
    return {
      id,
      team: player.team,
      championId: player.championId,
      x,
      y,
      vx: 0,
      vy: 0,
      facing: player.team === 'A' ? 0 : Math.PI,
      aimX: Math.round(x * 100) + ahead,
      aimY: Math.round(y * 100),
      health: DEFAULT_MAX_HEALTH,
      maxHealth: DEFAULT_MAX_HEALTH,
      energy: 0,
      alive: true,
      statuses: [],
    };
  });

  return {
    tick: 0,
    rng: seed >>> 0,
    arena: JSON.parse(JSON.stringify(arena)) as ArenaDef,
    champions,
    events: [],
  };
}
