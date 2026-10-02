import { describe, expect, it } from 'vitest';
import { checksum, cloneState, createMatch } from '../src/index';
import type { GameState } from '../src/index';
import { fnv1a32 } from '../src/checksum';
import { spawnArea } from '../src/area';
import { startDash } from '../src/motion';
import { spawnProjectile } from '../src/projectile';
import { applyKnockback, applyShield, applyStatus } from '../src/status';
import { arena01, config2v2 } from './helpers';

function fresh(): GameState {
  return createMatch(config2v2(), arena01, 1337);
}

describe('fnv1a32', () => {
  it('matches the published vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
});

describe('checksum', () => {
  it('returns a uint32', () => {
    const sum = checksum(fresh());
    expect(Number.isInteger(sum)).toBe(true);
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(sum).toBeLessThanOrEqual(0xffffffff);
  });

  it('is the same for equal states', () => {
    expect(checksum(fresh())).toBe(checksum(fresh()));
  });

  it('ignores object key order', () => {
    const state = fresh();
    const reordered = JSON.parse(JSON.stringify(state)) as GameState;
    reordered.champions = reordered.champions.map(
      (c) => Object.fromEntries(Object.entries(c).reverse()) as typeof c,
    );
    reordered.arena = Object.fromEntries(Object.entries(reordered.arena).reverse()) as typeof reordered.arena;
    expect(checksum(reordered)).toBe(checksum(state));
  });

  it('changes when a champion field changes', () => {
    const state = fresh();
    const before = checksum(state);
    const champion = state.champions[1];
    if (!champion) throw new Error('missing champion');
    champion.x += 1e-9;
    expect(checksum(state)).not.toBe(before);
  });

  it('changes when the tick, the rng or the arena changes', () => {
    const base = checksum(fresh());
    const tick = fresh();
    tick.tick = 1;
    expect(checksum(tick)).not.toBe(base);
    const rng = fresh();
    rng.rng += 1;
    expect(checksum(rng)).not.toBe(base);
    const arena = fresh();
    const obstacle = arena.arena.obstacles[0];
    if (!obstacle) throw new Error('missing obstacle');
    obstacle.height += 1;
    expect(checksum(arena)).not.toBe(base);
  });

  it('depends on array order', () => {
    const state = fresh();
    state.champions.reverse();
    expect(checksum(state)).not.toBe(checksum(fresh()));
  });

  it('throws on NaN and infinity', () => {
    const nan = fresh();
    const champion = nan.champions[0];
    if (!champion) throw new Error('missing champion');
    champion.vx = NaN;
    expect(() => checksum(nan)).toThrow('non-finite');
    champion.vx = Infinity;
    expect(() => checksum(nan)).toThrow('non-finite');
  });

  it('throws on values that are not plain JSON', () => {
    const state = fresh() as unknown as { champions: Record<string, unknown>[] };
    const champion = state.champions[0];
    if (!champion) throw new Error('missing champion');
    champion['extra'] = undefined;
    expect(() => checksum(state as unknown as GameState)).toThrow('undefined');
    champion['extra'] = () => 1;
    expect(() => checksum(state as unknown as GameState)).toThrow('function');
    champion['extra'] = 1n;
    expect(() => checksum(state as unknown as GameState)).toThrow('bigint');
  });
});

describe('checksum of combat state', () => {
  function armed(): GameState {
    const state = fresh();
    spawnProjectile(state, {
      ownerId: 0, x: -5, y: 0, dirX: 1, dirY: 0, speed: 25, radius: 0.2,
      lifetimeTicks: 60, pierce: true, effects: [{ type: 'damage', amount: 10 }],
    });
    spawnArea(state, {
      ownerId: 2, x: 3, y: 4, radius: 2, durationTicks: 60, intervalTicks: 30,
      targets: 'all', effects: [{ type: 'heal', amount: 5 }],
    });
    const projectile = state.projectiles[0];
    if (!projectile) throw new Error('missing projectile');
    projectile.hitIds.push(2);
    return state;
  }

  it('is stable for equal states and changes with each new field', () => {
    const base = checksum(armed());
    expect(checksum(armed())).toBe(base);
    const mutations: [string, (s: GameState) => void][] = [
      ['projectile x', (s) => void (s.projectiles[0]!.x += 1e-9)],
      ['projectile remainingTicks', (s) => void (s.projectiles[0]!.remainingTicks -= 1)],
      ['projectile effect amount', (s) => void ((s.projectiles[0]!.effects[0] as { amount: number }).amount += 1)],
      ['projectile hitIds entry', (s) => void (s.projectiles[0]!.hitIds[0] = 3)],
      ['area radius', (s) => void (s.areas[0]!.radius += 1e-9)],
      ['area targets', (s) => void (s.areas[0]!.targets = 'enemies')],
      ['area ticksToNextApply', (s) => void (s.areas[0]!.ticksToNextApply += 1)],
      ['nextEntityId', (s) => void (s.nextEntityId += 1)],
      ['events', (s) => void s.events.push({ type: 'areaExpired', areaId: 5 })],
    ];
    for (const [name, mutate] of mutations) {
      const state = armed();
      mutate(state);
      expect(checksum(state), name).not.toBe(base);
    }
  });

  it('throws on a NaN projectile coordinate', () => {
    const state = armed();
    state.projectiles[0]!.y = NaN;
    expect(() => checksum(state)).toThrow('non-finite');
  });

  it('survives a clone with live projectiles and areas', () => {
    const state = armed();
    expect(checksum(cloneState(state))).toBe(checksum(state));
  });
});

describe('cloneState', () => {
  it('returns an equal copy with an equal checksum', () => {
    const state = fresh();
    const copy = cloneState(state);
    expect(copy).toEqual(state);
    expect(copy).not.toBe(state);
    expect(checksum(copy)).toBe(checksum(state));
  });

  it('is independent of the original', () => {
    const state = fresh();
    const before = checksum(state);
    const copy = cloneState(state);
    const champion = copy.champions[0];
    const obstacle = copy.arena.obstacles[0];
    if (!champion || !obstacle) throw new Error('missing data');
    champion.x = 99;
    obstacle.x = 99;
    copy.tick = 99;
    copy.arena.spawns.teamA.length = 0;
    expect(checksum(state)).toBe(before);
  });
});

describe('checksum of status and dash state', () => {
  const NONE = { sourceId: 0, slot: null } as const;

  function loaded(): GameState {
    const state = fresh();
    applyStatus(state, 2, { type: 'stun', ticks: 60 }, NONE);
    applyStatus(state, 2, { type: 'slow', percent: 30, ticks: 90 }, { sourceId: 1, slot: 'Q' });
    applyStatus(state, 2, { type: 'dot', perPulse: 5, ticks: 90 }, NONE);
    applyShield(state, 2, { absorb: 20, ticks: 200 }, NONE);
    applyKnockback(state, 3, { dirX: 1, dirY: 0, distance: 2, ticks: 8 }, NONE);
    startDash(state, 0, { dirX: 1, dirY: 0, distance: 3, ticks: 6 });
    return state;
  }

  it('is stable for equal states and changes with each status and dash field', () => {
    const base = checksum(loaded());
    expect(checksum(loaded())).toBe(base);
    const mutations: [string, (s: GameState) => void][] = [
      ['status remainingTicks', (s) => void (s.champions[2]!.statuses[0]!.remainingTicks -= 1)],
      ['status source', (s) => void (s.champions[2]!.statuses[0]!.sourceId = 3)],
      ['status slot', (s) => void (s.champions[2]!.statuses[1]!.slot = 'E')],
      ['slow percent', (s) => void ((s.champions[2]!.statuses[1] as { percent: number }).percent += 1)],
      ['dot ticksToNextPulse', (s) => void ((s.champions[2]!.statuses[2] as { ticksToNextPulse: number }).ticksToNextPulse -= 1)],
      ['dot perPulse', (s) => void ((s.champions[2]!.statuses[2] as { perPulse: number }).perPulse += 1)],
      ['shield absorb', (s) => void ((s.champions[2]!.statuses[3] as { absorb: number }).absorb -= 1)],
      ['knockback direction', (s) => void ((s.champions[3]!.statuses[0] as { dirY: number }).dirY = 1)],
      ['knockback distance', (s) => void ((s.champions[3]!.statuses[0] as { distance: number }).distance += 1)],
      ['knockback totalTicks', (s) => void ((s.champions[3]!.statuses[0] as { totalTicks: number }).totalTicks += 1)],
      ['status order', (s) => void s.champions[2]!.statuses.reverse()],
      ['dash ticksLeft', (s) => void (s.champions[0]!.dash!.ticksLeft -= 1)],
      ['dash stepLength', (s) => void (s.champions[0]!.dash!.stepLength += 1e-9)],
      ['dash direction', (s) => void (s.champions[0]!.dash!.dirY = 1)],
      ['no dash', (s) => void (s.champions[0]!.dash = null)],
    ];
    for (const [name, mutate] of mutations) {
      const state = loaded();
      mutate(state);
      expect(checksum(state), name).not.toBe(base);
    }
  });

  it('survives a clone with live statuses and a dash', () => {
    const state = loaded();
    expect(checksum(cloneState(state))).toBe(checksum(state));
    expect(cloneState(state)).toEqual(state);
  });
});
