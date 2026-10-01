import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { parseArenaDef } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import {
  CAMERA_TILT_DEG,
  CAMERA_VERTICAL_FOV_DEG,
  FIT_MARGIN,
  cameraPosition,
  fitCamera,
  fitCameraDistance,
  groundAimCm,
  pointerToNdc,
  simToThree,
} from './camera';

const HALF_WIDTH = 15;
const HALF_DEPTH = 10;

// Projects with three's own camera, so the test does not share the fit
// function's math.
function projectCorners(aspect: number): Vector3[] {
  const distance = fitCameraDistance({
    aspect,
    verticalFovDeg: CAMERA_VERTICAL_FOV_DEG,
    tiltDeg: CAMERA_TILT_DEG,
    halfWidth: HALF_WIDTH,
    halfDepth: HALF_DEPTH,
    margin: FIT_MARGIN,
  });
  const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, aspect, 0.1, 500);
  camera.position.copy(cameraPosition(distance, CAMERA_TILT_DEG));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const corners: [number, number][] = [
    [-HALF_WIDTH, -HALF_DEPTH],
    [HALF_WIDTH, -HALF_DEPTH],
    [-HALF_WIDTH, HALF_DEPTH],
    [HALF_WIDTH, HALF_DEPTH],
  ];
  return corners.map(([x, y]) => simToThree(x, y).project(camera));
}

describe('simToThree', () => {
  it('maps sim (x, y) to three (x, 0, -y)', () => {
    const v = simToThree(3, 4);
    expect([v.x, v.y, v.z]).toEqual([3, 0, -4]);
  });
});

describe('camera framing', () => {
  const aspects = [
    ['16:9', 16 / 9],
    ['4:3', 4 / 3],
    ['21:9', 21 / 9],
  ] as const;

  it.each(aspects)('keeps all arena corners inside the viewport at %s', (_name, aspect) => {
    for (const p of projectCorners(aspect)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });

  it.each(aspects)('fits tightly at %s', (_name, aspect) => {
    const maxNdc = Math.max(...projectCorners(aspect).flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
    expect(maxNdc).toBeGreaterThan(0.9);
  });

  it('puts the sim north edge at the top of the screen and the south edge at the bottom', () => {
    const [southWest, southEast, northWest, northEast] = projectCorners(16 / 9);
    expect(southWest?.y).toBeLessThan(0);
    expect(southEast?.y).toBeLessThan(0);
    expect(northWest?.y).toBeGreaterThan(0);
    expect(northEast?.y).toBeGreaterThan(0);
  });
});

describe('champion facing convention', () => {
  // The champion glb faces +X. rotation.y = theta must turn it toward sim
  // direction (cos theta, sin theta), so team A (0) looks along +x and team B
  // (pi) along -x.
  const thetas = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  it.each(thetas)('rotation.y = %f turns +X toward sim (cos, sin)', (theta) => {
    const facing = new Vector3(1, 0, 0).applyEuler(new Euler(0, theta, 0));
    const expected = simToThree(Math.cos(theta), Math.sin(theta));
    expect(facing.x).toBeCloseTo(expected.x, 12);
    expect(facing.y).toBeCloseTo(expected.y, 12);
    expect(facing.z).toBeCloseTo(expected.z, 12);
  });
});

describe('mouse aim', () => {
  const arena = parseArenaDef(arena01Json);
  const WIDTH = 1280;
  const HEIGHT = 720;

  function fittedCamera(): PerspectiveCamera {
    const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, 1, 0.1, 500);
    fitCamera(camera, WIDTH, HEIGHT, arena);
    return camera;
  }

  // Sim points to ground, given in meters. Includes the arena corners, the
  // champion 0 spawn, the origin and one point outside the arena.
  const points: [string, number, number][] = [
    ['south-west corner', -15, -10],
    ['south-east corner', 15, -10],
    ['north-west corner', -15, 10],
    ['north-east corner', 15, 10],
    ['champion 0 spawn', -12, 2],
    ['origin', 0, 0],
    ['outside the arena', 17.25, -6.5],
  ];

  it.each(points)('groundAimCm returns the sim point for %s within 1 cm', (_name, x, y) => {
    const camera = fittedCamera();
    // Projects with three's own camera, so the test does not share the raycast.
    const ndc = simToThree(x, y).project(camera);
    const aim = groundAimCm(camera, ndc.x, ndc.y);
    if (!aim) throw new Error('no ground hit');
    expect(Number.isInteger(aim.x)).toBe(true);
    expect(Number.isInteger(aim.y)).toBe(true);
    expect(Math.abs(aim.x - x * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(aim.y - y * 100)).toBeLessThanOrEqual(1);
  });

  it('never returns -0', () => {
    const camera = fittedCamera();
    const aim = groundAimCm(camera, 0, 0);
    expect(Object.is(aim?.x, -0)).toBe(false);
    expect(Object.is(aim?.y, -0)).toBe(false);
  });

  it('returns null when the ray misses the ground plane', () => {
    // The fitted camera looks down steeply enough that every pixel hits the
    // ground, so this one looks up: the ray points away from y = 0.
    const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, 16 / 9, 0.1, 500);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 10, 0);
    camera.updateMatrixWorld();
    expect(groundAimCm(camera, 0, 0)).toBeNull();
  });

  it('fitCamera sets the aspect and the world matrix', () => {
    const camera = fittedCamera();
    expect(camera.aspect).toBeCloseTo(16 / 9, 12);
    const centre = simToThree(0, 0).project(camera);
    expect(Math.hypot(centre.x, centre.y)).toBeCloseTo(0, 6);
  });

  it('pointerToNdc maps the rect corners to +-1 with y flipped', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(pointerToNdc(10, 20, rect)).toEqual({ x: -1, y: 1 });
    expect(pointerToNdc(210, 120, rect)).toEqual({ x: 1, y: -1 });
    expect(pointerToNdc(110, 70, rect)).toEqual({ x: 0, y: 0 });
  });
});
