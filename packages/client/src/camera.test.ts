import { Euler, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { parseArenaDef } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import {
  CAMERA_TILT_DEG,
  CAMERA_VERTICAL_FOV_DEG,
  FIT_MARGIN,
  cameraPosition,
  createCanvasRect,
  fitCamera,
  fitCameraDistance,
  groundAimFromPointer,
  refreshCanvasRect,
  simToThree,
  type CanvasRect,
  type GroundAim,
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

// The two functions that groundAimFromPointer replaced, as they were before the
// frame path went allocation-free (pointerToNdc and groundAimCm, verbatim except
// for the names and the private raycaster state). They are the oracle: the
// aim must stay exactly what it was, to the last bit of the cm integers.
interface OldNdc {
  x: number;
  y: number;
}

function oldPointerToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): OldNdc {
  return {
    x: 2 * ((clientX - rect.left) / rect.width) - 1,
    y: 1 - 2 * ((clientY - rect.top) / rect.height),
  };
}

const oldGroundPlane = new Plane(new Vector3(0, 1, 0), 0);
const oldRaycaster = new Raycaster();
const oldRayOrigin = new Vector2();
const oldHit = new Vector3();

function oldGroundAimCm(camera: PerspectiveCamera, ndcX: number, ndcY: number): { x: number; y: number } | null {
  oldRaycaster.setFromCamera(oldRayOrigin.set(ndcX, ndcY), camera);
  if (!oldRaycaster.ray.intersectPlane(oldGroundPlane, oldHit)) return null;
  // Three (x, 0, z) is sim (x, -z). `+ 0` turns -0 into 0, as the sim does for aim.
  return { x: Math.round(oldHit.x * 100) + 0, y: Math.round(-oldHit.z * 100) + 0 };
}

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

  // The pixel under a ground point, for a canvas filling `rect`.
  function pixelOf(camera: PerspectiveCamera, x: number, y: number, rect: CanvasRect): { clientX: number; clientY: number } {
    // Projects with three's own camera, so the test does not share the raycast.
    const ndc = simToThree(x, y).project(camera);
    return {
      clientX: rect.left + ((ndc.x + 1) / 2) * rect.width,
      clientY: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  }

  const FULL: CanvasRect = { left: 0, top: 0, width: WIDTH, height: HEIGHT };

  it.each(points)('groundAimFromPointer returns the sim point for %s within 1 cm', (_name, x, y) => {
    const camera = fittedCamera();
    const out: GroundAim = { x: NaN, y: NaN };
    expect(groundAimFromPointer(camera, pixelOf(camera, x, y, FULL), FULL, out)).toBe(true);
    expect(Number.isInteger(out.x)).toBe(true);
    expect(Number.isInteger(out.y)).toBe(true);
    expect(Math.abs(out.x - x * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(out.y - y * 100)).toBeLessThanOrEqual(1);
  });

  it('never writes -0', () => {
    const camera = fittedCamera();
    const out: GroundAim = { x: NaN, y: NaN };
    expect(groundAimFromPointer(camera, { clientX: WIDTH / 2, clientY: HEIGHT / 2 }, FULL, out)).toBe(true);
    expect(Object.is(out.x, -0)).toBe(false);
    expect(Object.is(out.y, -0)).toBe(false);
  });

  function missCamera(): PerspectiveCamera {
    // The fitted camera looks down steeply enough that every pixel hits the
    // ground, so this one looks up: the ray points away from y = 0.
    const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, 16 / 9, 0.1, 500);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 10, 0);
    camera.updateMatrixWorld();
    return camera;
  }

  it('reports a miss and leaves the out record alone when the ray misses the ground plane', () => {
    const out: GroundAim = { x: 7, y: -9 };
    expect(groundAimFromPointer(missCamera(), { clientX: WIDTH / 2, clientY: HEIGHT / 2 }, FULL, out)).toBe(false);
    expect(out).toEqual({ x: 7, y: -9 });
  });

  // The new path against the oracle above, over a grid of canvases, cameras and
  // pointers: the same hit or miss and the same two numbers, by Object.is, so a
  // changed operation order, a lost `+ 0` or a rounding change shows up.
  describe('against the old pointerToNdc and groundAimCm', () => {
    const canvases: [string, number, number, CanvasRect][] = [
      ['1280x720', 1280, 720, { left: 0, top: 0, width: 1280, height: 720 }],
      ['320x180', 320, 180, { left: 0, top: 0, width: 320, height: 180 }],
      ['a fractional offset', 1000, 563, { left: 12.5, top: 7.25, width: 1000.5, height: 562.75 }],
    ];
    const cameras: [string, (width: number, height: number) => PerspectiveCamera][] = [
      [
        'the fitted camera',
        (w, h) => {
          const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, 1, 0.1, 500);
          fitCamera(camera, w, h, arena);
          return camera;
        },
      ],
      ['the camera that misses', () => missCamera()],
    ];

    it.each(canvases)('agrees on %s, with fractional pointers, inside and outside the canvas', (_name, w, h, rect) => {
      for (const [cameraName, make] of cameras) {
        const camera = make(w, h);
        const out: GroundAim = { x: NaN, y: NaN };
        let hits = 0;
        let misses = 0;
        for (let i = -2; i <= 12; i++) {
          for (let j = -2; j <= 12; j++) {
            const clientX = rect.left + (i / 10) * rect.width + 0.37 * (i % 3);
            const clientY = rect.top + (j / 10) * rect.height + 0.61 * (j % 4);
            const ndc = oldPointerToNdc(clientX, clientY, rect);
            const old = oldGroundAimCm(camera, ndc.x, ndc.y);
            out.x = NaN;
            out.y = NaN;
            const hit = groundAimFromPointer(camera, { clientX, clientY }, rect, out);
            const where = `${cameraName} at (${clientX}, ${clientY})`;
            expect(hit, where).toBe(old !== null);
            if (old === null) {
              misses += 1;
              continue;
            }
            hits += 1;
            expect(Object.is(out.x, old.x), `${where} x ${out.x} vs ${old.x}`).toBe(true);
            expect(Object.is(out.y, old.y), `${where} y ${out.y} vs ${old.y}`).toBe(true);
          }
        }
        // The grid exercises both outcomes, each on the camera that gives it.
        if (cameraName === 'the fitted camera') expect(hits).toBeGreaterThan(100);
        else expect(misses).toBeGreaterThan(0);
      }
    });
  });

  it('fitCamera sets the aspect and the world matrix', () => {
    const camera = fittedCamera();
    expect(camera.aspect).toBeCloseTo(16 / 9, 12);
    const centre = simToThree(0, 0).project(camera);
    expect(Math.hypot(centre.x, centre.y)).toBeCloseTo(0, 6);
  });
});

describe('the canvas rect', () => {
  it('starts with no size, as NaN fields', () => {
    const rect = createCanvasRect();
    expect([rect.left, rect.top, rect.width, rect.height].every(Number.isNaN)).toBe(true);
  });

  it('refreshCanvasRect copies the element rect, and takes the new values on every call', () => {
    // A fake canvas whose layout changes, as a resize does. Each call returns a
    // new object, like getBoundingClientRect, so the copy cannot alias it.
    let layout = { left: 0, top: 0, width: 1280, height: 720 };
    let calls = 0;
    const element = {
      getBoundingClientRect: () => {
        calls += 1;
        return { ...layout };
      },
    };
    const rect = createCanvasRect();
    refreshCanvasRect(rect, element);
    expect(rect).toEqual({ left: 0, top: 0, width: 1280, height: 720 });
    layout = { left: 5.5, top: 2.25, width: 640.5, height: 360.75 };
    expect(rect.width, 'the copy does not follow the element by itself').toBe(1280);
    refreshCanvasRect(rect, element);
    expect(rect).toEqual({ left: 5.5, top: 2.25, width: 640.5, height: 360.75 });
    expect(calls).toBe(2);
  });

  it('moves the aim when the rect changes, so a resize that skips the refresh would be caught', () => {
    const arena = parseArenaDef(arena01Json);
    const camera = new PerspectiveCamera(CAMERA_VERTICAL_FOV_DEG, 1, 0.1, 500);
    const rect = createCanvasRect();
    const element = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };
    fitCamera(camera, 640, 360, arena);
    refreshCanvasRect(rect, element);
    const pointer = { clientX: 160, clientY: 90 };
    const before: GroundAim = { x: NaN, y: NaN };
    expect(groundAimFromPointer(camera, pointer, rect, before)).toBe(true);
    rect.width = 1280;
    rect.height = 720;
    const after: GroundAim = { x: NaN, y: NaN };
    expect(groundAimFromPointer(camera, pointer, rect, after)).toBe(true);
    expect(after).not.toEqual(before);
  });
});
