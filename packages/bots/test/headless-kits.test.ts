import { describe, expect, it } from 'vitest';
import type { ChampionState, MatchConfig, Slot } from '@claudeline/sim';
import type { AbilitySpec, KitDef } from '@claudeline/sim';
import { SLOTS } from '@claudeline/sim';
import { WITHIN } from './escape-oracle';
import { configMirror, configLumeth, configSkerrow, createRun, rosterKits } from './helpers';
import { ESCAPES, HELD, KIT_SETS, LUMETH_SET, TICKS, expectNoStall, play } from './press-oracle';
import type { AllyRow, KitSet } from './press-oracle';

// The death this run asserts depends on these seeds: seeds 301 to 304 give none. A miss
// after a change to the bots, the sim or the Node version is governed by batch #53 decision 8.3.
const SEEDS = [101, 102, 103, 104];
const TIERS = ['easy', 'normal', 'hard', 'normal'] as const;
// The 3v3 that must start an ultimate: seeds and tiers pinned for that alone (see its test).
const ULTIMATE_SEEDS = [101, 102, 103, 104, 105, 106];
const ULTIMATE_TIERS = ['hard', 'hard', 'hard', 'hard', 'hard', 'hard'] as const;

/** Hargrim and two Quillons on each team. */
function config3v3(): MatchConfig {
  return {
    teamSize: 3,
    players: [
      { championId: 'hargrim', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'quillon', team: 'A' },
      { championId: 'hargrim', team: 'B' },
      { championId: 'quillon', team: 'B' },
      { championId: 'quillon', team: 'B' },
    ],
  };
}


describe.each(KIT_SETS)('headless matches of bots with $name', (set) => {
  it('a 2v2 of four bots on two kits ends with a death from a cast within 3600 ticks', () => {
    const run = createRun(SEEDS, TIERS, 7, { config: configMirror(), kits: set.kits() });
    const played = play(set, run);
    expect(played.killed, played.summary).toBe(true);
    played.state.champions.forEach((c, id) => {
      expect(played.started[id], `champion ${id} started no cast: ${played.summary}`).toBeGreaterThan(0);
    });
    expect(
      played.exStarted.some((n) => n > 0),
      `no EX cast: ${played.summary}`,
    ).toBe(true);
    expect(played.state.tick).toBe(TICKS);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expectNoStall(played);
  }, 30_000);

  // The 2v2 above ends its fights by tick 700 with the energy bar at 75 at most (the energy of a
  // champion comes from damage, and four champions die quickly), so the ultimate never fires in it:
  // 9000 matches of that mirror on the shipped kits (seeds 4 to 12003 in groups of four, three tier
  // sets, each stopped when one champion was left) gave no F cast. A 3v3 (Hargrim and two Quillons
  // a side) lasts longer and its bar reaches 100. These seeds and tiers are pinned for this
  // criterion alone; the death run above keeps its seeds.
  //
  // A declared start edit (batch #134 decision 4, the precedent of the Reaper's Dance run below):
  // every champion starts at 75 energy. Since the bots dodge (#137) the hard bots land fewer hits,
  // and no seed set tried (101 to 106 among them) reached an F by landing hits alone, in either
  // kit set. At 75 the energy reserve is what is tested: four (test kits) or five (shipped kits)
  // of six champions press F, and with the reserve dropped none does, since they spend the 25 of
  // an EX press first.
  it('a 3v3 of six bots on two kits starts an ultimate within 3600 ticks', () => {
    const config = config3v3();
    const run = createRun(ULTIMATE_SEEDS, ULTIMATE_TIERS, 7, { config, kits: set.kits() });
    for (const champion of run.state.champions) champion.energy = 75;
    const played = play(set, run);
    expect(
      played.ultimates.some((n) => n > 0),
      `no F cast: ${played.summary}`,
    ).toBe(true);
    expect(played.state.tick).toBe(TICKS);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expectNoStall(played);
  }, 30_000);
});

describe('a headless match with Skerrow on the shipped kits', () => {
  const set = KIT_SETS[1] as KitSet;
  const NORMAL = ['normal', 'normal', 'normal', 'normal'] as const;

  // Free play with no match flow: one team has no champion left by tick 3600 (a round is 5400 ticks
  // in match flow, which would decide the same way). Pinned seeds: a miss after a change to the
  // bots, the sim or the Node version is governed by batch #53 decision 8.3.
  it('Skerrow and Quillon against Hargrim and Quillon: a team is eliminated by tick 3600', () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configSkerrow(), kits: set.kits() });
    const played = play(set, run);
    expect(played.eliminatedAt, played.summary).toBeGreaterThan(0);
    expect(played.eliminatedAt, played.summary).toBeLessThanOrEqual(TICKS);
    expect(played.firstLunge, `Skerrow started no Lunge: ${played.summary}`).toBeGreaterThanOrEqual(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);

  // The same match with a start edit that makes Reaper's Dance reachable: Skerrow at 100 energy and
  // both enemies at 40 health, the damage F does, so the hold lets it go. It runs the whole play
  // loop, so the oracle's Skerrow F row (the hold, the band, the clear shot, the gates) runs on a
  // real press. One run: a miss after a change to the bots, the sim or the Node version is governed
  // by batch #53 decision 8.3; the fallback is Skerrow against a Quillon at 40 health, the other
  // two champions dead, 9 m apart.
  it("Skerrow starts Reaper's Dance at a target at 40 health, and no escape teleport is blocked", () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configSkerrow(), kits: set.kits() });
    const skerrow = run.state.champions[0] as ChampionState;
    skerrow.energy = 100;
    for (const id of [2, 3]) (run.state.champions[id] as ChampionState).health = 40;
    const played = play(set, run);
    expect(played.ultimates[0], played.summary).toBeGreaterThan(0);
    // The teleport counted apart is Skerrow's own (champion 0): Reaper's Dance, not another's.
    expect(played.tally.others, played.summary).toBeGreaterThan(0);
    expect(played.otherTeleporters, played.summary).toEqual(Array(played.tally.others).fill(0));
    expect(played.tally.escapes, played.summary).toBe(2);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);
});

describe('a headless match with Lumeth on the four shipped kits', () => {
  const NORMAL = ['normal', 'normal', 'normal', 'normal'] as const;

  // Free play, 3600 ticks, pinned seeds: a miss after a change to the bots, the sim or the Node
  // version is governed by batch #53 decision 8.3. Her ally presses (heals, the shield, Dawnbloom)
  // pass through the ally rows of the oracle, and a press that has no row or no ally fails the run.
  it('Hargrim and Lumeth against Hargrim and Quillon: every press passes the oracle', () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configLumeth(), kits: LUMETH_SET.kits() });
    const played = play(LUMETH_SET, run);
    expect(played.eliminatedAt, played.summary).toBeGreaterThan(0);
    expect(played.slots['lumeth:M1'], `Lumeth started no M1: ${played.summary}`).toBeGreaterThan(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);

  // The same match with a declared start edit: the enemy Hargrim stands 2 m east of Lumeth on tick
  // 0, so her trigger (3 m) holds at once and Lantern Burst is pressed through the oracle's escape
  // row. In the unedited run above she is never that close to anyone with E ready.
  it('Lumeth presses Lantern Burst at a Hargrim 2 m away on tick 0', () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configLumeth(), kits: LUMETH_SET.kits() });
    const lumeth = run.state.champions[1] as ChampionState;
    const hargrim = run.state.champions[2] as ChampionState;
    hargrim.x = lumeth.x + 2;
    hargrim.y = lumeth.y;
    const played = play(LUMETH_SET, run);
    expect(played.slots['lumeth:E'], `Lumeth started no Lantern Burst: ${played.summary}`).toBeGreaterThan(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);

  // The same edit with Lantern Burst cooling down: Glide is her only escape, and the oracle checks
  // its landing (the first of five whose dash path is clear), the aim and the dash the sim starts.
  it('Lumeth glides away from a Hargrim 2 m off with Lantern Burst cooling down', () => {
    const run = createRun(SEEDS, NORMAL, 7, { config: configLumeth(), kits: LUMETH_SET.kits() });
    const lumeth = run.state.champions[1] as ChampionState;
    const hargrim = run.state.champions[2] as ChampionState;
    hargrim.x = lumeth.x + 2;
    hargrim.y = lumeth.y;
    lumeth.cooldowns[SLOTS.indexOf('E')] = 600;
    const played = play(LUMETH_SET, run);
    expect(played.glides, `Lumeth started no Glide: ${played.summary}`).toBeGreaterThan(0);
    expect(played.tally.blockedEscapes, played.summary).toBe(0);
    expect(played.state.tick).toBe(TICKS);
    expectNoStall(played);
  }, 30_000);
});

// The run presses only some slots, so a wrong row of a table could go unseen. This reads the
// kit files and works every row out again, by the rule of docs/architecture/bots.md (the end of
// the first effect that reaches an enemy) written here by hand for the shapes these kits use.
describe('the band and clearance tables of the shipped kits', () => {
  const set = KIT_SETS[1] as KitSet;
  const kits = rosterKits();
  const slotOf = (id: string, key: string): AbilitySpec => {
    const kit = kits.find((k) => k.id === id) as KitDef;
    const [slot, variant] = key.split(':') as [Slot, string | undefined];
    const base = kit.slots[slot];
    return variant === 'ex' ? (base.ex as AbilitySpec) : base;
  };
  const projectile = (spec: AbilitySpec) => {
    const effect = spec.effects[0];
    if (effect === undefined || effect.type !== 'projectile') throw new Error('not a projectile');
    return effect;
  };

  it('has the reach and the shot width of every Quillon bolt', () => {
    for (const key of ['M1', 'M2', 'M2:ex', 'Q', 'E', 'E:ex', 'F']) {
      const bolt = projectile(slotOf('quillon', key));
      // The speed is multiplied by the lifetime first: 22 x 38 / 60, not 22 x (38 / 60).
      const reach = { min: 0, max: (bolt.speed * bolt.lifetimeTicks) / 60 };
      // Snare Orb is an opener: the kit band less the margin, and a target walking toward her.
      expect(set.bands[`quillon:${key}`], key).toEqual(
        key === 'Q' ? { ...reach, motion: 'closing' } : reach,
      );
      expect(set.clearances[`quillon:${key}`], key).toBe(bolt.radius);
    }
  });

  it('has the reach and the shot width of every Hargrim ability that is pressed', () => {
    const arc = slotOf('hargrim', 'M1').effects[0];
    if (arc === undefined || arc.type !== 'meleeArc') throw new Error('no arc');
    expect(set.bands['hargrim:M1']).toEqual({ min: 0, max: arc.radius + 0.5 });
    for (const key of ['M2', 'M2:ex']) {
      const area = slotOf('hargrim', key).effects[0];
      if (area === undefined || area.type !== 'area' || area.placement.type !== 'ahead') {
        throw new Error('no area ahead');
      }
      expect(set.bands[`hargrim:${key}`], key).toEqual({
        min: 0,
        max: area.placement.distance + area.radius + 0.5,
      });
    }
    const dash = slotOf('hargrim', 'SPACE:ex').effects[0];
    if (dash === undefined || dash.type !== 'dash') throw new Error('no dash');
    const burst = dash.then[0];
    if (burst === undefined || burst.type !== 'area') throw new Error('no burst');
    const burstReach = dash.distance + burst.radius + 0.5;
    expect(set.bands['hargrim:SPACE:ex']).toEqual({ min: 0, max: burstReach });
    const hook = projectile(slotOf('hargrim', 'E'));
    // Chain Hook is an opener: the roster's literal 4 to 7 m, with no margin, at a target walking
    // away. It lies inside the kit band less the margin, so it only restricts the press.
    expect(set.bands['hargrim:E']).toEqual({ min: 4, max: 7, margin: 0, motion: 'away' });
    expect(7).toBeLessThanOrEqual((hook.speed * hook.lifetimeTicks) / 60 - 1);
    expect(set.clearances['hargrim:E']).toBe(hook.radius);
    // Rush is the base dash: [D - 1, D] with no margin, a dash that a root skips.
    const rush = slotOf('hargrim', 'SPACE').effects[0];
    if (rush === undefined || rush.type !== 'dash') throw new Error('no dash');
    expect(set.bands['hargrim:SPACE']).toEqual({ min: rush.distance - 1, max: rush.distance, margin: 0 });
    expect(set.clearances['hargrim:SPACE']).toBe(0.5);
    const ultimate = slotOf('hargrim', 'F').effects[0];
    if (ultimate === undefined || ultimate.type !== 'dash') throw new Error('no dash');
    const slam = ultimate.then[0];
    if (slam === undefined || slam.type !== 'area') throw new Error('no slam');
    expect(set.bands['hargrim:F']).toEqual({ min: 0, max: ultimate.distance + slam.radius + 0.5 });
  });

  it('has the reach, the width, the Lunge band and the hold of every Skerrow ability', () => {
    const shipped = KIT_SETS[1] as KitSet;
    const arcOf = (spec: AbilitySpec) => {
      const effect = spec.effects[0];
      if (effect === undefined || effect.type !== 'meleeArc') throw new Error('no arc');
      return effect;
    };
    expect(shipped.bands['skerrow:M1']).toEqual({ min: 0, max: arcOf(slotOf('skerrow', 'M1')).radius + 0.5 });
    for (const key of ['E', 'E:ex']) {
      expect(shipped.bands[`skerrow:${key}`], key).toEqual({
        min: 0,
        max: arcOf(slotOf('skerrow', key)).radius + 0.5,
      });
    }
    for (const key of ['M2', 'Q']) {
      const bolt = projectile(slotOf('skerrow', key));
      // Quiet Dart is an opener: the kit band less the margin, at a target with an escape ready.
      const reach = { min: 0, max: (bolt.speed * bolt.lifetimeTicks) / 60 };
      expect(shipped.bands[`skerrow:${key}`], key).toEqual(
        key === 'Q' ? { ...reach, needs: 'escapeReady' } : reach,
      );
      expect(shipped.clearances[`skerrow:${key}`], key).toBe(bolt.radius);
    }
    // Lunge: the base dash gives [D - 1, D] with no margin; the EX dash its distance plus its arc.
    const lunge = slotOf('skerrow', 'SPACE').effects[0];
    if (lunge === undefined || lunge.type !== 'dash') throw new Error('no dash');
    expect(shipped.bands['skerrow:SPACE']).toEqual({ min: lunge.distance - 1, max: lunge.distance, margin: 0 });
    const exLunge = slotOf('skerrow', 'SPACE:ex').effects[0];
    if (exLunge === undefined || exLunge.type !== 'dash') throw new Error('no dash');
    const exArc = exLunge.then[0];
    if (exArc === undefined || exArc.type !== 'meleeArc') throw new Error('no arc');
    expect(shipped.bands['skerrow:SPACE:ex']).toEqual({ min: 0, max: exLunge.distance + exArc.radius + 0.5 });
    // Reaper's Dance: the teleport plus its arc; held for a target at or below the damage it does.
    const [jump, reap] = slotOf('skerrow', 'F').effects;
    if (jump === undefined || jump.type !== 'teleport') throw new Error('no teleport');
    if (reap === undefined || reap.type !== 'meleeArc') throw new Error('no arc');
    expect(shipped.bands['skerrow:F']).toEqual({ min: 0, max: jump.range + reap.radius + 0.5 });
    const damage = reap.effects.find((e) => e.type === 'damage');
    expect(damage?.type === 'damage' && damage.amount).toBe(HELD['skerrow:F']);
    // Vanish Step: a teleport the oracle finds a landing for.
    const vanish = slotOf('skerrow', 'R').effects[0];
    if (vanish === undefined || vanish.type !== 'teleport') throw new Error('no teleport');
    expect(ESCAPES['skerrow:R']?.teleport).toBe(vanish.range);
    expect(vanish.fixed).toBe(false);
    const skip = slotOf('quillon', 'SPACE').effects[0];
    if (skip === undefined || skip.type !== 'teleport') throw new Error('no teleport');
    expect(ESCAPES['quillon:SPACE']?.teleport).toBe(skip.range);
    expect(ESCAPES['quillon:R']?.after?.teleport).toBe(skip.range);
  });
  it('has the reach, the width, the opener condition and the escape of every Lumeth ability that is pressed', () => {
    const shipped = KIT_SETS[1] as KitSet;
    const bolt = projectile(slotOf('lumeth', 'M1'));
    expect(shipped.bands['lumeth:M1']).toEqual({ min: 0, max: (bolt.speed * bolt.lifetimeTicks) / 60 });
    expect(shipped.clearances['lumeth:M1']).toBe(bolt.radius);
    // Binding Sigil: the area at the aim, range plus radius plus 0.5, at a target beside an ally.
    const sigil = slotOf('lumeth', 'Q').effects[0];
    if (sigil === undefined || sigil.type !== 'area' || sigil.placement.type !== 'aim') {
      throw new Error('no area at the aim');
    }
    expect(shipped.bands['lumeth:Q']).toEqual({
      min: 0,
      max: sigil.placement.range + sigil.radius + 0.5,
      needs: 'nearAlly',
    });
    expect(shipped.clearances['lumeth:Q']).toBe(0.5);
    // Lantern Burst: an area around her; the trigger of the oracle is her 3 m.
    const burst = slotOf('lumeth', 'E').effects[0];
    if (burst === undefined || burst.type !== 'area') throw new Error('no area');
    expect(shipped.bands['lumeth:E']).toEqual({ min: 0, max: burst.radius + 0.5 });
    expect(ESCAPES['lumeth:E']).toEqual({ slot: 'E', teleport: null, after: null });
    expect(WITHIN['lumeth']).toBe(3);
    // Glide: the dash of the row is the kit's, and it goes after Lantern Burst.
    const glide = slotOf('lumeth', 'SPACE').effects[0];
    if (glide === undefined || glide.type !== 'dash') throw new Error('no dash');
    expect(ESCAPES['lumeth:SPACE']).toEqual({
      slot: 'SPACE',
      teleport: null,
      dash: glide.distance,
      after: { slot: 'E', teleport: null },
    });
    // Soothing Surge, Aegis Veil and Dawnbloom reach allies only: no enemy band, whatever else the
    // kit lists (Dawnbloom's slow on enemies is no reason to press it).
    for (const key of ['M2', 'M2:ex', 'R', 'R:ex', 'F']) {
      expect(shipped.bands[`lumeth:${key}`], key).toBeUndefined();
    }
  });

  it('has the reach, the need, the width and the speed of every Lumeth ally row', () => {
    const shipped = KIT_SETS[1] as KitSet;
    // What a slot does to allies: the allyEffects of its bolt, or the effects of its area on allies.
    const toAllies = (slot: Slot) => {
      const first = slotOf('lumeth', slot).effects[0];
      if (first === undefined) throw new Error('no effect');
      if (first.type === 'projectile') {
        return { bolt: first, area: undefined, effects: first.allyEffects ?? [] };
      }
      if (first.type === 'area' && first.targets === 'allies') {
        return { bolt: undefined, area: first, effects: first.effects };
      }
      throw new Error('reaches no ally');
    };
    const given = (effects: readonly { type: string; amount?: number; absorb?: number }[]) => {
      const heals = effects.flatMap((e) => (e.type === 'heal' ? [e.amount ?? 0] : []));
      const shields = effects.flatMap((e) => (e.type === 'shield' ? [e.absorb ?? 0] : []));
      return heals.length > 0 ? heals.reduce((a, b) => a + b, 0) : shields.reduce((a, b) => a + b, 0);
    };
    expect(Object.keys(shipped.allies).sort()).toEqual(['lumeth:F', 'lumeth:M1', 'lumeth:M2', 'lumeth:R']);
    for (const slot of ['M1', 'M2', 'R', 'F'] as const) {
      const { bolt, area, effects } = toAllies(slot);
      const row = shipped.allies[`lumeth:${slot}`] as AllyRow;
      expect(row.bolt, slot).toBe(bolt !== undefined);
      // A bolt reaches speed times lifetime over 60 (multiplied first), an area its radius plus 0.5.
      expect(row.reach, slot).toBe(
        bolt !== undefined ? (bolt.speed * bolt.lifetimeTicks) / 60 : (area?.radius ?? NaN) + 0.5,
      );
      expect(row.need, slot).toBe(given(effects));
      expect(row.clearance, slot).toBe(bolt !== undefined ? bolt.radius : 0);
      expect(row.speed, slot).toBe(bolt !== undefined ? bolt.speed : 0);
    }
    // The numbers of the roster and of the sub-plan: needs 10, 14, 30 and 30; reaches 12 (11 with
    // the margin), 10.133 (9.133), and 5.5 (4.5); clearances 0.35 and 0.5.
    expect(shipped.allies['lumeth:M1']).toMatchObject({ need: 10, reach: 12, clearance: 0.35 });
    expect(shipped.allies['lumeth:M2']).toMatchObject({ need: 14, clearance: 0.5 });
    expect(shipped.allies['lumeth:R']).toMatchObject({ need: 30, reach: 5.5 });
    expect(shipped.allies['lumeth:F']).toMatchObject({ need: 30, reach: 5.5 });
    // Her M1 is also pressed at an enemy, so it keeps its band beside its ally row.
    expect(shipped.bands['lumeth:M1']).toBeDefined();
  });
});
