import {
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  CAMERA_TILT_DEG,
  CAMERA_VERTICAL_FOV_DEG,
  FIT_MARGIN,
  cameraPosition,
  fitCameraDistance,
} from './camera';
import './style.css';

// Replaced by the arena definition in batch 2.
const ARENA_WIDTH = 30;
const ARENA_DEPTH = 20;

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setClearColor(new Color('#1b2230'));
container.appendChild(renderer.domElement);

const scene = new Scene();
const ground = new Mesh(
  new PlaneGeometry(ARENA_WIDTH, ARENA_DEPTH),
  new MeshBasicMaterial({ color: '#4f8f5b' }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, 1, 0.1, 500);

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
    halfWidth: ARENA_WIDTH / 2,
    halfDepth: ARENA_DEPTH / 2,
    margin: FIT_MARGIN,
  });
  camera.position.copy(cameraPosition(distance, CAMERA_TILT_DEG));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

resize();
window.addEventListener('resize', resize);

// The smoke test waits for this attribute.
renderer.domElement.dataset['rendered'] = 'true';
