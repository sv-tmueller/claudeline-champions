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
/** A cast that replaces a playing overlay crossfades from the last drawn pose over these ticks. */
export const OVERLAY_CROSSFADE_TICKS = 3;
/** Death blends in over these ticks, from the pose of the moment. */
export const DEATH_BLEND_TICKS = 6;
const TICKS_PER_SECOND = 60;
const RUN_BLEND_RATE = TICKS_PER_SECOND / RUN_BLEND_TICKS;
const OVERLAY_OUT_RATE = TICKS_PER_SECOND / OVERLAY_OUT_TICKS;
const DEATH_BLEND_RATE = TICKS_PER_SECOND / DEATH_BLEND_TICKS;
const OVERLAY_CROSSFADE_RATE = TICKS_PER_SECOND / OVERLAY_CROSSFADE_TICKS;
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
/**
 * The most the clip is scaled: a dash plays at it, and so does a hasted walk (8.25 m/s at the
 * cap).
 */
export const RUN_MAX_SCALE = 3;
const IDLE_SECONDS = 2;
const RUN_SECONDS = 20 / 30;
/** The passing keys of Run, frames 5 and 15: planted feet, `Hips` at rest. */
const RUN_KEY_1 = 5 / 30;
const RUN_KEY_2 = 15 / 30;
/** Run is entered at its first passing key, not at frame 0 (a split), see assets.md. */
const RUN_ENTRY = RUN_KEY_1;
/**
 * The longest step of the clip clock: a frame that took longer (a hidden tab) is cut to it. At the
 * scale cap it moves Run by 0.6 s, less than the 2/3 s clip, so a wrap is one subtraction.
 */
const MAX_DT = 0.2;
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
/** The overlay weight before the clip's end fades it: up, or down after an interrupt. */
export const D_OV_RAW = 10;
/** The weight the sampler uses: the raw weight, cut by the fade of the clip's last 6 ticks. */
export const D_OV_W = 11;
export const D_DEATH_T = 12;
export const D_DEATH_W = 13;
/** The position of the last frame, for the direction of a dash. */
export const D_LAST_X = 14;
export const D_LAST_Y = 15;
/** The weight of the crossfade from the last drawn pose to the new overlay's, 0 to 1. */
export const D_XF_W = 16;
const D_COUNT = 17;

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
  /** 1 when the Run of the last frame sat on a passing key: a stop then holds at once. */
  atKey: number;
  /** 1 between the sim's dashStarted and dashEnded events of this champion (and a round end). */
  dashing: number;
  /**
   * A cast replaced a playing overlay: 1 until the sampler has copied the last drawn pose of
   * Spine and both arms, 2 while it crossfades from it, 0 when it is over.
   */
  xfade: number;
  /** 1 or -1: the direction Run plays, from the last frame that had one (a dot of 0 keeps it). */
  sign: number;
  /** 1 until the first update, which has no frame before it to measure a displacement from. */
  fresh: number;
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
    atKey: 0,
    dashing: 0,
    sign: 1,
    xfade: 0,
    fresh: 1,
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

/**
 * The sim's dashStarted (1) and dashEnded (0) of a champion. A dash plays Run at its cap. It is
 * an event and not a read of `champion.dash`: an object that only shows up in a dash would be a
 * load V8 has no feedback for in the frame loop, and the first one deoptimizes it.
 */
export function triggerDash(anim: ChampionAnim, on: number): void {
  anim.dashing = on;
}

/** What `updateAnims` reads of a champion. The sim's `ChampionState` fits. */
export interface AnimChampion {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The aim point in whole centimetres: the facing is the direction to it. */
  aimX: number;
  aimY: number;
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

/**
 * The drawn time of an online match, in ticks: the render clock's tick (`net/render-clock.ts`),
 * which fits by shape and is read inside `updateAnimsAt` like `alpha` is in `updateAnims`.
 */
export interface DrawnTime {
  readonly ticks: number;
}

/**
 * `updateAnims` for an online match. There the two states a draw interpolates are a snapshot gap
 * apart, so `(state.tick + alpha) / 60` would jump the gap; the drawn time is the render tick,
 * `drawn.ticks / 60`. Same steps, same triggers. The local path keeps `updateAnims`.
 */
export function updateAnimsAt(
  anims: readonly ChampionAnim[],
  champions: readonly AnimChampion[],
  drawn: DrawnTime,
): void {
  const now = drawn.ticks / TICKS_PER_SECOND;
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
  // The first frame and a clock that went back stand still; a long gap is cut. Written as stores in
  // branches, see the note on phis above stepRun.
  d[D_DT] = now - last;
  if (last < 0 || now < last) d[D_DT] = 0;
  else if (now - last > MAX_DT) d[D_DT] = MAX_DT;
  d[D_LAST] = now;
  takeTriggers(anim);
  stepIdle(d);
  stepRun(anim, champion);
  stepOverlay(anim);
  stepCrossfade(anim);
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
    // A cast that replaces a playing overlay would cut from its pose to the new clip's first
    // key (Arm_R 77 degrees in one tick, Attack to Cast): the sampler crossfades from the pose
    // last drawn, over OVERLAY_CROSSFADE_TICKS.
    if (anim.ov !== OV_NONE) {
      anim.xfade = 1;
      d[D_XF_W] = 0;
    }
    anim.ov = anim.pendCast === CAST_ATTACK ? OV_ATTACK : OV_CAST;
    anim.pendCast = 0;
    anim.ovFade = 0;
    d[D_OV_T] = 0;
    // The weight goes on from the weight the last frame showed, which the last 6 ticks of the
    // clip had cut: a restart in that tail rises in 3 ticks, it does not jump to the raw weight.
    // A cast wins over a Hit of the same frame.
    d[D_OV_RAW] = d[D_OV_W] as number;
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
  anim.atKey = 0;
  anim.dashing = 0;
  anim.sign = 1;
  anim.xfade = 0;
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
  // A step is at most MAX_DT, shorter than the clip, so one subtraction wraps it.
  let t = (d[D_IDLE_T] as number) + (d[D_DT] as number);
  if (t >= IDLE_SECONDS) t -= IDLE_SECONDS;
  d[D_IDLE_T] = t;
}

// A note on phis, for stepRun and the other steps. V8's Maglev gives a double that is the result of
// a branch merge (`x = cond ? 1 : w`, or a `let` assigned in an `if`) a tagged representation when
// one side is an integer constant, and every merge of a double then allocates a heap number: one
// per call, 12 to 16 B, 150 KB in the bench of 12 000 calls. So no double in these steps is the
// merge of a branch with an integer on one side: a branch stores into the Float64Array, or the
// choice is arithmetic on a 0 or 1.
function stepRun(anim: ChampionAnim, champion: AnimChampion): void {
  const d = anim.d;
  const dt = d[D_DT] as number;
  const vx = champion.vx;
  const vy = champion.vy;
  // The displacement since the last frame gives a dash its direction: its walk velocity is zero.
  const x = champion.x;
  const y = champion.y;
  const moved = 1 - anim.fresh;
  const dx = (x - (d[D_LAST_X] as number)) * moved;
  const dy = (y - (d[D_LAST_Y] as number)) * moved;
  d[D_LAST_X] = x;
  d[D_LAST_Y] = y;
  anim.fresh = 0;
  const speedSquared = vx * vx + vy * vy;
  if (anim.dashing !== 0 || speedSquared >= RUN_MIN_SPEED_SQUARED) {
    anim.want = 1;
    if (anim.mode === RUN_OFF) {
      // From Idle, Run starts on a passing key (the pose closest to rest), so the early
      // weights never carry a split pose.
      d[D_RUN_T] = RUN_ENTRY;
      d[D_RUN_W] = 0;
    }
    anim.mode = RUN_ON;
    anim.held = 0;
    // Forward unless the champion walks or dashes against its facing. The facing is the
    // direction to the aim point (the sim turns it there every tick), so the dot product needs
    // no trig: only its sign matters. A dash has no walk velocity, so its motion is the
    // displacement since the last frame. The choice between the two is arithmetic on 0 or 1,
    // not a branch or a select: a double that comes out of a branch is a phi, which V8's Maglev
    // may box.
    const toAimX = champion.aimX / 100 - x;
    const toAimY = champion.aimY / 100 - y;
    const dash = anim.dashing;
    d[D_RUN_SCALE] = Math.sqrt(speedSquared) * RUN_SCALE_PER_SPEED;
    if ((d[D_RUN_SCALE] as number) > RUN_MAX_SCALE) d[D_RUN_SCALE] = RUN_MAX_SCALE;
    const walkScale = d[D_RUN_SCALE] as number;
    let scale = walkScale + (RUN_MAX_SCALE - walkScale) * dash;
    const dot = (dx * toAimX + dy * toAimY) * dash + (vx * toAimX + vy * toAimY) * (1 - dash);
    // The sign is an integer, 1 or -1, and the scale is multiplied: a double negated under a
    // branch was boxed. A frame with no step has no displacement, so a dot of 0 keeps the sign of
    // the last frame that had a direction.
    if (dot !== 0) anim.sign = dot < 0 ? -1 : 1;
    scale *= anim.sign;
    d[D_RUN_SCALE] = scale;
    // A step of the clip clock, at most MAX_DT times the scale cap, is shorter than the clip:
    // one wrap.
    let t = (d[D_RUN_T] as number) + dt * scale;
    if (t >= RUN_SECONDS) t -= RUN_SECONDS;
    else if (t < 0) t += RUN_SECONDS;
    d[D_RUN_T] = t;
    const w = (d[D_RUN_W] as number) + dt * RUN_BLEND_RATE;
    if (w >= 1 - EPS) d[D_RUN_W] = 1;
    else d[D_RUN_W] = w;
    // The key a stop on the next frame would settle onto, and how far it is: the next passing key
    // (frames 5 and 15, 1/6 s and 1/2 s) in the direction Run plays. Worked out here, in the hot
    // frame, so the stop itself is a flip of two integers and no cold code boxes a double.
    let key = RUN_KEY_1;
    let remain: number;
    if (scale >= 0) {
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
    anim.atKey = remain <= EPS ? 1 : 0;
    return;
  }
  anim.want = 0;
  if (anim.mode === RUN_OFF) return;
  if (anim.mode === RUN_ON) {
    // The walk stopped: Run plays on to the key worked out on the last frame, or holds at once
    // when it already sits on one.
    anim.mode = RUN_SETTLE;
    anim.held = anim.atKey;
    if (anim.atKey !== 0) d[D_RUN_T] = d[D_RUN_KEY] as number;
  }
  if (anim.held === 0) {
    // Plays on, at the scale it had, until the key, and its weight goes on rising if it
    // was still on its way in. No fade yet: a crossfade toward rest from a split pose
    // dips the feet below the floor (see assets.md).
    const rising = (d[D_RUN_W] as number) + dt * RUN_BLEND_RATE;
    if (rising >= 1 - EPS) d[D_RUN_W] = 1;
    else d[D_RUN_W] = rising;
    const scale = d[D_RUN_SCALE] as number;
    const step = scale >= 0 ? dt * scale : -dt * scale;
    const remain = d[D_RUN_REMAIN] as number;
    if (step >= remain - EPS) {
      d[D_RUN_T] = d[D_RUN_KEY] as number;
      anim.held = 1;
    } else {
      d[D_RUN_REMAIN] = remain - step;
      let advanced = (d[D_RUN_T] as number) + dt * scale;
      if (advanced >= RUN_SECONDS) advanced -= RUN_SECONDS;
      else if (advanced < 0) advanced += RUN_SECONDS;
      d[D_RUN_T] = advanced;
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
  if (anim.ovFade === 0) {
    const rising = (d[D_OV_RAW] as number) + dt * (OVERLAY_IN_RATE[ov] as number);
    if (rising >= 1 - EPS) d[D_OV_RAW] = 1;
    else d[D_OV_RAW] = rising;
  } else {
    const falling = (d[D_OV_RAW] as number) - dt * OVERLAY_OUT_RATE;
    if (falling <= EPS) d[D_OV_RAW] = 0;
    else d[D_OV_RAW] = falling;
  }
  const raw = d[D_OV_RAW] as number;
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

function stepCrossfade(anim: ChampionAnim): void {
  if (anim.xfade === 0) return;
  const d = anim.d;
  const w = (d[D_XF_W] as number) + (d[D_DT] as number) * OVERLAY_CROSSFADE_RATE;
  if (w >= 1 - EPS) d[D_XF_W] = 1;
  else d[D_XF_W] = w;
}

function stepDeath(anim: ChampionAnim): void {
  if (anim.dead === 0) return;
  const d = anim.d;
  const dt = d[D_DT] as number;
  const length = CLIP_SECONDS[CLIP_DEATH] as number;
  // Held on the last frame: the time stops at the clip's end and never wraps.
  const t = (d[D_DEATH_T] as number) + dt;
  if (t >= length - EPS) d[D_DEATH_T] = length;
  else d[D_DEATH_T] = t;
  const w = (d[D_DEATH_W] as number) + dt * DEATH_BLEND_RATE;
  if (w >= 1 - EPS) d[D_DEATH_W] = 1;
  else d[D_DEATH_W] = w;
}

// The priming script. V8 compiles a hot function with the type feedback it has seen, and a
// branch it has never run is compiled as a deopt: the first stop, dash, Cast or death that
// reached the frame loop threw the optimized code of `stepRun` or `poseChampion` away, and the
// function ran in the interpreter for hundreds of calls, which boxes a double per operation
// (7 to 25 KB per probe window on the first run of this module, and 2 to 10 KB when the first
// crossfade between two overlays came inside a window). So every branch runs once at
// load, on a record of its own, and the feedback exists before the first frame. Each row is
// [ticks, vx, vy, facing, dx, event]: the champion walks at (vx, vy), moves by dx per tick (a
// dash has no walk velocity) and the event, if any, is triggered on the row's first tick.
const EVENT_NONE = 0;
const EVENT_ATTACK = 1;
const EVENT_CAST = 2;
const EVENT_INTERRUPT = 3;
const EVENT_HIT = 4;
const EVENT_DASH_ON = 5;
const EVENT_DASH_OFF = 6;
const EVENT_DEATH = 7;
const EVENT_SNAP = 8;
const SCRIPT: readonly (readonly number[])[] = [
  [20, 0, 0, 0, 0, EVENT_NONE],
  // A walk and a stop, at every phase it can stop at, in both directions and at a slow pace.
  [25, 5.5, 0, 0, 0, EVENT_NONE],
  [30, 0, 0, 0, 0, EVENT_NONE],
  [3, 5.5, 2, 0.5, 0, EVENT_NONE],
  [30, 0, 0, 0.5, 0, EVENT_NONE],
  [25, -5.5, 0, 0, 0, EVENT_NONE],
  [30, 0, 0, 0, 0, EVENT_NONE],
  [7, 1, 0, 0, 0, EVENT_NONE],
  [30, 0, 0, 0, 0, EVENT_NONE],
  [9, 0, 6, 1.5, 0, EVENT_NONE],
  [30, 0, 0, 1.5, 0, EVENT_NONE],
  [11, 8.25, 0, 0, 0, EVENT_NONE],
  [30, 0, 0, 0, 0, EVENT_NONE],
  // Overlays over a walk and over Idle, replacing, interrupted and cut short.
  [6, 5.5, 0, 0, 0, EVENT_ATTACK],
  [10, 5.5, 0, 0, 0, EVENT_CAST],
  [4, 5.5, 0, 0, 0, EVENT_HIT],
  [10, 5.5, 0, 0, 0, EVENT_INTERRUPT],
  [30, 0, 0, 0, 0, EVENT_NONE],
  [9, 0, 0, 0, 0, EVENT_ATTACK],
  [30, 0, 0, 0, 0, EVENT_ATTACK],
  [4, 0, 0, 0, 0, EVENT_CAST],
  [10, 0, 0, 0, 0, EVENT_ATTACK],
  [10, 5.5, 0, 0, 0, EVENT_CAST],
  [6, 5.5, 0, 0, 0, EVENT_ATTACK],
  [30, 0, 0, 0, 0, EVENT_NONE],
  [30, 0, 0, 0, 0, EVENT_INTERRUPT],
  [20, 0, 0, 0, 0, EVENT_HIT],
  [5, 0, 0, 0, 0, EVENT_HIT],
  [30, 5.5, 0, 0, 0, EVENT_HIT],
  // A dash forward, a dash against the facing, and the end.
  [12, 0, 0, 0, 0.5, EVENT_DASH_ON],
  [12, 0, 0, 0, -0.5, EVENT_NONE],
  [20, 0, 0, 0, 0, EVENT_DASH_OFF],
  [10, 5.5, 0, 0, 0, EVENT_DASH_ON],
  [10, 5.5, 0, 0, 0, EVENT_DASH_OFF],
  // A death over a walk and an Attack, held, then the next round, and a death from Idle.
  [6, 5.5, 0, 0, 0, EVENT_ATTACK],
  [3, 5.5, 0, 0, 0, EVENT_DEATH],
  [90, 0, 0, 0, 0, EVENT_NONE],
  [6, 0, 0, 0, 0, EVENT_SNAP],
  [20, 0, 0, 0, 0, EVENT_NONE],
  [4, 0, 0, 0, 0, EVENT_HIT],
  [90, 0, 0, 0, 0, EVENT_DEATH],
  [6, 0, 0, 0, 0, EVENT_SNAP],
];

/**
 * Runs the priming script through a record of its own, calling `visit` after every update: the
 * caller poses a rig from it, which primes the sampler. Allocates, since it runs once at load.
 */
export function scriptAnims(visit: (anim: ChampionAnim) => void): void {
  const anim = createAnim();
  const champion: AnimChampion = { x: 0, y: 0, vx: 0, vy: 0, aimX: 1000, aimY: 0 };
  const state = { tick: 0, champions: [champion] };
  const clock = { alpha: 0 };
  const anims = [anim];
  for (const row of SCRIPT) {
    const [ticks, vx, vy, facing, dx, event] = row as [number, number, number, number, number, number];
    champion.vx = vx;
    champion.vy = vy;
    // The aim point is 10 m away in the facing direction, from the origin the champion starts at.
    champion.aimX = Math.round(Math.cos(facing) * 1000);
    champion.aimY = Math.round(Math.sin(facing) * 1000);
    for (let tick = 0; tick < ticks; tick++) {
      if (tick === 0) triggerEvent(anim, event);
      champion.x += dx;
      state.tick += 1;
      clock.alpha = (tick % 4) / 4;
      updateAnims(anims, state, clock);
      visit(anim);
    }
  }
}

function triggerEvent(anim: ChampionAnim, event: number): void {
  if (event === EVENT_ATTACK) triggerCast(anim, CAST_ATTACK);
  else if (event === EVENT_CAST) triggerCast(anim, CAST_OTHER);
  else if (event === EVENT_INTERRUPT) triggerInterrupt(anim);
  else if (event === EVENT_HIT) triggerHit(anim);
  else if (event === EVENT_DASH_ON) triggerDash(anim, 1);
  else if (event === EVENT_DASH_OFF) triggerDash(anim, 0);
  else if (event === EVENT_DEATH) triggerDeath(anim);
  else if (event === EVENT_SNAP) triggerSnap(anim);
  else if (event !== EVENT_NONE) throw new Error(`unknown event ${event} in the priming script`);
}
