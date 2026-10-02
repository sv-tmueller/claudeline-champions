import { Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';

export const RING_COLOUR = '#ffd23f';
export const RING_POOL_SIZE = 16;
/** How long a ring lives, in sim ticks. */
export const RING_TICKS = 18;
/** Above the area discs at 0.03. */
export const RING_Y = 0.04;
const START_RADIUS = 0.5;
const END_RADIUS = 1.2;

/**
 * A fixed pool of flat rings that grow and fade where a projectile ended.
 * A new ring takes the oldest slot, so nothing is allocated after startup.
 * Age is measured in sim ticks, so the effect is the same at any frame rate.
 */
export class ImpactRings {
  readonly group = new Group();
  /** Rings spawned so far. */
  spawned = 0;
  /** Rings showing right now. */
  visibleCount = 0;
  private readonly meshes: Mesh[] = [];
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly startTicks: number[] = [];
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
      this.active.push(false);
    }
  }

  /** Starts a ring at sim position (x, y) in meters on `tick`. */
  spawn(x: number, y: number, tick: number): void {
    const index = this.next;
    this.next = (index + 1) % RING_POOL_SIZE;
    const mesh = this.meshes[index] as Mesh;
    mesh.position.set(x, RING_Y, -y);
    mesh.visible = true;
    this.startTicks[index] = tick;
    // Taking the oldest ring while it still shows leaves the count as it was.
    if (!this.active[index]) this.visibleCount += 1;
    this.active[index] = true;
    this.spawned += 1;
  }

  /** `tick` is the sim tick and `alpha` the fraction of the next one already elapsed. */
  draw(tick: number, alpha: number): void {
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      if (!this.active[i]) continue;
      const mesh = this.meshes[i] as Mesh;
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
