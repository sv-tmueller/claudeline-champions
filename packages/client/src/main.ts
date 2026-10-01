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
import { buildDebugOverlay, updateChampionCircles } from './debug-overlay';
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
const human = state.champions[HUMAN_ID];
if (!human) throw new Error('match has no human champion');
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

function writeHooks(): void {
  const dataset = renderer.domElement.dataset;
  dataset['tick'] = String(state.tick);
  const champion = state.champions[HUMAN_ID];
  if (!champion) return;
  dataset['p0'] = `${Math.round(champion.x * 100)},${Math.round(champion.y * 100)}`;
  dataset['f0'] = champion.facing.toFixed(3);
}

/** Runs the sim. Never draws. One sampled input feeds every step of the frame. */
function stepSim(steps: number): void {
  sampleAim();
  inputs[HUMAN_ID] = input.toPlayerInput(aimX, aimY);
  for (let i = 0; i < steps; i++) {
    capturePoses(state.champions, previousPoses);
    step(state, inputs);
  }
  writeHooks();
}

/** Draws interpolated poses. Never steps the sim. */
function draw(alpha: number): void {
  interpolatePoses(previousPoses, state.champions, alpha, drawnPoses);
  for (const [i, pose] of drawnPoses.entries()) {
    const view = champions.children[i];
    if (!view) continue;
    view.position.set(pose.x, 0, -pose.y);
    view.rotation.y = pose.facing;
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
}

await loadModels();
capturePoses(state.champions, previousPoses);
writeHooks();
renderer.domElement.dataset['arena'] = arena.id;
renderer.setAnimationLoop(frame);
