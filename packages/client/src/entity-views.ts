import type { TeamId } from '@claudeline/sim';
import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Vector3,
} from 'three';
import type { AlphaClock } from './interpolate';

/** Centre height of a projectile sphere above the ground. */
export const PROJECTILE_Y = 1.0;
/** Just above the overlay lines at 0.02, below the impact rings at 0.04. */
export const AREA_Y = 0.03;
const INITIAL_SLOTS = 16;

export const PROJECTILE_ALLY_COLOUR = '#5cd6ff';
export const PROJECTILE_ENEMY_COLOUR = '#ff8a5c';
const AREA_OPACITY = 0.3;
/** An armed disc is fainter than a live one, so the ring and the filling disc carry the look. */
const ARMED_OPACITY = 0.12;
/** The ring and the progress disc sit just above the area disc, in its own units (a lifted local z). */
const RING_LIFT = 0.004;
const PROGRESS_LIFT = 0.002;
const RING_INNER = 0.92;

/** What a projectile or an area has in common for drawing. */
export interface ViewEntity {
  id: number;
  team: TeamId;
  x: number;
  y: number;
  radius: number;
  /**
   * Rules 2.7: only on an area spawned with a fuse. The area is armed, inert, while this is above
   * 0; `1 - ticksToNextApply / fuseTicks` is how far the fuse has burnt.
   */
  fuseTicks?: number;
  ticksToNextApply?: number;
}

interface Slot {
  id: number;
  active: boolean;
  seen: boolean;
  prevX: number;
  prevY: number;
  x: number;
  y: number;
  readonly mesh: Mesh;
  /** The mesh's own position vector, written field by field in `draw`. */
  readonly position: Vector3;
  /** Whether the armed look is on. Always false when the pool has no `armed` look. */
  armed: boolean;
  /** The outline and the filling disc of the armed look, children of `mesh`; null without one. */
  readonly ring: Mesh | null;
  readonly progress: Mesh | null;
}

/**
 * The look of an armed (fused, not yet pulsing) area. The disc itself takes the faint materials, a
 * ring outlines it and a disc grows inside it with the burnt part of the fuse. The materials are
 * made once with the pool, so the frame path allocates nothing.
 */
export interface ArmedLook {
  allyMaterial: MeshBasicMaterial;
  enemyMaterial: MeshBasicMaterial;
  ringGeometry: BufferGeometry;
  ringAllyMaterial: MeshBasicMaterial;
  ringEnemyMaterial: MeshBasicMaterial;
}

export interface EntityViewOptions {
  geometry: BufferGeometry;
  allyMaterial: MeshBasicMaterial;
  enemyMaterial: MeshBasicMaterial;
  localTeam: TeamId;
  /** Height of the mesh centre above the ground. */
  y: number;
  /** Lay a unit disc flat and scale it by the radius in x and y only. */
  flat: boolean;
  /** The armed look of a fused area; the pool shows it for an entity whose `fuseTicks` is above 0. */
  armed?: ArmedLook;
}

/**
 * A pool of meshes, one per live entity id. The entity arrays are never held:
 * the sim replaces them with `filter`, so each call reads the array it is given.
 * Steady state allocates nothing; growing the pool does.
 */
export class EntityViews {
  readonly group = new Group();
  private readonly slots: Slot[] = [];
  private live = 0;

  constructor(private readonly options: EntityViewOptions) {
    this.grow(INITIAL_SLOTS);
  }

  /** Views that are visible right now. */
  get count(): number {
    return this.live;
  }

  /**
   * Call before each `step`. Remembers where every entity is, and gives a
   * slot to one the views have not seen, such as a shot the F4 key spawned
   * between steps (its spawn event is dropped by the next step).
   */
  capture(entities: readonly ViewEntity[]): void {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (!entity) continue;
      const slot = this.find(entity.id) ?? this.acquire(entity);
      slot.prevX = entity.x;
      slot.prevY = entity.y;
    }
  }

  /** Call once after the step loop. Follows the entities and releases the ones that are gone. */
  sync(entities: readonly ViewEntity[]): void {
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) (slots[i] as Slot).seen = false;
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (!entity) continue;
      const slot = this.find(entity.id) ?? this.acquire(entity);
      slot.x = entity.x;
      slot.y = entity.y;
      slot.seen = true;
      this.follow(slot, entity);
    }
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as Slot;
      if (slot.active && !slot.seen) this.release(slot);
    }
  }

  /**
   * Moves each live mesh between its previous and current position. The fields
   * of the mesh's position are written directly: a `position.set(x, y, z)` call
   * passes three raw doubles, which V8 boxes into heap numbers wherever the
   * optimizing tier does not inline it (a cold branch with few live views), and
   * the live heap probe read 228 to 912 B per window of that (issue #89). The
   * fraction of the tick comes in the clock record, read by field, for the same
   * reason.
   */
  draw(clock: AlphaClock): void {
    const alpha = clock.alpha;
    const slots = this.slots;
    const y = this.options.y;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as Slot;
      if (!slot.active) continue;
      const x = slot.prevX + (slot.x - slot.prevX) * alpha;
      const simY = slot.prevY + (slot.y - slot.prevY) * alpha;
      const position = slot.position;
      position.x = x;
      position.y = y;
      position.z = -simY;
    }
  }

  private find(id: number): Slot | undefined {
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as Slot;
      if (slot.active && slot.id === id) return slot;
    }
    return undefined;
  }

  private acquire(entity: ViewEntity): Slot {
    const slots = this.slots;
    let free: Slot | undefined;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as Slot;
      if (!slot.active) {
        free = slot;
        break;
      }
    }
    if (!free) {
      const first = slots.length;
      this.grow(first);
      free = slots[first] as Slot;
    }
    free.id = entity.id;
    free.active = true;
    free.prevX = entity.x;
    free.prevY = entity.y;
    free.x = entity.x;
    free.y = entity.y;
    const mesh = free.mesh;
    mesh.material =
      entity.team === this.options.localTeam
        ? this.options.allyMaterial
        : this.options.enemyMaterial;
    if (this.options.flat) mesh.scale.set(entity.radius, entity.radius, 1);
    else mesh.scale.setScalar(entity.radius);
    // A recycled slot starts live; `follow` arms it right after if the entity is armed.
    if (free.ring && free.progress) {
      free.armed = false;
      free.ring.visible = false;
      free.progress.visible = false;
    }
    mesh.visible = true;
    this.live += 1;
    return free;
  }

  private release(slot: Slot): void {
    slot.active = false;
    slot.mesh.visible = false;
    this.live -= 1;
  }

  /**
   * Puts the armed look on a slot whose entity is armed and takes it off when the fuse has burnt.
   * Reads the fields of the entity and writes the fields of the meshes; nothing is allocated.
   */
  private follow(slot: Slot, entity: ViewEntity): void {
    const look = this.options.armed;
    const ring = slot.ring;
    const progress = slot.progress;
    if (!look || !ring || !progress) return;
    const fuse = entity.fuseTicks;
    const armed = fuse !== undefined && fuse > 0;
    if (armed !== slot.armed) {
      slot.armed = armed;
      const mine = entity.team === this.options.localTeam;
      slot.mesh.material = armed
        ? mine ? look.allyMaterial : look.enemyMaterial
        : mine ? this.options.allyMaterial : this.options.enemyMaterial;
      ring.material = mine ? look.ringAllyMaterial : look.ringEnemyMaterial;
      progress.material = mine ? this.options.allyMaterial : this.options.enemyMaterial;
      ring.visible = armed;
      progress.visible = armed;
    }
    if (armed) {
      const left = entity.ticksToNextApply ?? 0;
      const burnt = 1 - left / (fuse as number);
      progress.scale.x = burnt;
      progress.scale.y = burnt;
    }
  }

  /** Adds `count` hidden slots. Allocates, so it runs at startup and when the pool is full. */
  private grow(count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = new Mesh(this.options.geometry, this.options.enemyMaterial);
      mesh.visible = false;
      if (this.options.flat) mesh.rotation.x = -Math.PI / 2;
      let ring: Mesh | null = null;
      let progress: Mesh | null = null;
      const look = this.options.armed;
      if (look) {
        ring = new Mesh(look.ringGeometry, look.ringEnemyMaterial);
        ring.name = 'fuse-ring';
        ring.position.z = RING_LIFT;
        ring.visible = false;
        progress = new Mesh(this.options.geometry, this.options.enemyMaterial);
        progress.name = 'fuse-progress';
        progress.position.z = PROGRESS_LIFT;
        progress.scale.set(0, 0, 1);
        progress.visible = false;
        mesh.add(ring, progress);
      }
      this.group.add(mesh);
      this.slots.push({
        id: -1,
        active: false,
        seen: false,
        prevX: 0,
        prevY: 0,
        x: 0,
        y: 0,
        mesh,
        position: mesh.position,
        armed: false,
        ring,
        progress,
      });
    }
  }
}

export function createEntityViews(options: EntityViewOptions): EntityViews {
  return new EntityViews(options);
}

export function createProjectileViews(localTeam: TeamId): EntityViews {
  const views = createEntityViews({
    geometry: new SphereGeometry(1, 16, 12),
    allyMaterial: new MeshBasicMaterial({ color: PROJECTILE_ALLY_COLOUR }),
    enemyMaterial: new MeshBasicMaterial({ color: PROJECTILE_ENEMY_COLOUR }),
    localTeam,
    y: PROJECTILE_Y,
    flat: false,
  });
  views.group.name = 'Projectiles';
  return views;
}

export function createAreaViews(localTeam: TeamId): EntityViews {
  const translucent = (color: string): MeshBasicMaterial =>
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: AREA_OPACITY,
      depthWrite: false,
    });
  const armedFill = (color: string): MeshBasicMaterial =>
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: ARMED_OPACITY,
      depthWrite: false,
    });
  const outline = (color: string): MeshBasicMaterial =>
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
  const views = createEntityViews({
    geometry: new CircleGeometry(1, 48),
    allyMaterial: translucent(PROJECTILE_ALLY_COLOUR),
    enemyMaterial: translucent(PROJECTILE_ENEMY_COLOUR),
    localTeam,
    y: AREA_Y,
    flat: true,
    armed: {
      allyMaterial: armedFill(PROJECTILE_ALLY_COLOUR),
      enemyMaterial: armedFill(PROJECTILE_ENEMY_COLOUR),
      ringGeometry: new RingGeometry(RING_INNER, 1, 48),
      ringAllyMaterial: outline(PROJECTILE_ALLY_COLOUR),
      ringEnemyMaterial: outline(PROJECTILE_ENEMY_COLOUR),
    },
  });
  views.group.name = 'Areas';
  return views;
}
