import arena01Json from '../../../data/arenas/arena01.json';
import { CHAMPION_RADIUS, cloneState, parseArenaDef } from '../src/index';
import type {
  ArenaDef,
  ChampionState,
  GameState,
  MatchConfig,
  Obstacle,
  PlayerInput,
  SimEvent,
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

/**
 * The state as the fixtures that predate the ability toolkit saw it. Those fixtures stay byte
 * for byte as committed, so their checksums cover the state without the fields the toolkit
 * and the kit contract added. This asserts each dropped field is neutral first, so a regression
 * that changes behavior for a match without statuses or kits cannot hide behind the projection.
 */
export function legacyState(state: GameState): GameState {
  const copy = cloneState(state);
  for (const c of copy.champions) {
    if (c.dash !== null) throw new Error(`champion ${c.id} has a dash`);
    if (c.statuses.length > 0) throw new Error(`champion ${c.id} has statuses`);
    if (c.cooldowns.length !== 7 || c.cooldowns.some((v) => v !== 0)) {
      throw new Error(`champion ${c.id} has a cooldown`);
    }
    if (c.cast !== null) throw new Error(`champion ${c.id} has a cast`);
    delete (c as Partial<ChampionState>).dash;
    delete (c as Partial<ChampionState>).cooldowns;
    delete (c as Partial<ChampionState>).cast;
  }
  for (const entity of [...copy.projectiles, ...copy.areas]) {
    if (entity.castId !== null) throw new Error(`entity ${entity.id} has a cast id`);
    delete (entity as Partial<typeof entity>).castId;
  }
  if (copy.kits.length > 0) throw new Error('state has kits');
  if (copy.casts.length > 0) throw new Error('state has casts');
  delete (copy as Partial<GameState>).kits;
  delete (copy as Partial<GameState>).casts;
  return copy;
}

/**
 * Which scripted fixture has to produce each event type. `combat` is the committed combat
 * fixture; `ability` is the ability fixture that arrives with the kit contract. Typing it as
 * a record makes a new event type a compile error until it is classified.
 */
export const EVENT_FIXTURE: Record<SimEvent['type'], 'combat' | 'ability'> = {
  projectileSpawned: 'combat',
  projectileHit: 'combat',
  projectileExpired: 'combat',
  areaSpawned: 'combat',
  areaTick: 'combat',
  areaExpired: 'combat',
  damage: 'combat',
  heal: 'combat',
  death: 'combat',
  statusApplied: 'ability',
  statusExpired: 'ability',
  shieldAbsorbed: 'ability',
  meleeArc: 'ability',
  teleport: 'ability',
  dashStarted: 'ability',
  dashEnded: 'ability',
  castStarted: 'ability',
  castFired: 'ability',
  castInterrupted: 'ability',
  energyGained: 'ability',
};

const UNIQUE_STATUSES = ['stun', 'root', 'silence', 'invulnerable'];

/** Oracle for the status and dash rules. Returns one message per violation. */
export function checkStatusInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const bad = (c: ChampionState, what: string) =>
    problems.push(`tick ${state.tick} champion ${c.id}: ${what}`);
  const isInt = (v: number) => Number.isInteger(v);
  for (const c of state.champions) {
    if (!c.alive && (c.statuses.length > 0 || c.dash !== null)) bad(c, 'dead with statuses or a dash');
    const seen = new Set<string>();
    let push = 0;
    for (const s of c.statuses) {
      if (!isInt(s.remainingTicks) || s.remainingTicks < 1) bad(c, `${s.type} remainingTicks ${s.remainingTicks}`);
      if (!Number.isInteger(s.sourceId) || !state.champions[s.sourceId]) bad(c, `${s.type} source ${s.sourceId}`);
      const key = UNIQUE_STATUSES.includes(s.type) ? s.type : `${s.type}/${s.sourceId}/${s.slot}`;
      if (seen.has(key)) bad(c, `second instance of ${key}`);
      seen.add(key);
      if (s.type === 'stun' && s.remainingTicks > 120) bad(c, `stun of ${s.remainingTicks} ticks`);
      if ((s.type === 'slow' || s.type === 'haste') && (!isInt(s.percent) || s.percent < 1 || s.percent > 100)) {
        bad(c, `${s.type} percent ${s.percent}`);
      }
      if (s.type === 'shield' && !(s.absorb > 0)) bad(c, `shield absorb ${s.absorb}`);
      if ((s.type === 'dot' || s.type === 'hot') && (!isInt(s.ticksToNextPulse) || s.ticksToNextPulse < 1 || s.ticksToNextPulse > 30)) {
        bad(c, `${s.type} pulse timer ${s.ticksToNextPulse}`);
      }
      if (s.type === 'knockback') {
        const n = s.remainingTicks;
        if (!(s.distance > 0) || !isInt(s.totalTicks) || n > s.totalTicks) bad(c, 'bad knockback record');
        if (Math.abs(Math.sqrt(s.dirX * s.dirX + s.dirY * s.dirY) - 1) > 1e-12) bad(c, 'knockback direction is not a unit vector');
        push += (s.distance * n * (n + 1)) / (s.totalTicks * (s.totalTicks + 1));
      }
    }
    if (push > 6 + 1e-9) bad(c, `knockback push ${push} above 6 m`);
    if (c.dash) {
      if (!isInt(c.dash.ticksLeft) || c.dash.ticksLeft < 1) bad(c, `dash ticksLeft ${c.dash.ticksLeft}`);
      if (!(c.dash.stepLength > 0)) bad(c, `dash stepLength ${c.dash.stepLength}`);
      if (Math.abs(Math.sqrt(c.dash.dirX ** 2 + c.dash.dirY ** 2) - 1) > 1e-12) bad(c, 'dash direction is not a unit vector');
    }
  }
  return problems;
}

/**
 * Oracle for the kit, cast and energy state, from the state alone. It deliberately does not import
 * `src/cast.ts`. Returns one message per violation.
 */
export function checkAbilityInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const bad = (c: ChampionState, what: string) =>
    problems.push(`tick ${state.tick} champion ${c.id}: ${what}`);
  const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  const slots = ['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'] as const;

  for (const c of state.champions) {
    const kit = state.kits.find((k) => k.id === c.championId);
    if (!isInt(c.energy) || c.energy < 0 || c.energy > 100) bad(c, `energy ${c.energy}`);
    if (c.cooldowns.length !== 7) bad(c, `${c.cooldowns.length} cooldowns`);
    c.cooldowns.forEach((value, i) => {
      const max = kit ? (kit.slots[slots[i] as (typeof slots)[number]]?.cooldownTicks ?? 0) : 0;
      if (!isInt(value) || value < 0 || value > max) bad(c, `cooldown ${slots[i]} is ${value} of at most ${max}`);
    });
    if (!c.alive && c.cast !== null) bad(c, 'dead with a cast');
    if (c.cast) {
      const { cast } = c;
      const record = state.casts.find((r) => r.id === cast.castId);
      if (!record) bad(c, `cast ${cast.castId} has no record`);
      else if (record.casterId !== c.id || record.slot !== cast.slot || record.ex !== cast.ex) {
        bad(c, `cast ${cast.castId} does not match its record`);
      }
      if (!isInt(cast.windupTicks) || cast.windupTicks < 1) bad(c, `windupTicks ${cast.windupTicks}`);
      if (!isInt(cast.windupLeft) || cast.windupLeft < 1 || cast.windupLeft > cast.windupTicks) {
        bad(c, `windupLeft ${cast.windupLeft} of ${cast.windupTicks}`);
      }
    }
    if (c.dash && c.dash.castId !== null && !state.casts.some((r) => r.id === c.dash?.castId)) {
      bad(c, `dash cast ${c.dash.castId} has no record`);
    }
  }

  const ids = state.casts.map((r) => r.id);
  if (ids.some((id, i) => i > 0 && id <= (ids[i - 1] as number))) problems.push(`tick ${state.tick}: cast ids are not ascending`);
  for (const record of state.casts) {
    const where = `tick ${state.tick}: cast ${record.id}`;
    if (record.id < state.champions.length || record.id >= state.nextEntityId) problems.push(`${where} id out of range`);
    if (new Set(record.credited).size !== record.credited.length) problems.push(`${where} credits a target twice`);
    if (record.credited.some((t) => !state.champions[t])) problems.push(`${where} credits an unknown champion`);
    const referenced =
      state.champions.some((c) => c.cast?.castId === record.id || c.dash?.castId === record.id) ||
      state.projectiles.some((p) => p.castId === record.id) ||
      state.areas.some((a) => a.castId === record.id);
    if (!referenced) problems.push(`${where} is not referenced`);
  }
  const entityIds = [...state.projectiles.map((p) => p.id), ...state.areas.map((a) => a.id), ...ids];
  if (new Set(entityIds).size !== entityIds.length) problems.push(`tick ${state.tick}: entity and cast ids repeat`);
  for (const entity of [...state.projectiles, ...state.areas]) {
    if (entity.castId !== null && !state.casts.some((r) => r.id === entity.castId)) {
      problems.push(`tick ${state.tick}: entity ${entity.id} refers to cast ${entity.castId}, which is gone`);
    }
  }
  return problems;
}

/** Paths of every `-0` in a JSON-like value, since a JSON round trip would turn it into 0. */
export function findNegativeZero(value: unknown, path: string): string[] {
  if (typeof value === 'number') return Object.is(value, -0) ? [path] : [];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => findNegativeZero(item, `${path}.${key}`));
}
