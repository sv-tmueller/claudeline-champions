// Observers for the ability fixture and the cast stress test: a watcher that checks the ability
// rules after every step against a snapshot taken before it, and a coverage collector. They
// deliberately do not import `src/cast.ts` or `src/energy.ts`: every expectation is written out
// again here, so a rule that drifts in the source cannot also drift in its own oracle.
import { expect } from 'vitest';
import { checksum } from '../src/index';
import type { ChampionState, GameState, KitDef, PlayerInput, SimEvent, Slot } from '../src/index';
import { checkAbilityInvariants, checkInvariants, checkStatusInvariants, findNegativeZero } from './helpers';

const BIT: Record<Slot, number> = { M1: 1, M2: 2, SPACE: 4, Q: 8, E: 16, R: 32, F: 64 };
const SHIFT = 128;
/** Cast priority: the order the slots are tried in. */
export const PRIORITY: Slot[] = ['F', 'R', 'E', 'Q', 'SPACE', 'M2', 'M1'];
const SLOT_INDEX: Record<Slot, number> = { M1: 0, M2: 1, SPACE: 2, Q: 3, E: 4, R: 5, F: 6 };

/** What a projectile lands: on the owner's team (it has `allyEffects`), on enemies (a non-empty `effects`). */
interface ProjectileFlags {
  ally: boolean;
  enemy: boolean;
}

function flagsOf(p: { allyEffects?: unknown; effects: readonly unknown[] }): ProjectileFlags {
  return { ally: p.allyEffects !== undefined, enemy: p.effects.length > 0 };
}

/** What a step needs of the state before it: the champions only, which is cheap to copy. */
export interface Champions {
  champions: ChampionState[];
}

export function copyChampions(state: GameState): Champions {
  return { champions: JSON.parse(JSON.stringify(state.champions)) as ChampionState[] };
}

export type Rejection = 'dead' | 'stunned' | 'silenced' | 'windup' | 'cooldown' | 'energy' | 'rooted';
export const REJECTIONS: Rejection[] = ['dead', 'stunned', 'silenced', 'windup', 'cooldown', 'energy', 'rooted'];

interface Snapshot {
  alive: boolean;
  energy: number;
  cooldowns: number[];
  cast: { castId: number; windupLeft: number; slot: Slot; ex: boolean } | null;
  stunned: boolean;
  silenced: boolean;
  rooted: boolean;
  dashing: boolean;
  statuses: Map<string, number>;
}

function snapshot(c: ChampionState): Snapshot {
  const statuses = new Map<string, number>();
  for (const s of c.statuses) statuses.set(s.type, (statuses.get(s.type) ?? 0) + 1);
  return {
    alive: c.alive,
    energy: c.energy,
    cooldowns: [...c.cooldowns],
    cast: c.cast ? { castId: c.cast.castId, windupLeft: c.cast.windupLeft, slot: c.cast.slot, ex: c.cast.ex } : null,
    stunned: c.statuses.some((s) => s.type === 'stun'),
    silenced: c.statuses.some((s) => s.type === 'silence'),
    rooted: c.statuses.some((s) => s.type === 'root'),
    dashing: c.dash !== null,
    statuses,
  };
}

function kitOf(state: GameState, c: ChampionState): KitDef | undefined {
  return state.kits.find((k) => k.id === c.championId);
}

/** The table gain of a qualifying hit: F 15, an EX variant 10, M1 5, else 10. */
export function tableGain(slot: Slot, ex: boolean): number {
  if (slot === 'F') return 15;
  if (ex) return 10;
  return slot === 'M1' ? 5 : 10;
}

/** What coverage the ability fixture must reach, collected from the events of every step. */
export class Coverage {
  readonly eventTypes = new Set<SimEvent['type']>();
  readonly casts = new Set<string>();
  readonly interrupts = new Set<string>();
  readonly rejections = new Set<Rejection>();
  readonly gains = new Set<number>();
  readonly costs = new Set<number>();
  readonly statusesApplied = new Set<string>();
  readonly statusEnds = new Set<string>();
  readonly dashEnds = new Set<string>();
  readonly flags = new Set<string>();
  /** Energy each champion has earned in play since it was last set by the test-only write. */
  private earned: number[] = [];

  /** The test-only `setEnergy` ran: what the champion holds now was not earned in play. */
  energyWasSet(championId: number): void {
    this.earned[championId] = 0;
  }

  /** Notes everything one step shows; `before` and `inputs` are what it started from. */
  note(state: GameState, before: Champions, inputs: readonly (PlayerInput | undefined)[]): void {
    const events = state.events;
    const snaps = before.champions.map(snapshot);
    for (const [i, e] of events.entries()) {
      this.eventTypes.add(e.type);
      switch (e.type) {
        case 'castStarted': {
          const caster = state.champions[e.championId] as ChampionState;
          this.casts.add(`${caster.championId}/${e.slot}/${e.ex}`);
          this.costs.add(e.cost);
          const earned = this.earned[e.championId] ?? 0;
          if (e.ex && e.cost > 0 && earned >= e.cost) this.flags.add('exFromEarnedEnergy');
          this.earned[e.championId] = Math.max(0, earned - e.cost);
          break;
        }
        case 'castInterrupted':
          this.interrupts.add(e.reason);
          break;
        case 'energyGained': {
          this.gains.add(e.amount);
          this.earned[e.championId] = (this.earned[e.championId] ?? 0) + e.amount;
          const caster = state.champions[e.championId] as ChampionState;
          const target = state.champions[e.targetId] as ChampionState;
          const started = events.find((x) => x.type === 'castStarted' && x.castId === e.castId);
          const kitCast = started?.type === 'castStarted' ? tableGain(started.slot, started.ex) : null;
          if (kitOf(state, caster)?.support && caster.team === target.team) this.flags.add('supportHeal');
          if (e.energy === 100 && kitCast !== null && e.amount < kitCast) this.flags.add('trimmedGain');
          break;
        }
        case 'statusApplied':
          this.statusesApplied.add(e.status);
          break;
        case 'statusExpired':
          this.statusEnds.add(e.reason);
          break;
        case 'dashEnded':
          this.dashEnds.add(e.reason);
          break;
        case 'teleport':
          this.flags.add(e.blocked ? 'teleportBlocked' : 'teleportDone');
          break;
        case 'meleeArc':
          if (e.targetIds.length === 0) this.flags.add('arcEmpty');
          if (e.targetIds.length >= 2) this.flags.add('arcMany');
          break;
        case 'shieldAbsorbed': {
          let next = i + 1;
          while (events[next]?.type === 'statusExpired') next++;
          const after = events[next];
          const partial = after?.type === 'damage' && after.targetId === e.targetId;
          this.flags.add(partial ? 'shieldPartial' : 'shieldFull');
          break;
        }
        default:
          break;
      }
    }

    state.champions.forEach((c, id) => {
      const before0 = snaps[id] as Snapshot;
      const buttons = inputs[id]?.buttons ?? 0;
      const kit = kitOf(state, c);
      const started = events.find((e) => e.type === 'castStarted' && e.championId === id);
      const fired = events.some((e) => e.type === 'castFired' && e.championId === id);
      const held = PRIORITY.filter((slot) => (buttons & BIT[slot]) !== 0);
      if (held.length === 0 || !kit) return;
      if (started?.type === 'castStarted') {
        // A pick between several slots that were all castable, and Shift on a slot without EX.
        const castable = held.filter((slot) => this.castable(kit, before0, slot, buttons));
        if (!fired && castable.length >= 2) this.flags.add('priorityPick');
        if ((buttons & SHIFT) !== 0 && kit.slots[started.slot].ex === undefined && !started.ex) {
          this.flags.add('shiftWithoutEx');
        }
        return;
      }
      const reason = this.rejection(kit, before0, held, buttons, fired);
      if (reason) this.rejections.add(reason);
    });
  }

  /** Whether a held slot could cast at resolution time, going by the state at the step start. */
  private castable(kit: KitDef, before: Snapshot, slot: Slot, buttons: number): boolean {
    const spec = kit.slots[slot];
    const ex = (buttons & SHIFT) !== 0 && spec.ex !== undefined;
    const ability = ex && spec.ex ? spec.ex : spec;
    const cost = slot === 'F' ? 100 : ex ? 25 : 0;
    const cooldown = Math.max(0, (before.cooldowns[SLOT_INDEX[slot]] as number) - 1);
    if (cooldown > 0 || before.energy < cost) return false;
    return !(before.rooted && ability.effects.some((e) => e.type === 'dash'));
  }

  /** The reason no held slot cast, when the state at the step start says so for certain. */
  private rejection(kit: KitDef, before: Snapshot, held: Slot[], buttons: number, fired: boolean): Rejection | null {
    if (!before.alive) return 'dead';
    if (before.stunned) return 'stunned';
    if (before.silenced) return 'silenced';
    if (before.cast && before.cast.windupLeft > 1) return 'windup';
    if (fired) return null;
    for (const slot of held) {
      const spec = kit.slots[slot];
      const ex = (buttons & SHIFT) !== 0 && spec.ex !== undefined;
      const ability = ex && spec.ex ? spec.ex : spec;
      const cost = slot === 'F' ? 100 : ex ? 25 : 0;
      if (Math.max(0, (before.cooldowns[SLOT_INDEX[slot]] as number) - 1) > 0) {
        this.rejections.add('cooldown');
      } else if (before.energy < cost) {
        this.rejections.add('energy');
      } else if (before.rooted && ability.effects.some((e) => e.type === 'dash')) {
        this.rejections.add('rooted');
      }
    }
    return null;
  }

  /** What the run still has to show, as readable names; empty when everything is covered. */
  missing(kits: readonly KitDef[], abilityEventTypes: readonly SimEvent['type'][]): string[] {
    const out: string[] = [];
    for (const type of abilityEventTypes) if (!this.eventTypes.has(type)) out.push(`event ${type}`);
    for (const kit of kits) {
      for (const slot of PRIORITY) {
        if (!this.casts.has(`${kit.id}/${slot}/false`)) out.push(`cast ${kit.id} ${slot}`);
      }
      for (const slot of kit.ex) {
        if (!this.casts.has(`${kit.id}/${slot}/true`)) out.push(`cast ${kit.id} ${slot} EX`);
      }
    }
    for (const reason of ['stun', 'death']) if (!this.interrupts.has(reason)) out.push(`interrupt ${reason}`);
    for (const reason of REJECTIONS) if (!this.rejections.has(reason)) out.push(`rejection ${reason}`);
    for (const gain of [5, 10, 15]) if (!this.gains.has(gain)) out.push(`gain ${gain}`);
    for (const cost of [25, 100]) if (!this.costs.has(cost)) out.push(`cost ${cost}`);
    for (const type of ['stun', 'root', 'silence', 'invulnerable', 'slow', 'haste', 'shield', 'dot', 'hot', 'knockback']) {
      if (!this.statusesApplied.has(type)) out.push(`status ${type}`);
    }
    for (const reason of ['expired', 'depleted', 'stopped', 'replaced', 'death']) {
      if (!this.statusEnds.has(reason)) out.push(`status end ${reason}`);
    }
    for (const reason of ['complete', 'blocked']) if (!this.dashEnds.has(reason)) out.push(`dash end ${reason}`);
    for (const flag of [
      'supportHeal', 'trimmedGain', 'teleportBlocked', 'teleportDone', 'arcEmpty', 'arcMany',
      'shieldFull', 'shieldPartial', 'priorityPick', 'shiftWithoutEx', 'exFromEarnedEnergy',
    ]) {
      if (!this.flags.has(flag)) out.push(`flag ${flag}`);
    }
    return out;
  }
}

/**
 * Checks the rules of casting and energy after every step, against what the state looked like
 * before it, together with the collision, status, JSON and checksum oracles. Call `beforeStep`
 * right before each `step`, `afterStep` right after it, and `afterEnergySet` after a test-only
 * energy write.
 */
export class AbilityWatcher {
  problems: string[] = [];
  private before: Champions | null = null;
  /** The projectiles alive at the start of the step, by id: what each lands on allies and on enemies. */
  private projectilesBefore = new Map<number, ProjectileFlags>();
  private energy: number[];
  private statusOpen = new Map<string, number>();
  private dashOpen = new Map<number, number>();
  private castLife = new Map<number, 'open' | 'closed'>();
  private gained = new Set<string>();
  private health: number[];

  constructor(initial: GameState) {
    this.energy = initial.champions.map((c) => c.energy);
    this.health = initial.champions.map((c) => c.health);
  }

  private check(condition: boolean, message: string, state: GameState): void {
    if (!condition) this.problems.push(`tick ${state.tick}: ${message}`);
  }

  beforeStep(state: GameState): void {
    this.before = copyChampions(state);
    // The champions and the projectiles: a projectile that hits and ends in the step is gone from
    // the state after it, so what it landed is read from before the step or from the cast.
    this.projectilesBefore = new Map(state.projectiles.map((p) => [p.id, flagsOf(p)]));
  }

  afterEnergySet(state: GameState): void {
    state.champions.forEach((c, i) => (this.energy[i] = c.energy));
    this.generic(state);
  }

  afterStep(state: GameState, inputs: readonly (PlayerInput | undefined)[]): void {
    const before = this.before;
    if (!before) throw new Error('afterStep without beforeStep');
    this.before = null;
    this.generic(state);
    this.events(state);
    this.projectileRules(state);
    this.ledger(state);
    this.rules(state, before, inputs);
  }

  /** The oracles that need only the state. */
  private generic(state: GameState): void {
    this.problems.push(...checkInvariants(state), ...checkStatusInvariants(state), ...checkAbilityInvariants(state));
    const negative = findNegativeZero(state, 'state');
    this.check(negative.length === 0, `-0 at ${negative.join(', ')}`, state);
    // The arena and the kits never change during a run, so the per-step round trip skips them.
    const dynamic = { ...state } as Partial<GameState>;
    delete dynamic.arena;
    delete dynamic.kits;
    try {
      checksum(dynamic as GameState);
      expect(JSON.parse(JSON.stringify(dynamic))).toStrictEqual(dynamic);
    } catch (error) {
      this.problems.push(`tick ${state.tick}: checksum or JSON round trip failed: ${String(error)}`);
    }
  }

  /**
   * What a projectile may land, by the kit rules (kit.ts): a hit on the owner's team needs
   * `allyEffects` and a target that is not the owner, a hit on an enemy needs a non-empty `effects`
   * (an empty list beside `allyEffects` makes the projectile pass enemies), and energy for a hit on
   * an ally other than the caster needs a support kit and a heal that restored health to that
   * ally in the same step (a heal of nothing earns none). The flags of a projectile are read from
   * the state before the step, then after it, then, for a bolt that spawned and ended in this very
   * step, from the ability its owner's castFired names.
   */
  private projectileRules(state: GameState): void {
    const after = new Map(state.projectiles.map((p) => [p.id, flagsOf(p)]));
    for (const e of state.events) {
      if (e.type === 'projectileHit') {
        const owner = state.champions[e.ownerId] as ChampionState;
        const target = state.champions[e.targetId] as ChampionState;
        const flags =
          this.projectilesBefore.get(e.projectileId) ??
          after.get(e.projectileId) ??
          this.flagsFromCast(state, e.ownerId);
        if (!flags) {
          this.check(false, `projectile ${e.projectileId} of champion ${e.ownerId} hit champion ${e.targetId} and no flags are known`, state);
        } else if (owner.team === target.team) {
          this.check(flags.ally, `projectile ${e.projectileId} of champion ${e.ownerId} hit its ally ${e.targetId} with no allyEffects`, state);
          this.check(e.targetId !== e.ownerId, `projectile ${e.projectileId} of champion ${e.ownerId} hit its owner`, state);
        } else {
          this.check(flags.enemy, `projectile ${e.projectileId} of champion ${e.ownerId} hit an enemy with empty effects (champion ${e.targetId})`, state);
        }
      } else if (e.type === 'energyGained') {
        const caster = state.champions[e.championId] as ChampionState;
        const target = state.champions[e.targetId] as ChampionState;
        if (caster.team !== target.team || caster.id === target.id) continue;
        const healed = state.events.some(
          (h) => h.type === 'heal' && h.targetId === e.targetId && h.sourceId === e.championId,
        );
        this.check(kitOf(state, caster)?.support === true, `champion ${e.championId} earned energy for a heal of ally ${e.targetId} with a kit that is not support`, state);
        this.check(healed, `champion ${e.championId} earned energy for ally ${e.targetId} with no heal that restored health to it in the step`, state);
      }
    }
  }

  /** The flags of the first projectile of the ability the owner fired in this step, if any. */
  private flagsFromCast(state: GameState, ownerId: number): ProjectileFlags | null {
    const fired = state.events.find((e) => e.type === 'castFired' && e.championId === ownerId);
    const kit = kitOf(state, state.champions[ownerId] as ChampionState);
    if (fired?.type !== 'castFired' || !kit) return null;
    const spec = kit.slots[fired.slot];
    const ability = fired.ex && spec.ex ? spec.ex : spec;
    for (const effect of ability.effects) {
      if (effect.type === 'projectile') {
        return { ally: effect.allyEffects !== undefined, enemy: effect.effects.length > 0 };
      }
    }
    return null;
  }

  /** Lifecycles: one close per status, one dash end per dash, one fire or interrupt per cast. */
  private events(state: GameState): void {
    const running = [...this.health];
    for (const e of state.events) {
      switch (e.type) {
        case 'statusApplied': {
          const key = `${e.targetId}/${e.status}`;
          this.statusOpen.set(key, (this.statusOpen.get(key) ?? 0) + 1);
          break;
        }
        case 'statusExpired': {
          const key = `${e.targetId}/${e.status}`;
          this.statusOpen.set(key, (this.statusOpen.get(key) ?? 0) - 1);
          break;
        }
        case 'dashStarted':
          this.dashOpen.set(e.championId, (this.dashOpen.get(e.championId) ?? 0) + 1);
          break;
        case 'dashEnded':
          this.dashOpen.set(e.championId, (this.dashOpen.get(e.championId) ?? 0) - 1);
          break;
        case 'castStarted':
          this.check(!this.castLife.has(e.castId), `cast ${e.castId} started twice`, state);
          this.castLife.set(e.castId, 'open');
          break;
        case 'castFired':
        case 'castInterrupted':
          this.check(this.castLife.get(e.castId) === 'open', `cast ${e.castId} closed without being open`, state);
          this.castLife.set(e.castId, 'closed');
          break;
        case 'energyGained': {
          const key = `${e.castId}/${e.targetId}`;
          this.check(!this.gained.has(key), `energy for cast ${e.castId} and target ${e.targetId} twice`, state);
          this.gained.add(key);
          break;
        }
        case 'damage':
        case 'heal': {
          const sign = e.type === 'damage' ? -1 : 1;
          running[e.targetId] = (running[e.targetId] ?? 0) + sign * e.amount;
          this.check(running[e.targetId] === e.health, `${e.type} event health does not follow from the amounts`, state);
          break;
        }
        default:
          break;
      }
    }
    for (const c of state.champions) {
      this.check(c.health === running[c.id], `champion ${c.id} health is not conserved`, state);
      this.health[c.id] = c.health;
      for (const type of ['stun', 'root', 'slow', 'haste', 'silence', 'invulnerable', 'shield', 'dot', 'hot', 'wound', 'knockback']) {
        const count = c.statuses.filter((s) => s.type === type).length;
        this.check(count === (this.statusOpen.get(`${c.id}/${type}`) ?? 0), `champion ${c.id} ${type} events do not match`, state);
      }
      this.check((this.dashOpen.get(c.id) ?? 0) === (c.dash ? 1 : 0), `champion ${c.id} dash events do not match`, state);
    }
    const winding = new Set(state.champions.flatMap((c) => (c.cast ? [c.cast.castId] : [])));
    for (const [castId, life] of this.castLife) {
      this.check((life === 'open') === winding.has(castId), `cast ${castId} is ${life} but ${winding.has(castId) ? 'winding' : 'not winding'}`, state);
    }
  }

  /** Energy is the previous value plus gains minus costs, never above 100 and never below 0. */
  private ledger(state: GameState): void {
    const running = [...this.energy];
    for (const e of state.events) {
      if (e.type === 'castStarted') {
        running[e.championId] = (running[e.championId] as number) - e.cost;
        this.check((running[e.championId] as number) >= 0, `champion ${e.championId} paid ${e.cost} it did not have`, state);
      } else if (e.type === 'energyGained') {
        this.check(e.amount > 0, 'energyGained with no amount', state);
        running[e.championId] = (running[e.championId] as number) + e.amount;
        this.check(running[e.championId] === e.energy, `energyGained says ${e.energy}, ledger says ${running[e.championId]}`, state);
        this.check(e.energy <= 100, `energy ${e.energy} above 100`, state);
      }
    }
    for (const c of state.champions) {
      this.check(c.energy === running[c.id], `champion ${c.id} energy ${c.energy} is not ${running[c.id]}`, state);
      this.energy[c.id] = c.energy;
    }
  }

  /** The rules of casting, windups, cooldowns and movement, one champion at a time. */
  private rules(state: GameState, before: Champions, inputs: readonly (PlayerInput | undefined)[]): void {
    for (const c of state.champions) {
      const snap = snapshot(before.champions[c.id] as ChampionState);
      const kit = kitOf(state, c);
      const started = state.events.find((e) => e.type === 'castStarted' && e.championId === c.id);
      const fired = state.events.filter((e) => e.type === 'castFired' && e.championId === c.id);
      const interrupted = state.events.filter((e) => e.type === 'castInterrupted' && e.championId === c.id);

      // A stunned or silenced champion starts nothing; neither does a dead one or one winding up.
      if (started) {
        this.check(snap.alive, `dead champion ${c.id} started a cast`, state);
        this.check(!snap.stunned && !snap.silenced, `champion ${c.id} started a cast while stunned or silenced`, state);
        const winding = snap.cast !== null && !fired.some((f) => f.type === 'castFired' && f.castId === snap.cast?.castId);
        this.check(!winding, `champion ${c.id} started a cast during a windup`, state);
        this.check(state.events.filter((e) => e.type === 'castStarted' && e.championId === c.id).length === 1, `champion ${c.id} started two casts`, state);
      }

      // Priority: a higher held slot that could cast would have been picked.
      if (started?.type === 'castStarted' && kit && fired.length === 0) {
        const buttons = inputs[c.id]?.buttons ?? 0;
        const startedAt = state.events.indexOf(started);
        // A root another champion's cast applied earlier in the tick also rejects a dash.
        const rootedNow =
          snap.rooted ||
          state.events.slice(0, startedAt).some((e) => e.type === 'statusApplied' && e.targetId === c.id && e.status === 'root');
        const higher = PRIORITY.slice(0, PRIORITY.indexOf(started.slot)).filter((slot) => (buttons & BIT[slot]) !== 0);
        for (const slot of higher) {
          const spec = kit.slots[slot];
          const ex = (buttons & SHIFT) !== 0 && spec.ex !== undefined;
          const ability = ex && spec.ex ? spec.ex : spec;
          const cost = slot === 'F' ? 100 : ex ? 25 : 0;
          const ready = Math.max(0, (snap.cooldowns[SLOT_INDEX[slot]] as number) - 1) === 0;
          const open = !(rootedNow && ability.effects.some((e) => e.type === 'dash'));
          this.check(!(ready && open && snap.energy >= cost), `champion ${c.id} cast ${started.slot} though ${slot} was ready`, state);
        }
        const wanted = (buttons & SHIFT) !== 0 && kit.slots[started.slot].ex !== undefined;
        this.check(started.ex === wanted, `champion ${c.id} cast ex=${started.ex} for ${started.slot}`, state);
        this.check(started.cost === (started.slot === 'F' ? 100 : started.ex ? 25 : 0), `cast cost ${started.cost}`, state);
      }

      // Cooldowns: a slot that started is its cooldown; the others lose one while alive.
      if (kit && snap.alive && c.alive) {
        c.cooldowns.forEach((value, i) => {
          const slot = (['M1', 'M2', 'SPACE', 'Q', 'E', 'R', 'F'] as const)[i] as Slot;
          const expected =
            started?.type === 'castStarted' && started.slot === slot
              ? kit.slots[slot].cooldownTicks
              : Math.max(0, (snap.cooldowns[i] as number) - 1);
          this.check(value === expected, `champion ${c.id} cooldown ${slot} is ${value}, expected ${expected}`, state);
        });
      }

      // Windup: counts down once a turn, fires at 0, and is never left at 0.
      if (snap.cast && snap.alive && c.alive) {
        const ended = fired.some((f) => f.type === 'castFired' && f.castId === snap.cast?.castId) ||
          interrupted.some((f) => f.type === 'castInterrupted' && f.castId === snap.cast?.castId);
        if (!ended) {
          this.check(c.cast?.castId === snap.cast.castId && c.cast.windupLeft === snap.cast.windupLeft - 1, `champion ${c.id} windup did not count down`, state);
        } else if (fired.some((f) => f.type === 'castFired' && f.castId === snap.cast?.castId)) {
          this.check(snap.cast.windupLeft === 1 || interrupted.length > 0, `champion ${c.id} fired with ${snap.cast.windupLeft} turns left`, state);
        }
      }
      if (started?.type === 'castStarted' && kit) {
        const ability = started.ex && kit.slots[started.slot].ex ? kit.slots[started.slot].ex : kit.slots[started.slot];
        const windup = ability?.windupTicks ?? -1;
        this.check(started.windupTicks === windup, `castStarted windupTicks ${started.windupTicks} is not ${windup}`, state);
        const fireEvents = fired.filter((f) => f.type === 'castFired' && f.castId === started.castId);
        if (windup === 0) this.check(fireEvents.length === 1 && c.cast === null, `an instant cast of champion ${c.id} did not fire at once`, state);
        else if (c.alive && interrupted.every((i) => i.type === 'castInterrupted' && i.castId !== started.castId)) {
          this.check(c.cast?.castId === started.castId && c.cast.windupLeft === windup, `champion ${c.id} windup is not ${windup}`, state);
        }
      }

      // Movement: stunned, rooted, dashing or locked at the step start means no walking.
      if (snap.alive && c.alive) {
        const lockedWindup =
          snap.cast !== null &&
          snap.cast.windupLeft > 1 &&
          kit !== undefined &&
          (snap.cast.ex && kit.slots[snap.cast.slot].ex ? kit.slots[snap.cast.slot].ex : kit.slots[snap.cast.slot])?.movement === 'locked';
        if (snap.stunned || snap.rooted || snap.dashing || lockedWindup) {
          this.check(c.vx === 0 && c.vy === 0 && !Object.is(c.vx, -0) && !Object.is(c.vy, -0), `champion ${c.id} could not walk but has velocity ${c.vx}, ${c.vy}`, state);
        }
      }

      if (!c.alive) this.check(c.cast === null && c.dash === null && c.statuses.length === 0, `dead champion ${c.id} keeps a cast, a dash or statuses`, state);
    }
  }
}
