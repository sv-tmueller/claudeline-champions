import { SLOTS, createMatch, parseArenaDef, type GameState } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { Hud, type HudElement, type HudHandles } from './hud';
import { KILL_FEED_LINES, KILL_FEED_TICKS, createKillFeed, type KillFeed } from './kill-feed';
import type { SlotSource } from './hud-views';

// A stand-in for an element that logs every write, so a test can say how
// often and with what the HUD touched the DOM. No jsdom: the client tests run in node.
type Fake = HudElement & { log: string[] };

function fake(): Fake {
  const log: string[] = [];
  const dataset = new Proxy<Record<string, string | undefined>>(
    {},
    {
      set(target, key, value: string) {
        log.push(`data-${String(key)}=${value}`);
        target[key as string] = value;
        return true;
      },
    },
  );
  let text: string | null = '';
  let transform = '';
  return {
    log,
    dataset,
    style: {
      get transform() {
        return transform;
      },
      set transform(value: string) {
        log.push(`transform=${value}`);
        transform = value;
      },
    },
    get textContent() {
      return text;
    },
    set textContent(value: string | null) {
      log.push(`text=${String(value)}`);
      text = value;
    },
  };
}

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
    },
    parseArenaDef(arena01Json),
    1,
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
    lines: Array.from({ length: KILL_FEED_LINES }, () => ({ line: fake(), killer: fake(), victim: fake() })),
  };
  const feed = createKillFeed();
  const handles: HudHandles = elements;
  const hud = new Hud(handles, state.champions, 0, feed);
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
    expect(elements.healthText.log).toEqual(['text=120 / 120']);
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
    expect(elements.timer.log).toEqual(['text=1:30']);
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
    expect(elements.healthText.log).toEqual(['text=91 / 120']);
    expect(elements.healthFill.log).toEqual([`transform=scaleX(${91 / 120})`]);
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

  it('shows 1 for health 0.2 and 0 for none', () => {
    const { hud, state, elements } = rig();
    hud.update(state);
    local(state).health = 0.2;
    hud.update(state);
    expect(elements.healthText.log.at(-1)).toBe('text=1 / 120');
    local(state).health = 0;
    hud.update(state);
    expect(elements.healthText.log.at(-1)).toBe('text=0 / 120');
    expect(elements.healthFill.log.at(-1)).toBe('transform=scaleX(0)');
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

  it('writes the windup flag on all seven slots once', () => {
    const { hud, state, elements } = rig();
    const source: SlotSource = local(state);
    hud.update(state);
    clearLogs(elements);
    source.cast = { slot: 'Q' };
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

describe('HUD round', () => {
  it('writes the timer at tick 0 and again at 60, not in between', () => {
    const { hud, state, elements } = rig();
    hud.update(state);
    expect(elements.timer.log).toEqual(['text=1:30']);
    for (let tick = 1; tick < 60; tick++) {
      state.tick = tick;
      hud.update(state);
    }
    expect(elements.timer.log).toEqual(['text=1:30']);
    state.tick = 60;
    hud.update(state);
    expect(elements.timer.log).toEqual(['text=1:30', 'text=1:29']);
  });

  it('holds the timer at 0:00', () => {
    const { hud, state, elements } = rig();
    state.tick = 6000;
    hud.update(state);
    expect(elements.timer.log).toEqual(['text=0:00']);
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

  it('hides the line once when it expires and writes nothing else', () => {
    const { hud, state, feed, elements } = rig();
    state.tick = 100;
    feed.push(100, 2, 0);
    hud.update(state);
    // The timer moves with the tick, so it is left out of the counts.
    const others = (): number => writeCount(elements) - elements.timer.log.length;
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
    feed.push(0, -1, 1);
    hud.update(state);
    expect(elements.lines[0]?.killer.log).toEqual(['text=Ring', 'data-team=ring']);
    expect(elements.lines[0]?.victim.log).toEqual(['text=Quillon', 'data-team=ally']);
  });
});
