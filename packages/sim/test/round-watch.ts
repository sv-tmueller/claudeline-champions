// Oracles for match flow, for the rounds fixture: a check of the match state alone and a watcher
// that compares each step with the state before it. They deliberately do not import
// `src/flow.ts` or the match constants: every number is written out again here (180 ticks of
// warmup, 180 of pause, a 5400 tick round, a 1800 tick shrink, the 10 / 60 ring charge), so a rule
// that drifts in the source cannot also drift in its own oracle. The ring radii are the exception:
// they come from `state.arena`.
import { checksum } from '../src/index';
import type { ChampionState, GameState, MatchState, SimEvent } from '../src/index';
import { checkAbilityInvariants, checkInvariants, checkStatusInvariants, findNegativeZero } from './helpers';

const PHASES = ['warmup', 'round', 'roundEnd', 'matchEnd'];
const WARMUP = 180;
const PAUSE = 180;
const ROUND = 5400;
const SHRINK = 1800;
const NEAR = 1e-9;

/** The ring radius `e` ticks after sudden death started, by the formula of rules.md 1.1. */
export function ringRadius(state: GameState, e: number): number {
  const { startRadius, endRadius } = state.arena.ring;
  return e >= SHRINK ? endRadius : startRadius + ((endRadius - startRadius) * e) / SHRINK;
}

/** Where champion `id` spawns: the next free spawn of its team, in player order. */
export function spawnOf(state: GameState, id: number): [number, number] {
  const team = (state.champions[id] as ChampionState).team;
  let slot = 0;
  for (const c of state.champions) if (c.id < id && c.team === team) slot++;
  const list = team === 'A' ? state.arena.spawns.teamA : state.arena.spawns.teamB;
  return list[slot] as [number, number];
}

function alive(state: GameState, team: 'A' | 'B'): number {
  return state.champions.filter((c) => c.team === team && c.alive).length;
}

/** Problems with the match state alone: ranges, the phase rules and the ring. One message each. */
export function checkMatchInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const bad = (what: string) => problems.push(`tick ${state.tick}: ${what}`);
  const m = state.match;
  if (m === undefined) return ['state has no match'];
  const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!PHASES.includes(m.phase)) bad(`phase ${String(m.phase)}`);
  if (!isCount(m.phaseTicks)) bad(`phaseTicks ${m.phaseTicks}`);
  if (!isCount(m.round)) bad(`round ${m.round}`);
  if (!isCount(m.roundsToWin) || m.roundsToWin < 1) bad(`roundsToWin ${m.roundsToWin}`);
  if (!isCount(m.score.A) || !isCount(m.score.B)) bad(`score ${JSON.stringify(m.score)}`);
  if (m.score.A + m.score.B > m.round) bad(`score ${m.score.A} : ${m.score.B} after round ${m.round}`);
  if (m.score.A > m.roundsToWin || m.score.B > m.roundsToWin) bad('score above roundsToWin');
  if (Object.keys(m).length !== 6) bad(`match keys ${Object.keys(m).join()}`);

  if (m.phase === 'warmup') {
    if (m.round !== 0) bad(`round ${m.round} in warmup`);
    if (m.phaseTicks > WARMUP - 1) bad(`warmup phaseTicks ${m.phaseTicks}`);
    if (m.score.A !== 0 || m.score.B !== 0) bad('score in warmup');
    if (state.tick !== m.phaseTicks) bad('warmup is not the first phase');
  }
  if (m.phase === 'warmup') {
    for (const c of state.champions) {
      const [x, y] = spawnOf(state, c.id);
      if (c.x !== x || c.y !== y) bad(`champion ${c.id} off its spawn in warmup`);
      if (c.health !== c.maxHealth || !c.alive) bad(`champion ${c.id} not at full health in warmup`);
    }
  }
  if (m.phase === 'round') {
    if (m.round < 1) bad('round phase before round 1');
    if (alive(state, 'A') === 0 || alive(state, 'B') === 0) bad('a team is dead in the round phase');
    const expectRing = m.phaseTicks > ROUND;
    if ((m.ring !== null) !== expectRing) bad(`ring ${m.ring === null ? 'missing' : 'present'} at phaseTicks ${m.phaseTicks}`);
    if (m.ring !== null) {
      if (m.ring.radius !== ringRadius(state, m.phaseTicks - ROUND - 1)) bad(`ring radius ${m.ring.radius}`);
      if (m.ring.x !== 0 || m.ring.y !== 0) bad(`ring centre ${m.ring.x}, ${m.ring.y}`);
      if (m.ring.damagePerTick !== state.arena.ring.damagePerSecond / 60) bad(`ring damage ${m.ring.damagePerTick}`);
    }
  }
  if (m.phase === 'roundEnd' || m.phase === 'matchEnd') {
    if (state.projectiles.length > 0 || state.areas.length > 0) bad(`entities in ${m.phase}`);
    if (state.champions.some((c) => c.cast !== null)) bad(`a windup in ${m.phase}`);
  }
  if (m.phase === 'roundEnd') {
    if (m.phaseTicks < 1 || m.phaseTicks > PAUSE - 1) bad(`roundEnd phaseTicks ${m.phaseTicks}`);
    if (alive(state, 'A') > 0 && alive(state, 'B') > 0) bad('roundEnd with both teams alive');
  }
  if (m.phase === 'matchEnd') {
    const winners = [m.score.A, m.score.B].filter((s) => s === m.roundsToWin).length;
    if (winners !== 1) bad(`matchEnd with score ${m.score.A} : ${m.score.B}`);
    if (m.ring !== null && m.ring.radius < state.arena.ring.endRadius) bad('ring below its end radius');
  }
  if (m.phase !== 'round' && m.phase !== 'roundEnd' && m.phase !== 'matchEnd' && m.ring !== null) bad('ring outside a round');
  return problems;
}

/** The oracles that need only the state: collision, status, ability, match, -0, JSON, checksum. */
export function checkEveryStep(state: GameState): string[] {
  const problems = [
    ...checkInvariants(state),
    ...checkStatusInvariants(state),
    ...checkAbilityInvariants(state),
    ...checkMatchInvariants(state),
  ];
  const negative = findNegativeZero(state, 'state');
  if (negative.length > 0) problems.push(`tick ${state.tick}: -0 at ${negative.join(', ')}`);
  const dynamic = { ...state } as Partial<GameState>;
  delete dynamic.arena;
  delete dynamic.kits;
  try {
    checksum(dynamic as GameState);
    if (JSON.stringify(JSON.parse(JSON.stringify(dynamic))) !== JSON.stringify(dynamic)) {
      problems.push(`tick ${state.tick}: JSON round trip changed the state`);
    }
  } catch (error) {
    problems.push(`tick ${state.tick}: checksum or JSON round trip failed: ${String(error)}`);
  }
  return problems;
}

interface Before {
  champions: ChampionState[];
  match: MatchState;
  nextEntityId: number;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const MATCH_EVENTS = ['roundStarted', 'suddenDeathStarted', 'roundEnded', 'matchEnded'];
const CLASS: Record<string, number> = { roundEnded: 0, castInterrupted: 1, projectileExpired: 2, areaExpired: 3 };

/**
 * Compares each step of a match with flow with the state before it. Call `beforeStep` right before
 * each `step` and `afterStep` right after it.
 */
export class RoundWatcher {
  problems: string[] = [];
  private before: Before | null = null;

  private check(condition: boolean, message: string, state: GameState): void {
    if (!condition) this.problems.push(`tick ${state.tick}: ${message}`);
  }

  beforeStep(state: GameState): void {
    this.before = { champions: copy(state.champions), match: copy(state.match as MatchState), nextEntityId: state.nextEntityId };
  }

  afterStep(state: GameState): void {
    const before = this.before;
    if (!before) throw new Error('afterStep without beforeStep');
    this.before = null;
    const next = state.match as MatchState;
    const prev = before.match;
    const events = state.events;
    const matchEvents = events.filter((e) => MATCH_EVENTS.includes(e.type));

    const only = (type: string): SimEvent | undefined => {
      const found = matchEvents.filter((e) => e.type === type);
      this.check(found.length === 1 && matchEvents.length === 1, `expected exactly one ${type}, got ${matchEvents.map((e) => e.type).join() || 'none'}`, state);
      return found[0];
    };
    const none = () => this.check(matchEvents.length === 0, `unexpected ${matchEvents.map((e) => e.type).join()}`, state);

    const lockedBefore = prev.phase !== 'round';
    let reset = false;
    const transition = `${prev.phase}>${next.phase}`;
    switch (transition) {
      case 'warmup>warmup':
      case 'roundEnd>roundEnd':
      case 'matchEnd>matchEnd':
        none();
        this.check(next.phaseTicks === prev.phaseTicks + 1, `phaseTicks ${prev.phaseTicks} to ${next.phaseTicks}`, state);
        this.check(next.round === prev.round, 'round changed inside a phase', state);
        break;
      case 'warmup>round': {
        const e = only('roundStarted');
        this.check(prev.phaseTicks === WARMUP - 1, `warmup ended at phaseTicks ${prev.phaseTicks}`, state);
        this.check(e?.type === 'roundStarted' && e.round === 1 && next.round === 1, 'round 1 did not start', state);
        reset = true;
        break;
      }
      case 'round>round': {
        const e = matchEvents.filter((x) => x.type === 'suddenDeathStarted');
        this.check(next.phaseTicks === prev.phaseTicks + 1, `phaseTicks ${prev.phaseTicks} to ${next.phaseTicks}`, state);
        this.check(matchEvents.length === e.length, `unexpected ${matchEvents.map((x) => x.type).join()}`, state);
        this.check(e.length === (prev.phaseTicks === ROUND ? 1 : 0), `suddenDeathStarted ${e.length}x at phaseTicks ${prev.phaseTicks}`, state);
        const first = e[0];
        if (first?.type === 'suddenDeathStarted') {
          this.check(first.round === next.round && first.radius === state.arena.ring.startRadius, 'suddenDeathStarted fields', state);
        }
        break;
      }
      case 'round>roundEnd': {
        const e = only('roundEnded');
        this.check(next.phaseTicks === 1, `pause starts at phaseTicks ${next.phaseTicks}`, state);
        const a = alive(state, 'A');
        const b = alive(state, 'B');
        const winner = a > 0 ? 'A' : b > 0 ? 'B' : null;
        this.check(a === 0 || b === 0, 'round ended with both teams alive', state);
        if (e?.type === 'roundEnded') {
          this.check(e.round === prev.round && next.round === prev.round, 'round number', state);
          this.check(e.winner === winner, `winner ${String(e.winner)}, alive ${a} : ${b}`, state);
          const wantA = prev.score.A + (winner === 'A' ? 1 : 0);
          const wantB = prev.score.B + (winner === 'B' ? 1 : 0);
          this.check(e.scoreA === wantA && e.scoreB === wantB && next.score.A === wantA && next.score.B === wantB, 'score after the round', state);
        }
        // After roundEnded come the windups, projectiles and areas, in that order, nothing else.
        const at = events.findIndex((x) => x.type === 'roundEnded');
        let last = 0;
        for (const x of events.slice(at + 1)) {
          const rank = CLASS[x.type];
          this.check(rank !== undefined && rank >= last, `${x.type} after roundEnded out of order`, state);
          if (rank !== undefined) last = rank;
          if (x.type === 'castInterrupted' || x.type === 'projectileExpired') {
            this.check(x.reason === 'roundEnd', `${x.type} reason ${x.reason}`, state);
          }
        }
        this.check(state.projectiles.length === 0 && state.areas.length === 0, 'entities left after the decision', state);
        break;
      }
      case 'roundEnd>round': {
        const e = only('roundStarted');
        this.check(prev.phaseTicks === PAUSE - 1, `pause ended at phaseTicks ${prev.phaseTicks}`, state);
        this.check(prev.score.A < prev.roundsToWin && prev.score.B < prev.roundsToWin, 'round started after the match was won', state);
        this.check(e?.type === 'roundStarted' && e.round === prev.round + 1 && next.round === prev.round + 1, 'next round number', state);
        reset = true;
        break;
      }
      case 'roundEnd>matchEnd': {
        const e = only('matchEnded');
        this.check(prev.phaseTicks === PAUSE - 1, `pause ended at phaseTicks ${prev.phaseTicks}`, state);
        this.check(next.phaseTicks === 0, `matchEnd phaseTicks ${next.phaseTicks}`, state);
        const won = prev.score.A >= prev.roundsToWin ? 'A' : prev.score.B >= prev.roundsToWin ? 'B' : null;
        this.check(won !== null && e?.type === 'matchEnded' && e.winner === won && e.scoreA === prev.score.A && e.scoreB === prev.score.B, 'matchEnded fields', state);
        break;
      }
      default:
        this.problems.push(`tick ${state.tick}: transition ${transition} is not allowed`);
    }
    if (next.score.A < prev.score.A || next.score.B < prev.score.B) this.problems.push(`tick ${state.tick}: the score went down`);
    if (transition !== 'round>roundEnd' && (next.score.A !== prev.score.A || next.score.B !== prev.score.B)) {
      this.problems.push(`tick ${state.tick}: the score changed outside a decision`);
    }
    if (next.roundsToWin !== prev.roundsToWin) this.problems.push(`tick ${state.tick}: roundsToWin changed`);

    if (reset) this.afterReset(state, before);
    else if (lockedBefore) this.afterLockedStep(state, before);
    else this.afterRoundStep(state, before);
  }

  /** A locked step changes no position, health, energy, cooldown, status, dash or windup. */
  private afterLockedStep(state: GameState, before: Before): void {
    state.champions.forEach((c, i) => {
      const was = before.champions[i] as ChampionState;
      const same = (key: keyof ChampionState) => JSON.stringify(c[key]) === JSON.stringify(was[key]);
      for (const key of ['x', 'y', 'health', 'maxHealth', 'energy', 'alive', 'cooldowns', 'statuses', 'dash', 'cast'] as const) {
        this.check(same(key), `champion ${c.id} ${key} changed in a locked step`, state);
      }
      this.check(c.vx === 0 && c.vy === 0, `champion ${c.id} moves in a locked step`, state);
    });
    this.check(state.nextEntityId === before.nextEntityId, 'an entity id was used in a locked step', state);
    this.check(state.events.length === 0 || state.events.every((e) => MATCH_EVENTS.includes(e.type)), 'a non-match event in a locked step', state);
  }

  /** The postconditions of `roundStarted`. */
  private afterReset(state: GameState, before: Before): void {
    const m = state.match as MatchState;
    this.check(m.phase === 'round' && m.phaseTicks === 0 && m.ring === null, 'round start state', state);
    this.check(state.casts.length === 0, 'cast records survived the reset', state);
    this.check(state.projectiles.length === 0 && state.areas.length === 0, 'entities survived the reset', state);
    this.check(state.nextEntityId === before.nextEntityId, 'nextEntityId changed at the reset', state);
    state.champions.forEach((c) => {
      const [x, y] = spawnOf(state, c.id);
      this.check(c.x === x && c.y === y, `champion ${c.id} is not at its spawn`, state);
      this.check(c.health === c.maxHealth && c.alive, `champion ${c.id} is not at full health`, state);
      this.check(c.energy === 0 && c.cooldowns.every((v) => v === 0), `champion ${c.id} keeps energy or a cooldown`, state);
      this.check(c.statuses.length === 0 && c.dash === null && c.cast === null, `champion ${c.id} keeps a status, a dash or a cast`, state);
      this.check(c.vx === 0 && c.vy === 0, `champion ${c.id} has a velocity`, state);
    });
  }

  /** A step of the round phase: health moves only through events, and the ring rules hold. */
  private afterRoundStep(state: GameState, before: Before): void {
    const m = state.match as MatchState;
    const running = before.champions.map((c) => c.health);
    // The ring acts after the combat of the step, so it is the last damage a champion takes in it.
    const deathsByOthers = new Set<number>();
    for (const e of state.events) {
      if (e.type === 'death' && e.sourceId !== -1) deathsByOthers.add(e.targetId);
    }
    let ringHealth: number[] | null = null;
    const ringAfter = new Map<number, number>();
    const ringHits = new Map<number, number>();
    state.events.forEach((e) => {
      if (e.type === 'damage' || e.type === 'heal') {
        const was = running[e.targetId] as number;
        const expected = e.type === 'damage' ? was - e.amount : was + e.amount;
        this.check(Math.abs(expected - e.health) <= NEAR, `${e.type} event of champion ${e.targetId}: ${was} to ${e.health} by ${e.amount}`, state);
        running[e.targetId] = e.health;
        if (e.type === 'damage' && e.sourceId === -1) {
          this.check(!ringHits.has(e.targetId), `champion ${e.targetId} hit by the ring twice`, state);
          ringHits.set(e.targetId, e.amount);
          ringAfter.set(e.targetId, e.health);
          ringHealth ??= [];
          ringHealth[e.targetId] = was;
        }
      }
      if (e.type === 'shieldAbsorbed') this.check(e.sourceId !== -1, 'the ring was absorbed by a shield', state);
    });
    state.champions.forEach((c) => {
      this.check(Math.abs((running[c.id] as number) - c.health) <= NEAR, `champion ${c.id} health ${c.health} differs from the events ${running[c.id]}`, state);
    });

    // Sudden death: every alive, not invulnerable champion outside the ring pays 10 / 60.
    const ring = m.ring;
    const duringRing = ring !== null && before.match.phaseTicks >= ROUND;
    state.champions.forEach((c) => {
      const wasAlive = (before.champions[c.id] as ChampionState).alive;
      const hit = ringHits.get(c.id);
      if (!duringRing || ring === null) {
        this.check(hit === undefined, `ring damage to champion ${c.id} with no ring`, state);
        return;
      }
      const aliveAtRing = wasAlive && !deathsByOthers.has(c.id);
      const outside = c.x * c.x + c.y * c.y > ring.radius * ring.radius;
      const invulnerable = c.statuses.some((s) => s.type === 'invulnerable');
      const takes = aliveAtRing && outside && !invulnerable;
      if (!takes) {
        this.check(hit === undefined, `champion ${c.id} was hurt by the ring but is ${aliveAtRing ? (invulnerable ? 'invulnerable' : 'inside') : 'not alive'}`, state);
        return;
      }
      const have = ringHealth?.[c.id] ?? (running[c.id] as number);
      const want = Math.min(have, 10 / 60);
      // applyDamage with ignoreShields computes the health after exactly this, so no NEAR there.
      const after = ringAfter.get(c.id);
      const exact = after === have - want;
      this.check(
        hit !== undefined && Math.abs(hit - want) <= NEAR && exact,
        `champion ${c.id} took ${String(hit)} from the ring, expected ${want}, health ${String(after)} after it, expected ${have - want}`,
        state,
      );
    });
  }
}
