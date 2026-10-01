import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_TILT_DEG,
  CAMERA_VERTICAL_FOV_DEG,
  FIT_MARGIN,
  cameraPosition,
  fitCameraDistance,
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
