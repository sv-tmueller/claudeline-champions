import { Color, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { PROJECTILE_ALLY_COLOUR, PROJECTILE_ENEMY_COLOUR } from './entity-views';
import type { AlphaClock } from './interpolate';

export const RING_COLOUR = '#ffd23f';
export const RING_POOL_SIZE = 16;
/** How long a ring lives, in sim ticks. */
export const RING_TICKS = 18;
/** Above the area discs at 0.03. */
export const RING_Y = 0.04;
/** A ring's colour: yellow, or the ally or enemy projectile colour (a heal bolt that landed on a champion). */
export type RingTint = 0 | 1 | 2;
export const RING_TINT_YELLOW = 0;
export const RING_TINT_ALLY = 1;
export const RING_TINT_ENEMY = 2;
// Indexed by the tint. A ring copies one of these into its own colour, so a spawn
// writes three fields and a recycled ring never keeps the tint of its last use.
const TINT_COLOURS: readonly Color[] = [
  new Color(RING_COLOUR),
  new Color(PROJECTILE_ALLY_COLOUR),
  new Color(PROJECTILE_ENEMY_COLOUR),
];
/** Anything with a sim position, such as the sim's hit and expiry events. */
export interface Point {
  readonly x: number;
  readonly y: number;
}
const ORIGIN: Point = { x: 0, y: 0 };
const START_RADIUS = 0.5;
const END_RADIUS = 1.2;

/**
 * A fixed pool of flat rings that grow and fade where a projectile ended.
 * A new ring takes the oldest slot, so nothing is allocated after startup.
 * Age is measured in sim ticks, so the effect is the same at any frame rate.
 */
export class ImpactRings {
  readonly group = new Group();
  /** Rings showing right now. */
  visibleCount = 0;
  private readonly meshes: Mesh[] = [];
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly startTicks: number[] = [];
  /** Where each ring is, as the sim's record: spawn keeps it and draw reads it. */
  private readonly at: Point[] = [];
  /** The tint each ring's colour has now. */
  private readonly tints: number[] = [];
  private readonly active: boolean[] = [];
  private next = 0;

  constructor() {
    const geometry = new RingGeometry(0.85, 1, 48);
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      // Each ring fades on its own, so each has its own material.
      const material = new MeshBasicMaterial({
        color: RING_COLOUR,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
      this.startTicks.push(0);
      this.at.push(ORIGIN);
      this.tints.push(RING_TINT_YELLOW);
      this.active.push(false);
    }
  }

  /**
   * Starts a ring at the sim position of `at` (the sim's event record) on `tick`, yellow
   * unless `tint` says otherwise. A hit is rare, so this runs in V8's interpreter, where
   * loading a double field allocates a heap number: spawn keeps the record and `draw`,
   * which runs every frame and is optimized, reads its coordinates. The colour is
   * written only when it changes, so a yellow ring spawns without reading a colour.
   */
  spawn(at: Point, tick: number, tint: RingTint = RING_TINT_YELLOW): void {
    const index = this.next;
    this.next = (index + 1) % RING_POOL_SIZE;
    this.at[index] = at;
    if (this.tints[index] !== tint) {
      this.tints[index] = tint;
      (this.materials[index] as MeshBasicMaterial).color.copy(TINT_COLOURS[tint] as Color);
    }
    (this.meshes[index] as Mesh).visible = true;
    this.startTicks[index] = tick;
    // Taking the oldest ring while it still shows leaves the count as it was.
    if (!this.active[index]) this.visibleCount += 1;
    this.active[index] = true;
  }

  /** `tick` is the sim tick; the clock record holds the fraction of the next one already elapsed. */
  draw(tick: number, clock: AlphaClock): void {
    const alpha = clock.alpha;
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      if (!this.active[i]) continue;
      const mesh = this.meshes[i] as Mesh;
      const at = this.at[i] as Point;
      const position = mesh.position;
      position.x = at.x;
      position.y = RING_Y;
      position.z = -at.y;
      const age = tick - (this.startTicks[i] as number) + alpha;
      if (age >= RING_TICKS) {
        this.active[i] = false;
        mesh.visible = false;
        this.visibleCount -= 1;
        continue;
      }
      const progress = Math.max(age, 0) / RING_TICKS;
      const radius = START_RADIUS + (END_RADIUS - START_RADIUS) * progress;
      mesh.scale.set(radius, radius, 1);
      (this.materials[i] as MeshBasicMaterial).opacity = 1 - progress;
    }
  }
}

export function createImpactRings(): ImpactRings {
  return new ImpactRings();
}
