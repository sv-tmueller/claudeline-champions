import type { GameState } from '@claudeline/sim';

/**
 * The five sounds of the first pass, which are also the voice indices of
 * `createWebSound`. Small integers (Smis) on purpose: `play` is called from the
 * frame path, and a Smi crosses a call without being boxed.
 */
export const SOUNDS = { hit: 0, cast: 1, death: 2, roundStart: 3, roundEnd: 4 } as const;

/** What the game asks of the sound: a desktop build can swap it (`Platform.sound`). */
export interface SoundOutput {
  /**
   * Called on a user gesture. Makes the context and its voices on first use and
   * resumes it while it is suspended. Returns whether the context is running, or
   * can never run (no audio): then the gesture listeners have nothing left to do.
   */
  unlock(): boolean;
  /** A muted sound plays nothing. The state is kept across `unlock`. */
  setMuted(on: boolean): void;
  /** Plays voice `sound`, one of `SOUNDS`. Does nothing before `unlock` or while muted. No allocation. */
  play(sound: number): void;
}

/** The first pass's tuned values: each voice is one oscillator, and its decay is below in `play`. */
const VOICES: readonly { type: OscillatorType; hz: number }[] = [
  { type: 'square', hz: 220 }, // hit: a short low click
  { type: 'triangle', hz: 520 }, // cast: a soft blip
  { type: 'sawtooth', hz: 110 }, // death: a low buzz that dies away
  { type: 'sine', hz: 660 }, // round start: a clear high tone
  { type: 'sine', hz: 330 }, // round end: the same tone an octave down, longer
];
const MASTER_GAIN = 0.2;
const PEAK = 0.6;
// Time constants of the exponential decays, in seconds. Module constants, not
// table reads: a double read from an array and passed on is boxed.
const HIT_DECAY = 0.03;
const CAST_DECAY = 0.05;
const DEATH_DECAY = 0.12;
const ROUND_START_DECAY = 0.08;
const ROUND_END_DECAY = 0.14;

/** The page's AudioContext, looked up when the first gesture asks, never at load. */
export function browserAudioContext(): AudioContext {
  const AudioContextClass = globalThis.AudioContext as typeof AudioContext | undefined;
  if (AudioContextClass === undefined) throw new Error('this browser has no AudioContext');
  return new AudioContextClass();
}

function ignore(): void {}

/**
 * The web sound: one persistent voice per sound (an oscillator, an envelope gain
 * and a master gain into the destination), all made in `unlock` and started
 * once. A play then restarts its envelope and creates nothing. Every time
 * argument is 0, which the audio clock reads as now, so `play` never reads
 * `currentTime`, and every argument is a literal or a module constant. A factory
 * or a node that throws becomes one console warning (a console error would fail
 * every e2e spec) and the sound stays off, and a failed `resume()` is caught.
 */
export function createWebSound(makeContext: () => AudioContext): SoundOutput {
  let context: AudioContext | undefined;
  let gains: readonly AudioParam[] = [];
  let failed = false;
  let muted = false;

  function build(): void {
    let made: AudioContext | undefined;
    try {
      made = makeContext();
      const master = made.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(made.destination);
      const built: AudioParam[] = [];
      for (const voice of VOICES) {
        const oscillator = made.createOscillator();
        oscillator.type = voice.type;
        oscillator.frequency.value = voice.hz;
        const envelope = made.createGain();
        envelope.gain.value = 0;
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start();
        built.push(envelope.gain);
      }
      context = made;
      gains = built;
    } catch (error) {
      failed = true;
      console.warn('the sound is off', error);
      // A node failed after the context was made: close it, so no silent context or started
      // oscillator stays alive for the life of the page. A close that fails changes nothing.
      try {
        made?.close().catch(ignore);
      } catch {
        // Nothing left to release.
      }
    }
  }

  return {
    unlock(): boolean {
      if (failed) return true;
      if (context === undefined) build();
      if (context === undefined) return true;
      if (context.state === 'running') return true;
      try {
        context.resume().catch(ignore);
      } catch {
        // A context that cannot resume stays suspended; the next gesture tries again.
      }
      return false;
    },
    setMuted(on: boolean): void {
      muted = on;
    },
    play(sound: number): void {
      if (muted) return;
      const gain = gains[sound];
      if (gain === undefined) return;
      gain.cancelScheduledValues(0);
      gain.setValueAtTime(PEAK, 0);
      switch (sound) {
        case SOUNDS.hit:
          gain.setTargetAtTime(0, 0, HIT_DECAY);
          break;
        case SOUNDS.cast:
          gain.setTargetAtTime(0, 0, CAST_DECAY);
          break;
        case SOUNDS.death:
          gain.setTargetAtTime(0, 0, DEATH_DECAY);
          break;
        case SOUNDS.roundStart:
          gain.setTargetAtTime(0, 0, ROUND_START_DECAY);
          break;
        default:
          gain.setTargetAtTime(0, 0, ROUND_END_DECAY);
          break;
      }
    },
  };
}

/**
 * The second pass over a step's events (after `routeEvents`, which feedback.ts
 * owns): a hit for a projectile that touched a champion and for a melee arc with
 * at least one target, a cast for the local champion only (a 3v3 would be noise
 * otherwise), a death, a round start and a round end. Nothing for the match end,
 * which follows the last round end. Indexed loop, no allocation.
 */
export function routeSounds(state: GameState, sound: Pick<SoundOutput, 'play'>, localId: number): void {
  const events = state.events;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;
    switch (event.type) {
      case 'projectileHit':
        sound.play(SOUNDS.hit);
        break;
      case 'meleeArc':
        if (event.targetIds.length > 0) sound.play(SOUNDS.hit);
        break;
      case 'castStarted':
        if (event.championId === localId) sound.play(SOUNDS.cast);
        break;
      case 'death':
        sound.play(SOUNDS.death);
        break;
      case 'roundStarted':
        sound.play(SOUNDS.roundStart);
        break;
      case 'roundEnded':
        sound.play(SOUNDS.roundEnd);
        break;
      default:
        break;
    }
  }
}

/**
 * Unlocks the sound on the first gestures: a keydown or a pointerdown on `win`.
 * Chrome does not count Escape as a gesture, so a first Escape press may leave
 * the context suspended; the listeners stay until `unlock` reports a running
 * context. Returns a function that removes them.
 */
export function bindSoundUnlock(win: EventTarget, sound: Pick<SoundOutput, 'unlock'>): () => void {
  const onGesture = (): void => {
    if (sound.unlock()) remove();
  };
  function remove(): void {
    win.removeEventListener('keydown', onGesture);
    win.removeEventListener('pointerdown', onGesture);
  }
  win.addEventListener('keydown', onGesture);
  win.addEventListener('pointerdown', onGesture);
  return remove;
}
