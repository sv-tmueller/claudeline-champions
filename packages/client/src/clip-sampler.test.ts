import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Vector3, type AnimationAction, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import {
  CAST_ATTACK,
  CAST_OTHER,
  CLIP_ATTACK,
  CLIP_CAST,
  CLIP_DEATH,
  CLIP_HIT,
  CLIP_IDLE,
  CLIP_NAMES,
  CLIP_RUN,
  CLIP_SECONDS,
  D_DEATH_T,
  D_IDLE_T,
  D_OV_T,
  D_RUN_T,
  createAnim,
  triggerCast,
  triggerDash,
  triggerDeath,
  triggerHit,
  triggerInterrupt,
  triggerSnap,
  updateAnims,
  type AnimChampion,
  type ChampionAnim,
} from './champion-anim';
import { BONE_NAMES, HIPS_POSITION, STRIDE, createClipRig, poseChampion, sampleClip, writePose, type ClipRig } from './clip-sampler';

// The sampler plays the six clips of a champion model by itself, on the clip data, and
// poses the bones. three's AnimationMixer is the oracle of these tests, not the frame path.

const MODEL_IDS = ['placeholder', 'hargrim', 'quillon', 'lumeth', 'skerrow'] as const;
const modelsDir = fileURLToPath(new URL('../../../assets/models/champions/', import.meta.url));

async function loadModel(id: string): Promise<GLTF> {
  const file = readFileSync(`${modelsDir}${id}.glb`);
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return new GLTFLoader().parseAsync(data, '');
}

const models = new Map<string, GLTF>();
async function model(id: string): Promise<GLTF> {
  let gltf = models.get(id);
  if (gltf === undefined) {
    gltf = await loadModel(id);
    models.set(id, gltf);
  }
  return gltf;
}

/** A fresh view of a model, as main.ts makes one, and its rig. */
async function view(id: string): Promise<{ root: Object3D; rig: ClipRig; gltf: GLTF }> {
  const gltf = await model(id);
  const root = cloneSkinned(gltf.scene);
  return { root, rig: createClipRig(root, gltf.animations), gltf };
}

function bone(root: Object3D, name: string): Bone {
  const found = root.getObjectByName(name);
  if (!found || !(found as Bone).isBone) throw new Error(`no bone ${name}`);
  return found as Bone;
}

/** The pose of the six bones and the Hips position, as 4 x 6 quaternion components and 3 position ones. */
function readPose(root: Object3D): number[] {
  const out: number[] = [];
  for (const name of BONE_NAMES) out.push(...bone(root, name).quaternion.toArray());
  out.push(...bone(root, 'Hips').position.toArray());
  return out;
}

/** The pose three's mixer gives a clip alone at `time`, at weight 1 (`action.time` and `update(0)`). */
function oraclePose(clipName: string, id: string, times: readonly number[], gltf: GLTF): number[][] {
  const root = cloneSkinned(gltf.scene);
  const mixer = new AnimationMixer(root);
  const clip = gltf.animations.find((candidate) => candidate.name === clipName);
  if (!clip) throw new Error(`no clip ${clipName} in ${id}`);
  const action: AnimationAction = mixer.clipAction(clip);
  action.play();
  const poses: number[][] = [];
  for (const time of times) {
    action.time = time;
    mixer.update(0);
    poses.push(readPose(root));
  }
  return poses;
}

const COMPONENT_NAMES = BONE_NAMES.flatMap((name) => ['x', 'y', 'z', 'w'].map((axis) => `${name}.${axis}`)).concat([
  'Hips.px',
  'Hips.py',
  'Hips.pz',
]);

describe('the sampler against three\'s mixer', () => {
  it('names its clips as the glb does and orders them as the state machine does', () => {
    expect(CLIP_NAMES).toEqual(['Idle', 'Run', 'Attack', 'Cast', 'Hit', 'Death']);
  });

  it.each(MODEL_IDS)('has the lengths of CLIP_SECONDS in every clip of %s', async (id) => {
    const gltf = await model(id);
    CLIP_NAMES.forEach((name, i) => {
      const clip = gltf.animations.find((candidate) => candidate.name === name);
      expect(clip, `${id} ${name}`).toBeDefined();
      // The glb stores times as float32.
      expect(clip?.duration, `${id} ${name}`).toBeCloseTo(CLIP_SECONDS[i] as number, 6);
    });
  });

  it.each(MODEL_IDS)('gives the pose of three\'s mixer, bit for bit, for every clip of %s at 60 times', async (id) => {
    const { root, rig, gltf } = await view(id);
    for (let clip = 0; clip < CLIP_NAMES.length; clip++) {
      const name = CLIP_NAMES[clip] as string;
      const length = CLIP_SECONDS[clip] as number;
      // 60 times over the clip, and its last key.
      const times = Array.from({ length: 61 }, (_, i) => (i === 60 ? length : (length * i) / 60));
      const expected = oraclePose(name, id, times, gltf);
      times.forEach((time, i) => {
        rig.time[0] = time;
        sampleClip(rig, clip, 0, rig.cur);
        writePose(rig, rig.cur);
        const got = readPose(root);
        const want = expected[i] as number[];
        for (let c = 0; c < want.length; c++) {
          if (!Object.is(got[c], want[c])) {
            throw new Error(`${id} ${name} at ${time}: ${COMPONENT_NAMES[c]} is ${got[c]}, three's mixer has ${want[c]}`);
          }
        }
      });
    }
  });

  it('is not the mixer playing the wrong clip: every clip moves something, and the clips differ', async () => {
    const { root, rig } = await view('quillon');
    const poses: number[][] = [];
    for (let clip = 0; clip < CLIP_NAMES.length; clip++) {
      rig.time[0] = (CLIP_SECONDS[clip] as number) * 0.4;
      sampleClip(rig, clip, 0, rig.cur);
      writePose(rig, rig.cur);
      poses.push(readPose(root));
    }
    for (let a = 0; a < poses.length; a++) {
      for (let b = a + 1; b < poses.length; b++) expect(poses[a], `${CLIP_NAMES[a]} and ${CLIP_NAMES[b]}`).not.toEqual(poses[b]);
    }
  });
});

describe('the rig of a view', () => {
  it('saves the rest pose before any write', async () => {
    const { root, rig } = await view('hargrim');
    const rest = readPose(root);
    expect(Array.from(rig.rest.subarray(0, 24))).toEqual(rest.slice(0, 24));
    expect(Array.from(rig.rest.subarray(HIPS_POSITION, HIPS_POSITION + 3))).toEqual(rest.slice(24, 27));
    rig.time[0] = 0.5;
    sampleClip(rig, CLIP_RUN, 0, rig.cur);
    writePose(rig, rig.cur);
    expect(readPose(root)).not.toEqual(rest);
    // The saved pose is a copy, not a view of the bones.
    expect(Array.from(rig.rest.subarray(0, 24))).toEqual(rest.slice(0, 24));
  });

  it('primes the sampler at load and leaves the bones exactly where the model had them', async () => {
    const gltf = await model('lumeth');
    const root = cloneSkinned(gltf.scene);
    const before = readPose(root);
    const rig = createClipRig(root, gltf.animations);
    expect(readPose(root)).toEqual(before);
    expect(Array.from(rig.cursor).every((cursor) => cursor === 1)).toBe(true);
    expect(Array.from(rig.time)).toEqual([0, 0, 0, 0]);
    expect(Array.from(rig.from).every((value) => value === 0)).toBe(true);
    // The script sampled Death and an overlay: without the priming call these stay zero.
    expect(Array.from(rig.death).some((value) => value !== 0)).toBe(true);
    expect(Array.from(rig.over).some((value) => value !== 0)).toBe(true);
  });

  it.each(['Attack', 'Cast', 'Hit'] as const)('leaves the legs and Hips at rest for %s alone, and moves the spine and arms', async (name) => {
    const { root, rig } = await view('quillon');
    const rest = readPose(root);
    const clip = CLIP_NAMES.indexOf(name);
    let moved = false;
    for (let i = 0; i <= 12; i++) {
      rig.time[0] = ((CLIP_SECONDS[clip] as number) * i) / 12;
      sampleClip(rig, clip, 0, rig.cur);
      writePose(rig, rig.cur);
      const pose = readPose(root);
      // Hips rotation and position, Leg_L and Leg_R.
      expect(pose.slice(0, 4), `Hips at ${i}`).toEqual(rest.slice(0, 4));
      expect(pose.slice(16, 24), `legs at ${i}`).toEqual(rest.slice(16, 24));
      expect(pose.slice(24, 27), `Hips position at ${i}`).toEqual(rest.slice(24, 27));
      if (pose.slice(4, 16).some((value, c) => value !== rest[4 + c])) moved = true;
    }
    expect(moved, 'Spine or an arm moved').toBe(true);
  });

  it('turns culling off on every skinned mesh, since the bounding sphere is the bind pose', async () => {
    for (const id of MODEL_IDS) {
      const gltf = await model(id);
      const root = cloneSkinned(gltf.scene);
      const meshes: SkinnedMesh[] = [];
      root.traverse((object) => {
        if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh);
      });
      expect(meshes.length, id).toBeGreaterThanOrEqual(1);
      for (const mesh of meshes) expect(mesh.frustumCulled, `${id} ${mesh.name} before`).toBe(true);
      createClipRig(root, gltf.animations);
      for (const mesh of meshes) expect(mesh.frustumCulled, `${id} ${mesh.name}`).toBe(false);
    }
  });

  it('throws for a clip the model lacks, by name', async () => {
    const gltf = await model('placeholder');
    const root = cloneSkinned(gltf.scene);
    for (const name of CLIP_NAMES) {
      const missing = gltf.animations.filter((clip) => clip.name !== name);
      expect(() => createClipRig(root, missing), name).toThrow(new RegExp(name));
    }
  });

  it('throws for a track of a bone the rig does not know', async () => {
    const gltf = await model('placeholder');
    const root = cloneSkinned(gltf.scene);
    const clips = gltf.animations.map((clip) => clip.clone());
    const run = clips.find((clip) => clip.name === 'Run');
    if (!run) throw new Error('no Run');
    const track = run.tracks[0];
    if (!track) throw new Error('no track');
    track.name = 'Tail.quaternion';
    expect(() => createClipRig(root, clips)).toThrow(/Tail/);
  });
});

/** A world of one champion, to drive the state machine and the sampler together. */
function crew(root: Object3D, rig: ClipRig, overrides: Partial<AnimChampion> = {}) {
  const champion: AnimChampion = { x: 0, y: 0, vx: 0, vy: 0, aimX: 1000, aimY: 0, ...overrides };
  const state = { tick: 100, champions: [champion] };
  const clock = { alpha: 0 };
  const anim: ChampionAnim = createAnim();
  const anims = [anim];
  updateAnims(anims, state, clock);
  poseChampion(rig, anim);
  return {
    root,
    rig,
    champion,
    anim,
    /** Runs ticks of the sim, `frames` drawn frames per tick, `after` called after each frame. */
    run(ticks: number, frames = 1, after?: () => void): void {
      for (let i = 0; i < ticks; i++) {
        state.tick += 1;
        for (let frame = 0; frame < frames; frame++) {
          clock.alpha = frame / frames;
          updateAnims(anims, state, clock);
          poseChampion(rig, anim);
          after?.();
        }
      }
    },
  };
}

/** The rotation of bone `bone` is the same turn in both poses: a quaternion and its negative are. */
function expectSameTurn(got: number[], want: number[], bone: number, label: string): void {
  const g = got.slice(bone * 4, bone * 4 + 4);
  const w = want.slice(bone * 4, bone * 4 + 4);
  const sign = g.reduce((sum, value, i) => sum + value * (w[i] as number), 0) < 0 ? -1 : 1;
  g.forEach((value, i) => expect(value, `${label} ${BONE_NAMES[bone]} component ${i}`).toBeCloseTo(sign * (w[i] as number), 12));
}

function expectSamePosition(got: number[], want: number[], label: string): void {
  for (let i = 24; i < 27; i++) expect(got[i], `${label} Hips position ${i - 24}`).toBeCloseTo(want[i] as number, 12);
}

function sampled(rig: ClipRig, clip: number, time: number): number[] {
  rig.time[0] = time;
  sampleClip(rig, clip, 0, rig.scratch);
  return Array.from(rig.scratch.subarray(0, STRIDE));
}

describe('the blend', () => {
  it('poses Idle at time 0 as the rest pose', async () => {
    const { root, rig } = await view('hargrim');
    const rest = readPose(root);
    const c = crew(root, rig);
    // The Idle key at 0 is the rest pose, to float32.
    const pose = readPose(root);
    for (let bone = 0; bone < 6; bone++) expectSameTurn(pose, rest, bone, 'Idle at 0');
    expectSamePosition(pose, rest, 'Idle at 0');
    expect(c.anim.d[D_IDLE_T]).toBe(0);
  });

  it('plays the strike fully over Run, at weight 1: the spine and arms are Attack\'s, the legs and Hips are Run\'s', async () => {
    const { root, rig } = await view('quillon');
    const c = crew(root, rig, { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 });
    c.run(20);
    triggerCast(c.anim, CAST_ATTACK);
    c.run(6);
    const pose = readPose(root);
    const attack = sampled(rig, CLIP_ATTACK, c.anim.d[D_OV_T] as number);
    const run = sampled(rig, CLIP_RUN, c.anim.d[D_RUN_T] as number);
    for (const bone of [1, 2, 3]) expectSameTurn(pose, attack, bone, 'Attack');
    // Hips rotation, both legs and the Hips position: Run's.
    for (const bone of [0, 4, 5]) expectSameTurn(pose, run, bone, 'Run');
    expectSamePosition(pose, run, 'Run');
  });

  it('gives the same strike over Idle and over Run: the overlay replaces, it does not add', async () => {
    const standing = await view('quillon');
    const a = crew(standing.root, standing.rig);
    a.run(10);
    triggerCast(a.anim, CAST_ATTACK);
    a.run(8);
    const running = await view('quillon');
    const b = crew(running.root, running.rig, { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 });
    b.run(10);
    triggerCast(b.anim, CAST_ATTACK);
    b.run(8);
    const x = readPose(standing.root);
    const y = readPose(running.root);
    expect(a.anim.d[D_OV_T]).toBeCloseTo(b.anim.d[D_OV_T] as number, 9);
    for (const bone of [1, 2, 3]) expectSameTurn(x, y, bone, 'standing and running');
  });

  it('plays Death over everything: its five channels, and the legs at rest', async () => {
    const { root, rig } = await view('hargrim');
    const rest = readPose(root);
    const c = crew(root, rig, { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 });
    c.run(15);
    triggerCast(c.anim, CAST_OTHER);
    c.run(3);
    triggerDeath(c.anim);
    c.champion.vx = 0;
    c.run(10);
    const pose = readPose(root);
    const death = sampled(rig, CLIP_DEATH, c.anim.d[D_DEATH_T] as number);
    for (const bone of [0, 1, 2, 3]) expectSameTurn(pose, death, bone, 'Death');
    expectSamePosition(pose, death, 'Death');
    for (const bone of [4, 5]) expectSameTurn(pose, rest, bone, 'Death legs');
  });

  it('crossfades a cast that replaces a playing overlay, Arm_R turning a bounded angle a tick, for every pair', async () => {
    // Without the crossfade Attack then Cast turns 77 degrees in one tick. With it the worst offset
    // turns Attack then Cast 25.7, Cast then Attack 41.0, Attack then Attack 39.3 and Cast then
    // Cast 27.3 degrees. The bounds: 27.6 for the first pair (Attack's own fastest tick), 42 for
    // the other three.
    const { root, rig } = await view('quillon');
    for (const [first, second, bound] of [
      [CAST_ATTACK, CAST_OTHER, 27.6],
      [CAST_OTHER, CAST_ATTACK, 42],
      [CAST_ATTACK, CAST_ATTACK, 42],
      [CAST_OTHER, CAST_OTHER, 42],
    ] as const) {
      for (let offset = 1; offset <= 30; offset++) {
        const c = crew(root, rig);
        triggerCast(c.anim, first);
        c.run(offset);
        let before = bone(root, 'Arm_R').quaternion.clone();
        triggerCast(c.anim, second);
        for (let tick = 0; tick < 8; tick++) {
          c.run(1);
          const after = bone(root, 'Arm_R').quaternion.clone();
          expect(
            (before.angleTo(after) * 180) / Math.PI,
            `cast ${first} then ${second} after ${offset} ticks, tick ${tick}`,
          ).toBeLessThanOrEqual(bound);
          before = after;
        }
      }
    }
  });

  it('holds the last Death frame for good', async () => {
    const { root, rig } = await view('lumeth');
    const c = crew(root, rig);
    triggerDeath(c.anim);
    c.run(100);
    const later = readPose(root);
    c.run(400);
    expect(readPose(root)).toEqual(later);
    expect(c.anim.d[D_DEATH_T]).toBe(CLIP_SECONDS[CLIP_DEATH]);
  });

  it('blends a Hit over the legs of Run without touching them', async () => {
    const { root, rig } = await view('skerrow');
    const c = crew(root, rig, { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 });
    c.run(20);
    triggerHit(c.anim);
    c.run(3);
    const pose = readPose(root);
    const run = sampled(rig, CLIP_RUN, c.anim.d[D_RUN_T] as number);
    for (const bone of [4, 5]) expectSameTurn(pose, run, bone, 'Run legs under Hit');
    expect(CLIP_HIT).toBe(4);
    expect(CLIP_CAST).toBe(3);
    expect(CLIP_IDLE).toBe(0);
  });
});

// The lowest skinned vertex and the highest, over the unique vertices of every skinned mesh.
interface Extremes {
  low: number;
  high: number;
}

function vertexSet(root: Object3D): { mesh: SkinnedMesh; indices: number[] }[] {
  const sets: { mesh: SkinnedMesh; indices: number[] }[] = [];
  root.traverse((object) => {
    if (!(object as SkinnedMesh).isSkinnedMesh) return;
    const mesh = object as SkinnedMesh;
    const position = mesh.geometry.getAttribute('position');
    const skin = mesh.geometry.getAttribute('skinIndex');
    const seen = new Set<string>();
    const indices: number[] = [];
    for (let i = 0; i < position.count; i++) {
      const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)},${skin.getX(i)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      indices.push(i);
    }
    sets.push({ mesh, indices });
  });
  return sets;
}

const vertex = new Vector3();

function extremes(root: Object3D, sets: { mesh: SkinnedMesh; indices: number[] }[]): Extremes {
  root.updateMatrixWorld(true);
  let low = Infinity;
  let high = -Infinity;
  for (const { mesh, indices } of sets) {
    mesh.skeleton.update();
    for (const index of indices) {
      mesh.getVertexPosition(index, vertex);
      vertex.applyMatrix4(mesh.matrixWorld);
      if (vertex.y < low) low = vertex.y;
      if (vertex.y > high) high = vertex.y;
    }
  }
  return { low, high };
}

/**
 * The top every pose must stay under. The clips keep 1.90 m alone (assets.md), but an overlay
 * over Run adds the bounce of Run's Hips, up to 35 mm, to Quillon's staff at the strike:
 * 1.9078 m is the highest, 6 cm under the health bar at 1.97 m.
 */
const TOP = 1.91;
/** The lowest vertex may be this far under the floor, as the clips' own contract allows (0.1 mm). */
const FLOOR = -1e-4;

type Crew = ReturnType<typeof crew>;

/** What a floor and top walk of one model keeps: the lowest and highest vertex it saw. */
interface Walk {
  look(label: string): void;
  figures(): Extremes;
}

function walk(id: string, root: Object3D): Walk {
  const sets = vertexSet(root);
  let low = Infinity;
  let high = -Infinity;
  return {
    look(label) {
      const now = extremes(root, sets);
      low = Math.min(low, now.low);
      high = Math.max(high, now.high);
      expect(now.low, `${id} lowest vertex ${label}`).toBeGreaterThanOrEqual(FLOOR);
      expect(now.high, `${id} highest vertex ${label}`).toBeLessThanOrEqual(TOP);
    },
    figures: () => ({ low, high }),
  };
}


/** Runs `ticks` ticks of a crew, `frames` drawn frames each, looking after every frame. */
function runLooking(c: Crew, w: Walk, ticks: number, label: string, frames = 1): void {
  let n = 0;
  c.run(ticks, frames, () => w.look(`${label}, frame ${n++}`));
}

/** The aim point 10 m ahead of a champion at the origin that faces `facing`, in centimetres. */
function aimToward(facing: number): { aimX: number; aimY: number } {
  return { aimX: Math.round(Math.cos(facing) * 1000), aimY: Math.round(Math.sin(facing) * 1000) };
}

const WALKS: { speed: number; facing: number; name: string }[] = [
  { speed: 5.5, facing: 0, name: '5.5 m/s forward' },
  { speed: 5.5, facing: Math.PI, name: '5.5 m/s backward' },
  { speed: 1, facing: 0, name: '1 m/s forward' },
  { speed: 8.25, facing: 0, name: '8.25 m/s forward' },
];

describe('the floor and the top through every transition', () => {
  it.each(MODEL_IDS)('keeps %s above the floor and under 1.91 m, entering and leaving Run at every phase', async (id) => {
    const { root, rig } = await view(id);
    const w = walk(id, root);
    for (const { speed, facing, name } of WALKS) {
      for (let stopAfter = 0; stopAfter <= 40; stopAfter += 1) {
        for (const [frames, idleAt] of [[1, 8], [2, 7]] as const) {
          const c = crew(root, rig, { vx: speed, vy: 0, ...aimToward(facing) });
          // The Idle clock is at its rest height (time 0) `idleAt` ticks after the walk stops: the
          // worst case for the fade, since Idle's own Hips rise would lift the feet a little.
          c.anim.d[D_IDLE_T] = (((120 - stopAfter - idleAt) % 120) + 120) % 120 / 60;
          runLooking(c, w, stopAfter, `running ${name}`, frames);
          c.champion.vx = 0;
          runLooking(c, w, 70, `stopped after ${stopAfter} ticks of ${name}`, frames);
        }
      }
    }
    // A walk that starts and stops over and over, as a pointer at the edge of the dead zone does.
    const c = crew(root, rig, { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 });
    for (let round = 0; round < 12; round++) {
      c.champion.vx = 5.5;
      runLooking(c, w, 3 + round, 'on');
      c.champion.vx = 0;
      runLooking(c, w, 2 + round, 'off');
    }
    expect(w.figures().low).toBeGreaterThanOrEqual(FLOOR);
  });

  it.each(MODEL_IDS)('keeps %s above the floor and under 1.91 m with Attack, Cast and Hit over Idle and over Run', async (id) => {
    const { root, rig } = await view(id);
    const w = walk(id, root);
    for (const kind of ['attack', 'cast', 'hit'] as const) {
      for (const { speed, facing, name } of WALKS.slice(0, 2)) {
        for (const moving of [false, true]) {
          for (let offset = 0; offset <= 30; offset += 3) {
            const c = crew(root, rig, moving ? { vx: speed, vy: 0, ...aimToward(facing) } : { vx: 0, vy: 0, ...aimToward(facing) });
            runLooking(c, w, offset, `${kind} over ${moving ? name : 'Idle'}, lead-in`);
            if (kind === 'attack') triggerCast(c.anim, CAST_ATTACK);
            else if (kind === 'cast') triggerCast(c.anim, CAST_OTHER);
            else triggerHit(c.anim);
            runLooking(c, w, 40, `${kind} over ${moving ? name : 'Idle'} after ${offset}`);
          }
        }
      }
    }
    // A cast that replaces an overlay at every tick of it: the 3-tick crossfade between the two.
    for (const [first, second] of [[CAST_ATTACK, CAST_OTHER], [CAST_OTHER, CAST_ATTACK], [CAST_ATTACK, CAST_ATTACK]] as const) {
      for (const moving of [false, true]) {
        for (let offset = 0; offset <= 30; offset += 1) {
          const c = crew(root, rig, moving ? { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 } : {});
          runLooking(c, w, 9, 'before the casts');
          triggerCast(c.anim, first);
          runLooking(c, w, offset, `first cast ${first}`);
          triggerCast(c.anim, second);
          runLooking(c, w, 12, `second cast ${second} after ${offset}`);
        }
      }
    }
    // An M1 held down: Attack restarts as it ends, and a cast replaces it half way.
    const c = crew(root, rig, { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 });
    for (let round = 0; round < 6; round++) {
      triggerCast(c.anim, CAST_ATTACK);
      runLooking(c, w, 24, 'M1 held');
    }
    triggerCast(c.anim, CAST_ATTACK);
    runLooking(c, w, 9, 'M1 then');
    triggerCast(c.anim, CAST_OTHER);
    runLooking(c, w, 40, 'Cast replaces Attack');
  });

  it.each(MODEL_IDS)('keeps %s above the floor and under 1.91 m when a cast is interrupted at any tick', async (id) => {
    const { root, rig } = await view(id);
    const w = walk(id, root);
    for (const kind of [CAST_ATTACK, CAST_OTHER]) {
      for (let at = 0; at <= 30; at += 2) {
        const c = crew(root, rig, { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 });
        runLooking(c, w, 9, 'before the cast');
        triggerCast(c.anim, kind);
        runLooking(c, w, at, 'cast');
        triggerInterrupt(c.anim);
        runLooking(c, w, 20, `interrupted after ${at}`);
      }
    }
  });

  it.each(MODEL_IDS)('keeps %s above the floor and under 1.91 m through Death from every state, and the snap back', async (id) => {
    const { root, rig } = await view(id);
    const w = walk(id, root);
    for (const moving of [false, true]) {
      for (const overlay of [0, CAST_ATTACK, CAST_OTHER, -1]) {
        for (let at = 0; at <= 40; at += 2) {
          const c = crew(root, rig, moving ? { vx: 5.5, vy: 0, aimX: 1000, aimY: 0 } : { vx: 0, vy: 0, aimX: 1000, aimY: 0 });
          runLooking(c, w, at, 'before the death');
          if (overlay > 0) triggerCast(c.anim, overlay);
          if (overlay < 0) triggerHit(c.anim);
          runLooking(c, w, 3, 'overlay');
          triggerDeath(c.anim);
          c.champion.vx = 0;
          runLooking(c, w, 70, `death after ${at}`);
          // The next round: Idle at time 0.
          triggerSnap(c.anim);
          runLooking(c, w, 4, 'snap');
        }
      }
    }
  });

  it.each(MODEL_IDS)('keeps %s above the floor and under 1.91 m through a dash', async (id) => {
    const { root, rig } = await view(id);
    const w = walk(id, root);
    for (let lead = 0; lead <= 12; lead += 4) {
      const c = crew(root, rig);
      runLooking(c, w, lead, 'lead-in');
      triggerDash(c.anim, 1);
      runLooking(c, w, 8, 'dashing');
      triggerDash(c.anim, 0);
      runLooking(c, w, 60, 'after the dash');
    }
  });
});
