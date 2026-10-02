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

export function interpolatePoses(
  previous: readonly Pose[],
  champions: readonly Pose[],
  alpha: number,
  out: Pose[],
): void {
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
