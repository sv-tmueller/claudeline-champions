import { AnimationClip, InterpolateLinear, type Bone, type Object3D, type SkinnedMesh } from 'three';
import {
  CLIP_DEATH,
  CLIP_IDLE,
  CLIP_NAMES,
  CLIP_RUN,
  D_DEATH_T,
  D_DEATH_W,
  D_IDLE_T,
  D_OV_T,
  D_OV_W,
  D_RUN_T,
  D_RUN_W,
  OV_CLIP,
  OV_NONE,
  type ChampionAnim,
} from './champion-anim';

// Plays the six clips of a champion model on the clip data, by itself, and poses the bones.
// three's AnimationMixer is not on the frame path: it allocates 12 to 104 KB per probe window
// and averages instead of masking per bone (#105 decision 11). It is the oracle of
// clip-sampler.test.ts, which compares this module to it bit for bit.
//
// The rules of the frame path (client.md) hold here: no raw double crosses a call (a clip time
// is read from `rig.time`, a weight from the animation record's Float64Array, a slerp's t from
// a Float64Array), every buffer is allocated once, in `createClipRig`, and nothing but
// `writePose` poses a bone, once per bone per frame, with `fromArray(buffer, 0)`.
//
// The blend, with no additive blending anywhere:
// - the base layer crossfades Idle and Run with weights summing to 1; a channel only Run keys
//   (the legs) blends from the rest pose, as three does;
// - the overlay (Attack, Cast or Hit) replaces the channels it keys (Spine and both arms) with
//   slerp(base, overlay, w), so the strike reads fully at w = 1 and the legs keep Run's;
// - Death goes over everything: its channels blend from the pose of the moment by its weight,
//   and the channels it does not key (the legs) blend to rest.

/** The bones of the rig, in the order of the pose buffer. */
export const BONE_NAMES: readonly string[] = ['Hips', 'Spine', 'Arm_L', 'Arm_R', 'Leg_L', 'Leg_R'];
const BONES = 6;
/** The channels: a rotation per bone, then the Hips translation. */
const CHANNELS = 7;
const POSITION_CHANNEL = 6;
/** A pose buffer holds six quaternions, then the Hips position (3 doubles and a pad). */
export const HIPS_POSITION = 24;
export const STRIDE = 28;
const CLIPS = 6;

/** Where a clip's time is read from: the four clips that can play at once. */
export const SLOT_IDLE = 0;
export const SLOT_RUN = 1;
export const SLOT_OVERLAY = 2;
export const SLOT_DEATH = 3;

/** The keys of one channel of one clip: three's own arrays, read as they are. */
interface Track {
  readonly times: Float32Array;
  readonly values: Float32Array;
  /** The size of one value: 4 for a rotation, 3 for the translation. */
  readonly size: number;
}

export interface ClipRig {
  readonly bones: readonly Bone[];
  /** The rest pose of the bones, saved at load before any write. */
  readonly rest: Float64Array;
  /** Per clip and channel, the index in `tracks`, or -1 when the clip does not key the channel. */
  readonly trackOf: Int16Array;
  readonly tracks: readonly Track[];
  /** The key each track was last found in, so a clip played in order looks one key on. */
  readonly cursor: Int32Array;
  /** The clip times to sample at, by slot. */
  readonly time: Float64Array;
  /** The pose that is written to the bones. */
  readonly cur: Float64Array;
  /** The samples of the clips, blended into `cur`; `scratch` is a spare. */
  readonly idle: Float64Array;
  readonly run: Float64Array;
  readonly over: Float64Array;
  readonly death: Float64Array;
  readonly scratch: Float64Array;
  /** The two keys of a rotation being sampled, widened to doubles. */
  readonly pair: Float64Array;
  /** The t of the slerp being run, so no double crosses a call. */
  readonly alpha: Float64Array;
}

/**
 * Binds the six clips of a model to the bones of one view, by name. A missing clip, an
 * unknown bone or a track that is not linear throws, so a bad model is a page error at load.
 * Turns culling off on every skinned mesh: the bounding sphere is the bind pose, and the
 * Death corpse lies up to 1.31 m outside it.
 */
export function createClipRig(root: Object3D, clips: readonly AnimationClip[]): ClipRig {
  const bones: Bone[] = [];
  for (const name of BONE_NAMES) {
    const found = root.getObjectByName(name);
    if (found === undefined || !(found as Bone).isBone) throw new Error(`the champion model has no bone ${name}`);
    bones.push(found as Bone);
  }
  const rest = new Float64Array(STRIDE);
  for (let bone = 0; bone < BONES; bone++) (bones[bone] as Bone).quaternion.toArray(rest, bone * 4);
  (bones[0] as Bone).position.toArray(rest, HIPS_POSITION);

  const trackOf = new Int16Array(CLIPS * CHANNELS).fill(-1);
  const tracks: Track[] = [];
  for (let clipIndex = 0; clipIndex < CLIPS; clipIndex++) {
    const name = CLIP_NAMES[clipIndex] as string;
    const clip = AnimationClip.findByName(clips as AnimationClip[], name);
    if (clip === null) throw new Error(`the champion model has no clip ${name}`);
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      const node = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1);
      const bone = BONE_NAMES.indexOf(node);
      if (bone < 0) throw new Error(`clip ${name} has a track of ${node}, which is no bone of the rig`);
      let channel = -1;
      let size = 0;
      if (property === 'quaternion') {
        channel = bone;
        size = 4;
      } else if (property === 'position' && bone === 0) {
        channel = POSITION_CHANNEL;
        size = 3;
      }
      if (channel < 0) throw new Error(`clip ${name} has a track ${track.name}, which the sampler does not play`);
      if (track.getInterpolation() !== InterpolateLinear) throw new Error(`clip ${name} track ${track.name} is not linear`);
      if (!(track.times instanceof Float32Array) || !(track.values instanceof Float32Array)) {
        throw new Error(`clip ${name} track ${track.name} is not float32`);
      }
      if (track.values.length !== track.times.length * size) throw new Error(`clip ${name} track ${track.name} has the wrong size`);
      if (track.times.length < 2) throw new Error(`clip ${name} track ${track.name} has fewer than two keys`);
      if (trackOf[clipIndex * CHANNELS + channel] !== -1) throw new Error(`clip ${name} keys ${track.name} twice`);
      trackOf[clipIndex * CHANNELS + channel] = tracks.length;
      tracks.push({ times: track.times, values: track.values, size });
    }
  }

  root.traverse((object) => {
    if ((object as SkinnedMesh).isSkinnedMesh) object.frustumCulled = false;
  });

  return {
    bones,
    rest,
    trackOf,
    tracks,
    cursor: new Int32Array(tracks.length).fill(1),
    time: new Float64Array(4),
    cur: new Float64Array(STRIDE),
    idle: new Float64Array(STRIDE),
    run: new Float64Array(STRIDE),
    over: new Float64Array(STRIDE),
    death: new Float64Array(STRIDE),
    scratch: new Float64Array(STRIDE),
    pair: new Float64Array(8),
    alpha: new Float64Array(1),
  };
}

/**
 * `Quaternion.slerpFlat` of three, ported operation for operation so the result is the
 * same bit for bit; only t is read from an array. `dst` may be `a` or `b`.
 */
function slerpFlat(
  dst: Float64Array,
  dstOffset: number,
  a: Float64Array,
  aOffset: number,
  b: Float64Array,
  bOffset: number,
  tv: Float64Array,
  ti: number,
): void {
  let x0 = a[aOffset] as number;
  let y0 = a[aOffset + 1] as number;
  let z0 = a[aOffset + 2] as number;
  let w0 = a[aOffset + 3] as number;
  let x1 = b[bOffset] as number;
  let y1 = b[bOffset + 1] as number;
  let z1 = b[bOffset + 2] as number;
  let w1 = b[bOffset + 3] as number;
  let t = tv[ti] as number;

  if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {
    let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
    if (dot < 0) {
      x1 = -x1;
      y1 = -y1;
      z1 = -z1;
      w1 = -w1;
      dot = -dot;
    }
    let s = 1 - t;
    if (dot < 0.9995) {
      const theta = Math.acos(dot);
      const sin = Math.sin(theta);
      s = Math.sin(s * theta) / sin;
      t = Math.sin(t * theta) / sin;
      x0 = x0 * s + x1 * t;
      y0 = y0 * s + y1 * t;
      z0 = z0 * s + z1 * t;
      w0 = w0 * s + w1 * t;
    } else {
      x0 = x0 * s + x1 * t;
      y0 = y0 * s + y1 * t;
      z0 = z0 * s + z1 * t;
      w0 = w0 * s + w1 * t;
      const f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
      x0 *= f;
      y0 *= f;
      z0 *= f;
      w0 *= f;
    }
  }
  dst[dstOffset] = x0;
  dst[dstOffset + 1] = y0;
  dst[dstOffset + 2] = z0;
  dst[dstOffset + 3] = w0;
}

/** The linear mix of three's `PropertyMixer._lerp`, for the Hips translation: dst = a (1 - t) + b t. */
function lerpPosition(
  dst: Float64Array,
  dstOffset: number,
  a: Float64Array,
  aOffset: number,
  b: Float64Array,
  bOffset: number,
  tv: Float64Array,
  ti: number,
): void {
  const t = tv[ti] as number;
  const s = 1 - t;
  for (let i = 0; i < 3; i++) dst[dstOffset + i] = (a[aOffset + i] as number) * s + (b[bOffset + i] as number) * t;
}

/** Blends one channel of `b` into `a`: a slerp for a rotation, a lerp for the translation. */
function blendChannel(
  dst: Float64Array,
  a: Float64Array,
  b: Float64Array,
  channel: number,
  tv: Float64Array,
  ti: number,
): void {
  if (channel === POSITION_CHANNEL) lerpPosition(dst, HIPS_POSITION, a, HIPS_POSITION, b, HIPS_POSITION, tv, ti);
  else slerpFlat(dst, channel * 4, a, channel * 4, b, channel * 4, tv, ti);
}

/**
 * Samples one track at `rig.time[slot]` into `out` at `offset`, LINEAR as three's interpolants do:
 * the first key before the first time, the last key from the last time, and in between the
 * interval whose keys bracket it, found from the key the track was last in.
 */
function sampleTrack(rig: ClipRig, trackIndex: number, slot: number, out: Float64Array, offset: number): void {
  const track = rig.tracks[trackIndex] as Track;
  const times = track.times;
  const values = track.values;
  const size = track.size;
  const t = rig.time[slot] as number;
  const last = times.length - 1;
  if (t < (times[0] as number)) {
    for (let i = 0; i < size; i++) out[offset + i] = values[i] as number;
    return;
  }
  if (t >= (times[last] as number)) {
    for (let i = 0; i < size; i++) out[offset + i] = values[last * size + i] as number;
    return;
  }
  // The interval is the one with times[i1 - 1] <= t < times[i1], from 1 to last.
  let i1 = rig.cursor[trackIndex] as number;
  while (t >= (times[i1] as number)) i1++;
  while (t < (times[i1 - 1] as number)) i1--;
  rig.cursor[trackIndex] = i1;
  const t0 = times[i1 - 1] as number;
  const t1 = times[i1] as number;
  const alpha = (t - t0) / (t1 - t0);
  const offset1 = i1 * size;
  const offset0 = offset1 - size;
  if (size === 4) {
    const pair = rig.pair;
    for (let i = 0; i < 4; i++) {
      pair[i] = values[offset0 + i] as number;
      pair[4 + i] = values[offset1 + i] as number;
    }
    rig.alpha[0] = alpha;
    slerpFlat(out, offset, pair, 0, pair, 4, rig.alpha, 0);
  } else {
    const weight0 = 1 - alpha;
    for (let i = 0; i < 3; i++) {
      out[offset + i] = (values[offset0 + i] as number) * weight0 + (values[offset1 + i] as number) * alpha;
    }
  }
}

/**
 * The pose of one clip alone at `rig.time[slot]`, into `out`: every channel the clip keys is
 * sampled, and every other channel is the rest pose, as a mixer playing the clip alone would
 * leave it.
 */
export function sampleClip(rig: ClipRig, clip: number, slot: number, out: Float64Array): void {
  for (let channel = 0; channel < CHANNELS; channel++) {
    const track = rig.trackOf[clip * CHANNELS + channel] as number;
    const offset = channel === POSITION_CHANNEL ? HIPS_POSITION : channel * 4;
    if (track >= 0) {
      sampleTrack(rig, track, slot, out, offset);
    } else {
      const size = channel === POSITION_CHANNEL ? 3 : 4;
      for (let i = 0; i < size; i++) out[offset + i] = rig.rest[offset + i] as number;
    }
  }
}

/** Writes a pose buffer to the bones: each bone once, with `fromArray(buffer, offset)`. */
export function writePose(rig: ClipRig, pose: Float64Array): void {
  const bones = rig.bones;
  for (let bone = 0; bone < BONES; bone++) (bones[bone] as Bone).quaternion.fromArray(pose, bone * 4);
  (bones[0] as Bone).position.fromArray(pose, HIPS_POSITION);
}

/**
 * Poses one champion's bones from its animation record: the base layer, the overlay over
 * it, Death over both. Reads the clip times and weights from the record, so nothing is passed.
 */
export function poseChampion(rig: ClipRig, anim: ChampionAnim): void {
  const d = anim.d;
  const time = rig.time;
  const cur = rig.cur;
  const deathWeight = d[D_DEATH_W] as number;
  if (anim.dead !== 0 && deathWeight >= 1) {
    time[SLOT_DEATH] = d[D_DEATH_T] as number;
    sampleClip(rig, CLIP_DEATH, SLOT_DEATH, cur);
    writePose(rig, cur);
    return;
  }

  // The base layer: Idle and Run, with weights summing to 1.
  const runWeight = d[D_RUN_W] as number;
  if (runWeight <= 0) {
    time[SLOT_IDLE] = d[D_IDLE_T] as number;
    sampleClip(rig, CLIP_IDLE, SLOT_IDLE, cur);
  } else if (runWeight >= 1) {
    time[SLOT_RUN] = d[D_RUN_T] as number;
    sampleClip(rig, CLIP_RUN, SLOT_RUN, cur);
  } else {
    time[SLOT_IDLE] = d[D_IDLE_T] as number;
    time[SLOT_RUN] = d[D_RUN_T] as number;
    sampleClip(rig, CLIP_IDLE, SLOT_IDLE, rig.idle);
    sampleClip(rig, CLIP_RUN, SLOT_RUN, rig.run);
    for (let channel = 0; channel < CHANNELS; channel++) blendChannel(cur, rig.idle, rig.run, channel, d, D_RUN_W);
  }

  // The overlay replaces the channels its clip keys, Spine and both arms.
  const overlay = anim.ov;
  if (overlay !== OV_NONE) {
    const clip = OV_CLIP[overlay] as number;
    time[SLOT_OVERLAY] = d[D_OV_T] as number;
    sampleClip(rig, clip, SLOT_OVERLAY, rig.over);
    for (let channel = 0; channel < CHANNELS; channel++) {
      if ((rig.trackOf[clip * CHANNELS + channel] as number) >= 0) blendChannel(cur, cur, rig.over, channel, d, D_OV_W);
    }
  }

  // Death over everything: every channel moves toward the Death clip's pose, and the legs, which it
  // does not key, toward rest.
  if (anim.dead !== 0 && deathWeight > 0) {
    time[SLOT_DEATH] = d[D_DEATH_T] as number;
    sampleClip(rig, CLIP_DEATH, SLOT_DEATH, rig.death);
    for (let channel = 0; channel < CHANNELS; channel++) blendChannel(cur, cur, rig.death, channel, d, D_DEATH_W);
  }
  writePose(rig, cur);
}
