import { Vector3 } from 'three';

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
