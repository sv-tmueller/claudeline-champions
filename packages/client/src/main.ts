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
import { readArena, twoVsTwoPlacements } from './arena';
import {
  CAMERA_TILT_DEG,
  CAMERA_VERTICAL_FOV_DEG,
  FIT_MARGIN,
  cameraPosition,
  fitCameraDistance,
  simToThree,
} from './camera';
import { buildDebugOverlay } from './debug-overlay';
import { PLACEHOLDER_CHAMPION_URL, arenaModelUrl } from './models';
import './style.css';

const arena = readArena(arena01Json);

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
scene.add(champions);
const overlay = buildDebugOverlay(arena);
scene.add(overlay);

const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, 1, 0.1, 500);

function render(): void {
  renderer.render(scene, camera);
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  const distance = fitCameraDistance({
    aspect: camera.aspect,
    verticalFovDeg: CAMERA_VERTICAL_FOV_DEG,
    tiltDeg: CAMERA_TILT_DEG,
    halfWidth: arena.size.width / 2,
    halfDepth: arena.size.height / 2,
    margin: FIT_MARGIN,
  });
  camera.position.copy(cameraPosition(distance, CAMERA_TILT_DEG));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  render();
}

resize();
window.addEventListener('resize', resize);

// The smoke test waits for this attribute.
renderer.domElement.dataset['rendered'] = 'true';

renderer.domElement.dataset['overlay'] = 'off';
window.addEventListener('keydown', (event) => {
  if (event.code !== 'F3' || event.repeat) return;
  event.preventDefault();
  overlay.visible = !overlay.visible;
  render();
  renderer.domElement.dataset['overlay'] = overlay.visible ? 'on' : 'off';
});

// A rejected load is not caught on purpose: it surfaces as a page error.
async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  const [arenaGltf, championGltf] = await Promise.all([
    loader.loadAsync(arenaModelUrl(arena.id)),
    loader.loadAsync(PLACEHOLDER_CHAMPION_URL),
  ]);
  // The arena glb already uses the (x, 0, -y) mapping.
  scene.add(arenaGltf.scene);
  for (const placement of twoVsTwoPlacements(arena)) {
    const champion = championGltf.scene.clone();
    champion.position.copy(simToThree(placement.x, placement.y));
    champion.rotation.y = placement.facing;
    champions.add(champion);
  }
  render();
  renderer.domElement.dataset['arena'] = arena.id;
}

await loadModels();
