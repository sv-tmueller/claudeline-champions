import type { ArenaDef } from '@claudeline/sim';
import { type PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

export const CAMERA_TILT_DEG = 55;
export const CAMERA_VERTICAL_FOV_DEG = 40;
// The arena corners are pushed outward by this factor before fitting, which
// leaves an empty border around the ground plane.
export const FIT_MARGIN = 1.06;

const DEG = Math.PI / 180;

/** Sim (x, y) on the ground maps to three (x, 0, -y), so screen-up is sim +y. */
export function simToThree(x: number, y: number): Vector3 {
  return new Vector3(x, 0, -y);
}

/** Camera on the sim-south side, tilted `tiltDeg` above the horizontal, looking at the origin. */
export function cameraPosition(distance: number, tiltDeg: number): Vector3 {
  const tilt = tiltDeg * DEG;
  return new Vector3(0, distance * Math.sin(tilt), distance * Math.cos(tilt));
}

export interface FitInput {
  aspect: number;
  verticalFovDeg: number;
  tiltDeg: number;
  halfWidth: number;
  halfDepth: number;
  margin: number;
}

/**
 * Smallest distance from the origin at which every margin-expanded arena
 * corner is inside the viewport.
 *
 * For a corner at ground offset (x, z), the camera-space depth is
 * `d - z cos(tilt)`. Its NDC is `x / (depth t a)` horizontally and
 * `-z sin(tilt) / (depth t)` vertically, with `t = tan(fov / 2)` and `a` the
 * aspect. Requiring |NDC| <= 1 gives a lower bound on d per corner and axis.
 * The answer is the largest bound.
 */
export function fitCameraDistance(input: FitInput): number {
  const tilt = input.tiltDeg * DEG;
  const t = Math.tan((input.verticalFovDeg * DEG) / 2);
  const halfWidth = input.halfWidth * input.margin;
  const halfDepth = input.halfDepth * input.margin;
  let distance = 0;
  for (const simY of [-halfDepth, halfDepth]) {
    const z = simToThree(0, simY).z;
    const nearShift = z * Math.cos(tilt);
    distance = Math.max(
      distance,
      halfWidth / (t * input.aspect) + nearShift,
      (Math.abs(z) * Math.sin(tilt)) / t + nearShift,
    );
  }
  return distance;
}

/**
 * Frames the whole arena for a viewport of the given CSS size. The camera is
 * not in the scene, so its world matrix is updated here for the raycaster.
 */
export function fitCamera(
  camera: PerspectiveCamera,
  width: number,
  height: number,
  arena: ArenaDef,
): void {
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
  camera.updateMatrixWorld();
}

export interface Ndc {
  x: number;
  y: number;
}

/** Client (CSS pixel) coordinates to normalized device coordinates; NDC y points up. */
export function pointerToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Ndc {
  return {
    x: 2 * ((clientX - rect.left) / rect.width) - 1,
    y: 1 - 2 * ((clientY - rect.top) / rect.height),
  };
}

const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
const raycaster = new Raycaster();
const rayOrigin = new Vector2();
const hit = new Vector3();

/**
 * The ground point under an NDC position as integer sim centimeters, or null
 * when the ray misses the plane (cursor above the horizon).
 */
export function groundAimCm(camera: PerspectiveCamera, ndcX: number, ndcY: number): { x: number; y: number } | null {
  raycaster.setFromCamera(rayOrigin.set(ndcX, ndcY), camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
  // Three (x, 0, z) is sim (x, -z). `+ 0` turns -0 into 0, as the sim does for aim.
  return { x: Math.round(hit.x * 100) + 0, y: Math.round(-hit.z * 100) + 0 };
}
