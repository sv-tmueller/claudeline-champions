import { resetAbilityState } from './cast';
import {
  RING_SOURCE_ID,
  ROUND_END_TICKS,
  ROUND_TICKS,
  SUDDEN_DEATH_TICKS,
  TICK_RATE,
  WARMUP_TICKS,
} from './constants';
import { atan2 } from './dmath';
import { applyDamage } from './health';
import type { PlayerInput } from './input';
import { interruptCast } from './state';
import type { AreaState, ChampionState, GameState, MatchState, ProjectileState } from './state';

// Match flow (rules.md section 1), used by `step` only for a match with a `match` record. A match
// without one is free play and never gets here.
//
// This module holds no arrow functions and, in the steady state of a phase, allocates nothing: it
// uses indexed loops and writes into the records that exist. A transition may allocate (events,
// the ring record, the emptied entity arrays).

/** Ends every projectile and area with its event, in id order, and empties both lists. */
function endEntities(state: GameState): void {
  const { projectiles, areas } = state;
  if (projectiles.length > 0) {
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i] as ProjectileState;
      state.events.push({
        type: 'projectileExpired',
        projectileId: p.id,
        reason: 'roundEnd',
        x: p.x,
        y: p.y,
      });
    }
    state.projectiles = [];
  }
  if (areas.length > 0) {
    for (let i = 0; i < areas.length; i++) {
      state.events.push({ type: 'areaExpired', areaId: (areas[i] as AreaState).id });
    }
    state.areas = [];
  }
}

/**
 * Starts a round, the first after the warmup and every later one: leftover entities end, every
 * champion returns to its spawn at full health and alive, the ability state resets, the ring goes
 * and `roundStarted` follows last. The score, the entity ids, the aim and the facing carry over.
 */
function startRound(state: GameState, match: MatchState): void {
  endEntities(state);
  const { champions, arena } = state;
  // The champions take the spawns in team slot order, as `createMatch` placed them.
  let slotA = 0;
  let slotB = 0;
  for (let i = 0; i < champions.length; i++) {
    const champion = champions[i] as ChampionState;
    const slot = champion.team === 'A' ? slotA++ : slotB++;
    const spawns = champion.team === 'A' ? arena.spawns.teamA : arena.spawns.teamB;
    const spawn = spawns[slot] as [number, number];
    champion.x = spawn[0];
    champion.y = spawn[1];
    champion.vx = 0;
    champion.vy = 0;
    champion.health = champion.maxHealth;
    champion.alive = true;
  }
  resetAbilityState(state);
  match.ring = null;
  match.round += 1;
  match.phase = 'round';
  match.phaseTicks = 0;
  state.events.push({ type: 'roundStarted', round: match.round });
}

/**
 * The turn of a locked phase (warmup, round end pause, match end), after the inputs are resolved:
 * an alive champion keeps its aim and facing live and stands still. Nothing else runs. Then the
 * phase clock counts, the phase may end, and the tick advances.
 */
export function stepLocked(
  state: GameState,
  match: MatchState,
  resolved: readonly PlayerInput[],
): void {
  const { champions } = state;
  for (let i = 0; i < champions.length; i++) {
    const champion = champions[i] as ChampionState;
    const input = resolved[champion.id];
    if (!champion.alive || !input) continue;
    champion.aimX = input.aimX;
    champion.aimY = input.aimY;
    champion.vx = 0;
    champion.vy = 0;
    const toAimX = champion.aimX / 100 - champion.x;
    const toAimY = champion.aimY / 100 - champion.y;
    if (toAimX !== 0 || toAimY !== 0) champion.facing = atan2(toAimY, toAimX);
  }

  match.phaseTicks += 1;
  if (match.phase === 'warmup') {
    if (match.phaseTicks >= WARMUP_TICKS) startRound(state, match);
  } else if (match.phase === 'roundEnd' && match.phaseTicks >= ROUND_END_TICKS) {
    const { score, roundsToWin } = match;
    if (score.A >= roundsToWin || score.B >= roundsToWin) {
      state.events.push({
        type: 'matchEnded',
        winner: score.A >= roundsToWin ? 'A' : 'B',
        scoreA: score.A,
        scoreB: score.B,
      });
      match.phase = 'matchEnd';
      match.phaseTicks = 0;
    } else {
      startRound(state, match);
    }
  }
  state.tick += 1;
}

/**
 * Steps 6b and 6c of a round phase step, after the entities expired. Sudden death first: from
 * `ROUND_TICKS` steps on the ring exists, its radius is recomputed from the integer step count
 * and an alive champion whose centre is outside takes its damage. Then the decision.
 */
export function stepRoundEnd(state: GameState, match: MatchState): void {
  const { champions } = state;
  if (match.phaseTicks >= ROUND_TICKS) {
    const e = match.phaseTicks - ROUND_TICKS;
    const { startRadius, endRadius, damagePerSecond } = state.arena.ring;
    let ring = match.ring;
    if (ring === null) {
      ring = { x: 0, y: 0, radius: startRadius, damagePerTick: damagePerSecond / TICK_RATE };
      match.ring = ring;
      state.events.push({ type: 'suddenDeathStarted', round: match.round, radius: startRadius });
    }
    // From the integer step count each time, never built up by subtraction; the hold is exact.
    ring.radius =
      e >= SUDDEN_DEATH_TICKS
        ? endRadius
        : startRadius + ((endRadius - startRadius) * e) / SUDDEN_DEATH_TICKS;
    for (let i = 0; i < champions.length; i++) {
      const champion = champions[i] as ChampionState;
      if (!champion.alive) continue;
      const dx = champion.x - ring.x;
      const dy = champion.y - ring.y;
      // A champion exactly on the radius is inside.
      if (dx * dx + dy * dy > ring.radius * ring.radius) {
        applyDamage(state, champion.id, ring.damagePerTick, RING_SOURCE_ID, true);
      }
    }
  }

  let aliveA = 0;
  let aliveB = 0;
  for (let i = 0; i < champions.length; i++) {
    const champion = champions[i] as ChampionState;
    if (!champion.alive) continue;
    if (champion.team === 'A') aliveA++;
    else aliveB++;
  }
  if (aliveA > 0 && aliveB > 0) return;

  // The round is decided: the team with a champion left wins, no team scores in a draw.
  const { score } = match;
  let winner: 'A' | 'B' | null = null;
  if (aliveA > 0) winner = 'A';
  else if (aliveB > 0) winner = 'B';
  if (winner === 'A') score.A += 1;
  else if (winner === 'B') score.B += 1;
  state.events.push({
    type: 'roundEnded',
    round: match.round,
    winner,
    scoreA: score.A,
    scoreB: score.B,
  });
  for (let i = 0; i < champions.length; i++) {
    interruptCast(state, champions[i] as ChampionState, 'roundEnd');
  }
  endEntities(state);
  match.phase = 'roundEnd';
  // The deciding step is the first of the pause: the clock counts it after this.
  match.phaseTicks = 0;
}
