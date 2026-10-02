import { CHAMPION_RADIUS, type ArenaDef, type Obstacle } from '@claudeline/sim';
import { BufferGeometry, Group, LineBasicMaterial, LineLoop, Vector3 } from 'three';
import { simToThree } from './camera';
import type { Pose } from './interpolate';

/** Just above the floor top at y = 0. */
export const OVERLAY_Y = 0.02;
const CIRCLE_SEGMENTS = 64;

function lifted(x: number, y: number): Vector3 {
  const v = simToThree(x, y);
  v.y = OVERLAY_Y;
  return v;
}

function rectCorners(x: number, y: number, w: number, h: number): Vector3[] {
  // h is the extent along sim y.
  return [
    lifted(x - w / 2, y - h / 2),
    lifted(x + w / 2, y - h / 2),
    lifted(x + w / 2, y + h / 2),
    lifted(x - w / 2, y + h / 2),
  ];
}

/** A circle in sim space as CIRCLE_SEGMENTS points, lifted to OVERLAY_Y. */
function circlePoints(cx: number, cy: number, r: number): Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.push(lifted(cx + r * Math.cos(angle), cy + r * Math.sin(angle)));
  }
  return points;
}

function footprint(obstacle: Obstacle): Vector3[] {
  if (obstacle.type === 'rect') return rectCorners(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
  return circlePoints(obstacle.x, obstacle.y, obstacle.r);
}

/**
 * The sim footprints (boundary first, then one loop per obstacle) as lines in
 * the scene. depthTest is off so tall obstacles and walls cannot hide a line
 * and near edges do not z-fight with side faces.
 */
export function buildDebugOverlay(arena: ArenaDef, championCount: number): Group {
  const material = new LineBasicMaterial({ color: '#ff00ff', depthTest: false, depthWrite: false });
  const group = new Group();
  group.name = 'DebugOverlay';
  group.visible = false;
  const outlines = [
    rectCorners(0, 0, arena.size.width, arena.size.height),
    ...arena.obstacles.map(footprint),
  ];
  for (const points of outlines) {
    const loop = new LineLoop(new BufferGeometry().setFromPoints(points), material);
    loop.renderOrder = 1;
    group.add(loop);
  }

  // One circle per champion, built around its own origin and moved by
  // updateChampionCircles, so a frame only writes a position.
  const circles = new Group();
  circles.name = 'ChampionCircles';
  const circle = circlePoints(0, 0, CHAMPION_RADIUS);
  for (let i = 0; i < championCount; i++) {
    const loop = new LineLoop(new BufferGeometry().setFromPoints(circle), material);
    loop.renderOrder = 1;
    circles.add(loop);
  }
  group.add(circles);
  return group;
}

/** Moves each champion circle to its (interpolated) pose. Allocates nothing. */
export function updateChampionCircles(overlay: Group, poses: readonly Pose[]): void {
  const circles = overlay.getObjectByName('ChampionCircles');
  if (!circles) throw new Error('overlay has no ChampionCircles group');
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    if (!pose) continue;
    // Same mapping as simToThree, written in place.
    circles.children[i]?.position.set(pose.x, 0, -pose.y);
  }
}
