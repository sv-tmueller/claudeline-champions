import { describe, expect, it, vi } from 'vitest';
import {
  MARKER_FUNCTION,
  MARKER_MIN_BYTES,
  WINDOW_FRAMES,
  conclude,
  measureWindows,
  pickAsserted,
  probeLine,
  splitWindows,
  summarise,
  type Allocations,
  type ProfileNode,
  type SamplingProfile,
} from '../e2e/heap-probe';
import { originOf, readPort } from '../e2e/port';

// The pure part of the heap probe's shared module (e2e/heap-probe.ts), which the
// two probe specs run in a browser: how a profile is sorted into counted code,
// bots, sweep files and the rest, and which window's figure a spec asserts.

function node(url: string, functionName: string, selfSize: number, children: ProfileNode[] = [], id = 0): ProfileNode {
  return { id, callFrame: { functionName, url }, selfSize, children };
}

const ORIGIN = originOf(readPort());
const CLIENT = `${ORIGIN}/packages/client/src/`;
const SIM = `${ORIGIN}/packages/sim/src/`;
const BOTS = `${ORIGIN}/packages/bots/src/`;

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

  it('counts the scoreboard writer, and not its DOM module or a module that only starts with its name', () => {
    const root = node('', '(root)', 0, [
      node(`${CLIENT}scoreboard.ts`, 'update', 48),
      node(`${CLIENT}scoreboard-dom.ts`, 'bindScoreboard', 700),
      node(`${CLIENT}scoreboard-extra.ts`, 'other', 500),
    ]);
    const result = summarise(root);
    expect(result.combat).toBe(48);
    expect(result.combatByFunction).toEqual({ 'scoreboard.ts:update': 48 });
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
      node(`${ORIGIN}/node_modules/three/build/three.module.js`, 'onAnimationFrame', 36),
      node('', 'requestAnimationFrame', 24),
    ]);
    const result = summarise(root);
    expect(result.onAnimationFrame).toBe(36);
    expect(result.fakeRequestAnimationFrame).toBe(24);
    expect(result.combat).toBe(0);
  });

  it('gives the same figures for the same tree on any origin, so the probe does not depend on CLAUDELINE_PORT', () => {
    const tree = (origin: string): ProfileNode =>
      node('', '(root)', 0, [
        node(`${origin}/packages/client/src/main.ts`, 'frameMany', 300),
        node(`${origin}/packages/sim/src/input.ts`, 'resolveInput', 70),
        node(`${origin}/packages/bots/src/bot.ts`, 'think', 900),
        node(`${origin}/node_modules/three/build/three.module.js`, 'onAnimationFrame', 36),
      ]);
    const onDefault = summarise(tree('http://127.0.0.1:5173'));
    expect(onDefault.combat).toBe(300);
    expect(summarise(tree('http://127.0.0.1:6172'))).toEqual(onDefault);
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

// A profile as the CDP returns it for a session that ran three windows, each between two markers:
// node 1 is `draw` (counted), node 2 `frameMany` (counted), node 3 the marker function, node 4 a
// bots function. `selfSize` of a node is the sum of its samples, over the whole session.
const MARK = MARKER_MIN_BYTES + 100;
function session(): SamplingProfile {
  const draw = node(`${CLIENT}entity-views.ts`, 'draw', 700 + 40, [], 1);
  const frameMany = node(`${CLIENT}main.ts`, 'frameMany', 360 + 24 + 24, [], 2);
  const marker = node('', MARKER_FUNCTION, MARK * 6 + 16, [], 3);
  const think = node(`${BOTS}bot.ts`, 'think', 900, [], 4);
  const head = node('', '(root)', 0, [draw, frameMany, marker, think], 0);
  return {
    head,
    samples: [
      // Before the first window: a read between windows, not counted.
      { nodeId: 1, size: 40, ordinal: 1 },
      { nodeId: 3, size: MARK, ordinal: 2 },
      { nodeId: 1, size: 700, ordinal: 3 },
      { nodeId: 2, size: 360, ordinal: 4 },
      // A small allocation of the marker function (the array header) is not a boundary, and not counted.
      { nodeId: 3, size: 16, ordinal: 5 },
      { nodeId: 3, size: MARK, ordinal: 6 },
      // Between the windows.
      { nodeId: 2, size: 24, ordinal: 7 },
      { nodeId: 3, size: MARK, ordinal: 8 },
      { nodeId: 4, size: 900, ordinal: 9 },
      { nodeId: 3, size: MARK, ordinal: 10 },
      // The third window.
      { nodeId: 3, size: MARK, ordinal: 11 },
      { nodeId: 2, size: 24, ordinal: 12 },
      { nodeId: 3, size: MARK, ordinal: 13 },
    ],
  };
}

describe('splitWindows', () => {
  it('gives each window the samples between its two markers, and none of the reads around them', () => {
    const windows = splitWindows(session(), 3);
    expect(windows).toHaveLength(3);
    expect(windows[0]?.combat).toBe(1060);
    expect(windows[0]?.combatByFunction).toEqual({ 'entity-views.ts:draw': 700, 'main.ts:frameMany': 360 });
    expect(windows[0]?.bots).toBe(0);
    expect(windows[1]?.combat).toBe(0);
    expect(windows[1]?.bots).toBe(900);
    expect(windows[1]?.botsByFunction).toEqual({ 'bots/bot.ts:think': 900 });
    expect(windows[2]?.combat).toBe(24);
  });

  it('cuts by ordinal, not by array position, when the samples arrive in another order', () => {
    const ordered = splitWindows(session(), 3);
    // The CDP orders the ordinals, not the array: the same samples reversed, and shuffled by a fixed
    // permutation, must give the same windows.
    const reversed = session();
    reversed.samples.reverse();
    const shuffled = session();
    shuffled.samples = [7, 2, 12, 0, 9, 4, 11, 1, 6, 10, 3, 8, 5].map((at) => session().samples[at]!);
    expect(shuffled.samples.map((s) => s.ordinal)).not.toEqual(session().samples.map((s) => s.ordinal));
    expect(splitWindows(reversed, 3)).toEqual(ordered);
    expect(splitWindows(shuffled, 3)).toEqual(ordered);
  });

  it('leaves every allocation of the marker function out of the windows, the small ones too', () => {
    const windows = splitWindows(session(), 3);
    expect(windows.map((w) => w.total)).toEqual([1060, 900, 24]);
  });

  it('refuses a profile with a marker missing or extra, and says how many it found', () => {
    expect(() => splitWindows(session(), 4)).toThrow(/found 6 window markers, expected 8/);
    expect(() => splitWindows(session(), 1)).toThrow(/found 6 window markers, expected 2/);
  });
});

describe('measureWindows', () => {
  it('runs every window inside one sampling session, so the profiler forces one collection and not one per window', async () => {
    const calls: string[] = [];
    const page = { evaluate: async (_fn: unknown, frames: number) => void calls.push(`window ${frames}`) };
    const sent: Array<{ method: string; params: unknown }> = [];
    const profile = session();
    const cdp = {
      send: async (method: string, params?: unknown) => {
        calls.push(method);
        sent.push({ method, params });
        return method === 'HeapProfiler.stopSampling' ? { profile } : {};
      },
    };
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const measured = await measureWindows(page as never, cdp as never, 'sandbox', 0, 3);
      expect(calls).toEqual([
        'HeapProfiler.startSampling',
        ...Array.from({ length: 3 }, () => `window ${WINDOW_FRAMES}`),
        'HeapProfiler.stopSampling',
      ]);
      expect(sent[0]?.params).toMatchObject({ includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      expect(measured.windows.map((w) => w.combat)).toEqual([1060, 0, 24]);
      expect(measured.asserted.combat).toBe(24);
    } finally {
      spy.mockRestore();
    }
  });
});
