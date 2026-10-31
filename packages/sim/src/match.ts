import type { ArenaDef } from './arena';
import { DEFAULT_MAX_HEALTH } from './constants';
import { SLOTS } from './input';
import { validateKit } from './kit';
import type { KitDef } from './kit';
import { checkOrbPoint } from './orb';
import type { ChampionState, GameState, MatchConfig, TeamId } from './state';

function fail(problem: string): never {
  throw new Error(`Invalid match: ${problem}`);
}

/**
 * Starts a match. `kits` are the ability kits, plain data: a player whose `championId` equals a
 * kit's id gets that kit's health, speed and abilities, and any other player gets none and the
 * default health and base speed. Every kit given is validated and an id may appear once; the state
 * keeps a copy of the kits the players use, in the order they were given. With `roundsToWin` the
 * match starts in its warmup (see `flow.ts`); without it the match is free play and the state has
 * no `match` key. With `energyOrb` the point is validated, and a match with flow gets the orb.
 */
export function createMatch(
  config: MatchConfig,
  arena: ArenaDef,
  seed: number,
  kits: readonly KitDef[] = [],
): GameState {
  const { teamSize, players, roundsToWin, energyOrb } = config;
  if (teamSize !== 2 && teamSize !== 3) fail('teamSize must be 2 or 3');
  if (players.length !== 2 * teamSize) {
    fail(`expected ${2 * teamSize} players, got ${players.length}`);
  }
  if (!Number.isInteger(seed)) fail('seed must be an integer');
  if (roundsToWin !== undefined && !(Number.isSafeInteger(roundsToWin) && roundsToWin >= 1)) {
    fail('roundsToWin must be a positive integer');
  }
  if (energyOrb !== undefined) {
    const problem = checkOrbPoint(energyOrb, arena);
    if (problem !== undefined) fail(`energyOrb ${problem}`);
  }

  const checked = kits.map((kit) => validateKit(kit));
  const ids = new Set<string>();
  for (const kit of checked) {
    if (ids.has(kit.id)) fail(`duplicate kit id "${kit.id}"`);
    ids.add(kit.id);
  }
  const used = checked.filter((kit) => players.some((p) => p.championId === kit.id));

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
    const kit = used.find((k) => k.id === player.championId);
    const maxHealth = kit ? kit.maxHealth : DEFAULT_MAX_HEALTH;
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
      aimY: Math.round(y * 100) + 0,
      health: maxHealth,
      maxHealth,
      energy: 0,
      alive: true,
      statuses: [],
      dash: null,
      cooldowns: SLOTS.map(() => 0),
      cast: null,
    };
  });

  const state: GameState = {
    tick: 0,
    rng: seed >>> 0,
    arena: JSON.parse(JSON.stringify(arena)) as ArenaDef,
    champions,
    nextEntityId: champions.length,
    projectiles: [],
    areas: [],
    kits: used,
    casts: [],
    events: [],
  };
  // A key that is missing, not undefined, marks free play: checksum and JSON both see the difference.
  if (roundsToWin !== undefined) {
    state.match = {
      phase: 'warmup',
      phaseTicks: 0,
      round: 0,
      roundsToWin,
      score: { A: 0, B: 0 },
      ring: null,
    };
    // Copies plus 0, never the config object, and never a -0.
    if (energyOrb !== undefined) {
      state.match.orb = { x: energyOrb.x + 0, y: energyOrb.y + 0, taken: false };
    }
  }
  return state;
}
