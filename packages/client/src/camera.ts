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

/** The canvas's client rect, copied once per resize into fields, so a frame reads numbers and makes no DOMRect. */
export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A canvas rect with no size yet: every field is NaN until `refreshCanvasRect` fills it. */
export function createCanvasRect(): CanvasRect {
  return { left: NaN, top: NaN, width: NaN, height: NaN };
}

/** Where `groundAimFromPointer` writes a hit, integer sim centimeters. */
export interface GroundAim {
  x: number;
  y: number;
}

/**
 * Copies the element's current client rect into `out`. The canvas fills its
 * container, so only a resize moves it: `main.ts` calls this from its resize
 * handler, after `setSize`, and a layout change without a resize event would
 * leave the copy stale. `getBoundingClientRect` makes a new DOMRect on every
 * call, which is why a frame must not call it.
 */
export function refreshCanvasRect(out: CanvasRect, element: { getBoundingClientRect(): CanvasRect }): void {
  const rect = element.getBoundingClientRect();
  out.left = rect.left;
  out.top = rect.top;
  out.width = rect.width;
  out.height = rect.height;
}

const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
const raycaster = new Raycaster();
const rayOrigin = new Vector2();
const hit = new Vector3();

/**
 * Casts the pointer's ray (client CSS pixels, through the cached canvas rect)
 * onto the ground and writes the ground point under it into `out` as integer sim
 * centimeters. Returns false, and leaves `out` alone, when the ray misses the
 * plane (cursor above the horizon). NDC y points up.
 *
 * It runs every frame while a pointer exists, so no raw double crosses a call
 * and nothing is returned or built: the NDC are locals with the same
 * expressions, in the same order, as the two functions this replaced, so the aim
 * is bit for bit the old one (camera.test.ts keeps them as the oracle). The
 * ray's own origin is a module-level Vector2 whose fields are written in place.
 */
export function groundAimFromPointer(
  camera: PerspectiveCamera,
  pointer: { clientX: number; clientY: number },
  rect: CanvasRect,
  out: GroundAim,
): boolean {
  const ndcX = 2 * ((pointer.clientX - rect.left) / rect.width) - 1;
  const ndcY = 1 - 2 * ((pointer.clientY - rect.top) / rect.height);
  rayOrigin.x = ndcX;
  rayOrigin.y = ndcY;
  raycaster.setFromCamera(rayOrigin, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return false;
  // Three (x, 0, z) is sim (x, -z). `+ 0` turns -0 into 0, as the sim does for aim.
  out.x = Math.round(hit.x * 100) + 0;
  out.y = Math.round(-hit.z * 100) + 0;
  return true;
}
