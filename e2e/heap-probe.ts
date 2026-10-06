import type { CDPSession, Page } from '@playwright/test';

// The heap probe's machinery, shared by the two probe specs: combat.spec.ts (the
// sandbox, a steady state of eight shots in flight) and live-probe.spec.ts (the
// default match, where the hooks and the HUD change in every window). It is not
// a spec, so Playwright does not collect it, like support.ts. Each spec keeps its
// own scene, its driving and its end assertions; this file counts the bytes.

// The functions whose allocations the heap probe counts: every combat render
// module, the pose and overlay helpers that run each frame, the loop clock, the
// input sampler, the HUD writer with its views and the kill feed, the text tables
// of the hooks and the HUD (hook-text.ts), the champion names, the result screen's
// writer, the client's bot-driving glue (bot-driver.ts) and every function in
// main.ts (stepSim, sampleAim, draw and the hook writers). The HUD builder,
// hud-dom.ts, the result panel's builder, result-dom.ts, and the setup modules run
// once at startup and are not counted.
// The bots package is not counted either, and its bytes are logged as the sixth
// figure of the probe line. A live match leaves the bots' steady state in any
// window by design (a new plan, a fresh path follower after an intent change, the
// aim point boxed every 15 thinks), and bot output differs between platforms, so
// counting it would tie the browser limit to decisions the runner makes
// differently. The think has its own gate, allocation.test.ts in the bots
// package. Its files get the prefix bots/ in `summarise`, as the sim's get sim/,
// so a bots file such as bot.ts never matches a client entry. Bytes of an
// inlined callee land on its caller, so bots bytes inlined into the glue still
// show in bot-driver.ts or stepSim, which are counted.
// The measured windows run through the client's dev-only hook, window.__runProbeFrames
// (frameMany in main.ts), which calls frame directly. No frame of a measured
// window runs through three's animation callback or the fake clock's
// requestAnimationFrame, so onAnimationFrame is not counted. It was counted
// while the windows ran on the fake clock, and then it held the bytes of frame
// (inlined into it by V8) next to the boxed timer ids of the fake clock, which
// no change of the client controlled (see testing.md). The hook's own function,
// frameMany, is counted like every function of main.ts, and the bytes of every
// callee V8 inlines into it land on it, so excluding it would hide a regression
// (the escaping array in frame passed with the hook excluded).
export const COMBAT_CODE =
  /^(entity-views|health-bars|impact-rings|champion-look|feedback|interpolate|debug-overlay|loop|input|hud|hud-views|hook-text|kill-feed|roster|bot-driver|result-screen)\.ts:|^main\.ts:/;
// Three's own animation callback. It is logged and never counted.
const ON_ANIMATION_FRAME = /^three\.module[^:]*:onAnimationFrame$/;
// The sweep files of the sim. Their garbage was huge (about 790 KB per window, in
// projectile.ts and geometry.ts) until #62 removed most of it: now 5.7 to 18 KB
// per window (total minus outside the sweep files, 9 windows of a local run on
// 66f4828). The sanity floor below leaves them out, so it does not depend on
// them.
const SWEEP_FILES = /^sim\/(projectile|geometry|area)\.ts:/;
// The sandbox's limit, 640 B, on the median of five measured windows. In a warm
// steady state every counted function reads 0 B but the hook's frameMany, which reads
// 300 to 588 B per window (9 to 18 B per frame, one boxed number per frame, whatever
// its argument: it stayed with the timestamp as an argument, as an integer, in a field
// of the loop clock and with no argument at all) and counts the bytes of the callees
// inlined into it. The median of five was at most 528 B over 35 local attempts at
// limit 1 B (all 35 read, none blind: see testing.md) and at most 504 B over the 24
// runner attempts of the isolation of #77 (run 37434090996); the limit is about 100 B
// above the largest. The worst window is not a stable figure: window 0 holds the first
// frame's acquire of the volley's 8 views and reads 636 to 1068 B counted in every
// attempt (59 attempts: 24 runner, 35 local; the acquire is 336 to 660 B of it), and a
// one-off spike lands in one window of some attempts (1224 to 2140 B).
// Each of these fails the limit alone, as the median of the windows per attempt over 3
// attempts, on 458f458 plus the line of testing.md: an escaping array in frame (1600 to
// 1648 B), a template string written to data-p0x on every writeHooks call (3052 to
// 3128 B), a closure made per call in routeEvents (1956 to 2064 B), an escaping object
// in the entity views' draw (3052 to 3180 B), a fresh literal from toPlayerInput (2064
// to 2168 B), a template string per Hud.update call (784 to 1572 B), an escaping array
// per BotDriver.think call (1408 to 1448 B) and a template string per
// ResultScreen.update call (968 to 1040 B). The per-change writes of the human's
// position and facing are the live scene's (see LIVE_ALLOCATION_LIMIT_BYTES): here
// they read 336 to 432 B and pass. See testing.md.
export const COMBAT_ALLOCATION_LIMIT_BYTES = 640;
// The live match's limit: 640 B as well, with its own figures. The median of five
// measured windows was at most 504 B over 35 local attempts at limit 1 B (all 35 read,
// none blind) and at most 540 B over the 24 runner attempts of the isolation (run
// 37434090996), counting every function of the pattern but `entity-views.ts:draw`
// (LIVE_EXCLUDED below). The limit is about 100 B above the largest clean median and
// below the median of every live mutation but one (3 attempts each, same lines as
// the sandbox's): 1600 to 1736 B for the array in frame, 2608 to 2676 B for the
// p0x template, 1892 to 1924 B for the closure in routeEvents, 1960 to 2180 B for
// the toPlayerInput literal, 1572 to 1632 B for the Hud.update template, 1312 to
// 1424 B for the array in BotDriver.think, 884 to 912 B for the ResultScreen.update
// template, the smallest, and for the per-change pair 976 to 1088 B (x.toFixed(0) in
// data-p0x) and 1352 to 1388 B ((facing / 1000).toFixed(3) in data-f0). The one
// exception is the escaping object in the entity views' draw: it lands in the
// excluded function and reads 432 to 456 B here, so the sandbox, which counts draw,
// is its gate (3052 to 3180 B). See testing.md.
export const LIVE_ALLOCATION_LIMIT_BYTES = 640;
// The one function of the counted code that the live scene does not count. On the
// runner `entity-views.ts:draw` allocated 228 to 912 B in every window (1.1 to 1.5 KB
// in the window of the first hit) in 19 of 24 attempts and 0 B in the other 5: a mode
// of the engine's tiers on a path with few active views, which the live scene reaches
// late. The bytes are logged apart, as `excluded`. The sandbox, whose 8 shots keep
// `draw` hot, counts it, and the mutation of `draw` fails there (see testing.md).
// This is a carve-out: the client defect is
// https://github.com/sv-tmueller/claudeline-champions/issues/89, and its fix removes
// LIVE_EXCLUDED. Anchored, so `main.ts:draw` and `impact-rings.ts:draw`, which are
// spike sites, stay counted.
export const LIVE_EXCLUDED = /^entity-views\.ts:draw$/;
// The profiler must see garbage outside the sweep files in every window: the
// sim's collision, step and sight code and three's render. About 265 KB per
// window was the lowest figure measured with the hook on a head that contains
// #62 (264,652 B, 9 windows of a local run on 66f4828), so the floor is about
// a third of it.
export const PROFILER_SANITY_BYTES = 80_000;

// A window is one page.evaluate call of the client's dev-only hook, which runs
// 30 frames 16.67 ms apart, one sim tick each, with no hook read between them.
export const WINDOW_FRAMES = 30;
// A sixteenth of the pixels of the 1280x720 viewport that the screenshots need.
export const PROBE_VIEWPORT = { width: 320, height: 180 };

export interface ProfileNode {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
}

export interface Allocations {
  total: number;
  /** Bytes outside the sweep files of the sim, for the sanity floor. */
  outsideSweep: number;
  combat: number;
  /** Bytes of the functions a scene leaves out of the counted code, see `summarise`. Logged, not counted. */
  excluded: number;
  /** Bytes in the bots package. Logged, not counted: the think has its own gate (allocation.test.ts). */
  bots: number;
  /** Bytes in three's onAnimationFrame. Logged, not counted: no measured frame runs through it. */
  onAnimationFrame: number;
  /** Bytes in the fake clock's own requestAnimationFrame. Logged, not counted; it reads 0 B when no frame uses it. */
  fakeRequestAnimationFrame: number;
  /** Bytes per "file:function" for the combat code, for the failure message. */
  combatByFunction: Record<string, number>;
  /** Bytes per "file:function" of the excluded functions, for the log. */
  excludedByFunction: Record<string, number>;
  /** Bytes per "bots/file:function", for the log. */
  botsByFunction: Record<string, number>;
}

/**
 * Sorts a profile into the figures of a window. `exclude` names functions of the
 * counted code ("file:function") that a scene leaves out of `combat`: their bytes
 * are in `excluded` and in the log instead. Only the live scene uses it (see
 * live-probe.spec.ts).
 */
export function summarise(root: ProfileNode, exclude?: RegExp): Allocations {
  const result: Allocations = {
    total: 0,
    outsideSweep: 0,
    combat: 0,
    excluded: 0,
    bots: 0,
    onAnimationFrame: 0,
    fakeRequestAnimationFrame: 0,
    combatByFunction: {},
    excludedByFunction: {},
    botsByFunction: {},
  };
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    result.total += node.selfSize;
    // The sim has an input.ts of its own (resolveInput) and the bots a bot.ts, so
    // their files get a prefix and never match a client module of the same name.
    const url = node.callFrame.url;
    const bots = url.includes('/packages/bots/');
    const prefix = url.includes('/packages/sim/') ? 'sim/' : bots ? 'bots/' : '';
    const key = `${prefix}${url.split('/').slice(-1)[0]}:${node.callFrame.functionName}`;
    if (!SWEEP_FILES.test(key)) result.outsideSweep += node.selfSize;
    if (key === ':requestAnimationFrame') result.fakeRequestAnimationFrame += node.selfSize;
    if (ON_ANIMATION_FRAME.test(key)) result.onAnimationFrame += node.selfSize;
    if (node.selfSize > 0 && bots) {
      result.bots += node.selfSize;
      result.botsByFunction[key] = (result.botsByFunction[key] ?? 0) + node.selfSize;
    }
    if (node.selfSize > 0 && exclude?.test(key) && COMBAT_CODE.test(key)) {
      result.excluded += node.selfSize;
      result.excludedByFunction[key] = (result.excludedByFunction[key] ?? 0) + node.selfSize;
    } else if (node.selfSize > 0 && COMBAT_CODE.test(key)) {
      result.combat += node.selfSize;
      result.combatByFunction[key] = (result.combatByFunction[key] ?? 0) + node.selfSize;
    }
    pending.push(...node.children);
  }
  return result;
}

/**
 * The window whose figure a spec asserts: the median of an odd count by counted
 * bytes, so that one spiked window does not decide the attempt (decision 12 of
 * batch #63, as the spike isolation of #77 decided it; see testing.md).
 */
export function pickAsserted(windows: readonly Allocations[]): Allocations {
  const sorted = [...windows].sort((a, b) => a.combat - b.combat);
  if (sorted.length === 0) throw new Error('no windows to pick from');
  if (sorted.length % 2 === 0) throw new Error(`the median needs an odd count of windows, got ${sorted.length}`);
  return sorted[(sorted.length - 1) / 2] as Allocations;
}

/** One line per attempt, so every log shows the figures of all its measured windows. */
export function probeLine(scene: string, attempt: number, windows: readonly Allocations[]): string {
  const figures = windows.map(
    (w) => `${w.total}/${w.onAnimationFrame}/${w.fakeRequestAnimationFrame}/${w.outsideSweep}/${w.combat}/${w.bots}/${w.excluded}`,
  );
  return `heap probe ${scene} attempt ${attempt}: bytes per window, total/onAnimationFrame/fake requestAnimationFrame/outside the sweep files/counted code/bots/excluded: ${figures.join(' ')}`;
}

/** A CDP session with the heap profiler enabled, for the page. Open it after the clock is paused. */
export async function openProbe(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  return cdp;
}

/**
 * Runs one window of frames in one call, through the client's dev-only hook
 * (frameMany in main.ts). The hook calls the frame function directly with
 * synthetic timestamps, so neither the fake clock nor three's animation loop
 * runs a frame, and the clock stays paused.
 */
export async function runWindow(page: Page): Promise<void> {
  await page.evaluate((frames) => {
    const hook = (window as unknown as { __runProbeFrames?: (frames: number) => void }).__runProbeFrames;
    if (!hook) throw new Error('the dev-only frame hook is missing');
    hook(frames);
  }, WINDOW_FRAMES);
}

/**
 * Runs one window under the sampling heap profiler, which counts garbage as
 * well as live objects. A plain heap delta cannot be used: the sim allocates
 * inside `step` on every projectile sweep, far more than any view.
 */
export async function allocationsOverAWindow(page: Page, cdp: CDPSession, exclude?: RegExp): Promise<Allocations> {
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 16,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await runWindow(page);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  return summarise(profile.head as ProfileNode, exclude);
}

export interface Measured {
  windows: Allocations[];
  /** The window whose counted bytes the spec asserts: the median. */
  asserted: Allocations;
  lowestOutsideSweep: number;
}

/**
 * Measures `count` windows in a row with nothing between them, logs the probe
 * line of the attempt and, for every window with counted bytes, its functions
 * (counted and bots), so every runner log names the function of any spike,
 * whether the attempt passed or failed. A spec that must read or drive between
 * windows measures them one by one with `allocationsOverAWindow` and ends with
 * `conclude`.
 */
export async function measureWindows(
  page: Page,
  cdp: CDPSession,
  scene: string,
  attempt: number,
  count: number,
  exclude?: RegExp,
): Promise<Measured> {
  const windows: Allocations[] = [];
  for (let i = 0; i < count; i++) windows.push(await allocationsOverAWindow(page, cdp, exclude));
  return conclude(scene, attempt, windows);
}

/** Logs the probe line and the per-function figures of measured windows and picks the asserted one. */
export function conclude(
  scene: string,
  attempt: number,
  windows: readonly Allocations[],
): Measured {
  console.log(probeLine(scene, attempt, windows));
  windows.forEach((w, index) => {
    if (w.combat > 0 || w.excluded > 0) {
      console.log(
        `heap probe ${scene} attempt ${attempt} window ${index}: counted ${JSON.stringify(w.combatByFunction)} excluded ${JSON.stringify(w.excludedByFunction)} bots ${JSON.stringify(w.botsByFunction)}`,
      );
    }
  });
  return {
    windows: [...windows],
    asserted: pickAsserted(windows),
    lowestOutsideSweep: Math.min(...windows.map((w) => w.outsideSweep)),
  };
}

// The heap probe once had two modes on the CI runner, which retries could not
// cover (batch #53, decisions 5 and 13 to 16). Playwright's fake clock hands out
// timer ids of 1e12 and up, which are not small integers, so each
// requestAnimationFrame call boxed about three heap numbers (36 B per frame).
// Which function held them depended on Maglev's inlining: the fake clock's own
// requestAnimationFrame (a clean figure, 0 to 72 B in onAnimationFrame), or
// three's onAnimationFrame, where the bytes land when Maglev inlines the fake
// clock's callback into it (the bad mode, about 1100 B per window, which the
// runner entered in every attempt once the sandbox scene was heavy). The totals
// were equal in both modes. The windows now run through the dev-only hook and
// no frame goes through the fake clock, so neither function shows a byte and the
// fake requestAnimationFrame figure of the log line reads 0 (a nonzero figure
// means a window ran frames through the clock). The log line keeps its four
// older figures, total, onAnimationFrame, fake requestAnimationFrame and outside
// the sweep files, and adds the counted combat bytes of the window as a fifth and
// the bots bytes as a sixth and the excluded bytes (the live scene's `draw`, 0 for the
// sandbox) as a seventh.
