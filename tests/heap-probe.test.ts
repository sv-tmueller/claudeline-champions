import { describe, expect, it, vi } from 'vitest';
import {
  LIVE_EXCLUDED,
  allocationsOverAWindow,
  conclude,
  measureWindows,
  pickAsserted,
  probeLine,
  summarise,
  type Allocations,
  type ProfileNode,
} from '../e2e/heap-probe';

// The pure part of the heap probe's shared module (e2e/heap-probe.ts), which the
// two probe specs run in a browser: how a profile is sorted into counted code,
// bots, sweep files and the rest, and which window's figure a spec asserts.

function node(url: string, functionName: string, selfSize: number, children: ProfileNode[] = []): ProfileNode {
  return { callFrame: { functionName, url }, selfSize, children };
}

const CLIENT = 'http://127.0.0.1:5173/packages/client/src/';
const SIM = 'http://127.0.0.1:5173/packages/sim/src/';
const BOTS = 'http://127.0.0.1:5173/packages/bots/src/';

describe('summarise', () => {
  it('counts the client modules of the frame path, and nothing from the sim or the bots', () => {
    const root = node('', '(root)', 0, [
      node(`${CLIENT}main.ts`, 'frameMany', 300),
      node(`${CLIENT}hook-text.ts`, 'intText', 8),
      node(`${CLIENT}hud-dom.ts`, 'buildHud', 5000),
      node(`${SIM}input.ts`, 'resolveInput', 70),
      node(`${BOTS}bot.ts`, 'think', 900),
    ]);
    const result = summarise(root);
    expect(result.combat).toBe(308);
    expect(result.combatByFunction).toEqual({ 'main.ts:frameMany': 300, 'hook-text.ts:intText': 8 });
    expect(result.total).toBe(300 + 8 + 5000 + 70 + 900);
  });

  it('logs the bots bytes as their own figure, keyed by function, and never counts them', () => {
    const root = node('', '(root)', 0, [
      node(`${BOTS}bot.ts`, 'think', 900, [node(`${BOTS}plan.ts`, 'makePlan', 120)]),
      node(`${BOTS}bot.ts`, 'think', 40),
      node(`${CLIENT}bot-driver.ts`, 'think', 16),
    ]);
    const result = summarise(root);
    expect(result.bots).toBe(1060);
    expect(result.botsByFunction).toEqual({ 'bots/bot.ts:think': 940, 'bots/plan.ts:makePlan': 120 });
    expect(result.combat).toBe(16);
    expect(result.combatByFunction).toEqual({ 'bot-driver.ts:think': 16 });
  });

  it('leaves the sweep files of the sim out of the bytes outside them', () => {
    const root = node('', '(root)', 0, [
      node(`${SIM}projectile.ts`, 'sweep', 10_000),
      node(`${SIM}geometry.ts`, 'distance', 2000),
      node(`${SIM}step.ts`, 'step', 300),
    ]);
    const result = summarise(root);
    expect(result.total).toBe(12_300);
    expect(result.outsideSweep).toBe(300);
  });

  it("keeps three's animation callback and the fake clock apart from the counted code", () => {
    const root = node('', '(root)', 0, [
      node('http://127.0.0.1:5173/node_modules/three/build/three.module.js', 'onAnimationFrame', 36),
      node('', 'requestAnimationFrame', 24),
    ]);
    const result = summarise(root);
    expect(result.onAnimationFrame).toBe(36);
    expect(result.fakeRequestAnimationFrame).toBe(24);
    expect(result.combat).toBe(0);
  });
});

function window(combat: number): Allocations {
  return {
    total: 0,
    outsideSweep: 0,
    combat,
    excluded: 0,
    bots: 0,
    onAnimationFrame: 0,
    fakeRequestAnimationFrame: 0,
    combatByFunction: {},
    excludedByFunction: {},
    botsByFunction: {},
  };
}

describe('summarise with an excluded function', () => {
  const root = node('', '(root)', 0, [
    node(`${CLIENT}main.ts`, 'frameMany', 300),
    node(`${CLIENT}entity-views.ts`, 'draw', 800),
    node(`${CLIENT}entity-views.ts`, 'acquire', 24),
  ]);

  it('keeps the excluded bytes out of the counted code and logs them apart', () => {
    const result = summarise(root, LIVE_EXCLUDED);
    expect(result.combat).toBe(324);
    expect(result.combatByFunction).toEqual({ 'main.ts:frameMany': 300, 'entity-views.ts:acquire': 24 });
    expect(result.excluded).toBe(800);
    expect(result.excludedByFunction).toEqual({ 'entity-views.ts:draw': 800 });
  });

  it('counts everything of the pattern when nothing is excluded', () => {
    const result = summarise(root);
    expect(result.combat).toBe(1124);
    expect(result.excluded).toBe(0);
  });
});

describe('LIVE_EXCLUDED', () => {
  it('matches the entity views draw and nothing else, so no other spike site is hidden', () => {
    expect(LIVE_EXCLUDED.test('entity-views.ts:draw')).toBe(true);
    for (const key of ['main.ts:draw', 'impact-rings.ts:draw', 'entity-views.ts:find', 'entity-views.ts:drawAll', 'sim/entity-views.ts:draw']) {
      expect(LIVE_EXCLUDED.test(key), key).toBe(false);
    }
  });
});

describe('pickAsserted', () => {
  it('takes the middle window of an odd count, so one spiked window does not decide', () => {
    expect(pickAsserted([window(336), window(4020), window(408)]).combat).toBe(408);
    expect(pickAsserted([window(5), window(1), window(9), window(3), window(7)]).combat).toBe(5);
  });

  it('refuses an even count and no windows', () => {
    expect(() => pickAsserted([window(1), window(2)])).toThrow(/odd/);
    expect(() => pickAsserted([])).toThrow(/no windows/);
  });
});

describe('probeLine', () => {
  it('names the scene and the attempt and gives seven figures per window, the excluded bytes last', () => {
    const first = { ...window(336), total: 900_000, outsideSweep: 280_000, bots: 1200, excluded: 456 };
    const second = { ...window(408), total: 890_000, onAnimationFrame: 1, fakeRequestAnimationFrame: 2, outsideSweep: 270_000 };
    expect(probeLine('live', 1, [first, second])).toBe(
      'heap probe live attempt 1: bytes per window, total/onAnimationFrame/fake requestAnimationFrame/outside the sweep files/counted code/bots/excluded: ' +
        '900000/0/0/280000/336/1200/456 890000/1/2/270000/408/0/0',
    );
  });
});

describe('conclude', () => {
  it('logs the line and the functions of each window, and returns the median window and the lowest outside figure', () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line));
    try {
      const windows: Allocations[] = [
        { ...window(300), outsideSweep: 90_000, combatByFunction: { 'main.ts:frameMany': 300 } },
        { ...window(4000), outsideSweep: 85_000, combatByFunction: { 'hud.ts:updateRing': 4000 } },
        { ...window(0), outsideSweep: 95_000, excluded: 480, excludedByFunction: { 'entity-views.ts:draw': 480 } },
      ];
      const measured = conclude('live', 2, windows);
      expect(measured.asserted.combat).toBe(300);
      expect(measured.lowestOutsideSweep).toBe(85_000);
      expect(measured.windows).toHaveLength(3);
      expect(logged[0]).toBe(probeLine('live', 2, windows));
      expect(logged).toHaveLength(4);
      expect(logged[2]).toContain('"hud.ts:updateRing":4000');
      expect(logged[3]).toContain('excluded {"entity-views.ts:draw":480}');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('measureWindows', () => {
  it('profiles each window in turn, counting every function of the pattern, and concludes on them', async () => {
    const calls: string[] = [];
    const draw = node('http://127.0.0.1:5173/packages/client/src/entity-views.ts', 'draw', 700);
    const frameMany = node('http://127.0.0.1:5173/packages/client/src/main.ts', 'frameMany', 360);
    const page = {
      evaluate: async () => void calls.push('window'),
    };
    const cdp = {
      send: async (method: string) => {
        calls.push(method);
        return method === 'HeapProfiler.stopSampling' ? { profile: { head: node('', '(root)', 0, [draw, frameMany]) } } : {};
      },
    };
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const measured = await measureWindows(page as never, cdp as never, 'sandbox', 0, 3);
      expect(calls).toEqual(Array.from({ length: 3 }, () => ['HeapProfiler.startSampling', 'window', 'HeapProfiler.stopSampling']).flat());
      expect(measured.windows.map((w) => [w.combat, w.excluded])).toEqual([[1060, 0], [1060, 0], [1060, 0]]);
      expect(measured.asserted.combat).toBe(1060);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('allocationsOverAWindow', () => {
  it('forwards the exclusion to the summary, so the live path counts the draw bytes apart', async () => {
    const draw = node('http://127.0.0.1:5173/packages/client/src/entity-views.ts', 'draw', 700);
    const frameMany = node('http://127.0.0.1:5173/packages/client/src/main.ts', 'frameMany', 360);
    const page = { evaluate: async () => undefined };
    const cdp = {
      send: async (method: string) =>
        method === 'HeapProfiler.stopSampling' ? { profile: { head: node('', '(root)', 0, [draw, frameMany]) } } : {},
    };
    const live = await allocationsOverAWindow(page as never, cdp as never, LIVE_EXCLUDED);
    expect([live.combat, live.excluded]).toEqual([360, 700]);
    const sandbox = await allocationsOverAWindow(page as never, cdp as never);
    expect([sandbox.combat, sandbox.excluded]).toEqual([1060, 0]);
  });
});
