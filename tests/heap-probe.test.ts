import { describe, expect, it, vi } from 'vitest';
import {
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

  it('counts the camera module and the entity views draw, the two frame-path sites of the pointer aim and the drawing', () => {
    const root = node('', '(root)', 0, [
      node(`${CLIENT}main.ts`, 'sampleAim', 0, [node(`${CLIENT}camera.ts`, 'groundAimFromPointer', 96)]),
      node(`${CLIENT}camera.ts`, 'refreshCanvasRect', 24),
      node(`${CLIENT}entity-views.ts`, 'draw', 36),
      node(`${CLIENT}camera-extra.ts`, 'other', 500),
    ]);
    const result = summarise(root);
    expect(result.combat).toBe(156);
    expect(result.combatByFunction).toEqual({
      'camera.ts:groundAimFromPointer': 96,
      'camera.ts:refreshCanvasRect': 24,
      'entity-views.ts:draw': 36,
    });
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

  it('counts the sound module, routeSounds and play, and not a module that only starts with its name', () => {
    const root = node('', '(root)', 0, [
      node(`${CLIENT}audio.ts`, 'routeSounds', 64, [node(`${CLIENT}audio.ts`, 'play', 32)]),
      node(`${CLIENT}audio-extra.ts`, 'other', 500),
    ]);
    const result = summarise(root);
    expect(result.combat).toBe(96);
    expect(result.combatByFunction).toEqual({ 'audio.ts:play': 32, 'audio.ts:routeSounds': 64 });
  });

  it('counts the animation state machine and the clip sampler, and not a module that only starts with their names', () => {
    const root = node('', '(root)', 0, [
      node(`${CLIENT}main.ts`, 'draw', 0, [
        node(`${CLIENT}champion-anim.ts`, 'updateAnims', 16, [node(`${CLIENT}champion-anim.ts`, 'stepRun', 8)]),
        node(`${CLIENT}clip-sampler.ts`, 'poseChampion', 24, [node(`${CLIENT}clip-sampler.ts`, 'slerpFlat', 40)]),
      ]),
      node(`${CLIENT}champion-anim-extra.ts`, 'other', 500),
      node(`${CLIENT}clip-sampler.test.ts`, 'other', 700),
    ]);
    const result = summarise(root);
    expect(result.combat).toBe(88);
    expect(result.combatByFunction).toEqual({
      'champion-anim.ts:updateAnims': 16,
      'champion-anim.ts:stepRun': 8,
      'clip-sampler.ts:poseChampion': 24,
      'clip-sampler.ts:slerpFlat': 40,
    });
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
    bots: 0,
    onAnimationFrame: 0,
    fakeRequestAnimationFrame: 0,
    combatByFunction: {},
    botsByFunction: {},
  };
}

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
  it('names the scene and the attempt and gives six figures per window, the bots bytes last', () => {
    const first = { ...window(336), total: 900_000, outsideSweep: 280_000, bots: 1200 };
    const second = { ...window(408), total: 890_000, onAnimationFrame: 1, fakeRequestAnimationFrame: 2, outsideSweep: 270_000 };
    expect(probeLine('live', 1, [first, second])).toBe(
      'heap probe live attempt 1: bytes per window, total/onAnimationFrame/fake requestAnimationFrame/outside the sweep files/counted code/bots: ' +
        '900000/0/0/280000/336/1200 890000/1/2/270000/408/0',
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
        { ...window(0), outsideSweep: 95_000 },
      ];
      const measured = conclude('live', 2, windows);
      expect(measured.asserted.combat).toBe(300);
      expect(measured.lowestOutsideSweep).toBe(85_000);
      expect(measured.windows).toHaveLength(3);
      expect(logged[0]).toBe(probeLine('live', 2, windows));
      // Only a window with counted bytes gets a line of its functions.
      expect(logged).toHaveLength(3);
      expect(logged[2]).toContain('"hud.ts:updateRing":4000');
      expect(logged[2]).not.toContain('excluded');
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
      expect(measured.windows.map((w) => w.combat)).toEqual([1060, 1060, 1060]);
      expect(measured.asserted.combat).toBe(1060);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('allocationsOverAWindow', () => {
  it('counts the entity views draw in the window it runs, on either scene', async () => {
    const draw = node('http://127.0.0.1:5173/packages/client/src/entity-views.ts', 'draw', 700);
    const frameMany = node('http://127.0.0.1:5173/packages/client/src/main.ts', 'frameMany', 360);
    const page = { evaluate: async () => undefined };
    const cdp = {
      send: async (method: string) =>
        method === 'HeapProfiler.stopSampling' ? { profile: { head: node('', '(root)', 0, [draw, frameMany]) } } : {},
    };
    const window = await allocationsOverAWindow(page as never, cdp as never);
    expect(window.combat).toBe(1060);
    expect(window.combatByFunction).toEqual({ 'entity-views.ts:draw': 700, 'main.ts:frameMany': 360 });
  });
});
