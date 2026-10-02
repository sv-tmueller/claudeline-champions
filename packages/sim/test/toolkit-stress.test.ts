// A seeded random run of the whole A1 toolkit on arena01: every status, dashes, knockbacks,
// teleports, melee arcs, damage and heal, with random walking. After every call and every step it
// checks the collision and status oracles, that nothing is -0 or NaN, that the state survives a JSON
// round trip, and that every status that opened closes exactly once.
import { describe, expect, it } from 'vitest';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, PlayerInput, SimEvent, StatusSpec } from '../src/index';
import { applyDamage, applyHeal } from '../src/health';
import { meleeArc } from '../src/melee';
import { startDash, teleport } from '../src/motion';
import { nextRandom } from '../src/rng';
import { applyKnockback, applyShield, applyStatus } from '../src/status';
import { SLOTS } from '../src/input';
import { arena01, checkInvariants, checkStatusInvariants, config2v2, findNegativeZero } from './helpers';

const TICKS = 4000;

interface Run {
  state: GameState;
  /** Open minus closed statuses per `target/type`, and the dashes in flight per champion. */
  open: Map<string, number>;
  dashes: Map<number, number>;
  seen: Set<SimEvent['type']>;
  endReasons: Set<string>;
  problems: string[];
}

function pick<T>(state: GameState, items: readonly T[]): T {
  return items[Math.floor(nextRandom(state) * items.length)] as T;
}

function between(state: GameState, lo: number, hi: number): number {
  return lo + Math.floor(nextRandom(state) * (hi - lo + 1));
}

function randomSpec(state: GameState): StatusSpec {
  const type = pick(state, ['stun', 'root', 'silence', 'invulnerable', 'slow', 'haste', 'dot', 'hot'] as const);
  const ticks = between(state, 1, 200);
  if (type === 'slow' || type === 'haste') return { type, percent: between(state, 1, 100), ticks };
  if (type === 'dot' || type === 'hot') return { type, perPulse: between(state, 1, 12), ticks };
  return { type, ticks };
}

function act(state: GameState): void {
  const target = between(state, 0, 3);
  const source = { sourceId: between(state, 0, 3), slot: pick(state, [null, ...SLOTS]) };
  const dirX = between(state, -10, 10);
  const dirY = between(state, -10, 10);
  switch (between(state, 0, 9)) {
    case 0:
    case 1:
      applyStatus(state, target, randomSpec(state), source);
      break;
    case 2:
      applyShield(state, target, { absorb: between(state, 1, 60), ticks: between(state, 1, 300) }, source);
      break;
    case 3:
      if (dirX !== 0 || dirY !== 0) {
        applyKnockback(state, target, { dirX, dirY, distance: between(state, 1, 8), ticks: between(state, 1, 15) }, source);
      }
      break;
    case 4:
      if (dirX !== 0 || dirY !== 0) {
        startDash(state, target, { dirX, dirY, distance: between(state, 1, 8), ticks: between(state, 1, 12) });
        // Often follow it with stun or root, so a dash ends that way and not only by luck.
        const hostile = nextRandom(state);
        if (hostile < 0.2) applyStatus(state, target, { type: 'stun', ticks: between(state, 1, 40) }, source);
        else if (hostile < 0.4) applyStatus(state, target, { type: 'root', ticks: between(state, 1, 40) }, source);
      }
      break;
    case 5:
      teleport(state, target, between(state, -160, 160) / 10, between(state, -110, 110) / 10);
      break;
    case 6:
      applyDamage(state, target, between(state, 10, 90), source.sourceId);
      break;
    case 7:
      applyHeal(state, target, between(state, 1, 40), source.sourceId);
      break;
    case 8:
      if (dirX !== 0 || dirY !== 0) {
        const owner = state.champions[target];
        meleeArc(state, {
          ownerId: target,
          x: owner?.x ?? 0,
          y: owner?.y ?? 0,
          dirX,
          dirY,
          radius: between(state, 1, 4),
          cosHalfAngle: pick(state, [-1, -0.5, 0, 0.5, 0.9]),
          effects: [
            { type: 'damage', amount: between(state, 1, 20) },
            { type: 'knockback', distance: between(state, 1, 5), ticks: between(state, 1, 10), direction: pick(state, ['away', 'toward'] as const) },
          ],
        });
      }
      break;
    default:
      break;
  }
}

function inputs(state: GameState): PlayerInput[] {
  return state.champions.map(() => ({
    moveX: pick(state, [-1, 0, 1] as const),
    moveY: pick(state, [-1, 0, 1] as const),
    aimX: between(state, -1500, 1500),
    aimY: between(state, -1000, 1000),
    buttons: 0,
  }));
}

function note(run: Run, events: readonly SimEvent[]): void {
  for (const e of events) {
    run.seen.add(e.type);
    if (e.type === 'statusApplied') {
      const key = `${e.targetId}/${e.status}`;
      run.open.set(key, (run.open.get(key) ?? 0) + 1);
    } else if (e.type === 'statusExpired') {
      const key = `${e.targetId}/${e.status}`;
      run.open.set(key, (run.open.get(key) ?? 0) - 1);
      run.endReasons.add(`${e.status}:${e.reason}`);
    } else if (e.type === 'dashStarted') {
      run.dashes.set(e.championId, (run.dashes.get(e.championId) ?? 0) + 1);
    } else if (e.type === 'dashEnded') {
      run.dashes.set(e.championId, (run.dashes.get(e.championId) ?? 0) - 1);
      run.endReasons.add(`dash:${e.reason}`);
    }
  }
}

/** `blocked[id]` says the champion could not walk when the step began. */
function verify(run: Run, afterStep: boolean, blocked?: boolean[]): void {
  const { state } = run;
  const where = `tick ${state.tick}${afterStep ? ' after step' : ' after call'}`;
  run.problems.push(...checkInvariants(state), ...checkStatusInvariants(state));
  const negative = findNegativeZero(state, 'state');
  if (negative.length > 0) run.problems.push(`${where}: -0 at ${negative.join(', ')}`);
  try {
    checksum(state);
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  } catch (error) {
    run.problems.push(`${where}: ${String(error)}`);
  }
  for (const c of state.champions) {
    for (const type of ['stun', 'root', 'slow', 'haste', 'silence', 'invulnerable', 'shield', 'dot', 'hot', 'knockback']) {
      const count = c.statuses.filter((s) => s.type === type).length;
      const open = run.open.get(`${c.id}/${type}`) ?? 0;
      if (count !== open) run.problems.push(`${where}: champion ${c.id} ${type} has ${count} instances but ${open} open`);
    }
    if ((run.dashes.get(c.id) ?? 0) !== (c.dash ? 1 : 0)) {
      run.problems.push(`${where}: champion ${c.id} dash events do not match the dash record`);
    }
    if (blocked?.[c.id] && c.alive && (c.vx !== 0 || c.vy !== 0 || Object.is(c.vx, -0) || Object.is(c.vy, -0))) {
      run.problems.push(`${where}: champion ${c.id} was blocked from walking but has velocity ${c.vx}, ${c.vy}`);
    }
  }
}

function play(seed: number): Run {
  const state = createMatch(config2v2(), arena01, seed);
  // Enough health that champions live long enough for the statuses to interleave, but still die.
  for (const c of state.champions) c.health = c.maxHealth = 400;
  const run: Run = {
    state,
    open: new Map(),
    dashes: new Map(),
    seen: new Set(),
    endReasons: new Set(),
    problems: [],
  };
  for (let t = 0; t < TICKS; t++) {
    const before = state.events.length;
    if (nextRandom(state) < 0.35) act(state);
    note(run, state.events.slice(before));
    verify(run, false);
    const blocked = state.champions.map(
      (c) => c.statuses.some((s) => s.type === 'stun' || s.type === 'root') || c.dash !== null,
    );
    step(state, inputs(state));
    note(run, state.events);
    verify(run, true, blocked);
  }
  return run;
}

describe('toolkit stress run', () => {
  const run = play(20251002);

  it('keeps every oracle after every call and every step', () => {
    expect(run.problems).toEqual([]);
  });

  it('exercises every status, dash and arc outcome it is meant to', () => {
    const missing = [
      'statusApplied',
      'statusExpired',
      'shieldAbsorbed',
      'meleeArc',
      'teleport',
      'dashStarted',
      'dashEnded',
      'death',
    ].filter((type) => !run.seen.has(type as SimEvent['type']));
    expect(missing).toEqual([]);
    for (const reason of ['expired', 'depleted', 'stopped', 'replaced', 'death']) {
      expect([...run.endReasons].some((r) => r.endsWith(`:${reason}`)), reason).toBe(true);
    }
    for (const reason of ['complete', 'blocked', 'rooted', 'stunned', 'replaced']) {
      expect(run.endReasons.has(`dash:${reason}`), `dash ${reason}`).toBe(true);
    }
  });

  it('gives the same checksum when run twice', () => {
    expect(checksum(play(20251002).state)).toBe(checksum(run.state));
  });

  it('continues identically from a clone', () => {
    const state = createMatch(config2v2(), arena01, 7);
    for (let t = 0; t < 200; t++) {
      if (nextRandom(state) < 0.35) act(state);
      step(state, inputs(state));
    }
    const copy = cloneState(state);
    for (let t = 0; t < 200; t++) {
      if (nextRandom(state) < 0.35) act(state);
      step(state, inputs(state));
      if (nextRandom(copy) < 0.35) act(copy);
      step(copy, inputs(copy));
    }
    expect(checksum(copy)).toBe(checksum(state));
  });
});
