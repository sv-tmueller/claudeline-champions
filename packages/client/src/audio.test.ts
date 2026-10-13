import type { GameState } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import { SOUNDS, bindSoundUnlock, createWebSound, routeSounds, type SoundOutput } from './audio';

/** What the fake context counted. A voice is an oscillator, its envelope gain and the master gain. */
interface Counts {
  contexts: number;
  oscillators: number;
  gains: number;
  starts: number;
  resumes: number;
  /** One entry per `cancelScheduledValues` call: the index of the envelope that got it. */
  cancels: number[];
  /** Every call on an envelope parameter, in order, as text. */
  calls: string[];
}

interface FakeOptions {
  state?: string;
  resume?: () => Promise<void>;
}

/** A stand-in for an AudioContext that counts what the sound code asks of it. Its currentTime throws. */
function fakeContext(options: FakeOptions = {}): { counts: Counts; make: () => AudioContext } {
  const counts: Counts = { contexts: 0, oscillators: 0, gains: 0, starts: 0, resumes: 0, cancels: [], calls: [] };
  const make = (): AudioContext => {
    counts.contexts += 1;
    const context = {
      state: options.state ?? 'running',
      destination: { destination: true },
      get currentTime(): number {
        throw new Error('play must not read currentTime');
      },
      createOscillator() {
        counts.oscillators += 1;
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect() {},
          start() {
            counts.starts += 1;
          },
        };
      },
      createGain() {
        counts.gains += 1;
        // The first gain is the master, the others are envelopes in voice order.
        const index = counts.gains - 2;
        return {
          gain: {
            value: 1,
            cancelScheduledValues() {
              counts.cancels.push(index);
              counts.calls.push(`cancel:${index}`);
            },
            setValueAtTime(value: number, time: number) {
              counts.calls.push(`set:${index}:${value}:${time}`);
            },
            setTargetAtTime(target: number, start: number, constant: number) {
              counts.calls.push(`target:${index}:${target}:${start}:${constant > 0}`);
            },
          },
          connect() {},
        };
      },
      resume() {
        counts.resumes += 1;
        return options.resume ? options.resume() : Promise.resolve();
      },
    };
    return context as unknown as AudioContext;
  };
  return { counts, make };
}

function withWarnings<T>(run: () => T): { result: T; warnings: unknown[][] } {
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args);
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = warn;
  }
}

describe('SOUNDS', () => {
  it('indexes the five voices 0 to 4', () => {
    expect(SOUNDS).toEqual({ hit: 0, cast: 1, death: 2, roundStart: 3, roundEnd: 4 });
  });
});

describe('createWebSound', () => {
  it('builds nothing before unlock, and a play before unlock does nothing', () => {
    const { counts, make } = fakeContext();
    const sound = createWebSound(make);
    sound.play(SOUNDS.hit);
    sound.play(SOUNDS.roundEnd);
    expect(counts).toEqual({ contexts: 0, oscillators: 0, gains: 0, starts: 0, resumes: 0, cancels: [], calls: [] });
  });

  it('unlock builds one context and one started voice per sound, and a second unlock builds no more', () => {
    const { counts, make } = fakeContext();
    const sound = createWebSound(make);
    sound.unlock();
    sound.unlock();
    expect(counts.contexts).toBe(1);
    expect(counts.oscillators).toBe(5);
    expect(counts.gains).toBe(6);
    expect(counts.starts).toBe(5);
  });

  it('plays voice i with exactly one cancel, one set to the peak and one decay, all at time 0', () => {
    for (let i = 0; i < 5; i++) {
      const { counts, make } = fakeContext();
      const sound = createWebSound(make);
      sound.unlock();
      sound.play(i);
      expect(counts.cancels, `voice ${i}`).toEqual([i]);
      expect(counts.calls[0], `voice ${i}`).toBe(`cancel:${i}`);
      expect(counts.calls[1], `voice ${i}`).toMatch(new RegExp(`^set:${i}:[0-9.]+:0$`));
      expect(counts.calls[2], `voice ${i}`).toBe(`target:${i}:0:0:true`);
      expect(counts.calls, `voice ${i}`).toHaveLength(3);
    }
  });

  it('ignores an index outside the five voices', () => {
    const { counts, make } = fakeContext();
    const sound = createWebSound(make);
    sound.unlock();
    sound.play(5);
    sound.play(-1);
    expect(counts.calls).toEqual([]);
  });

  it('creates no node over 100 plays and never reads currentTime', () => {
    const { counts, make } = fakeContext();
    const sound = createWebSound(make);
    sound.unlock();
    const before = { ...counts, cancels: [], calls: [] };
    for (let i = 0; i < 100; i++) sound.play(i % 5);
    expect({ ...counts, cancels: [], calls: [] }).toEqual(before);
    expect(counts.cancels).toHaveLength(100);
  });

  it('plays nothing while muted, and again once unmuted', () => {
    const { counts, make } = fakeContext();
    const sound = createWebSound(make);
    sound.unlock();
    sound.setMuted(true);
    sound.play(SOUNDS.death);
    expect(counts.calls).toEqual([]);
    sound.setMuted(false);
    sound.play(SOUNDS.death);
    expect(counts.cancels).toEqual([SOUNDS.death]);
  });

  it('keeps a mute set before the unlock', () => {
    const { counts, make } = fakeContext();
    const sound = createWebSound(make);
    sound.setMuted(true);
    sound.unlock();
    sound.play(SOUNDS.hit);
    expect(counts.contexts).toBe(1);
    expect(counts.calls).toEqual([]);
  });

  it('only warns when the factory throws, once, and plays nothing', () => {
    const { result, warnings } = withWarnings(() => {
      const sound = createWebSound(() => {
        throw new Error('no audio here');
      });
      sound.unlock();
      sound.unlock();
      sound.play(SOUNDS.hit);
      return sound;
    });
    expect(result).toBeDefined();
    expect(warnings).toHaveLength(1);
  });

  it('only warns when a node cannot be made, and plays nothing', () => {
    const { counts, make } = fakeContext();
    const { warnings } = withWarnings(() => {
      const sound = createWebSound(() => {
        const context = make();
        context.createOscillator = () => {
          throw new Error('no oscillator');
        };
        return context;
      });
      sound.unlock();
      sound.play(SOUNDS.hit);
    });
    expect(warnings).toHaveLength(1);
    expect(counts.calls).toEqual([]);
  });

  it('resumes a suspended context on each unlock', () => {
    const { counts, make } = fakeContext({ state: 'suspended' });
    const sound = createWebSound(make);
    expect(sound.unlock()).toBe(false);
    expect(sound.unlock()).toBe(false);
    expect(counts.contexts).toBe(1);
    expect(counts.resumes).toBe(2);
  });

  it('does not resume a running context, and says it is running', () => {
    const { counts, make } = fakeContext({ state: 'running' });
    const sound = createWebSound(make);
    expect(sound.unlock()).toBe(true);
    expect(counts.resumes).toBe(0);
  });

  it('catches a rejected resume', async () => {
    let handled = false;
    const { make } = fakeContext({
      state: 'suspended',
      resume: () => {
        const rejected = Promise.reject(new Error('blocked'));
        const then = rejected.then.bind(rejected);
        // A rejection handler attached in the same tick is what keeps the page free of an unhandled rejection.
        rejected.then = ((onFulfilled: never, onRejected: unknown) => {
          handled ||= onRejected !== undefined;
          return then(onFulfilled, onRejected as never);
        }) as typeof rejected.then;
        return rejected;
      },
    });
    const sound = createWebSound(make);
    sound.unlock();
    expect(handled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sound.unlock()).toBe(false);
  });

  it('catches a resume that throws', () => {
    const { make } = fakeContext({
      state: 'suspended',
      resume: () => {
        throw new Error('blocked');
      },
    });
    const sound = createWebSound(make);
    expect(() => sound.unlock()).not.toThrow();
  });

  it('reports running once the factory failed, so the listeners go', () => {
    const { result } = withWarnings(() =>
      createWebSound(() => {
        throw new Error('no audio here');
      }).unlock(),
    );
    expect(result).toBe(true);
  });
});

/** A sound that records what it is asked to play. */
function recorder(): { sound: SoundOutput; plays: number[] } {
  const plays: number[] = [];
  return {
    plays,
    sound: {
      unlock: () => true,
      setMuted: () => undefined,
      play: (id: number) => void plays.push(id),
    },
  };
}

function stateOf(events: object[]): GameState {
  return { events } as unknown as GameState;
}

describe('routeSounds', () => {
  const EVENTS = [
    { type: 'projectileHit', x: 1, y: 1 },
    { type: 'castStarted', championId: 0, castId: 1, slot: 'M1' },
    { type: 'castStarted', championId: 1, castId: 2, slot: 'M1' },
    { type: 'death', targetId: 1, sourceId: 0 },
    { type: 'roundStarted', round: 2 },
    { type: 'roundEnded', round: 1, winner: 0, scoreA: 1, scoreB: 0 },
    { type: 'meleeArc', ownerId: 0, targetIds: [1] },
    { type: 'meleeArc', ownerId: 0, targetIds: [] },
    { type: 'damage', targetId: 1, sourceId: 0, amount: 10, health: 90 },
    { type: 'heal', targetId: 0, sourceId: 0, amount: 5, health: 100 },
  ];

  it('plays a hit, the local cast, a death, a round start, a round end and a landed melee arc, in event order', () => {
    const { sound, plays } = recorder();
    routeSounds(stateOf(EVENTS), sound, 0);
    expect(plays).toEqual([SOUNDS.hit, SOUNDS.cast, SOUNDS.death, SOUNDS.roundStart, SOUNDS.roundEnd, SOUNDS.hit]);
  });

  it('plays a cast only for the local champion', () => {
    const { sound, plays } = recorder();
    routeSounds(stateOf(EVENTS), sound, 1);
    expect(plays.filter((id) => id === SOUNDS.cast)).toHaveLength(1);
    const other = recorder();
    routeSounds(stateOf([{ type: 'castStarted', championId: 2, castId: 1, slot: 'Q' }]), other.sound, 0);
    expect(other.plays).toEqual([]);
  });

  it('plays nothing for the events with no sound', () => {
    const { sound, plays } = recorder();
    routeSounds(
      stateOf([
        { type: 'damage', targetId: 1, sourceId: 0, amount: 10, health: 90 },
        { type: 'heal', targetId: 0, sourceId: 0, amount: 5, health: 100 },
        { type: 'projectileExpired', reason: 'wall', x: 0, y: 0 },
        { type: 'castFired', championId: 0, castId: 1, slot: 'M1', ex: false },
        { type: 'matchEnded', winner: 0, scoreA: 2, scoreB: 0 },
        { type: 'meleeArc', ownerId: 0, targetIds: [] },
      ]),
      sound,
      0,
    );
    expect(plays).toEqual([]);
  });

  it('plays a hit for every landed event, one after the other', () => {
    const { sound, plays } = recorder();
    routeSounds(stateOf([{ type: 'projectileHit' }, { type: 'projectileHit' }, { type: 'death', targetId: 1, sourceId: 0 }]), sound, 0);
    expect(plays).toEqual([SOUNDS.hit, SOUNDS.hit, SOUNDS.death]);
  });
});

describe('bindSoundUnlock', () => {
  function counting(running: boolean[]): { sound: Pick<SoundOutput, 'unlock'>; calls: () => number } {
    let calls = 0;
    return {
      calls: () => calls,
      sound: { unlock: () => running[Math.min(calls++, running.length - 1)] ?? true },
    };
  }

  it('unlocks on a keydown and on a pointerdown', () => {
    const win = new EventTarget();
    const { sound, calls } = counting([false]);
    bindSoundUnlock(win, sound);
    win.dispatchEvent(new Event('keydown'));
    win.dispatchEvent(new Event('pointerdown'));
    expect(calls()).toBe(2);
  });

  it('keeps listening while the context is suspended and stops once it runs', () => {
    const win = new EventTarget();
    const { sound, calls } = counting([false, false, true]);
    bindSoundUnlock(win, sound);
    for (const type of ['keydown', 'keydown', 'pointerdown']) win.dispatchEvent(new Event(type));
    expect(calls()).toBe(3);
    win.dispatchEvent(new Event('keydown'));
    win.dispatchEvent(new Event('pointerdown'));
    expect(calls()).toBe(3);
  });

  it('returns a function that removes both listeners', () => {
    const win = new EventTarget();
    const { sound, calls } = counting([false]);
    const unbind = bindSoundUnlock(win, sound);
    unbind();
    win.dispatchEvent(new Event('keydown'));
    win.dispatchEvent(new Event('pointerdown'));
    expect(calls()).toBe(0);
  });
});
