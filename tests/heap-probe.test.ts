import { describe, expect, it } from 'vitest';
import { pickAsserted, probeLine, summarise, type Allocations, type ProfileNode } from '../e2e/heap-probe';

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
    const result = summarise(root, /^entity-views\.ts:draw$/);
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

describe('pickAsserted', () => {
  const windows = [window(336), window(4020), window(408)];

  it('takes the worst window under the worst rule', () => {
    expect(pickAsserted(windows, 'worst').combat).toBe(4020);
  });

  it('takes the middle window of an odd count under the median rule, so one spike does not decide', () => {
    expect(pickAsserted(windows, 'median').combat).toBe(408);
    expect(pickAsserted([window(5), window(1), window(9), window(3), window(7)], 'median').combat).toBe(5);
  });

  it('refuses a median of an even count and of no windows', () => {
    expect(() => pickAsserted([window(1), window(2)], 'median')).toThrow(/odd/);
    expect(() => pickAsserted([], 'worst')).toThrow(/no windows/);
  });
});

describe('probeLine', () => {
  it('names the scene and the attempt and gives six figures per window', () => {
    const first = { ...window(336), total: 900_000, outsideSweep: 280_000, bots: 1200 };
    const second = { ...window(408), total: 890_000, onAnimationFrame: 1, fakeRequestAnimationFrame: 2, outsideSweep: 270_000 };
    expect(probeLine('live', 1, [first, second])).toBe(
      'heap probe live attempt 1: bytes per window, total/onAnimationFrame/fake requestAnimationFrame/outside the sweep files/counted code/bots: ' +
        '900000/0/0/280000/336/1200 890000/1/2/270000/408/0',
    );
  });
});
