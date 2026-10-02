import { createMatch, parseArenaDef, step, type PlayerInput } from '@claudeline/sim';
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
import arena01Json from '../../../data/arenas/arena01.json';
import { CAMERA_VERTICAL_FOV_DEG, fitCamera, groundAimCm, pointerToNdc } from './camera';
import { createChampionLooks, lookMode, type ChampionLooks } from './champion-look';
import { buildDebugOverlay, updateChampionCircles } from './debug-overlay';
import { createAreaViews, createProjectileViews } from './entity-views';
import { CombatFeedback, flashText, routeEvents } from './feedback';
import { createHealthBars } from './health-bars';
import { createImpactRings } from './impact-rings';
import { createKillFeed } from './kill-feed';
import { bindInput, createInputCore } from './input';
import { capturePoses, createPoses, interpolatePoses } from './interpolate';
import { createFixedStepClock } from './loop';
import { PLACEHOLDER_CHAMPION_URL, arenaModelUrl } from './models';
import './style.css';

const HUMAN_ID = 0;
const LOCAL_SEED = 1;

const arena = parseArenaDef(arena01Json);
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
  arena,
  LOCAL_SEED,
);

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');

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
const clock = createFixedStepClock();

// The pose before the latest tick, the one being drawn, and the inputs array
// the sim reads. Champion 0 is the human, the others get missing inputs.
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

// The text of every tick up to ten minutes, made once at startup. The tick
// hook changes on every tick and the e2e tests read it to pace themselves. A
// change-guarded String(state.tick) instead read about 256 B of garbage per
// measurement window in the heap probe in e2e/combat.spec.ts (PR #42 tester
// round 2), right at its limit, so the table stays. It costs about 1.24 MB once.
// Past the table it falls back to String().
const TICK_TEXT_COUNT = 36_000;
const TICK_TEXT: string[] = [];
for (let tick = 0; tick < TICK_TEXT_COUNT; tick++) TICK_TEXT.push(String(tick));

// The last value written to each of these hooks, so a steady frame builds no
// strings. Fields of an object, not `let`s: a number in a closure slot is a new
// heap number on every store.
const wrote = { tick: -1, x: NaN, y: NaN, facing: NaN };

function writeHooks(): void {
  const dataset = renderer.domElement.dataset;
  if (state.tick !== wrote.tick) {
    wrote.tick = state.tick;
    dataset['tick'] = TICK_TEXT[state.tick] ?? String(state.tick);
  }
  const champion = state.champions[HUMAN_ID];
  if (!champion) return;
  const x = Math.round(champion.x * 100);
  const y = Math.round(champion.y * 100);
  if (x !== wrote.x || y !== wrote.y) {
    wrote.x = x;
    wrote.y = y;
    dataset['p0'] = `${x},${y}`;
  }
  if (champion.facing !== wrote.facing) {
    wrote.facing = champion.facing;
    dataset['f0'] = champion.facing.toFixed(3);
  }
}

// The last value written to each combat hook, so the DOM is only touched on a change.
const written = { projectiles: -1, areas: -1, hits: -1, deaths: -1, flashMask: -1, rings: -1 };

function writeCombatHooks(): void {
  const dataset = renderer.domElement.dataset;
  if (projectileViews.count !== written.projectiles) {
    written.projectiles = projectileViews.count;
    dataset['projectiles'] = String(written.projectiles);
  }
  if (areaViews.count !== written.areas) {
    written.areas = areaViews.count;
    dataset['areas'] = String(written.areas);
  }
  if (feedback.hits !== written.hits) {
    written.hits = feedback.hits;
    dataset['hits'] = String(written.hits);
  }
  if (feedback.deaths !== written.deaths) {
    written.deaths = feedback.deaths;
    dataset['deaths'] = String(written.deaths);
  }
  const mask = feedback.flashMask(state.tick);
  if (mask !== written.flashMask) {
    written.flashMask = mask;
    dataset['flashing'] = flashText(mask);
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
    step(state, inputs);
    // Every step: the sim clears its events at the start of the next one.
    routeEvents(state, feedback);
  }
  // `step` replaces the projectile and area arrays, so read them fresh here.
  projectileViews.sync(state.projectiles);
  areaViews.sync(state.areas);
  writeHooks();
  writeCombatHooks();
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
    renderer.domElement.dataset['rings'] = String(written.rings);
  }
  if (healthBars.update(state.champions, drawnPoses)) {
    renderer.domElement.dataset['bars'] = healthBars.hookText();
  }
  updateChampionCircles(overlay, drawnPoses);
  render();
}

function frame(now: number): void {
  const steps = clock.advance(now);
  if (steps > 0) stepSim(steps);
  draw(clock.alpha);
}

// A rejected load is not caught on purpose: it surfaces as a page error.
async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  const [arenaGltf, championGltf] = await Promise.all([
    loader.loadAsync(arenaModelUrl(arena.id)),
    loader.loadAsync(PLACEHOLDER_CHAMPION_URL),
  ]);
  // The arena glb already uses the (x, 0, -y) mapping.
  scene.add(arenaGltf.scene);
  // One view per champion in id order, so champions.children[i] is champion i.
  for (let i = 0; i < state.champions.length; i++) champions.add(championGltf.scene.clone());
  looks = createChampionLooks(champions.children);
}

await loadModels();
capturePoses(state.champions, previousPoses);
writeHooks();
writeCombatHooks();
if (import.meta.env.DEV) {
  // Dev builds only: Vite replaces the flag with false in a build and drops the
  // branch and the chunk, so F4 never ships.
  const { bindDebugShot, fireDebugShot } = await import('./debug-shot');
  bindDebugShot(window, renderer.domElement, () => fireDebugShot(state, HUMAN_ID, aimX, aimY));
}
// Draw once so the arena and champions are on the canvas before the hook.
draw(0);
renderer.domElement.dataset['arena'] = arena.id;
renderer.setAnimationLoop(frame);
