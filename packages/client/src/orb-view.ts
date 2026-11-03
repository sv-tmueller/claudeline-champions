import { CHAMPION_RADIUS, ORB_COLLECTIBLE_TICKS, ORB_RADIUS, type GameState } from '@claudeline/sim';
import { Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry } from 'three';

/** The orb is not on the field: before the warning, after the pickup and between rounds. */
export const ORB_HIDDEN = 0;
/** The warning marker shows, and the orb cannot be taken yet (17 s to 20 s of the round). */
export const ORB_WARNING = 1;
/** The orb is collectible: drawn on the marker, until the pickup or the round's end. */
export const ORB_UP = 2;
/** The text of each mode, for the `data-orb` hook, indexed by mode. */
export const ORB_TEXTS: readonly string[] = ['hidden', 'warning', 'up'];

/**
 * The orb colour: a deep blue, 80 or more from every champion body, arena floor and trim and every
 * other colour of the client (tools/blender/test_champion_models.py, CLIENT_COLOURS), and outside the
 * pixel boxes of the e2e specs. No texture and no glb: a flat ring and a sphere.
 */
export const ORB_COLOUR = '#2f4bff';
/** The ring lies just above the area discs at 0.03 and the impact rings at 0.04. */
const RING_Y = 0.05;
/** The ring's width. */
const RING_WIDTH = 0.12;

/**
 * The energy orb of a match with `MatchConfig.energyOrb`: a warning ring on the floor at the orb point,
 * as wide as the reach of a champion circle that touches the orb, and the orb itself as a sphere on it.
 * Both are made once from the match's `orb` and only ever shown or hidden. The mode is a small integer
 * (`ORB_HIDDEN`, `ORB_WARNING`, `ORB_UP`) that the event handlers set (`CombatFeedback`) and `sync` moves
 * from warning to up. Visibility is written only when the mode changes, and `changes` counts those writes
 * for the `data-orb` hook. A match with no orb gets a view that nothing ever shows.
 */
export class OrbView {
  readonly group = new Group();
  readonly ring: Mesh;
  readonly sphere: Mesh;
  mode = ORB_HIDDEN;
  /** Mode changes so far. */
  changes = 0;

  /** `at` is the point of the sim, `state.match.orb`: the sim's (x, y) is the scene's (x, -y). */
  constructor(at: { readonly x: number; readonly y: number }) {
    const material = new MeshBasicMaterial({ color: ORB_COLOUR });
    const reach = ORB_RADIUS + CHAMPION_RADIUS;
    this.ring = new Mesh(new RingGeometry(reach - RING_WIDTH, reach, 48), material);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(at.x, RING_Y, -at.y);
    this.ring.visible = false;
    this.sphere = new Mesh(new SphereGeometry(ORB_RADIUS, 24, 16), material);
    this.sphere.position.set(at.x, ORB_RADIUS, -at.y);
    this.sphere.visible = false;
    this.group.add(this.ring, this.sphere);
  }

  /** Sets the mode. Nothing is written when it is the mode already. Integers only. */
  setMode(mode: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.changes += 1;
    this.ring.visible = mode !== ORB_HIDDEN;
    this.sphere.visible = mode === ORB_UP;
  }

  /**
   * Call after every step, once the events are routed. `step` adds one to `phaseTicks` after the orb,
   * so the state reads 1200 when the next step is the first that can take the orb: from then on the
   * warning is the orb.
   */
  sync(state: Pick<GameState, 'match'>): void {
    const match = state.match;
    if (match !== undefined && this.mode === ORB_WARNING && match.phaseTicks >= ORB_COLLECTIBLE_TICKS) {
      this.setMode(ORB_UP);
    }
  }
}

/** The view of a match: at the orb point of `state.match.orb`, or at the origin for a match without one. */
export function createOrbView(state: Pick<GameState, 'match'>): OrbView {
  return new OrbView(state.match?.orb ?? { x: 0, y: 0 });
}
