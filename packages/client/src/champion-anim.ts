import type { AlphaClock } from './interpolate';

// The animation state machine of the champions' clips: which clip plays at what time
// and weight, per champion. It is pure: no three, and nothing here poses a bone (that is
// clip-sampler.ts, which reads these records). It runs in the frame loop, so the
// frame-path rule of client.md holds: a record of small integers plus one Float64Array of
// the doubles, no closure, no number `let` outside a function, indexed loops, and no raw
// double crossing a call (the clip time is read from `state.tick` and the loop clock's
// `alpha` here, never passed in). The transitions are tuned constants in ticks at 60 Hz.

/** The clips, in the order of the tables below. The glb exports them alphabetically. */
export const CLIP_IDLE = 0;
export const CLIP_RUN = 1;
export const CLIP_ATTACK = 2;
export const CLIP_CAST = 3;
export const CLIP_HIT = 4;
export const CLIP_DEATH = 5;
export const CLIP_NAMES: readonly string[] = ['Idle', 'Run', 'Attack', 'Cast', 'Hit', 'Death'];
/** The length of each clip in seconds: the last key of the clip, in frames of 30 per second. */
export const CLIP_SECONDS = new Float64Array([2, 20 / 30, 12 / 30, 15 / 30, 9 / 30, 1]);

/** The overlay that plays over the base layer, from Spine and both arms. */
export const OV_NONE = 0;
export const OV_ATTACK = 1;
export const OV_CAST = 2;
export const OV_HIT = 3;
/** The clip of each overlay kind. */
export const OV_CLIP = new Int8Array([-1, CLIP_ATTACK, CLIP_CAST, CLIP_HIT]);
/** What a pending cast is: the first slot's Attack, or the Cast of any other slot. */
export const CAST_ATTACK = 1;
export const CAST_OTHER = 2;

// The tuned transitions, in ticks. A weight moves linearly, so a blend of n ticks is a
// rate of 60 / n per second.
/** Idle to Run and back. */
export const RUN_BLEND_TICKS = 9;
/** The overlays fade in over these ticks (Attack, Cast, Hit) ... */
const IN_TICKS = [0, 3, 3, 2];
/** ... and out over the last 6 ticks of their clip, or 6 ticks after an interrupt. */
export const OVERLAY_OUT_TICKS = 6;
/** Death blends in over these ticks, from the pose of the moment. */
export const DEATH_BLEND_TICKS = 6;
const TICKS_PER_SECOND = 60;
const RUN_BLEND_RATE = TICKS_PER_SECOND / RUN_BLEND_TICKS;
const OVERLAY_OUT_RATE = TICKS_PER_SECOND / OVERLAY_OUT_TICKS;
const DEATH_BLEND_RATE = TICKS_PER_SECOND / DEATH_BLEND_TICKS;
const OVERLAY_IN_RATE = new Float64Array(IN_TICKS.map((ticks) => (ticks === 0 ? 0 : TICKS_PER_SECOND / ticks)));

/** Below this speed, in m/s, a champion is in Idle. */
export const RUN_MIN_SPEED = 0.5;
const RUN_MIN_SPEED_SQUARED = RUN_MIN_SPEED * RUN_MIN_SPEED;
/**
 * At 5.5 m/s a step covers 1.83 m of ground and the clip's foot travel is 0.92 m, so the
 * clip plays at `speed * 2 / 5.5`: twice as fast at 5.5 m/s.
 */
export const RUN_REFERENCE_SPEED = 5.5;
export const RUN_FOOT_FACTOR = 2;
const RUN_SCALE_PER_SPEED = RUN_FOOT_FACTOR / RUN_REFERENCE_SPEED;
/** The most the clip is scaled: a dash plays at it, and so does a hasted walk (8.25 m/s at the cap). */
export const RUN_MAX_SCALE = 3;
const RUN_SECONDS = 20 / 30;
/** The passing keys of Run, frames 5 and 15: planted feet, `Hips` at rest. */
const RUN_KEY_1 = 5 / 30;
const RUN_KEY_2 = 15 / 30;
/** Run is entered at its first passing key, not at frame 0 (a split), see assets.md. */
const RUN_ENTRY = RUN_KEY_1;
/** The longest step of the clip clock: a frame that took longer (a hidden tab) is cut to it. */
const MAX_DT = 0.25;
/** Weights and clip times snap to their end values within this, so float noise ends a blend. */
const EPS = 1e-9;

/** How Run plays: not at all, on while the champion moves, or settling onto a passing key. */
const RUN_OFF = 0;
const RUN_ON = 1;
const RUN_SETTLE = 2;

// The indices of the doubles of a record.
export const D_NOW = 0;
export const D_LAST = 1;
export const D_DT = 2;
export const D_IDLE_T = 3;
export const D_RUN_T = 4;
export const D_RUN_W = 5;
export const D_RUN_SCALE = 6;
export const D_RUN_REMAIN = 7;
export const D_RUN_KEY = 8;
export const D_OV_T = 9;
/** The overlay weight before the clip's end fades it: it moves up, or down after an interrupt. */
export const D_OV_RAW = 10;
/** The weight the sampler uses: the raw weight, cut by the fade over the last 6 ticks of the clip. */
export const D_OV_W = 11;
export const D_DEATH_T = 12;
export const D_DEATH_W = 13;
const D_COUNT = 14;

/**
 * What the hook of a champion says, by `code`: the base clip, plus the overlay that plays
 * (code = want + 2 * overlay), and Death over all of it.
 */
export const ANIM_TEXTS: readonly string[] = [
  'Idle',
  'Run',
  'Idle+Attack',
  'Run+Attack',
  'Idle+Cast',
  'Run+Cast',
  'Idle+Hit',
  'Run+Hit',
  'Death',
];
const CODE_DEATH = 8;

/**
 * One champion's animation: integers for the state and the pending triggers the event pass
 * writes, and the doubles in one typed array (the indices above), so storing a double
 * never boxes one.
 */
export interface ChampionAnim {
  /** Run: `RUN_OFF`, `RUN_ON` or `RUN_SETTLE`. */
  mode: number;
  /** A settling Run sits on its key. */
  held: number;
  /** 1 when the champion walks or dashes, 0 when it is idle: the base clip it is heading for. */
  want: number;
  /** The overlay that plays, `OV_NONE` if none. */
  ov: number;
  /** 1 after an interrupt, while the overlay fades out. */
  ovFade: number;
  /** 1 once the death event came, until the round starts. */
  dead: number;
  /** The index of `ANIM_TEXTS` the champion is in. */
  code: number;
  /** The triggers of the step loop, taken and cleared by the next update. */
  pendCast: number;
  pendInterrupt: number;
  pendHit: number;
  pendDeath: number;
  pendSnap: number;
  readonly d: Float64Array;
}

export function createAnim(): ChampionAnim {
  const d = new Float64Array(D_COUNT);
  d[D_LAST] = -1;
  return {
    mode: RUN_OFF,
    held: 0,
    want: 0,
    ov: OV_NONE,
    ovFade: 0,
    dead: 0,
    code: 0,
    pendCast: 0,
    pendInterrupt: 0,
    pendHit: 0,
    pendDeath: 0,
    pendSnap: 0,
    d,
  };
}

export function createAnims(count: number): ChampionAnim[] {
  return Array.from({ length: count }, () => createAnim());
}

// The triggers. The event handlers call them cold, a few times per window: they store
// integers and load no double field. The next update (in `draw`) takes them.

/** The first slot's castStarted is an Attack, any other slot's a Cast. */
export function triggerCast(anim: ChampionAnim, kind: number): void {
  anim.pendCast = kind;
}

export function triggerInterrupt(anim: ChampionAnim): void {
  anim.pendInterrupt = 1;
}

/** Damage from a champion; the round's ring (`RING_SOURCE_ID`) never triggers it. */
export function triggerHit(anim: ChampionAnim): void {
  anim.pendHit = 1;
}

export function triggerDeath(anim: ChampionAnim): void {
  anim.pendDeath = 1;
}

/** A round starts: Idle at time 0. */
export function triggerSnap(anim: ChampionAnim): void {
  anim.pendSnap = 1;
}

/** What `updateAnims` reads of a champion. The sim's `ChampionState` fits. */
export interface AnimChampion {
  alive: boolean;
  vx: number;
  vy: number;
  facing: number;
  dash: { dirX: number; dirY: number } | null;
}

/** What it reads of the sim: the tick and the champions. `GameState` fits. */
export interface AnimState {
  readonly tick: number;
  readonly champions: readonly AnimChampion[];
}

/**
 * Takes the pending triggers and moves every champion's clips on to the drawn time,
 * `(tick + alpha) / 60`. Call it once per frame, from `draw`, before the sampler.
 */
export function updateAnims(anims: readonly ChampionAnim[], state: AnimState, clock: AlphaClock): void {
  const now = (state.tick + clock.alpha) / TICKS_PER_SECOND;
  const champions = state.champions;
  for (let i = 0; i < anims.length; i++) {
    const anim = anims[i];
    const champion = champions[i];
    if (anim === undefined || champion === undefined) continue;
    anim.d[D_NOW] = now;
    updateAnim(anim, champion);
  }
}

function updateAnim(anim: ChampionAnim, champion: AnimChampion): void {
  const d = anim.d;
  const last = d[D_LAST] as number;
  const now = d[D_NOW] as number;
  let dt = now - last;
  // The first frame and a clock that went back stand still; a long gap is cut.
  if (last < 0 || dt < 0) dt = 0;
  else if (dt > MAX_DT) dt = MAX_DT;
  d[D_DT] = dt;
  d[D_LAST] = now;
  takeTriggers(anim);
  stepIdle(d);
  stepRun(anim, champion);
  stepOverlay(anim);
  stepDeath(anim);
  anim.code = anim.dead !== 0 ? CODE_DEATH : anim.want + 2 * anim.ov;
}

function takeTriggers(anim: ChampionAnim): void {
  const d = anim.d;
  if (anim.pendDeath !== 0) {
    anim.pendDeath = 0;
    if (anim.dead === 0) {
      anim.dead = 1;
      d[D_DEATH_T] = 0;
      d[D_DEATH_W] = 0;
    }
  }
  if (anim.pendSnap !== 0) {
    anim.pendSnap = 0;
    snap(anim);
  }
  if (anim.dead !== 0) {
    anim.pendCast = 0;
    anim.pendInterrupt = 0;
    anim.pendHit = 0;
    return;
  }
  // An interrupt first: it fades the cast that plays, and a cast of the same frame replaces it.
  if (anim.pendInterrupt !== 0) {
    anim.pendInterrupt = 0;
    if (anim.ov === OV_ATTACK || anim.ov === OV_CAST) anim.ovFade = 1;
  }
  if (anim.pendCast !== 0) {
    anim.ov = anim.pendCast === CAST_ATTACK ? OV_ATTACK : OV_CAST;
    anim.pendCast = 0;
    anim.ovFade = 0;
    d[D_OV_T] = 0;
    // The weight goes on from where it is: a restarted Attack does not drop out and rise again.
    // A cast wins over a Hit of the same frame.
    anim.pendHit = 0;
  }
  if (anim.pendHit !== 0) {
    anim.pendHit = 0;
    if (anim.ov === OV_NONE) {
      anim.ov = OV_HIT;
      anim.ovFade = 0;
      d[D_OV_T] = 0;
      d[D_OV_RAW] = 0;
    }
  }
}

/** Idle at time 0 with no overlay, no Run and no Death. */
function snap(anim: ChampionAnim): void {
  const d = anim.d;
  anim.mode = RUN_OFF;
  anim.held = 0;
  anim.want = 0;
  anim.ov = OV_NONE;
  anim.ovFade = 0;
  anim.dead = 0;
  d[D_IDLE_T] = 0;
  d[D_RUN_T] = 0;
  d[D_RUN_W] = 0;
  d[D_RUN_SCALE] = 0;
  d[D_OV_T] = 0;
  d[D_OV_RAW] = 0;
  d[D_OV_W] = 0;
  d[D_DEATH_T] = 0;
  d[D_DEATH_W] = 0;
}

function stepIdle(d: Float64Array): void {
  const t = (d[D_IDLE_T] as number) + (d[D_DT] as number);
  const length = CLIP_SECONDS[CLIP_IDLE] as number;
  d[D_IDLE_T] = t - length * Math.floor(t / length);
}

function stepRun(anim: ChampionAnim, champion: AnimChampion): void {
  const d = anim.d;
  const dt = d[D_DT] as number;
  const vx = champion.vx;
  const vy = champion.vy;
  const dash = champion.dash;
  const speedSquared = vx * vx + vy * vy;
  if (dash !== null || speedSquared >= RUN_MIN_SPEED_SQUARED) {
    anim.want = 1;
    if (anim.mode === RUN_OFF) {
      // From Idle, Run starts on a passing key (the pose closest to rest), so the early
      // weights never carry a split pose.
      d[D_RUN_T] = RUN_ENTRY;
      d[D_RUN_W] = 0;
    }
    anim.mode = RUN_ON;
    anim.held = 0;
    // Forward unless the champion walks or dashes against its facing.
    const fx = Math.cos(champion.facing);
    const fy = Math.sin(champion.facing);
    let scale = RUN_MAX_SCALE;
    let dot: number;
    if (dash !== null) {
      dot = dash.dirX * fx + dash.dirY * fy;
    } else {
      scale = Math.sqrt(speedSquared) * RUN_SCALE_PER_SPEED;
      if (scale > RUN_MAX_SCALE) scale = RUN_MAX_SCALE;
      dot = vx * fx + vy * fy;
    }
    if (dot < 0) scale = -scale;
    d[D_RUN_SCALE] = scale;
    const t = (d[D_RUN_T] as number) + dt * scale;
    d[D_RUN_T] = t - RUN_SECONDS * Math.floor(t / RUN_SECONDS);
    const w = (d[D_RUN_W] as number) + dt * RUN_BLEND_RATE;
    d[D_RUN_W] = w >= 1 - EPS ? 1 : w;
    return;
  }
  anim.want = 0;
  if (anim.mode === RUN_OFF) return;
  if (anim.mode === RUN_ON) settleOnKey(anim);
  if (anim.held === 0) {
    // Plays on, at the scale it had, until the key, and its weight goes on rising if it
    // was still on its way in. No fade yet: a crossfade toward rest from a split pose
    // dips the feet below the floor (see assets.md).
    const rising = (d[D_RUN_W] as number) + dt * RUN_BLEND_RATE;
    d[D_RUN_W] = rising >= 1 - EPS ? 1 : rising;
    const scale = d[D_RUN_SCALE] as number;
    const step = dt * Math.abs(scale);
    const remain = d[D_RUN_REMAIN] as number;
    if (step >= remain - EPS) {
      d[D_RUN_T] = d[D_RUN_KEY] as number;
      anim.held = 1;
    } else {
      d[D_RUN_REMAIN] = remain - step;
      const t = (d[D_RUN_T] as number) + dt * scale;
      d[D_RUN_T] = t - RUN_SECONDS * Math.floor(t / RUN_SECONDS);
    }
  } else {
    const w = (d[D_RUN_W] as number) - dt * RUN_BLEND_RATE;
    if (w <= EPS) {
      d[D_RUN_W] = 0;
      anim.mode = RUN_OFF;
    } else {
      d[D_RUN_W] = w;
    }
  }
}

/**
 * The walk stopped: finds the next passing key in the direction Run plays (frames 5 and
 * 15, 1/6 s and 1/2 s) and how far it is. A Run that already sits on one holds at once.
 */
function settleOnKey(anim: ChampionAnim): void {
  const d = anim.d;
  const t = d[D_RUN_T] as number;
  anim.mode = RUN_SETTLE;
  anim.held = 0;
  let remain: number;
  let key = RUN_KEY_1;
  if ((d[D_RUN_SCALE] as number) >= 0) {
    if (t <= RUN_KEY_1 + EPS) {
      remain = RUN_KEY_1 - t;
    } else if (t <= RUN_KEY_2 + EPS) {
      key = RUN_KEY_2;
      remain = RUN_KEY_2 - t;
    } else {
      remain = RUN_KEY_1 + RUN_SECONDS - t;
    }
  } else if (t >= RUN_KEY_2 - EPS) {
    key = RUN_KEY_2;
    remain = t - RUN_KEY_2;
  } else if (t >= RUN_KEY_1 - EPS) {
    remain = t - RUN_KEY_1;
  } else {
    key = RUN_KEY_2;
    remain = t + RUN_SECONDS - RUN_KEY_2;
  }
  d[D_RUN_KEY] = key;
  d[D_RUN_REMAIN] = remain;
  if (remain <= EPS) {
    d[D_RUN_T] = key;
    anim.held = 1;
  }
}

function stepOverlay(anim: ChampionAnim): void {
  const d = anim.d;
  const ov = anim.ov;
  if (ov === OV_NONE) {
    d[D_OV_W] = 0;
    return;
  }
  const dt = d[D_DT] as number;
  const length = CLIP_SECONDS[OV_CLIP[ov] as number] as number;
  const t = (d[D_OV_T] as number) + dt;
  d[D_OV_T] = t;
  let raw = d[D_OV_RAW] as number;
  if (anim.ovFade === 0) {
    raw += dt * (OVERLAY_IN_RATE[ov] as number);
    if (raw >= 1 - EPS) raw = 1;
  } else {
    raw -= dt * OVERLAY_OUT_RATE;
    if (raw <= EPS) raw = 0;
  }
  d[D_OV_RAW] = raw;
  // The last 6 ticks of the clip fade it out, so it ends at zero weight on its last key.
  let w = raw;
  const tail = (length - t) * OVERLAY_OUT_RATE;
  if (tail < w) w = tail;
  if (t >= length - EPS || (anim.ovFade !== 0 && raw <= 0)) {
    anim.ov = OV_NONE;
    anim.ovFade = 0;
    d[D_OV_T] = 0;
    d[D_OV_RAW] = 0;
    d[D_OV_W] = 0;
    return;
  }
  d[D_OV_W] = w;
}

function stepDeath(anim: ChampionAnim): void {
  if (anim.dead === 0) return;
  const d = anim.d;
  const dt = d[D_DT] as number;
  const length = CLIP_SECONDS[CLIP_DEATH] as number;
  // Held on the last frame: the time stops at the clip's end and never wraps.
  const t = (d[D_DEATH_T] as number) + dt;
  d[D_DEATH_T] = t >= length - EPS ? length : t;
  const w = (d[D_DEATH_W] as number) + dt * DEATH_BLEND_RATE;
  d[D_DEATH_W] = w >= 1 - EPS ? 1 : w;
}
