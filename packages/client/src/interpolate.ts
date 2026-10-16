import type { Object3D } from 'three';

const TAU = Math.PI * 2;

/** A champion's rendered pose: meters and radians in sim space. */
export interface Pose {
  x: number;
  y: number;
  facing: number;
}

export function createPoses(count: number): Pose[] {
  return Array.from({ length: count }, () => ({ x: 0, y: 0, facing: 0 }));
}

/** Copies position and facing into `into` in place; no allocation per call. */
export function capturePoses(champions: readonly Pose[], into: Pose[]): void {
  for (let i = 0; i < champions.length; i++) {
    const champion = champions[i];
    const pose = into[i];
    if (!champion || !pose) continue;
    pose.x = champion.x;
    pose.y = champion.y;
    pose.facing = champion.facing;
  }
}

/** Interpolates along the shortest arc. The result may lie outside (-pi, pi]. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/**
 * What the frame path reads the fraction of the next tick from: the loop clock, whose
 * `alpha` is a field. A double passed to a call is boxed where V8 does not inline it,
 * so the draw calls take this record and read the field inside.
 */
export interface AlphaClock {
  readonly alpha: number;
}

export function interpolatePoses(
  previous: readonly Pose[],
  champions: readonly Pose[],
  clock: AlphaClock,
  out: Pose[],
): void {
  const alpha = clock.alpha;
  for (let i = 0; i < champions.length; i++) {
    const current = champions[i];
    const before = previous[i];
    const pose = out[i];
    if (!current || !before || !pose) continue;
    pose.x = before.x + (current.x - before.x) * alpha;
    pose.y = before.y + (current.y - before.y) * alpha;
    pose.facing = lerpAngle(before.facing, current.facing, alpha);
  }
}

// The Euler angles of a champion view: only the vertical axis ever turns. A literal
// with a fraction makes this an array of doubles from the start, so storing a facing
// never changes its elements kind, and x and z are never written again.
const ANGLES: [number, number, number] = [0, 0.5, 0];

/**
 * Puts a champion view at its drawn pose, in three's frame (sim y is -z). Writes the
 * fields of the position and sets the facing through `rotation.fromArray`, so no raw
 * double crosses a call: `position.set(x, y, z)` and the `rotation.y` setter pass
 * doubles that V8 boxes wherever it does not inline them (issue #89).
 */
export function placeChampion(view: Object3D, pose: Pose): void {
  const position = view.position;
  position.x = pose.x;
  position.y = 0;
  position.z = -pose.y;
  ANGLES[1] = pose.facing;
  view.rotation.fromArray(ANGLES);
}
