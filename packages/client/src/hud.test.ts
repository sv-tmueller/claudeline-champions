import { RING_SOURCE_ID, SLOTS, createMatch, parseArenaDef, type CastState, type GameState } from '@claudeline/sim';
import { describe, expect, it, vi } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { Hud, type HudHandles } from './hud';
import { KILL_FEED_LINES, KILL_FEED_TICKS, createKillFeed, type KillFeed } from './kill-feed';
import type { SlotSource } from './hud-views';
import { fake, type Fake } from './test-fake';
import { TEST_KITS } from './test-kits';

interface Rig {
  hud: Hud;
  state: GameState;
  feed: KillFeed;
  elements: {
    healthText: Fake;
    healthFill: Fake;
    energyFill: Fake;
    exMark: Fake;
    ultimateMark: Fake;
    slots: { icon: Fake; seconds: Fake }[];
    score: Fake;
    timer: Fake;
    ring: { root: Fake; countdown: Fake; radius: Fake; distance: Fake };
    lines: { line: Fake; killer: Fake; victim: Fake }[];
  };
}

function rig(): Rig {
  const state = createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'lumeth', team: 'B' },
        { championId: 'skerrow', team: 'B' },
      ],
      roundsToWin: 3,
    },
    parseArenaDef(arena01Json),
    1,
    TEST_KITS,
  );
  const elements = {
    healthText: fake(),
    healthFill: fake(),
    energyFill: fake(),
    exMark: fake(),
    ultimateMark: fake(),
    slots: SLOTS.map(() => ({ icon: fake(), seconds: fake() })),
    score: fake(),
    timer: fake(),
    ring: { root: fake(), countdown: fake(), radius: fake(), distance: fake() },
    lines: Array.from({ length: KILL_FEED_LINES }, () => ({ line: fake(), killer: fake(), victim: fake() })),
  };
  const feed = createKillFeed();
  const handles: HudHandles = elements;
  const hud = new Hud(handles, state.champions, 0, feed, 3);
  return { hud, state, feed, elements };
}

function allElements(elements: Rig['elements']): Fake[] {
  return [
    elements.healthText,
    elements.healthFill,
    elements.energyFill,
    elements.exMark,
    elements.ultimateMark,
    ...elements.slots.flatMap((slot) => [slot.icon, slot.seconds]),
    elements.score,
    elements.timer,
    elements.ring.root,
    elements.ring.countdown,
    elements.ring.radius,
    elements.ring.distance,
    ...elements.lines.flatMap((line) => [line.line, line.killer, line.victim]),
  ];
}

function writeCount(elements: Rig['elements']): number {
  return allElements(elements).reduce((sum, element) => sum + element.log.length, 0);
}

function clearLogs(elements: Rig['elements']): void {
  for (const element of allElements(elements)) element.log.length = 0;
}

function local(state: GameState): SlotSource & GameState['champions'][number] {
  const champion = state.champions[0];
  if (!champion) throw new Error('no champion');
  return champion;
}

describe('HUD first update', () => {
  it('writes every element once', () => {
    const { hud, state, elements } = rig();
    hud.update(state);
    expect(elements.healthText.log).toEqual(['text=160 / 160']);
    expect(elements.healthFill.log).toEqual(['transform=scaleX(1)']);
    expect(elements.energyFill.log).toEqual(['transform=scaleX(0)']);
    expect(elements.exMark.log).toEqual(['data-ready=false']);
    expect(elements.ultimateMark.log).toEqual(['data-ready=false']);
    for (const [i, slot] of elements.slots.entries()) {
      expect(slot.seconds.log).toEqual(['text=']);
      expect(slot.icon.log).toEqual([
        'data-ready=true',
        'data-windup=false',
        `data-blocked=${i === SLOTS.length - 1}`,
      ]);
    }
    expect(elements.score.log).toEqual(['text=0 : 0']);
    expect(elements.timer.log).toEqual(['text=1:30', 'data-sudden=false']);
    for (const { line, killer, victim } of elements.lines) {
      expect(line.log).toEqual(['data-visible=false']);
      expect(killer.log).toEqual([]);
      expect(victim.log).toEqual([]);
    }
  });

  it('writes nothing on a second update of the same state', () => {
    const { hud, state, elements } = rig();
    hud.update(state);
    clearLogs(elements);
    hud.update(state);
    hud.update(state);
    expect(writeCount(elements)).toBe(0);
  });
});

describe('HUD health', () => {
  it('writes the rounded-up health and the fill once per change', () => {
    const { hud, state, elements } = rig();
    hud.update(state);
    clearLogs(elements);
    local(state).health = 90.5;
    hud.update(state);
    expect(elements.healthText.log).toEqual(['text=91 / 160']);
    expect(elements.healthFill.log).toEqual([`transform=scaleX(${91 / 160})`]);
    expect(writeCount(elements)).toBe(2);
  });

  it('writes nothing while the rounded-up health stays the same', () => {
    const { hud, state, elements } = rig();
    local(state).health = 91;
    hud.update(state);
    clearLogs(elements);
    local(state).health = 90.2;
    hud.update(state);
    expect(writeCount(elements)).toBe(0);
  });

  it('writes the text and the fill once when only the maximum health changes', () => {
    const { hud, state, elements } = rig();
    local(state).health = 91;
    hud.update(state);
    clearLogs(elements);
    local(state).maxHealth = 130;
    hud.update(state);
    expect(elements.healthText.log).toEqual(['text=91 / 130']);
    expect(elements.healthFill.log).toEqual([`transform=scaleX(${91 / 130})`]);
    expect(writeCount(elements)).toBe(2);
  });

  it('writes the template text and fill for every whole health from 0 to the maximum', () => {
    const { hud, state, elements } = rig();
    for (let health = 0; health <= 160; health++) {
      local(state).health = health;
      hud.update(state);
      expect(elements.healthText.log.at(-1), `health ${health}`).toBe(`text=${health} / 160`);
      expect(elements.healthFill.log.at(-1), `health ${health}`).toBe(`transform=scaleX(${health / 160})`);
    }
  });

  it('shows 1 for health 0.2 and 0 for none', () => {
    const { hud, state, elements } = rig();
    hud.update(state);
    local(state).health = 0.2;
    hud.update(state);
    expect(elements.healthText.log.at(-1)).toBe('text=1 / 160');
    local(state).health = 0;
    hud.update(state);
    expect(elements.healthText.log.at(-1)).toBe('text=0 / 160');
    expect(elements.healthFill.log.at(-1)).toBe('transform=scaleX(0)');
  });
});

describe('HUD clamps', () => {
  it('clamps the health fill to full when health is above the maximum', () => {
    const { hud, state, elements } = rig();
    local(state).maxHealth = 160;
    local(state).health = 170;
    hud.update(state);
    expect(elements.healthFill.log).toEqual(['transform=scaleX(1)']);
  });

  it('clamps the health fill to empty when health is negative', () => {
    const { hud, state, elements } = rig();
    local(state).maxHealth = 160;
    local(state).health = -3;
    hud.update(state);
    expect(elements.healthFill.log).toEqual(['transform=scaleX(0)']);
  });

  it('clamps the energy fill to full above 100', () => {
    const { hud, state, elements } = rig();
    local(state).energy = 130;
    hud.update(state);
    expect(elements.energyFill.log).toEqual(['transform=scaleX(1)']);
  });

  it('clamps the energy fill to empty below 0', () => {
    const { hud, state, elements } = rig();
    local(state).energy = -10;
    hud.update(state);
    expect(elements.energyFill.log).toEqual(['transform=scaleX(0)']);
  });
});

describe('HUD energy', () => {
  it('flips the EX mark once at 25', () => {
    const { hud, state, elements } = rig();
    local(state).energy = 24;
    hud.update(state);
    clearLogs(elements);
    local(state).energy = 25;
    hud.update(state);
    expect(elements.exMark.log).toEqual(['data-ready=true']);
    expect(elements.energyFill.log).toEqual(['transform=scaleX(0.25)']);
    expect(elements.ultimateMark.log).toEqual([]);
    expect(writeCount(elements)).toBe(2);
  });

  it('writes the template fill for every whole energy from 0 to 100', () => {
    const { hud, state, elements } = rig();
    for (let energy = 0; energy <= 100; energy++) {
      local(state).energy = energy;
      hud.update(state);
      expect(elements.energyFill.log.at(-1), `energy ${energy}`).toBe(`transform=scaleX(${energy / 100})`);
    }
  });

  it('flips the ultimate mark and unblocks F once at 100', () => {
    const { hud, state, elements } = rig();
    local(state).energy = 99;
    hud.update(state);
    clearLogs(elements);
    local(state).energy = 100;
    hud.update(state);
    expect(elements.ultimateMark.log).toEqual(['data-ready=true']);
    expect(elements.energyFill.log).toEqual(['transform=scaleX(1)']);
    const ultimate = elements.slots[SLOTS.indexOf('F')];
    expect(ultimate?.icon.log).toEqual(['data-blocked=false']);
    expect(writeCount(elements)).toBe(3);
  });
});

describe('HUD cooldowns and windup', () => {
  it('writes nothing while the whole seconds stay the same, then once per change', () => {
    const { hud, state, elements } = rig();
    const source: SlotSource = local(state);
    source.cooldowns = [120, 0, 0, 0, 0, 0, 0];
    hud.update(state);
    expect(elements.slots[0]?.seconds.log).toEqual(['text=2']);
    expect(elements.slots[0]?.icon.log[0]).toBe('data-ready=false');
    clearLogs(elements);
    source.cooldowns = [61, 0, 0, 0, 0, 0, 0];
    hud.update(state);
    expect(writeCount(elements)).toBe(0);
    source.cooldowns = [60, 0, 0, 0, 0, 0, 0];
    hud.update(state);
    expect(elements.slots[0]?.seconds.log).toEqual(['text=1']);
    expect(writeCount(elements)).toBe(1);
  });

  it('marks a slot ready again when its cooldown ends', () => {
    const { hud, state, elements } = rig();
    const source: SlotSource = local(state);
    source.cooldowns = [0, 0, 0, 5, 0, 0, 0];
    hud.update(state);
    clearLogs(elements);
    source.cooldowns = [0, 0, 0, 0, 0, 0, 0];
    hud.update(state);
    expect(elements.slots[3]?.seconds.log).toEqual(['text=']);
    expect(elements.slots[3]?.icon.log).toEqual(['data-ready=true']);
  });

  it('shows 99 up to 5940 ticks of cooldown and the number itself above', () => {
    const { hud, state, elements } = rig();
    const source: SlotSource = local(state);
    source.cooldowns = [5940, 0, 0, 0, 0, 0, 0];
    hud.update(state);
    expect(elements.slots[0]?.seconds.log).toEqual(['text=99']);
    source.cooldowns = [5941, 0, 0, 0, 0, 0, 0];
    hud.update(state);
    expect(elements.slots[0]?.seconds.log).toEqual(['text=99', 'text=100']);
    source.cooldowns = [6000, 0, 0, 0, 0, 0, 0];
    hud.update(state);
    expect(elements.slots[0]?.seconds.log).toEqual(['text=99', 'text=100']);
  });

  it('writes the windup flag on all seven slots once', () => {
    const { hud, state, elements } = rig();
    const source: SlotSource = local(state);
    hud.update(state);
    clearLogs(elements);
    const windup: CastState = { castId: 1, slot: 'Q', ex: false, windupTicks: 12, windupLeft: 12 };
    source.cast = windup;
    hud.update(state);
    for (const slot of elements.slots) expect(slot.icon.log).toEqual(['data-windup=true']);
    expect(writeCount(elements)).toBe(7);
    hud.update(state);
    expect(writeCount(elements)).toBe(7);
    source.cast = null;
    hud.update(state);
    for (const slot of elements.slots) expect(slot.icon.log).toEqual(['data-windup=true', 'data-windup=false']);
  });
});

function match(state: GameState): NonNullable<GameState['match']> {
  if (!state.match) throw new Error('no match flow');
  return state.match;
}

describe('HUD round', () => {
  const RING = { x: 0, y: 0, radius: 12, damagePerTick: 0.1 };

  it('shows the full round in the warmup', () => {
    const { hud, state, elements } = rig();
    for (const phaseTicks of [0, 90, 179]) {
      match(state).phaseTicks = phaseTicks;
      hud.update(state);
    }
    expect(elements.timer.log).toEqual(['text=1:30', 'data-sudden=false']);
  });

  it('writes the timer for round ticks 0, 59 and 60 and 5400', () => {
    const { hud, state, elements } = rig();
    match(state).phase = 'round';
    for (const [phaseTicks, text] of [
      [0, '1:30'],
      [59, '1:30'],
      [60, '1:29'],
      [5400, '0:00'],
    ] as const) {
      match(state).phaseTicks = phaseTicks;
      hud.update(state);
      expect(elements.timer.log.filter((entry) => entry.startsWith('text=')).at(-1), `phase tick ${phaseTicks}`).toBe(
        `text=${text}`,
      );
    }
    // Written at 1:30 once, then at 1:29 and 0:00.
    expect(elements.timer.log.filter((entry) => entry.startsWith('text='))).toEqual([
      'text=1:30',
      'text=1:29',
      'text=0:00',
    ]);
  });

  it('writes sudden death and its flag once when the ring comes, and the time again when it goes', () => {
    const { hud, state, elements } = rig();
    match(state).phase = 'round';
    match(state).phaseTicks = 5400;
    hud.update(state);
    clearLogs(elements);
    match(state).phaseTicks = 5401;
    match(state).ring = RING;
    hud.update(state);
    expect(elements.timer.log).toEqual(['text=Sudden death', 'data-sudden=true']);
    match(state).phaseTicks = 5402;
    hud.update(state);
    hud.update(state);
    expect(elements.timer.log).toEqual(['text=Sudden death', 'data-sudden=true']);
    // The next round: the ring is gone and the clock starts again.
    clearLogs(elements);
    match(state).ring = null;
    match(state).phaseTicks = 0;
    hud.update(state);
    expect(elements.timer.log).toEqual(['text=1:30', 'data-sudden=false']);
  });

  it('keeps the timer text after the round is decided', () => {
    const { hud, state, elements } = rig();
    match(state).phase = 'round';
    match(state).phaseTicks = 600;
    hud.update(state);
    clearLogs(elements);
    match(state).phase = 'roundEnd';
    match(state).phaseTicks = 0;
    hud.update(state);
    match(state).phase = 'matchEnd';
    hud.update(state);
    expect(elements.timer.log).toEqual([]);
  });

  it('keeps sudden death on the timer through the pause after the round', () => {
    const { hud, state, elements } = rig();
    match(state).phase = 'round';
    match(state).phaseTicks = 5500;
    match(state).ring = RING;
    hud.update(state);
    clearLogs(elements);
    match(state).phase = 'roundEnd';
    match(state).phaseTicks = 1;
    hud.update(state);
    expect(elements.timer.log).toEqual([]);
  });

  it('writes a new score once', () => {
    const { hud, state, elements } = rig();
    hud.update(state);
    expect(elements.score.log).toEqual(['text=0 : 0']);
    match(state).phase = 'roundEnd';
    match(state).score = { A: 1, B: 0 };
    hud.update(state);
    hud.update(state);
    expect(elements.score.log).toEqual(['text=0 : 0', 'text=1 : 0']);
  });

  it('writes the score for a match of one round to win and past the rounds to win', () => {
    const { elements, state, feed } = rig();
    const hud = new Hud(elements, state.champions, 0, feed, 1);
    match(state).score = { A: 1, B: 0 };
    hud.update(state);
    // A score past the table falls back to the template, whatever the rounds to win.
    match(state).score = { A: 4, B: 2 };
    hud.update(state);
    expect(elements.score.log).toEqual(['text=1 : 0', 'text=4 : 2']);
  });

  it('reads a state without match flow as 0 : 0 and 1:30', () => {
    const { hud, state, elements } = rig();
    delete state.match;
    hud.update(state);
    expect(elements.score.log).toEqual(['text=0 : 0']);
    expect(elements.timer.log).toEqual(['text=1:30', 'data-sudden=false']);
  });

  it('writes nothing on a second update of a round in progress', () => {
    const { hud, state, elements } = rig();
    match(state).phase = 'round';
    match(state).phaseTicks = 1234;
    hud.update(state);
    clearLogs(elements);
    hud.update(state);
    expect(writeCount(elements)).toBe(0);
  });
});

describe('HUD kill feed', () => {
  it('writes one line for a death, with names and sides', () => {
    const { hud, state, feed, elements } = rig();
    state.tick = 100;
    hud.update(state);
    clearLogs(elements);
    feed.push(100, 0, 2);
    hud.update(state);
    const [first] = elements.lines;
    expect(first?.line.log).toEqual(['data-visible=true']);
    expect(first?.killer.log).toEqual(['text=Hargrim', 'data-team=ally']);
    expect(first?.victim.log).toEqual(['text=Lumeth', 'data-team=enemy']);
    expect(writeCount(elements)).toBe(5);
  });

  it('reads no line while the feed has not changed', () => {
    const { hud, state, feed, elements } = rig();
    state.tick = 100;
    feed.push(100, 2, 0);
    hud.update(state);
    const read = vi.spyOn(feed, 'line');
    state.tick = 101;
    hud.update(state);
    expect(read).not.toHaveBeenCalled();
    state.tick = 100 + KILL_FEED_TICKS;
    hud.update(state);
    // The expiry changed the feed, so the loop ran and hid the line without reading it.
    expect(elements.lines[0]?.line.log).toEqual(['data-visible=true', 'data-visible=false']);
    expect(read).not.toHaveBeenCalled();
    feed.push(state.tick, 0, 2);
    hud.update(state);
    expect(read).toHaveBeenCalled();
  });

  it('hides the line once when it expires and writes nothing else', () => {
    const { hud, state, feed, elements } = rig();
    state.tick = 100;
    feed.push(100, 2, 0);
    hud.update(state);
    const others = (): number => writeCount(elements);
    clearLogs(elements);
    state.tick = 100 + KILL_FEED_TICKS - 1;
    hud.update(state);
    expect(others()).toBe(0);
    state.tick = 100 + KILL_FEED_TICKS;
    hud.update(state);
    expect(elements.lines[0]?.line.log).toEqual(['data-visible=false']);
    expect(others()).toBe(1);
    hud.update(state);
    expect(others()).toBe(1);
  });

  it('moves a line up when an older one expires', () => {
    const { hud, state, feed, elements } = rig();
    state.tick = 100;
    feed.push(100, 2, 0);
    feed.push(200, 0, 3);
    hud.update(state);
    clearLogs(elements);
    state.tick = 400;
    hud.update(state);
    expect(elements.lines[0]?.killer.log).toEqual(['text=Hargrim', 'data-team=ally']);
    expect(elements.lines[0]?.victim.log).toEqual(['text=Skerrow', 'data-team=enemy']);
    expect(elements.lines[1]?.line.log).toEqual(['data-visible=false']);
  });

  it('names an unknown killer as the ring', () => {
    const { hud, state, feed, elements } = rig();
    feed.push(0, RING_SOURCE_ID, 1);
    hud.update(state);
    expect(elements.lines[0]?.killer.log).toEqual(['text=Ring', 'data-team=ring']);
    expect(elements.lines[0]?.victim.log).toEqual(['text=Quillon', 'data-team=ally']);
  });
});
