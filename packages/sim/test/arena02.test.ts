// Arena 2: the definition, its ring and two matches on it.
//
// It reads `data/arenas/arena02.json`, so a change to the file shows up here. It uses the Hargrim and
// Quillon kits of `data/kits` through `validateKit`, for a 2v2 of Hargrim and Quillon on each team,
// and it imports nothing from the other test files but `helpers.ts` and `round-watch.ts`.
//
// The match test runs 3600 ticks with random inputs. The inputs come from `nextRandom` (mulberry32)
// on a holder of this file seeded with SEED, so the state's own random stream is not drawn on. Each champion holds its move,
// aim and buttons and redraws all three with p = 0.15 per tick. An aim goes to a live enemy with
// p = 0.7 and to a random point of the arena otherwise. Each of the seven ability buttons is held
// with p = 0.3. The match seed is SEED too.
//
// SEED was chosen by trying 1, 2, 3 and so on, and 1 is the first that satisfies every pin of the
// match test: a projectile that ends on an obstacle, a champion in contact with an obstacle, and
// damage to a champion, with no oracle problem. It does so with room to spare (96 projectiles that
// end on an obstacle, 686 steps in contact and 40 damage events), and round 1 is decided inside the
// 3600 ticks, so the round reset runs on arena 2 too. No checksum is committed. A later change to a kit
// or to the sim can break the test only through an invariant or a coverage pin, and then the fix is
// a new SEED, with this paragraph updated to say which one and why.
//
// The standoff test is the only one where arena 2's ring runs: every input is missing, so the
// champions stay on their spawns, outside the end circle, and the ring kills all four. The pairs are
// mirrors, so both teams are wiped on the same tick and the round is a draw.
import { describe, expect, it } from 'vitest';
import arena02Json from '../../../data/arenas/arena02.json';
import hargrimJson from '../../../data/kits/hargrim.json';
import quillonJson from '../../../data/kits/quillon.json';
import {
  CHAMPION_RADIUS,
  MAX_ARENA_METERS,
  RING_SOURCE_ID,
  ROUND_TICKS,
  WARMUP_TICKS,
  checksum,
  createMatch,
  hasLineOfSight,
  parseArenaDef,
  step,
} from '../src/index';
import type { ArenaDef, GameState, MatchConfig, PlayerInput, SimEvent } from '../src/index';
import { validateKit } from '../src/kit';
import { nextRandom } from '../src/rng';
import { arena01, contactKinds } from './helpers';
import { RoundWatcher, checkEveryStep } from './round-watch';

const SEED = 1;
const TICKS = 3600;
const REDRAW = 0.15;
const AIM_AT_ENEMY = 0.7;
const HOLD_BUTTON = 0.3;
const SUDDEN_DEATH_AT = WARMUP_TICKS + ROUND_TICKS;
const STANDOFF_CAP = 9000;

const arena02: ArenaDef = parseArenaDef(arena02Json);
const kits = [validateKit(hargrimJson), validateKit(quillonJson)];
const config: MatchConfig = {
  teamSize: 2,
  roundsToWin: 3,
  players: [
    { championId: 'hargrim', team: 'A' },
    { championId: 'quillon', team: 'A' },
    { championId: 'hargrim', team: 'B' },
    { championId: 'quillon', team: 'B' },
  ],
};

function start(arena: ArenaDef = arena02, seed = SEED): GameState {
  return createMatch(config, arena, seed, kits);
}

/** The ring checks a v1 arena must pass. One message per broken rule. */
function ringProblems(def: ArenaDef): string[] {
  const problems: string[] = [];
  const { startRadius, endRadius, damagePerSecond } = def.ring;
  const half = Math.min(def.size.width, def.size.height) / 2;
  if (!(0 < endRadius && endRadius < startRadius && startRadius <= MAX_ARENA_METERS)) {
    problems.push(`radii ${endRadius} and ${startRadius} are not 0 < end < start <= ${MAX_ARENA_METERS}`);
  }
  if (!(Number.isFinite(damagePerSecond) && damagePerSecond > 0)) {
    problems.push(`damagePerSecond ${damagePerSecond} is not finite and above 0`);
  }
  if (endRadius + CHAMPION_RADIUS > half) {
    problems.push(`the end circle plus a champion (${endRadius + CHAMPION_RADIUS}) is wider than the floor (${half})`);
  }
  for (const spawn of [...def.spawns.teamA, ...def.spawns.teamB]) {
    const d = Math.hypot(spawn[0], spawn[1]);
    if (!(endRadius < d && d <= startRadius)) {
      problems.push(`spawn ${spawn.join(',')} is ${d} m from the centre, outside ${endRadius} to ${startRadius}`);
    }
  }
  def.obstacles.forEach((o, i) => {
    const reach =
      o.type === 'circle'
        ? Math.max(Math.hypot(o.x, o.y) - o.r, 0)
        : Math.hypot(Math.max(Math.abs(o.x) - o.w / 2, 0), Math.max(Math.abs(o.y) - o.h / 2, 0));
    if (reach < endRadius) problems.push(`obstacle ${i} reaches inside the end radius (${reach} m from the centre)`);
  });
  return problems;
}

function withRing(ring: Partial<ArenaDef['ring']>): ArenaDef {
  return { ...arena02, ring: { ...arena02.ring, ...ring } };
}

describe('the arena02 definition', () => {
  it('parses to exactly the data file', () => {
    expect(arena02).toStrictEqual(arena02Json);
  });

  it('shares no obstacle with arena01', () => {
    for (const o of arena02.obstacles) expect(arena01.obstacles).not.toContainEqual(o);
  });

  it('gives no spawn of team A a line of sight to a spawn of team B', () => {
    const state = start();
    const seen: string[] = [];
    for (const [ax, ay] of arena02.spawns.teamA) {
      for (const [bx, by] of arena02.spawns.teamB) {
        if (hasLineOfSight(state, { x: ax, y: ay }, { x: bx, y: by })) seen.push(`${ax},${ay} to ${bx},${by}`);
      }
    }
    expect(seen).toEqual([]);
  });

  it('would let spawns see each other without its two central walls', () => {
    const state = start({ ...arena02, obstacles: arena02.obstacles.slice(2) });
    let visible = 0;
    for (const [ax, ay] of arena02.spawns.teamA) {
      for (const [bx, by] of arena02.spawns.teamB) {
        if (hasLineOfSight(state, { x: ax, y: ay }, { x: bx, y: by })) visible++;
      }
    }
    expect(visible).toBeGreaterThan(0);
  });
});

describe('the arena02 ring', () => {
  it('has the v1 values', () => {
    expect(arena02.ring).toStrictEqual({ startRadius: 18, endRadius: 3, damagePerSecond: 10 });
  });

  it('passes every ring check', () => {
    expect(ringProblems(arena02)).toEqual([]);
  });

  it('flags a ring that breaks one rule at a time', () => {
    const pillar = { type: 'circle', x: 0, y: 0, r: 1, height: 2, blocksProjectiles: true } as const;
    const cases: [string, ArenaDef, string][] = [
      ['an end circle that does not fit the floor', withRing({ endRadius: 9.6 }), 'wider than the floor'],
      ['a start radius inside the spawns', withRing({ startRadius: 11 }), 'from the centre'],
      ['an obstacle in the open centre', { ...arena02, obstacles: [...arena02.obstacles, pillar] }, 'inside the end radius'],
      ['a ring that does not shrink', withRing({ endRadius: 18 }), '0 < end < start'],
      ['a ring that does no damage', withRing({ damagePerSecond: 0 }), 'damagePerSecond'],
    ];
    for (const [name, def, problem] of cases) {
      expect(ringProblems(def).join('\n'), name).toContain(problem);
    }
  });

  it('is rejected by parseArenaDef when it does not shrink', () => {
    const json = { ...arena02Json, ring: { ...arena02Json.ring, endRadius: 18 } };
    expect(() => parseArenaDef(json)).toThrow('ring');
  });
});

/** A player per champion that holds its input and redraws it with p = REDRAW each tick. */
class RandomPlayers {
  private readonly random: () => number;
  private readonly held: PlayerInput[];

  constructor(seed: number, count: number) {
    const holder = { rng: seed };
    this.random = () => nextRandom(holder);
    this.held = Array.from({ length: count }, () => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 }));
  }

  next(state: GameState): PlayerInput[] {
    const r = this.random;
    state.champions.forEach((c, i) => {
      if (r() >= REDRAW) return;
      const enemies = state.champions.filter((e) => e.team !== c.team && e.alive);
      let aimX: number;
      let aimY: number;
      if (r() < AIM_AT_ENEMY && enemies.length > 0) {
        const target = enemies[Math.floor(r() * enemies.length)]!;
        aimX = Math.round(target.x * 100);
        aimY = Math.round(target.y * 100);
      } else {
        aimX = Math.round((r() - 0.5) * state.arena.size.width * 100);
        aimY = Math.round((r() - 0.5) * state.arena.size.height * 100);
      }
      let buttons = 0;
      for (let bit = 0; bit < 7; bit++) if (r() < HOLD_BUTTON) buttons |= 1 << bit;
      this.held[i] = {
        moveX: (Math.floor(r() * 3) - 1) as -1 | 0 | 1,
        moveY: (Math.floor(r() * 3) - 1) as -1 | 0 | 1,
        aimX,
        aimY,
        buttons,
      };
    });
    return this.held.map((h) => ({ ...h }));
  }
}

interface Played {
  state: GameState;
  problems: string[];
  obstacleHits: number;
  obstacleContacts: number;
  damage: number;
}

/** Plays `ticks` ticks of random inputs with every oracle, counting what the pins need. */
function playRandom(arena: ArenaDef, ticks: number): Played {
  const state = start(arena);
  const players = new RandomPlayers(SEED, state.champions.length);
  const watcher = new RoundWatcher();
  const played: Played = { state, problems: [], obstacleHits: 0, obstacleContacts: 0, damage: 0 };
  played.problems.push(...checkEveryStep(state));
  for (let i = 0; i < ticks; i++) {
    watcher.beforeStep(state);
    step(state, players.next(state));
    watcher.afterStep(state);
    played.problems.push(...checkEveryStep(state));
    for (const e of state.events) {
      if (e.type === 'projectileExpired' && e.reason === 'obstacle') played.obstacleHits++;
      if (e.type === 'damage') played.damage++;
    }
    const kinds = contactKinds(state);
    if (kinds.has('circle') || kinds.has('rect')) played.obstacleContacts++;
  }
  played.problems.push(...watcher.problems);
  return played;
}

describe('a 2v2 on arena02 with random inputs', () => {
  const run = playRandom(arena02, TICKS);

  it(`runs ${TICKS} ticks with every invariant holding`, () => {
    expect(run.state.tick).toBe(TICKS);
    expect(run.problems).toEqual([]);
  });

  it('ends a projectile on an obstacle, touches an obstacle and damages a champion', () => {
    expect(run.obstacleHits, 'projectileExpired on an obstacle').toBeGreaterThan(0);
    expect(run.obstacleContacts, 'steps in contact with an obstacle').toBeGreaterThan(0);
    expect(run.damage, 'damage events').toBeGreaterThan(0);
  });

  it('gives the same checksum when played again', () => {
    expect(checksum(playRandom(arena02, TICKS).state)).toBe(checksum(run.state));
  });

  it('would miss the obstacle pins on the same match without obstacles', () => {
    const open = playRandom({ ...arena02, obstacles: [] }, TICKS);
    expect(open.obstacleHits).toBe(0);
    expect(open.obstacleContacts).toBe(0);
  });
});

describe('a standoff on arena02', () => {
  /** Every input missing, until the round is decided. */
  function standoff(tweak: (state: GameState) => void = () => undefined) {
    const state = start();
    tweak(state);
    const watcher = new RoundWatcher();
    const problems: string[] = [];
    const events: SimEvent[] = [];
    let decidedAt = -1;
    for (let i = 0; i < STANDOFF_CAP && decidedAt < 0; i++) {
      watcher.beforeStep(state);
      step(state, []);
      watcher.afterStep(state);
      problems.push(...checkEveryStep(state));
      events.push(...state.events);
      if (state.events.some((e) => e.type === 'roundEnded')) decidedAt = state.tick;
    }
    return { events, problems: [...problems, ...watcher.problems], decidedAt };
  }

  it('is decided by the ring after sudden death starts, as a draw', () => {
    const { events, problems, decidedAt } = standoff();
    expect(problems).toEqual([]);
    expect(decidedAt).toBeGreaterThan(SUDDEN_DEATH_AT);
    const ended = events.find((e) => e.type === 'roundEnded');
    expect(ended?.type === 'roundEnded' ? ended.winner : 'no roundEnded').toBeNull();
    const deaths = events.filter((e) => e.type === 'death');
    expect(deaths).toHaveLength(4);
    for (const e of deaths) expect(e.sourceId).toBe(RING_SOURCE_ID);
  });

  it('is not a draw when one champion has more health', () => {
    const { events } = standoff((state) => {
      const hargrimB = state.champions[2]!;
      hargrimB.health += 1;
      hargrimB.maxHealth += 1;
    });
    const ended = events.find((e) => e.type === 'roundEnded');
    expect(ended?.type === 'roundEnded' ? ended.winner : 'no roundEnded').toBe('B');
  });
});
