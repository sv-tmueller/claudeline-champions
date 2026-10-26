import { describe, expect, it } from 'vitest';
import {
  ANIM_TEXTS,
  CAST_ATTACK,
  CAST_OTHER,
  CLIP_SECONDS,
  D_DEATH_T,
  D_DEATH_W,
  D_IDLE_T,
  D_NOW,
  D_OV_T,
  D_OV_W,
  D_RUN_SCALE,
  D_RUN_T,
  D_XF_W,
  D_RUN_W,
  RUN_MAX_SCALE,
  scriptAnims,
  createAnim,
  triggerCast,
  triggerDash,
  triggerDeath,
  triggerHit,
  triggerInterrupt,
  triggerSnap,
  updateAnims,
  updateAnimsAt,
  type AnimChampion,
  type AnimState,
  type ChampionAnim,
  type DrawnTime,
} from './champion-anim';
import { createRenderClock, type RenderClock } from './net/render-clock';
import { createSnapshotBuffer, type BufferView } from './net/snapshot-buffer';
import { buildStream, type StreamEntry } from './net/test-stream';

// The state machine of a champion's clips, in ticks at 60 Hz. The tests drive it as the
// client does: the sim tick and the loop clock's alpha are read inside updateAnims, and
// a pending trigger is consumed by the next update.

const KEY_PASS_1 = 5 / 30;
const KEY_PASS_2 = 15 / 30;

interface World {
  state: AnimState & { tick: number; champions: AnimChampion[] };
  clock: { alpha: number };
  anim: ChampionAnim;
  champion: AnimChampion;
  /** Runs `count` ticks: the tick moves on by one and the anim updates once per tick. */
  run(count: number): void;
  /** Updates with no time passing, as a second frame of the same tick would. */
  again(): void;
  /** The hook text of the champion. */
  text(): string;
}

function walking(speed: number): Partial<AnimChampion> {
  return { vx: speed, vy: 0, aimX: 1000, aimY: 0 };
}

function world(overrides: Partial<AnimChampion> = {}): World {
  const champion: AnimChampion = { x: 0, y: 0, vx: 0, vy: 0, aimX: 1000, aimY: 0, ...overrides };
  const anim = createAnim();
  const state = { tick: 100, champions: [champion] };
  const clock = { alpha: 0 };
  const anims = [anim];
  updateAnims(anims, state, clock);
  return {
    state,
    clock,
    anim,
    champion,
    run(count) {
      for (let i = 0; i < count; i++) {
        state.tick += 1;
        updateAnims(anims, state, clock);
      }
    },
    again() {
      updateAnims(anims, state, clock);
    },
    text: () => ANIM_TEXTS[anim.code] as string,
  };
}

describe('the hook texts', () => {
  it('are the nine strings of the state table, in code order', () => {
    expect(ANIM_TEXTS).toEqual([
      'Idle',
      'Run',
      'Idle+Attack',
      'Run+Attack',
      'Idle+Cast',
      'Run+Cast',
      'Idle+Hit',
      'Run+Hit',
      'Death',
    ]);
  });

  it('starts every champion in Idle at time 0', () => {
    const w = world();
    expect(w.text()).toBe('Idle');
    expect(w.anim.d[D_IDLE_T]).toBe(0);
    expect(w.anim.d[D_RUN_W]).toBe(0);
    expect(w.anim.d[D_OV_W]).toBe(0);
    expect(w.anim.d[D_DEATH_W]).toBe(0);
  });
});

describe('Idle and Run', () => {
  it('is Idle under 0.5 m/s and Run at 0.5 m/s or more', () => {
    const slow = world(walking(0.49));
    slow.run(2);
    expect(slow.text()).toBe('Idle');
    const exact = world(walking(0.5));
    exact.run(2);
    expect(exact.text()).toBe('Run');
  });

  it('is Run for a dash, whose walk velocity is zero, at the cap of the scale', () => {
    const w = world();
    triggerDash(w.anim, 1);
    w.run(2);
    expect(w.text()).toBe('Run');
    expect(w.anim.d[D_RUN_SCALE]).toBe(RUN_MAX_SCALE);
    triggerDash(w.anim, 0);
    w.run(1);
    expect(w.anim.want).toBe(0);
  });

  it('plays a dash backward when it moves against the facing', () => {
    const w = world({ aimX: 1000, aimY: 0 });
    triggerDash(w.anim, 1);
    w.run(1);
    for (let tick = 0; tick < 3; tick++) {
      w.champion.x -= 0.5;
      w.clock.alpha = 0;
      w.run(1);
      // A frame between two ticks sees no step, so no displacement: the direction of the last
      // one stays.
      w.clock.alpha = 0.5;
      w.again();
      expect(w.anim.d[D_RUN_SCALE]).toBe(-RUN_MAX_SCALE);
    }
    expect(w.anim.d[D_RUN_SCALE]).toBe(-RUN_MAX_SCALE);
    w.clock.alpha = 0;
    w.champion.x += 0.5;
    w.run(1);
    expect(w.anim.d[D_RUN_SCALE]).toBe(RUN_MAX_SCALE);
  });

  it('forgets a dash at the start of a round', () => {
    const w = world();
    triggerDash(w.anim, 1);
    w.run(2);
    triggerSnap(w.anim);
    w.run(1);
    expect(w.anim.dashing).toBe(0);
    expect(w.text()).toBe('Idle');
  });

  it('enters Run at its passing key, not at frame 0, and with weight 0', () => {
    const w = world();
    w.run(30);
    w.champion.vx = 5.5;
    w.again();
    expect(w.anim.d[D_RUN_T]).toBe(KEY_PASS_1);
    expect(w.anim.d[D_RUN_W]).toBe(0);
  });

  it('loops Idle on its own time, 2 seconds long', () => {
    const w = world();
    w.run(119);
    expect(w.anim.d[D_IDLE_T]).toBeCloseTo(119 / 60, 9);
    w.run(2);
    expect(w.anim.d[D_IDLE_T]).toBeCloseTo(1 / 60, 9);
  });

  it('fades Run in over 9 ticks, as Idle goes out', () => {
    const w = world();
    w.champion.vx = 5.5;
    w.run(4);
    expect(w.anim.d[D_RUN_W]).toBeCloseTo(4 / 9, 9);
    w.run(5);
    expect(w.anim.d[D_RUN_W]).toBe(1);
    w.run(20);
    expect(w.anim.d[D_RUN_W]).toBe(1);
  });

  it('advances Run by 2/60 of a clip second per tick at 5.5 m/s', () => {
    const w = world(walking(5.5));
    w.run(1);
    const before = w.anim.d[D_RUN_T] as number;
    w.run(1);
    expect((w.anim.d[D_RUN_T] as number) - before).toBeCloseTo(2 / 60, 9);
    expect(w.anim.d[D_RUN_SCALE]).toBeCloseTo(2, 9);
  });

  it('scales the clip with the speed, 2 / 5.5 clip seconds per metre', () => {
    const w = world(walking(2.75));
    w.run(1);
    expect(w.anim.d[D_RUN_SCALE]).toBeCloseTo(1, 9);
  });

  it('caps the scale', () => {
    const w = world(walking(30));
    w.run(1);
    expect(w.anim.d[D_RUN_SCALE]).toBe(RUN_MAX_SCALE);
  });

  it('plays backward, with a negative scale, when the velocity opposes the facing', () => {
    const w = world({ vx: -5.5, vy: 0, aimX: 1000, aimY: 0 });
    w.run(1);
    expect(w.anim.d[D_RUN_SCALE]).toBeCloseTo(-2, 9);
    const before = w.anim.d[D_RUN_T] as number;
    w.run(1);
    const after = w.anim.d[D_RUN_T] as number;
    expect(after).toBeLessThan(before);
    expect(before - after).toBeCloseTo(2 / 60, 9);
  });

  it('keeps Run time inside the clip, 20 frames long', () => {
    const w = world(walking(5.5));
    w.run(400);
    expect(w.anim.d[D_RUN_T]).toBeGreaterThanOrEqual(0);
    expect(w.anim.d[D_RUN_T]).toBeLessThan(CLIP_SECONDS[1] as number);
    const back = world({ vx: -5.5, vy: 0, aimX: 1000, aimY: 0 });
    back.run(400);
    expect(back.anim.d[D_RUN_T]).toBeGreaterThanOrEqual(0);
    expect(back.anim.d[D_RUN_T]).toBeLessThan(CLIP_SECONDS[1] as number);
  });

  it('plays on, not fading, until the key, at the scale it had, when the walk stops between keys', () => {
    const w = world(walking(5.5));
    // Entry at 5/30, 5 ticks of 2/60 s: 1/3 s, between the keys at 1/6 s and 1/2 s.
    w.run(5);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(1 / 3, 9);
    w.champion.vx = 0;
    w.run(4);
    expect(w.text()).toBe('Idle');
    expect(w.anim.d[D_RUN_W]).toBe(1);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(1 / 3 + 8 / 60, 9);
    w.run(1);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(KEY_PASS_2, 9);
    expect(w.anim.d[D_RUN_W]).toBe(1);
  });

  it('then fades over 9 ticks and is gone, with Run held on the key all the while', () => {
    const w = world(walking(5.5));
    w.run(5);
    w.champion.vx = 0;
    w.run(5);
    for (let tick = 1; tick <= 9; tick++) {
      w.run(1);
      expect(w.anim.d[D_RUN_T]).toBeCloseTo(KEY_PASS_2, 9);
      expect(w.anim.d[D_RUN_W]).toBeCloseTo(Math.max(0, 1 - tick / 9), 9);
    }
    w.run(1);
    expect(w.anim.d[D_RUN_W]).toBe(0);
  });

  it('plays on from just before key 15, at the scale it had, and holds on it', () => {
    const w = world(walking(5.5));
    // Enter at 5/30, play to 0.4 s: (0.4 - 5/30) / (2/60) = 7 ticks.
    w.run(7);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(0.4, 9);
    w.champion.vx = 0;
    // 0.1 s left to key 15 at 2/60 s a tick: 3 ticks, and it lands on the key exactly.
    w.run(3);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(KEY_PASS_2, 9);
    expect(w.anim.d[D_RUN_W]).toBe(1);
    w.run(1);
    expect(w.anim.d[D_RUN_T]).toBe(KEY_PASS_2);
    expect(w.anim.d[D_RUN_W]).toBeCloseTo(1 - 1 / 9, 9);
  });

  it('holds at the key it stopped on and wraps the next one around the loop end', () => {
    const w = world(walking(5.5));
    // Entry 5/30 and 20 ticks of 2/60 s: 5/30 + 2/3 wraps to 5/30 after one loop.
    w.run(20);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(KEY_PASS_1, 9);
    w.champion.vx = 0;
    // Exactly on a key when it stops: holds at once.
    w.run(1);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(KEY_PASS_1, 9);
    expect(w.anim.d[D_RUN_W]).toBeLessThan(1);
  });

  it('plays a backward Run on to the key behind it', () => {
    const w = world({ vx: -5.5, vy: 0, aimX: 1000, aimY: 0 });
    // Entry 5/30, backward: after 7 ticks 5/30 - 14/60 = -1/15, which is 0.6 s in the loop.
    w.run(7);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(0.6, 9);
    w.champion.vx = 0;
    // The key behind it is key 15 at 0.5 s: 0.1 s at 2/60 s a tick is 3 ticks.
    w.run(3);
    expect(w.anim.d[D_RUN_T]).toBeCloseTo(KEY_PASS_2, 9);
    w.run(1);
    expect(w.anim.d[D_RUN_T]).toBe(KEY_PASS_2);
    expect(w.anim.d[D_RUN_W]).toBeLessThan(1);
  });

  it('plays on again, from the held key, when the walk resumes mid-fade', () => {
    const w = world(walking(5.5));
    w.run(20);
    w.champion.vx = 0;
    w.run(4);
    const faded = w.anim.d[D_RUN_W] as number;
    expect(faded).toBeLessThan(1);
    w.champion.vx = 5.5;
    w.run(1);
    expect(w.anim.d[D_RUN_W]).toBeGreaterThan(faded);
    expect(w.text()).toBe('Run');
  });

  it('is Idle again once the fade is over', () => {
    const w = world(walking(5.5));
    w.run(20);
    w.champion.vx = 0;
    w.run(2 + 9 + 1);
    expect(w.anim.d[D_RUN_W]).toBe(0);
    w.run(1);
    expect(w.text()).toBe('Idle');
  });
});

describe('Attack and Cast', () => {
  it('plays Attack from time 0 on a pending M1 cast, and fades it in over 3 ticks', () => {
    const w = world();
    w.run(10);
    triggerCast(w.anim, CAST_ATTACK);
    w.again();
    expect(w.text()).toBe('Idle+Attack');
    expect(w.anim.d[D_OV_T]).toBe(0);
    expect(w.anim.d[D_OV_W]).toBe(0);
    w.run(1);
    expect(w.anim.d[D_OV_W]).toBeCloseTo(1 / 3, 9);
    w.run(2);
    expect(w.anim.d[D_OV_W]).toBe(1);
  });

  it('is Run plus Attack while walking', () => {
    const w = world(walking(5.5));
    w.run(3);
    triggerCast(w.anim, CAST_ATTACK);
    w.run(1);
    expect(w.text()).toBe('Run+Attack');
  });

  it('fades Attack out over its last 6 ticks of 24 and ends after 24', () => {
    const w = world();
    triggerCast(w.anim, CAST_ATTACK);
    w.run(1);
    w.run(17);
    expect(w.anim.d[D_OV_W]).toBe(1);
    w.run(3);
    expect(w.anim.d[D_OV_W]).toBeCloseTo(0.5, 6);
    w.run(2);
    expect(w.text()).toBe('Idle+Attack');
    w.run(1);
    expect(w.text()).toBe('Idle');
    expect(w.anim.d[D_OV_W]).toBe(0);
  });

  it('restarts Attack from 0 when the next M1 starts', () => {
    const w = world();
    triggerCast(w.anim, CAST_ATTACK);
    w.run(10);
    expect(w.anim.d[D_OV_T]).toBeGreaterThan(0.1);
    triggerCast(w.anim, CAST_ATTACK);
    w.again();
    expect(w.anim.d[D_OV_T]).toBe(0);
    expect(w.text()).toBe('Idle+Attack');
    expect(w.anim.d[D_OV_W]).toBe(1);
  });

  it('restarts Attack in its last 6 ticks from the weight it showed, in 3 ticks and not in one', () => {
    const w = world();
    triggerCast(w.anim, CAST_ATTACK);
    w.run(23);
    const shown = w.anim.d[D_OV_W] as number;
    expect(shown).toBeCloseTo(1 / 6, 6);
    triggerCast(w.anim, CAST_ATTACK);
    w.run(1);
    expect((w.anim.d[D_OV_W] as number) - shown).toBeLessThanOrEqual(1 / 3 + 1e-9);
    expect(w.anim.d[D_OV_W]).toBeGreaterThan(shown);
    w.run(2);
    expect(w.anim.d[D_OV_W]).toBeCloseTo(1, 6);
  });

  it('marks a crossfade only for a cast that replaces a playing overlay, 3 ticks long', () => {
    const w = world();
    triggerCast(w.anim, CAST_ATTACK);
    w.run(1);
    expect(w.anim.xfade).toBe(0);
    triggerCast(w.anim, CAST_OTHER);
    w.run(1);
    expect(w.anim.xfade).toBe(1);
    expect(w.anim.d[D_XF_W]).toBeCloseTo(1 / 3, 9);
    w.run(2);
    expect(w.anim.d[D_XF_W]).toBe(1);
  });

  it('plays Cast for any other slot, 15 frames, in 3 ticks and out 6', () => {
    const w = world();
    triggerCast(w.anim, CAST_OTHER);
    w.run(1);
    expect(w.text()).toBe('Idle+Cast');
    w.run(2);
    expect(w.anim.d[D_OV_W]).toBe(1);
    // 30 ticks long: the fade out is over the last 6.
    w.run(21);
    expect(w.anim.d[D_OV_W]).toBeCloseTo(1, 6);
    w.run(3);
    expect(w.anim.d[D_OV_W]).toBeCloseTo(0.5, 6);
    w.run(4);
    expect(w.text()).toBe('Idle');
  });

  it('lets a cast replace the Attack that plays', () => {
    const w = world();
    triggerCast(w.anim, CAST_ATTACK);
    w.run(10);
    triggerCast(w.anim, CAST_OTHER);
    w.again();
    expect(w.text()).toBe('Idle+Cast');
    expect(w.anim.d[D_OV_T]).toBe(0);
  });

  it('fades the overlay out over 6 ticks when the cast is interrupted, from the weight it had', () => {
    const w = world();
    triggerCast(w.anim, CAST_OTHER);
    w.run(8);
    expect(w.anim.d[D_OV_W]).toBe(1);
    triggerInterrupt(w.anim);
    w.run(3);
    expect(w.anim.d[D_OV_W]).toBeCloseTo(0.5, 6);
    expect(w.text()).toBe('Idle+Cast');
    w.run(3);
    expect(w.text()).toBe('Idle');
    expect(w.anim.d[D_OV_W]).toBe(0);
  });

  it('does not let an interrupt cut a Hit', () => {
    const w = world();
    triggerHit(w.anim);
    w.run(4);
    triggerInterrupt(w.anim);
    w.run(1);
    expect(w.text()).toBe('Idle+Hit');
    expect(w.anim.d[D_OV_W]).toBe(1);
  });
});

describe('Hit', () => {
  it('plays when nothing else plays, in 2 ticks and out over the last 6 of 18', () => {
    const w = world();
    triggerHit(w.anim);
    w.run(1);
    expect(w.text()).toBe('Idle+Hit');
    expect(w.anim.d[D_OV_W]).toBeCloseTo(0.5, 9);
    w.run(1);
    expect(w.anim.d[D_OV_W]).toBe(1);
    w.run(10);
    expect(w.anim.d[D_OV_W]).toBe(1);
    w.run(3);
    expect(w.anim.d[D_OV_W]).toBeCloseTo(0.5, 6);
    w.run(3);
    expect(w.text()).toBe('Idle');
  });

  it.each([
    ['Attack', CAST_ATTACK],
    ['Cast', CAST_OTHER],
  ])('does not interrupt %s', (_name, kind) => {
    const w = world();
    triggerCast(w.anim, kind);
    w.run(2);
    triggerHit(w.anim);
    w.run(1);
    expect(w.text()).toBe(kind === CAST_ATTACK ? 'Idle+Attack' : 'Idle+Cast');
  });

  it('does not restart a Hit that runs', () => {
    const w = world();
    triggerHit(w.anim);
    w.run(8);
    const time = w.anim.d[D_OV_T] as number;
    triggerHit(w.anim);
    w.run(1);
    expect(w.anim.d[D_OV_T]).toBeCloseTo(time + 1 / 60, 9);
  });

  it('loses to a cast of the same frame', () => {
    const w = world();
    triggerHit(w.anim);
    triggerCast(w.anim, CAST_ATTACK);
    w.run(1);
    expect(w.text()).toBe('Idle+Attack');
  });
});

describe('Death', () => {
  it('blends in over 6 ticks over everything, even an Attack', () => {
    const w = world(walking(5.5));
    triggerCast(w.anim, CAST_ATTACK);
    w.run(4);
    triggerDeath(w.anim);
    w.champion.vx = 0;
    w.run(1);
    expect(w.text()).toBe('Death');
    expect(w.anim.d[D_DEATH_W]).toBeCloseTo(1 / 6, 9);
    w.run(5);
    expect(w.anim.d[D_DEATH_W]).toBe(1);
  });

  it('holds its last frame and never loops', () => {
    const w = world();
    triggerDeath(w.anim);
    w.run(300);
    expect(w.anim.d[D_DEATH_T]).toBe(CLIP_SECONDS[5]);
    expect(w.anim.d[D_DEATH_W]).toBe(1);
    expect(w.text()).toBe('Death');
    w.run(300);
    expect(w.anim.d[D_DEATH_T]).toBe(CLIP_SECONDS[5]);
    expect(w.text()).toBe('Death');
  });

  it('plays from time 0, 30 frames in 1 second', () => {
    const w = world();
    triggerDeath(w.anim);
    w.run(30);
    expect(w.anim.d[D_DEATH_T]).toBeCloseTo(0.5, 9);
  });

  it('takes no Hit, no cast and no interrupt once dead', () => {
    const w = world();
    triggerDeath(w.anim);
    w.run(2);
    triggerHit(w.anim);
    triggerCast(w.anim, CAST_ATTACK);
    triggerInterrupt(w.anim);
    w.run(2);
    expect(w.text()).toBe('Death');
    expect(w.anim.d[D_OV_W]).toBe(0);
  });

  it('snaps to Idle at time 0 when the round starts', () => {
    const w = world(walking(5.5));
    w.run(30);
    triggerCast(w.anim, CAST_ATTACK);
    w.run(3);
    triggerDeath(w.anim);
    w.champion.vx = 0;
    w.run(400);
    expect(w.text()).toBe('Death');
    triggerSnap(w.anim);
    w.again();
    expect(w.text()).toBe('Idle');
    expect(w.anim.d[D_IDLE_T]).toBe(0);
    expect(w.anim.d[D_RUN_W]).toBe(0);
    expect(w.anim.d[D_OV_W]).toBe(0);
    expect(w.anim.d[D_DEATH_W]).toBe(0);
    expect(w.anim.d[D_DEATH_T]).toBe(0);
  });

  it('snaps a living, running champion too', () => {
    const w = world(walking(5.5));
    w.run(30);
    w.champion.vx = 0;
    triggerSnap(w.anim);
    w.again();
    expect(w.text()).toBe('Idle');
    expect(w.anim.d[D_RUN_W]).toBe(0);
  });
});

describe('the clock', () => {
  it('reads the tick and the alpha of the loop clock inside, one clip second per 60 ticks', () => {
    const w = world();
    w.clock.alpha = 0.5;
    w.again();
    expect(w.anim.d[D_IDLE_T]).toBeCloseTo(0.5 / 60, 9);
    w.state.tick += 1;
    w.clock.alpha = 0;
    w.again();
    expect(w.anim.d[D_IDLE_T]).toBeCloseTo(1 / 60, 9);
    w.clock.alpha = 0.25;
    w.again();
    expect(w.anim.d[D_IDLE_T]).toBeCloseTo(1.25 / 60, 9);
  });

  it('ignores a clock that goes back and caps a long gap, such as a tab that was in the background', () => {
    const w = world();
    w.run(1);
    const time = w.anim.d[D_IDLE_T] as number;
    w.state.tick -= 50;
    w.again();
    expect(w.anim.d[D_IDLE_T]).toBe(time);
    w.state.tick += 5000;
    w.again();
    expect(w.anim.d[D_IDLE_T]).toBeLessThanOrEqual(2);
    expect(w.anim.d[D_IDLE_T]).toBeGreaterThanOrEqual(0);
  });
});

describe('the priming script', () => {
  it('visits every state of the machine, so V8 has seen every branch before the first frame', () => {
    const codes = new Set<number>();
    const modes = new Set<number>();
    const held = new Set<number>();
    const signs = new Set<number>();
    const dashing = new Set<number>();
    const xfades = new Set<number>();
    let frames = 0;
    scriptAnims((anim) => {
      frames++;
      codes.add(anim.code);
      modes.add(anim.mode);
      held.add(anim.held);
      signs.add(Math.sign(anim.d[D_RUN_SCALE] as number));
      dashing.add(anim.dashing);
      xfades.add(anim.xfade);
    });
    expect([...codes].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...modes].sort()).toEqual([0, 1, 2]);
    expect([...held].sort()).toEqual([0, 1]);
    expect([...signs].sort()).toEqual([-1, 0, 1]);
    expect([...dashing].sort()).toEqual([0, 1]);
    expect([...xfades].sort()).toEqual([0, 1]);
    expect(frames).toBeGreaterThan(300);
  });
});

describe('the clip lengths', () => {
  it('are the seconds of the six clips, in the order Idle, Run, Attack, Cast, Hit, Death', () => {
    expect(Array.from(CLIP_SECONDS)).toEqual([2, 20 / 30, 12 / 30, 15 / 30, 9 / 30, 1]);
  });
});

// The time base of an online match: the drawn time comes from the render clock, not from a state's
// tick and an alpha, because the two states a draw interpolates are a snapshot gap apart.

describe('updateAnimsAt', () => {
  // One champion through a script of walks, stops, casts, a hit, a dash, a death and a new round,
  // each row [ticks, vx, event]. `drive` calls `step(tick, alpha)` once per frame.
  const ROWS: readonly (readonly [number, number, string])[] = [
    [20, 0, ''],
    [25, 5.5, ''],
    [30, 0, ''],
    [6, 5.5, 'attack'],
    [10, 5.5, 'cast'],
    [12, 0, 'hit'],
    [15, 0, 'interrupt'],
    [12, 5.5, 'dashOn'],
    [12, 0, 'dashOff'],
    [10, 0, 'death'],
    [40, 0, ''],
    [6, 0, 'snap'],
  ];

  function trigger(anim: ChampionAnim, event: string): void {
    if (event === 'attack') triggerCast(anim, CAST_ATTACK);
    else if (event === 'cast') triggerCast(anim, CAST_OTHER);
    else if (event === 'hit') triggerHit(anim);
    else if (event === 'interrupt') triggerInterrupt(anim);
    else if (event === 'dashOn') triggerDash(anim, 1);
    else if (event === 'dashOff') triggerDash(anim, 0);
    else if (event === 'death') triggerDeath(anim);
    else if (event === 'snap') triggerSnap(anim);
  }

  /** Every field but the doubles. */
  function integersOf(anim: ChampionAnim): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(anim)) if (key !== 'd') out[key] = value as number;
    return out;
  }

  function play(frame: (anim: ChampionAnim, champion: AnimChampion, tick: number, alpha: number) => void): ChampionAnim[] {
    const anim = createAnim();
    const champion: AnimChampion = { x: 0, y: 0, vx: 0, vy: 0, aimX: 1000, aimY: 0 };
    const frames: ChampionAnim[] = [];
    let tick = 100;
    for (const [ticks, vx, event] of ROWS) {
      champion.vx = vx;
      for (let i = 0; i < ticks; i++) {
        if (i === 0) trigger(anim, event);
        tick += 1;
        champion.x += vx / 60;
        frame(anim, champion, tick, (i % 4) / 4);
        frames.push({ ...anim, d: Float64Array.from(anim.d) });
      }
    }
    return frames;
  }

  it('gives the same record as updateAnims at every frame of the state machine script, with drawn = tick + alpha', () => {
    const old = play((anim, champion, tick, alpha) => {
      updateAnims([anim], { tick, champions: [champion] }, { alpha });
    });
    const drawn: { ticks: number } = { ticks: 0 };
    const next = play((anim, champion, tick, alpha) => {
      drawn.ticks = tick + alpha;
      updateAnimsAt([anim], [champion], drawn);
    });
    expect(next).toHaveLength(old.length);
    expect(old.length).toBeGreaterThan(150);
    expect(new Set(old.map((frame) => frame.code)).size).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < old.length; i++) {
      const a = old[i] as ChampionAnim;
      const b = next[i] as ChampionAnim;
      for (let k = 0; k < a.d.length; k++) expect(Object.is(b.d[k], a.d[k])).toBe(true);
      const integersA = integersOf(a);
      const integersB = integersOf(b);
      expect(integersB).toEqual(integersA);
    }
  });

  it('skips a champion with no anim, as updateAnims does', () => {
    const drawn: DrawnTime = { ticks: 12.5 };
    const champion: AnimChampion = { x: 0, y: 0, vx: 0, vy: 0, aimX: 0, aimY: 0 };
    expect(() => updateAnimsAt([], [champion], drawn)).not.toThrow();
    const anim = createAnim();
    expect(() => updateAnimsAt([anim], [], drawn)).not.toThrow();
    expect(anim.d[D_NOW]).toBe(0);
  });

  // The render clock over the scripted stream: the drawn time is the render tick, so it moves about
  // a frame a frame. Drawn from the tick of snapshot B and the buffer's alpha it would jump a
  // snapshot gap at once.
  function frames(source: (clock: RenderClock, view: BufferView) => number): number[] {
    const clock = createRenderClock(6);
    const buffer = createSnapshotBuffer();
    const stream = buildStream();
    const anim = createAnim();
    const champion: AnimChampion = { x: 0, y: 0, vx: 0, vy: 0, aimX: 0, aimY: 0 };
    const drawn: { ticks: number } = { ticks: 0 };
    const times: number[] = [];
    let next = 0;
    for (let now = 0; now <= 1000; now += 1000 / 60) {
      while (next < stream.length && (stream[next] as StreamEntry).atMs <= now) {
        const entry = stream[next] as StreamEntry;
        clock.onSnapshot(entry.snapshot.tick, entry.atMs);
        buffer.add(entry.snapshot);
        next++;
      }
      clock.update(now);
      const view = buffer.select(clock.renderTick);
      if (view === null) continue;
      drawn.ticks = source(clock, view);
      updateAnimsAt([anim], [champion], drawn);
      times.push(anim.d[D_NOW] as number);
    }
    return times;
  }

  it('moves about one frame a frame when driven by the render clock over the stream', () => {
    const times = frames((clock) => clock.renderTick);
    expect(times.length).toBeGreaterThan(40);
    for (let i = 1; i < times.length; i++) {
      const step = (times[i] as number) - (times[i - 1] as number);
      expect(step).toBeGreaterThanOrEqual(0);
      // A frame is 1/60 s; the catch-up allows 2 frames; a snapshot gap is 3.
      expect(step).toBeLessThanOrEqual(2 / 60 + 1e-9);
    }
  });

  it('would jump a snapshot gap when driven by the tick of B and the buffer alpha', () => {
    const times = frames((_clock, view) => (view.b as { tick: number }).tick + view.alpha);
    let biggest = 0;
    for (let i = 1; i < times.length; i++) biggest = Math.max(biggest, Math.abs((times[i] as number) - (times[i - 1] as number)));
    expect(biggest).toBeGreaterThan(2 / 60 + 1e-9);
  });
});
