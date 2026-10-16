import type { CDPSession, Page } from '@playwright/test';

// The heap probe's machinery, shared by the two probe specs: combat.spec.ts (the
// sandbox, a steady state of eight shots in flight) and live-probe.spec.ts (the
// default match, where the hooks and the HUD change in every window). It is not
// a spec, so Playwright does not collect it, like support.ts. Each spec keeps its
// own scene, its driving and its end assertions; this file counts the bytes.

// The functions whose allocations the heap probe counts: every combat render
// module, the pose and overlay helpers that run each frame, the loop clock, the
// input sampler, the pointer aim (camera.ts), the HUD writer with its views and the
// kill feed, the text tables of the hooks and the HUD (hook-text.ts), the champion
// names, the result screen's writer, the client's bot-driving glue (bot-driver.ts),
// the sound (audio.ts: routeSounds and play run on every step's events, and both
// probe specs unlock the audio with a real gesture before the first measured window),
// the champions' clips (champion-anim.ts, the state machine, and clip-sampler.ts, the
// sampler that poses the bones: both run for every champion in every frame, and the
// clip time is read from fields inside them) and every function in main.ts (stepSim,
// sampleAim, draw and the hook writers). The
// HUD builder, hud-dom.ts, the result panel's builder, result-dom.ts, and the setup
// modules run once at startup and are not counted.
// The bots package is not in COMBAT_CODE: its bytes are the sixth figure of the probe
// line, and the live scene bounds them apart (LIVE_BOTS_LIMIT_BYTES below). Its files
// get the prefix bots/ in `summarise`, as the sim's get sim/, so a bots file such as
// bot.ts never matches a client entry. Bytes of an inlined callee land on its caller,
// so bots bytes inlined into the glue still show in bot-driver.ts or stepSim, which are
// counted.
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
  /^(entity-views|health-bars|impact-rings|champion-look|feedback|interpolate|debug-overlay|loop|input|hud|hud-views|hook-text|kill-feed|roster|bot-driver|result-screen|camera|audio|champion-anim|clip-sampler)\.ts:|^main\.ts:/;
// Three's own animation callback. It is logged and never counted.
const ON_ANIMATION_FRAME = /^three\.module[^:]*:onAnimationFrame$/;
// The sweep files of the sim. Their garbage was huge (about 790 KB per window, in
// projectile.ts and geometry.ts) until #62 removed most of it: now 5.7 to 18 KB
// per window (total minus outside the sweep files, 9 windows of a local run on
// 66f4828). The sanity floor below leaves them out, so it does not depend on
// them.
const SWEEP_FILES = /^sim\/(projectile|geometry|area)\.ts:/;
// The sandbox's limit, 600 B, on the median of five measured windows. In a warm
// steady state every counted function reads 0 B but the hook's frameMany, which reads
// 300 to 588 B per window (9 to 18 B per frame, one boxed number per frame, whatever
// its argument: it stayed with the timestamp as an argument, as an integer, in a field
// of the loop clock and with no argument at all) and counts the bytes of the callees
// inlined into it. The largest clean median of five is 504 B, from the 24 runner
// attempts of the isolation of #77 (run 37434090996, before the fixes of #87 and #89)
// and, with the fixes in, once locally on b7df9fb (2 attempts: 336 and 504 B). The other
// figures with the fixes in: at most 456 B over 15 local attempts at limit 1 B on
// 1670d1b (5 batches of 3 repeats, none blind: see testing.md), at most 480 B over the
// tester's 3 local attempts on 3def3bc (360, 480 and 480 B), and at most 456 B over the
// 6 runner attempts on 3def3bc (384, 360, 432, 432, 456 and 408 B, run 37456539110).
// The limit is 96 B above 504 B (about 100 B, to a round 600 B) and 292 B under the
// smallest mutation (892 B). It was 640 B, 136 B above the largest figure, which is
// outside the margins the rule has accepted (96 to 120 B).
// Rechecked against 600 B: the eight per-call mutations below all failed 3 of 3 on the
// sandbox (medians 940 to 3132 B).
// The worst window is not a stable figure: window 0 holds the first frame's acquire of
// the volley's 8 views and reads 744 to 1032 B counted in the 15 local attempts (636 to
// 1068 B over the 59 earlier ones, 24 runner and 35 local; 792 to 1092 B in the 6 runner
// attempts on 3def3bc), and a one-off spike lands in one window of some attempts (1224 to
// 2140 B).
// Each of these fails the limit alone, as the median of the windows per attempt over 3
// attempts, on 1670d1b plus the line of testing.md: an escaping array in frame (1600 to
// 1728 B), a template string written to data-p0x on every writeHooks call (2844 to
// 3068 B), a closure made per call in routeEvents (1884 to 2020 B), an escaping object
// in the entity views' draw (3024 to 3144 B), a fresh literal from toPlayerInput (2016
// to 2088 B), a template string per Hud.update call (1612 to 1776 B), an escaping array
// per BotDriver.think call (1320 to 1996 B) and a template string per
// ResultScreen.update call (892 to 944 B). The per-change writes of the human's
// position and facing (336 to 408 B) and the canvas rect asked from the DOM on every
// sampleAim call (336 to 504 B) are the live scene's (see LIVE_ALLOCATION_LIMIT_BYTES):
// the sandbox's pointer never moves, so here they pass. See testing.md.
export const COMBAT_ALLOCATION_LIMIT_BYTES = 600;
// The live match's limit: 780 B, its own literal, on the median of five measured
// windows. The measured windows hold the first projectiles and hits of round 3, whose
// event paths (the view acquire, routeEvents, the impact rings) cost 24 to 330 B in a
// window, so the base is higher than the sandbox's, and a moving pointer is present
// in every window, so `sampleAim` and the camera module are counted. On 1670d1b the
// median of five was at most 684 B over 15 local attempts at limit 1 B (5 batches of 3
// repeats; none blind; a worst clean window of 780 B, and 3 spikes in 75 windows:
// `feedback.ts:hit` 1548 B, `hud.ts:updateRound` 1944 B, `health-bars.ts:update` 1944
// B), and `main.ts:sampleAim`, `camera.ts:*` and `entity-views.ts:draw` read 0 B in all
// 75 windows. The earlier shape (8d80073, no pointer, `draw` excluded) read at most 684 B
// over 21 local attempts and medians of 588, 540 and 660 B on the runner (7b80afd, run
// 37442967554). The limit is 96 B above the largest clean local median (684 B), 120 B
// above the largest of those runner medians (660 B) and 228 B under the smallest
// live-gated mutation (1008 B, below). A runner live median above 780 B reopens it
// (about 100 B above the largest clean median, below the smallest live-gated mutation;
// if none fits, stop and report). Live mutations (3 attempts each, same lines as the
// sandbox's), medians: 1008 to 1176 B for x.toFixed(0) in data-p0x, the smallest
// live-gated one (228 B over the limit), 1020 to 1148 B for the canvas rect asked from
// the DOM in every sampleAim call, 1300 to 1388 B for (facing / 1000).toFixed(3) in
// data-f0, 1352 to 1468 B for the Hud.update template, 1536 to 1568 B for the array in
// BotDriver.think, 1720 to 1876 B for the array in frame, 1800 to 1988 B for the closure
// in routeEvents, 2216 to 2320 B for the toPlayerInput literal, 2428 to 2628 B for the
// p0x template and 3068 to 3348 B for the escaping object in the entity views' draw
// (which fails on both scenes). One mutation is gated by the sandbox and not by this
// limit: the template per ResultScreen.update call (836 to 860 B here over 3 attempts,
// all red, but only 56 B over the limit, and 704 B and 752 B passed under 780 B in
// the earlier 12, so it is not a live gate; 892 to 944 B against 600 B on the
// sandbox). See testing.md.
export const LIVE_ALLOCATION_LIMIT_BYTES = 780;
// The live match's bots limit: 12 000 B, its own literal (the bots stay out of
// COMBAT_CODE), on the median of the five measured windows' own bots figures, not on the
// bots figure of the window that is the median by counted bytes. On bc1d6f1 the bots read
// a median window of 39 to 44 KB over 15 local attempts and 52 and 40 KB on the runner
// (windows from 25 to 132 KB): the plan search's garbage (about 53 KB a plan) and the
// calls V8's Maglev tier boxes (Number.isFinite, hypot2), see bots.md, Allocation. With
// both fixed (#93) the median window read 3.2 to 3.9 KB, on windows 5 to 9 of round 3
// (6.4 KB once, where `sight.ts:lineOfSight` read 2732 B after a deopt, clean by decision
// 12 of #91, which set 9600 B). #98 moved the windows: the dash hold shortens rounds 1
// and 2, round 3 begins by tick 2609 and the measured windows are windows 4 to 8 of it,
// in the chase, where plans and cold kite and escape code read more. On the head of #98
// the median window read 6404 to 7996 B over 15 local attempts (6404, 6876, 7092, 7100,
// 7108, 7128, 7148, 7180, 7192, 7196, 7292, 7372, 7652, 7740, 7996), 6952, 7348 and 7200
// B in three runner jobs (4ea802d) and 7176 to 7568 B in the tester's twelve attempts;
// main's bots on the same windows read 5744 to 6416 B in 3 local attempts. The limit is
// 50 percent above the largest clean median of the three sources, 7996 B, a local one
// (11994, rounded up to 100), the rule of decision 12, and it also satisfies the other
// clause, at most a quarter of the smallest revert median: reverting the plan search and
// the Maglev fixes (`packages/bots/src` as on bc1d6f1) reads 61.9, 65.8 and 66.7 KB on
// these windows (a quarter of 61.9 KB is 15.5 KB) and fails 3 of 3 local attempts; so
// does the -0 deopt of `aim` (bots.md), 72.3 to 74.2 KB in 3 of 3, the second positive
// control. The 50 percent clause is the lower one here, so it sets the limit. It does not
// catch one reverted Maglev fix alone: `bot.ts:aim` adds about 1.2 KB, the distance of
// `steerTowardInto` and the finite test of `cellIndexAt` up to 5 KB a window together,
// and the median window stays under 12 KB then. A runner median above 12 000 B reopens
// the limit. See bots.md and testing.md.
export const LIVE_BOTS_LIMIT_BYTES = 12_000;
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
  /** Bytes in the bots package. Not in `combat`: the live scene bounds them apart (LIVE_BOTS_LIMIT_BYTES). */
  bots: number;
  /** Bytes in three's onAnimationFrame. Logged, not counted: no measured frame runs through it. */
  onAnimationFrame: number;
  /** Bytes in the fake clock's own requestAnimationFrame. Logged, not counted; it reads 0 B when no frame uses it. */
  fakeRequestAnimationFrame: number;
  /** Bytes per "file:function" for the combat code, for the failure message. */
  combatByFunction: Record<string, number>;
  /** Bytes per "bots/file:function", for the log. */
  botsByFunction: Record<string, number>;
}

/** Sorts a profile into the figures of a window: counted code, bots, sweep files and the rest. */
export function summarise(root: ProfileNode): Allocations {
  const result: Allocations = {
    total: 0,
    outsideSweep: 0,
    combat: 0,
    bots: 0,
    onAnimationFrame: 0,
    fakeRequestAnimationFrame: 0,
    combatByFunction: {},
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
    if (node.selfSize > 0 && COMBAT_CODE.test(key)) {
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
    (w) => `${w.total}/${w.onAnimationFrame}/${w.fakeRequestAnimationFrame}/${w.outsideSweep}/${w.combat}/${w.bots}`,
  );
  return `heap probe ${scene} attempt ${attempt}: bytes per window, total/onAnimationFrame/fake requestAnimationFrame/outside the sweep files/counted code/bots: ${figures.join(' ')}`;
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
export async function allocationsOverAWindow(page: Page, cdp: CDPSession): Promise<Allocations> {
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 16,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await runWindow(page);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  return summarise(profile.head as ProfileNode);
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
): Promise<Measured> {
  const windows: Allocations[] = [];
  for (let i = 0; i < count; i++) windows.push(await allocationsOverAWindow(page, cdp));
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
    if (w.combat > 0) {
      console.log(
        `heap probe ${scene} attempt ${attempt} window ${index}: counted ${JSON.stringify(w.combatByFunction)} bots ${JSON.stringify(w.botsByFunction)}`,
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
// the bots bytes as a sixth.
