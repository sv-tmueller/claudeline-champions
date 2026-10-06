import { parseArenaDef, step, type KitDef, type PlayerInput } from '@claudeline/sim';
import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { arenaById } from './arenas';
import { createBotDriver } from './bot-driver';
import { CAMERA_VERTICAL_FOV_DEG, fitCamera, groundAimCm, pointerToNdc } from './camera';
import { createChampionLooks, lookMode, type ChampionLooks } from './champion-look';
import { buildDebugOverlay, updateChampionCircles } from './debug-overlay';
import { readDevLaunch } from './dev-launch';
import { createAreaViews, createProjectileViews } from './entity-views';
import { CombatFeedback, flashText, flashTexts, routeEvents } from './feedback';
import { createHealthBars } from './health-bars';
import { cmText, facingKey, facingText, intText, percentText } from './hook-text';
import { Hud } from './hud';
import { buildHud } from './hud-dom';
import { createImpactRings } from './impact-rings';
import { createKillFeed } from './kill-feed';
import { parseLaunch } from './launch';
import { LOCAL_SEED, createLocalMatch } from './match-setup';
import { bindInput, createInputCore } from './input';
import { capturePoses, createPoses, interpolatePoses } from './interpolate';
import { createFixedStepClock, STEP_MS } from './loop';
import { arenaModelUrl, championModelUrl } from './models';
import { buildResult } from './result-dom';
import { ResultScreen } from './result-screen';
import './style.css';
import './hud.css';
import './result.css';

const HUMAN_ID = 0;

// Every arena file under data/arenas joins the match and the select the same
// way. parseArenaDef validates each one, so a bad file is a page error. Sorted
// by id, so the order does not depend on the file system.
const arenas = Object.values(import.meta.glob('../../../data/arenas/*.json', { eager: true, import: 'default' }))
  .map((json) => parseArenaDef(json))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const arenaIds = arenas.map((candidate) => candidate.id);

// Every kit file under data/kits joins the match and the select without a client
// change. A bad kit file shows up as a page error from createMatch, which
// validates it. Sorted by id, so the order does not depend on the file system.
const kits = (Object.values(
  import.meta.glob('../../../data/kits/*.json', { eager: true, import: 'default' }),
) as KitDef[]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const kitIds = kits.map((kit) => kit.id);
const launch = parseLaunch(location.search, kitIds, arenaIds, import.meta.env.DEV);
const arena = arenaById(arenas, launch.arena);

const { state, botIds } = createLocalMatch(launch, arena, kits);
// The bots think here, in the main thread, once per tick before `step`.
const bots = createBotDriver(botIds, launch.difficulty, LOCAL_SEED);
const roundsToWin = state.match?.roundsToWin;
if (roundsToWin === undefined) throw new Error('the local match has no match flow');

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');
const hudRoot = document.getElementById('hud');
if (!hudRoot) throw new Error('missing #hud container');
const resultRoot = document.getElementById('result');
if (!resultRoot) throw new Error('missing #result container');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setClearColor(new Color('#1b2230'));
container.appendChild(renderer.domElement);

const scene = new Scene();
// Starting values, tuned against the e2e screenshot: about pi of light on top
// faces shows the authored base colour, side faces stay readable.
scene.add(new HemisphereLight(0xffffff, 0x808080, 2.0));
const sun = new DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 20, 10);
scene.add(sun);

const champions = new Group();
champions.name = 'Champions';
scene.add(champions);
const overlay = buildDebugOverlay(arena, state.champions.length);
scene.add(overlay);

const human = state.champions[HUMAN_ID];
if (!human) throw new Error('match has no human champion');
const projectileViews = createProjectileViews(human.team);
const areaViews = createAreaViews(human.team);
const impactRings = createImpactRings();
const healthBars = createHealthBars(state.champions, human.team);
const killFeed = createKillFeed();
const feedback = new CombatFeedback(state.champions.length, impactRings, killFeed);
scene.add(areaViews.group, projectileViews.group, impactRings.group, healthBars.group);

// Built before the models load, so the HUD shows while they do.
const hud = new Hud(buildHud(hudRoot, roundsToWin), state.champions, HUMAN_ID, killFeed, roundsToWin);
const result = new ResultScreen(buildResult(resultRoot, kitIds, launch.difficulty), human.team, roundsToWin);

const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, 1, 0.1, 500);

function render(): void {
  renderer.render(scene, camera);
}

function resize(): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCamera(camera, window.innerWidth, window.innerHeight, arena);
  render();
}

resize();
window.addEventListener('resize', resize);

// The scene test waits for this attribute.
renderer.domElement.dataset['rendered'] = 'true';

renderer.domElement.dataset['overlay'] = 'off';
window.addEventListener('keydown', (event) => {
  if (event.code !== 'F3' || event.repeat) return;
  event.preventDefault();
  overlay.visible = !overlay.visible;
  render();
  renderer.domElement.dataset['overlay'] = overlay.visible ? 'on' : 'off';
});

const input = createInputCore();
bindInput(window, renderer.domElement, input);
// Dev builds only: Vite replaces the flag with false in a build, and the module
// goes with it, so a production page has no time scale.
const devLaunch = import.meta.env.DEV ? readDevLaunch(location.search) : undefined;
const clock = createFixedStepClock(devLaunch?.timeScale ?? 1);

// The pose before the latest tick, the one being drawn, and the inputs array
// the sim reads. Champion 0 is the human, the bots write their own entries
// before every step, and an entry nobody writes is a missing input.
const previousPoses = createPoses(state.champions.length);
const drawnPoses = createPoses(state.champions.length);
const inputs: (PlayerInput | undefined)[] = state.champions.map(() => undefined);
let aimX = human.aimX;
let aimY = human.aimY;

/** Reads the pointer into the aim point. No pointer or no ground hit keeps the last aim. */
function sampleAim(): void {
  const pointer = input.pointer;
  if (!pointer) return;
  const ndc = pointerToNdc(pointer.clientX, pointer.clientY, renderer.domElement.getBoundingClientRect());
  const hit = groundAimCm(camera, ndc.x, ndc.y);
  if (!hit) return;
  aimX = hit.x;
  aimY = hit.y;
}

// The hooks are written with setAttribute and text from tables made at startup
// (hook-text.ts, flashTexts), and only when the value changed, so a steady frame
// builds no string. A dataset write allocated about 100 B per window in the heap
// probe, and a String(), a template or a toFixed() leaves garbage on every
// change. The position is two hooks, p0x and p0y, since one "x,y" text cannot
// come from a table, and so is every bar (data-bar0 to data-barN).
const canvas = renderer.domElement;
const BAR_ATTRIBUTES = state.champions.map((_, id) => `data-bar${id}`);
const FLASH_TEXTS = flashTexts(state.champions.length);

// The last value written to each of these hooks, so a steady frame builds no
// strings. Fields of an object, not `let`s: a number in a closure slot is a new
// heap number on every store. `facing` is the key in milliradians.
const wrote = { tick: -1, x: NaN, y: NaN, facing: NaN, round: -1, phase: '' };

function writeHooks(): void {
  if (state.tick !== wrote.tick) {
    wrote.tick = state.tick;
    canvas.setAttribute('data-tick', intText(state.tick));
  }
  // The match phase and the round, for the e2e specs: a phase is the sim's own string.
  const match = state.match;
  if (match !== undefined) {
    if (match.phase !== wrote.phase) {
      wrote.phase = match.phase;
      canvas.setAttribute('data-phase', match.phase);
    }
    if (match.round !== wrote.round) {
      wrote.round = match.round;
      canvas.setAttribute('data-round', intText(match.round));
    }
  }
  const champion = state.champions[HUMAN_ID];
  if (!champion) return;
  const x = Math.round(champion.x * 100);
  if (x !== wrote.x) {
    wrote.x = x;
    canvas.setAttribute('data-p0x', cmText(x));
  }
  const y = Math.round(champion.y * 100);
  if (y !== wrote.y) {
    wrote.y = y;
    canvas.setAttribute('data-p0y', cmText(y));
  }
  const facing = facingKey(champion.facing);
  if (facing !== wrote.facing) {
    wrote.facing = facing;
    canvas.setAttribute('data-f0', facingText(facing));
  }
}

// The last value written to each combat hook, so the DOM is only touched on a change.
const written = { projectiles: -1, areas: -1, hits: -1, deaths: -1, flashMask: -1, rings: -1 };

function writeCombatHooks(): void {
  if (projectileViews.count !== written.projectiles) {
    written.projectiles = projectileViews.count;
    canvas.setAttribute('data-projectiles', intText(written.projectiles));
  }
  if (areaViews.count !== written.areas) {
    written.areas = areaViews.count;
    canvas.setAttribute('data-areas', intText(written.areas));
  }
  if (feedback.hits !== written.hits) {
    written.hits = feedback.hits;
    canvas.setAttribute('data-hits', intText(written.hits));
  }
  if (feedback.deaths !== written.deaths) {
    written.deaths = feedback.deaths;
    canvas.setAttribute('data-deaths', intText(written.deaths));
  }
  const mask = feedback.flashMask(state.tick);
  if (mask !== written.flashMask) {
    written.flashMask = mask;
    canvas.setAttribute('data-flashing', FLASH_TEXTS[mask] ?? flashText(mask));
  }
}

/** Runs the sim. Never draws. One sampled input feeds every step of the frame. */
function stepSim(steps: number): void {
  sampleAim();
  inputs[HUMAN_ID] = input.toPlayerInput(aimX, aimY);
  for (let i = 0; i < steps; i++) {
    capturePoses(state.champions, previousPoses);
    projectileViews.capture(state.projectiles);
    areaViews.capture(state.areas);
    bots.think(state, inputs);
    step(state, inputs);
    // Every step: the sim clears its events at the start of the next one.
    routeEvents(state, feedback);
  }
  // `step` replaces the projectile and area arrays, so read them fresh here.
  projectileViews.sync(state.projectiles);
  areaViews.sync(state.areas);
  writeHooks();
  writeCombatHooks();
  hud.update(state);
  result.update(state);
}

// Created after the champion views exist, in loadModels. draw never runs before then.
let looks: ChampionLooks | undefined;

/** Draws interpolated poses. Never steps the sim. */
function draw(alpha: number): void {
  interpolatePoses(previousPoses, state.champions, alpha, drawnPoses);
  for (let i = 0; i < drawnPoses.length; i++) {
    const pose = drawnPoses[i];
    const view = champions.children[i];
    if (!pose || !view) continue;
    view.position.set(pose.x, 0, -pose.y);
    view.rotation.y = pose.facing;
    const champion = state.champions[i];
    if (champion) looks?.set(i, lookMode(feedback.isFlashing(i, state.tick), champion.alive));
  }
  projectileViews.draw(alpha);
  areaViews.draw(alpha);
  impactRings.draw(state.tick, alpha);
  // Only draw retires a ring, so the count is written here.
  if (impactRings.visibleCount !== written.rings) {
    written.rings = impactRings.visibleCount;
    canvas.setAttribute('data-rings', intText(written.rings));
  }
  if (healthBars.update(state.champions, drawnPoses)) {
    for (let id = 0; id < BAR_ATTRIBUTES.length; id++) {
      if (healthBars.changed(id)) canvas.setAttribute(BAR_ATTRIBUTES[id] as string, percentText(healthBars.percent(id)));
    }
  }
  updateChampionCircles(overlay, drawnPoses);
  render();
}

function frame(now: number): void {
  const steps = clock.advance(now);
  if (steps > 0) stepSim(steps);
  draw(clock.alpha);
}

// The timestamp of the dev-only probe hook below, in the same closure as frame.
// Set once from performance.now() on the first call (the paused fake clock in
// combat.spec, in a warm-up window), so the first probe frame moves the loop
// clock forward; later frames read no clock.
let probeNow = -1;

/**
 * Runs `count` frames with synthetic timestamps one sim tick apart, without the
 * animation loop. Only the dev-only hook calls it, and a build drops it. The
 * heap probe counts this function like the rest of main.ts: V8 inlines the frame
 * into it, so the frame's bytes land here, and the hook's own cost is 9 to
 * 18 B per frame (see testing.md).
 */
function frameMany(count: number): void {
  if (probeNow < 0) probeNow = performance.now();
  for (let i = 0; i < count; i++) {
    probeNow += STEP_MS;
    frame(probeNow);
  }
}

// A rejected load is not caught on purpose: it surfaces as a page error.
async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  // Each distinct champion model loads once, however many champions use it.
  const urls = [...new Set(state.champions.map((champion) => championModelUrl(champion.championId)))];
  const [arenaGltf, ...championGltfs] = await Promise.all([
    loader.loadAsync(arenaModelUrl(arena.id)),
    ...urls.map((url) => loader.loadAsync(url)),
  ]);
  // The arena glb already uses the (x, 0, -y) mapping.
  if (arenaGltf) scene.add(arenaGltf.scene);
  // One view per champion in id order, so champions.children[i] is champion i.
  for (const champion of state.champions) {
    const gltf = championGltfs[urls.indexOf(championModelUrl(champion.championId))];
    if (!gltf) throw new Error(`no model loaded for ${champion.championId}`);
    champions.add(gltf.scene.clone());
  }
  looks = createChampionLooks(champions.children);
}

await loadModels();
capturePoses(state.champions, previousPoses);
writeHooks();
writeCombatHooks();
hud.update(state);
result.update(state);
if (import.meta.env.DEV) {
  // Dev builds only: Vite replaces the flag with false in a build and drops the
  // branch and the chunk, so F4 and the probe hook never ship.
  const { bindDebugShot, fireDebugShot } = await import('./debug-shot');
  bindDebugShot(window, renderer.domElement, () => fireDebugShot(state, HUMAN_ID, aimX, aimY));
  // The heap probe of e2e/combat.spec.ts runs frames through this hook instead of
  // the animation loop, see frameMany. The hook only forwards a frame count.
  (window as unknown as { __runProbeFrames: (frames: number) => void }).__runProbeFrames = (frames) => {
    frameMany(frames);
  };
}
// Draw once so the arena and champions are on the canvas before the hook.
draw(0);
renderer.domElement.dataset['arena'] = arena.id;
renderer.setAnimationLoop(frame);
