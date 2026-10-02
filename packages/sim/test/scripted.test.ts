// Scripted combat fixture test.
//
// The fixture runs 600 ticks on arena01 with four champions. `segments` hold the inputs as
// in the replay fixture: a segment holds its inputs for `ticks` ticks, an entry is
// [moveX, moveY, aimX, aimY, buttons], or null for a missing input. `actions` drive the
// combat toolkit directly, because no ability calls it yet: an action runs when
// `state.tick === tick`, before that tick's step, in array order. Types are `projectile`
// and `area` (the spec of spawnProjectile and spawnArea), `damage` and `heal` (`targetId`,
// `amount`, `sourceId`). `checkpoints` hold the checksum after the step that makes
// `state.tick` equal to `tick`; `checksum` is the one after the last tick.
//
// How the committed checksums were generated: author the fixture with every checksum set
// to 0, run `npx vitest run --project sim packages/sim/test/scripted.test.ts`, copy the actual
// values from the failing checkpoint and checksum assertions into the fixture, and rerun
// until it is green. There is no writer script. Changing gameplay on purpose means
// regenerating it the same way in the same change. The checkpoints at ticks 200 to 600 and
// the final checksum were regenerated once for batch #23 decision 9 (CI run 36947793538),
// when facing moved to `dmath.atan2`.
//
// "Replay once in a separate process" is met by the committed checksums, which the authoring
// run produced, plus every CI run that replays them again. The coverage test fails if the
// script stops exercising something the plan requires.
import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/scripted-arena01-2v2.json';
import { checksum, cloneState, createMatch, step } from '../src/index';
import type { GameState, MatchConfig, PlayerInput, SimEvent } from '../src/index';
import { spawnArea } from '../src/area';
import type { AreaSpec } from '../src/area';
import { applyDamage, applyHeal } from '../src/health';
import { spawnProjectile } from '../src/projectile';
import type { ProjectileSpec } from '../src/projectile';
import { arena01, checkInvariants } from './helpers';

type Entry = [number, number, number, number, number] | null;

interface Segment {
  ticks: number;
  inputs: Entry[];
}

interface Action {
  tick: number;
  type: 'projectile' | 'area' | 'damage' | 'heal';
  spec: Record<string, unknown>;
}

interface Checkpoint {
  tick: number;
  checksum: number;
}

interface Fixture {
  format: 1;
  arena: 'arena01';
  seed: number;
  config: MatchConfig;
  ticks: number;
  segments: Segment[];
  actions: Action[];
  checkpoints: Checkpoint[];
  checksum: number;
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function decodeFixture(data: unknown): Fixture {
  const f = data as Fixture;
  if (f.format !== 1) throw new Error('fixture format must be 1');
  if (f.arena !== 'arena01') throw new Error('fixture arena must be arena01');
  if (!isInt(f.seed)) throw new Error('fixture seed must be an integer');
  if (!isInt(f.checksum)) throw new Error('fixture checksum must be an integer');
  let total = 0;
  f.segments.forEach((segment, s) => {
    if (!isInt(segment.ticks) || segment.ticks <= 0) throw new Error(`segment ${s}: bad ticks`);
    if (segment.inputs.length !== f.config.players.length) {
      throw new Error(`segment ${s}: expected ${f.config.players.length} inputs`);
    }
    for (const entry of segment.inputs) {
      if (entry === null) continue;
      const [moveX, moveY, , , buttons] = entry;
      const ok =
        entry.length === 5 &&
        entry.every(isInt) &&
        Math.abs(moveX) <= 1 &&
        Math.abs(moveY) <= 1 &&
        buttons >= 0 &&
        buttons <= 255;
      if (!ok) throw new Error(`segment ${s}: bad input ${JSON.stringify(entry)}`);
    }
    total += segment.ticks;
  });
  if (total !== f.ticks) throw new Error(`segment ticks sum to ${total}, expected ${f.ticks}`);
  if (f.ticks < 600) throw new Error('fixture must run at least 600 ticks');
  let previous = 0;
  for (const action of f.actions) {
    if (!isInt(action.tick) || action.tick < previous || action.tick >= f.ticks) {
      throw new Error(`action at tick ${action.tick} is out of order or range`);
    }
    if (!['projectile', 'area', 'damage', 'heal'].includes(action.type)) {
      throw new Error(`unknown action type ${action.type}`);
    }
    previous = action.tick;
  }
  const expected = Array.from({ length: f.ticks / 100 }, (_, i) => (i + 1) * 100);
  if (f.checkpoints.map((c) => c.tick).join() !== expected.join()) {
    throw new Error('checkpoints must be every 100 ticks');
  }
  return f;
}

function toInput(entry: Entry): PlayerInput | undefined {
  if (entry === null) return undefined;
  const [moveX, moveY, aimX, aimY, buttons] = entry;
  return { moveX: moveX as -1 | 0 | 1, moveY: moveY as -1 | 0 | 1, aimX, aimY, buttons };
}

const fixture = decodeFixture(fixtureJson);

/** The decoded inputs for every tick, so a replay can start at any tick. */
const inputsByTick: (PlayerInput | undefined)[][] = fixture.segments.flatMap((segment) =>
  Array.from({ length: segment.ticks }, () => segment.inputs.map(toInput)),
);

function runAction(state: GameState, action: Action): void {
  const spec = action.spec;
  if (action.type === 'projectile') spawnProjectile(state, spec as unknown as ProjectileSpec);
  else if (action.type === 'area') spawnArea(state, spec as unknown as AreaSpec);
  else {
    const { targetId, amount, sourceId } = spec as Record<string, number>;
    const apply = action.type === 'damage' ? applyDamage : applyHeal;
    apply(state, targetId as number, amount as number, sourceId as number);
  }
}

interface Observer {
  /** Before the actions of the tick the state is about to run. */
  beforeTick?: (state: GameState) => void;
  /** After an action; `events` are the ones that action appended. */
  afterAction?: (state: GameState, events: SimEvent[]) => void;
  /** After a step; `events` are the events of that step. */
  afterStep?: (state: GameState, inputs: (PlayerInput | undefined)[]) => void;
}

/** Plays the fixture from `state` (at tick `from`) to the end. */
function play(state: GameState, from = 0, observer: Observer = {}): GameState {
  for (let tick = from; tick < fixture.ticks; tick++) {
    observer.beforeTick?.(state);
    for (const action of fixture.actions) {
      if (action.tick !== tick) continue;
      const before = state.events.length;
      runAction(state, action);
      observer.afterAction?.(state, state.events.slice(before));
    }
    const inputs = inputsByTick[tick] as (PlayerInput | undefined)[];
    step(state, inputs);
    observer.afterStep?.(state, inputs);
  }
  return state;
}

function start(): GameState {
  return createMatch(fixture.config, arena01, fixture.seed);
}

function findNegativeZero(value: unknown, path: string): string[] {
  if (typeof value === 'number') return Object.is(value, -0) ? [path] : [];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => findNegativeZero(item, `${path}.${key}`));
}

interface Frozen {
  x: number;
  y: number;
  aimX: number;
  aimY: number;
  facing: number;
}

/** Checks the invariants after every action and step; returns the problems found. */
class InvariantWatcher {
  problems: string[] = [];
  deaths = new Map<number, number>();
  private frozen = new Map<number, Frozen>();
  private health: number[];
  private spawned = new Set<number>();
  private expired = new Map<number, number>();

  constructor(initial: GameState) {
    this.health = initial.champions.map((c) => c.health);
  }

  private check(condition: boolean, message: string, state: GameState): void {
    if (!condition) this.problems.push(`tick ${state.tick}: ${message}`);
  }

  after(state: GameState, events: SimEvent[]): void {
    this.problems.push(...checkInvariants(state));
    this.champions(state, events);
    this.entities(state, events);
    const negative = findNegativeZero(state, 'state');
    this.check(negative.length === 0, `-0 at ${negative.join(', ')}`, state);
    try {
      expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
    } catch (error) {
      this.problems.push(`tick ${state.tick}: JSON round trip changed the state: ${String(error)}`);
    }
    try {
      checksum(state);
    } catch (error) {
      this.problems.push(`tick ${state.tick}: checksum threw ${String(error)}`);
    }
  }

  private champions(state: GameState, events: SimEvent[]): void {
    const running = [...this.health];
    for (const event of events) {
      if (event.type === 'death') {
        this.deaths.set(event.targetId, (this.deaths.get(event.targetId) ?? 0) + 1);
      }
      if (event.type !== 'damage' && event.type !== 'heal') continue;
      const sign = event.type === 'damage' ? -1 : 1;
      running[event.targetId] = (running[event.targetId] ?? 0) + sign * event.amount;
      this.check(
        running[event.targetId] === event.health,
        `${event.type} event health ${event.health} does not follow from the amounts`,
        state,
      );
    }
    for (const c of state.champions) {
      this.check(c.health >= 0 && c.health <= c.maxHealth, `champion ${c.id} health ${c.health}`, state);
      this.check(c.alive === c.health > 0, `champion ${c.id} alive does not match health`, state);
      this.check(c.health === running[c.id], `champion ${c.id} health is not conserved`, state);
      this.health[c.id] = c.health;
      const frozen = this.frozen.get(c.id);
      if (c.alive) {
        this.check(frozen === undefined, `champion ${c.id} revived`, state);
        continue;
      }
      if (!frozen) {
        this.frozen.set(c.id, { x: c.x, y: c.y, aimX: c.aimX, aimY: c.aimY, facing: c.facing });
      } else {
        this.check(
          c.x === frozen.x &&
            c.y === frozen.y &&
            c.aimX === frozen.aimX &&
            c.aimY === frozen.aimY &&
            c.facing === frozen.facing,
          `dead champion ${c.id} changed`,
          state,
        );
      }
      this.check(c.vx === 0 && c.vy === 0, `dead champion ${c.id} has a velocity`, state);
    }
    for (const [id, count] of this.deaths) {
      this.check(count <= 1, `champion ${id} died ${count} times`, state);
    }
  }

  private entities(state: GameState, events: SimEvent[]): void {
    for (const event of events) {
      if (event.type === 'projectileSpawned') this.spawned.add(event.projectileId);
      if (event.type === 'areaSpawned') this.spawned.add(event.areaId);
      const ended =
        event.type === 'projectileExpired' ? event.projectileId : event.type === 'areaExpired' ? event.areaId : -1;
      if (ended >= 0) this.expired.set(ended, (this.expired.get(ended) ?? 0) + 1);
    }
    const { width, height } = state.arena.size;
    const first = state.champions.length;
    const ascending = (ids: number[]) => ids.every((id, i) => i === 0 || id > (ids[i - 1] as number));
    const projectileIds = state.projectiles.map((p) => p.id);
    const areaIds = state.areas.map((a) => a.id);
    this.check(ascending(projectileIds), 'projectile ids are not ascending', state);
    this.check(ascending(areaIds), 'area ids are not ascending', state);
    const all = [...projectileIds, ...areaIds];
    this.check(new Set(all).size === all.length, 'entity ids repeat', state);
    this.check(
      all.every((id) => id >= first && id < state.nextEntityId),
      'entity id out of range',
      state,
    );
    for (const p of state.projectiles) {
      this.check(Math.abs(p.x) <= width / 2 && Math.abs(p.y) <= height / 2, `projectile ${p.id} outside`, state);
      this.check(p.remainingTicks >= 1, `projectile ${p.id} remainingTicks ${p.remainingTicks}`, state);
      this.check(new Set(p.hitIds).size === p.hitIds.length, `projectile ${p.id} hitIds repeat`, state);
      for (const id of p.hitIds) {
        const target = state.champions[id];
        this.check(target !== undefined && target.team !== p.team, `projectile ${p.id} hit ally ${id}`, state);
      }
    }
    for (const a of state.areas) {
      this.check(a.remainingTicks >= 1, `area ${a.id} remainingTicks ${a.remainingTicks}`, state);
      this.check(
        a.ticksToNextApply >= 0 && a.ticksToNextApply < a.intervalTicks,
        `area ${a.id} ticksToNextApply ${a.ticksToNextApply}`,
        state,
      );
    }
    const live = new Set(all);
    for (const id of this.spawned) {
      const ended = this.expired.get(id) ?? 0;
      this.check(live.has(id) ? ended === 0 : ended === 1, `entity ${id} lifecycle (expired ${ended}x)`, state);
    }
  }
}

describe('scripted combat fixture', () => {
  it('keeps every invariant after every action and every step', () => {
    const state = start();
    const watcher = new InvariantWatcher(state);
    let steps = 0;
    play(state, 0, {
      afterAction: (s, events) => watcher.after(s, events),
      afterStep: (s) => {
        steps++;
        watcher.after(s, s.events);
      },
    });
    expect(steps).toBe(fixture.ticks);
    expect(watcher.problems).toEqual([]);
  });

  it('exercises everything the plan requires', () => {
    const allEvents: SimEvent[] = [];
    const overlapTick = new Map<number, number>();
    const hitTick = new Map<number, number>();
    let deadInput = false;
    const nonBlocking = arena01.obstacles.filter((o) => !o.blocksProjectiles);
    const overlaps = (x: number, y: number, r: number) =>
      nonBlocking.some((o) => {
        if (o.type === 'circle') return Math.hypot(x - o.x, y - o.y) <= o.r + r;
        const gapX = Math.max(Math.abs(x - o.x) - o.w / 2, 0);
        const gapY = Math.max(Math.abs(y - o.y) - o.h / 2, 0);
        return Math.hypot(gapX, gapY) <= r;
      });
    const note = (s: GameState, events: SimEvent[]) => {
      allEvents.push(...events);
      for (const e of events) {
        if (e.type === 'projectileHit' && !hitTick.has(e.projectileId)) hitTick.set(e.projectileId, s.tick);
      }
    };
    let aliveBefore: boolean[] = [];
    play(start(), 0, {
      beforeTick: (s) => {
        aliveBefore = s.champions.map((c) => c.alive);
      },
      afterAction: (s, events) => note(s, events),
      afterStep: (s, inputs) => {
        note(s, s.events);
        for (const p of s.projectiles) {
          if (overlaps(p.x, p.y, p.radius) && !overlapTick.has(p.id)) overlapTick.set(p.id, s.tick);
        }
        s.champions.forEach((_, i) => {
          const input = inputs[i];
          if (aliveBefore[i] === false && input && (input.moveX !== 0 || input.moveY !== 0)) {
            deadInput = true;
          }
        });
      },
    });

    const everyType: Record<SimEvent['type'], true> = {
      projectileSpawned: true,
      projectileHit: true,
      projectileExpired: true,
      areaSpawned: true,
      areaTick: true,
      areaExpired: true,
      damage: true,
      heal: true,
      death: true,
    };
    const seen = new Set(allEvents.map((e) => e.type));
    expect(Object.keys(everyType).filter((type) => !seen.has(type as SimEvent['type']))).toEqual([]);

    const reasons = new Set(
      allEvents.flatMap((e) => (e.type === 'projectileExpired' ? [e.reason] : [])),
    );
    expect([...reasons].sort()).toEqual(['boundary', 'hit', 'lifetime', 'obstacle']);

    const hitsPerProjectile = new Map<number, number>();
    for (const e of allEvents) {
      if (e.type === 'projectileHit') {
        hitsPerProjectile.set(e.projectileId, (hitsPerProjectile.get(e.projectileId) ?? 0) + 1);
      }
    }
    expect(Math.max(...hitsPerProjectile.values())).toBeGreaterThanOrEqual(2);

    const overlappedThenHit = [...overlapTick].filter(
      ([id, tick]) => (hitTick.get(id) ?? -1) > tick,
    );
    expect(overlappedThenHit.length).toBeGreaterThan(0);

    expect(allEvents.filter((e) => e.type === 'death')).toHaveLength(1);
    expect(allEvents.some((e) => e.type === 'heal' && e.health === 120 && e.amount > 0)).toBe(true);
    const tickSizes = allEvents.flatMap((e) => (e.type === 'areaTick' ? [e.targetIds.length] : []));
    expect(tickSizes).toContain(0);
    expect(Math.max(...tickSizes)).toBeGreaterThanOrEqual(2);
    expect(deadInput).toBe(true);
  });

  it('matches the committed checkpoints', () => {
    const actual: Checkpoint[] = [];
    play(start(), 0, {
      afterStep: (s) => {
        if (s.tick % 100 === 0) actual.push({ tick: s.tick, checksum: checksum(s) });
      },
    });
    expect(actual).toEqual(fixture.checkpoints);
  });

  it('reproduces the committed checksum', () => {
    expect(checksum(play(start()))).toBe(fixture.checksum);
  });

  it('gives the same checksum when replayed twice in one process', () => {
    expect(checksum(play(start()))).toBe(checksum(play(start())));
  });

  it('continues identically from a clone taken while projectiles and areas are live', () => {
    const state = start();
    let copy: GameState | undefined;
    let cloneTick = -1;
    // Take the clone at the start of the first tick that has both, before its actions.
    const original = play(state, 0, {
      beforeTick: (s) => {
        if (!copy && s.projectiles.length > 0 && s.areas.length > 0) {
          copy = cloneState(s);
          cloneTick = s.tick;
        }
      },
    });
    expect(copy).toBeDefined();
    if (!copy) return;
    expect(copy.projectiles.length).toBeGreaterThan(0);
    expect(copy.areas.length).toBeGreaterThan(0);
    expect(checksum(play(copy, cloneTick))).toBe(checksum(original));
  });
});
