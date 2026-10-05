import { EX_ENERGY_COST, MAX_ENERGY, ULTIMATE_ENERGY_COST, type MatchState, type TeamId } from '@claudeline/sim';
import {
  SUDDEN_DEATH_TEXT,
  TIMER_TEXT,
  createRoundView,
  createSlotViews,
  readRoundView,
  readSlotViews,
  type RoundView,
  type SlotSource,
  type SlotView,
} from './hud-views';
import { KILL_FEED_LINES, type KillFeed } from './kill-feed';
import { championName } from './roster';

/**
 * The part of an element the HUD writes. `HTMLElement` satisfies it, and so does
 * a counting fake. State goes into `data-*` attributes through `setAttribute`
 * and not through `dataset`: in the heap probe (e2e/combat.spec.ts) a `dataset`
 * write allocated about 100 B per window in the counted code whenever a slot
 * changed, and `setAttribute` allocated none.
 */
export interface HudElement {
  textContent: string | null;
  style: { transform: string };
  setAttribute(name: string, value: string): void;
}

export interface HudHandles {
  healthText: HudElement;
  healthFill: HudElement;
  energyFill: HudElement;
  exMark: HudElement;
  ultimateMark: HudElement;
  /** One per slot in `SLOTS` order. */
  slots: readonly { icon: HudElement; seconds: HudElement }[];
  score: HudElement;
  timer: HudElement;
  /** `KILL_FEED_LINES` lines, the oldest first. */
  lines: readonly { line: HudElement; killer: HudElement; victim: HudElement }[];
}

/** What `update` reads from the game state. */
export interface HudState {
  tick: number;
  /** Absent in free play, which reads as 0 : 0 and a full round. */
  match?: MatchState;
  champions: readonly (SlotSource & { health: number; maxHealth: number })[];
}

const RING_NAME = 'Ring';
// The timer key of the sudden death text, past the 91 keys of the seconds.
const SUDDEN_KEY = 100;
const SIDE_ALLY = 'ally';
const SIDE_ENEMY = 'enemy';
const SIDE_RING = 'ring';
const TRUE = 'true';
const FALSE = 'false';

// The text of 0 to 99 seconds, made once. A ready slot shows nothing.
const SECONDS_TEXT: readonly string[] = Array.from({ length: 100 }, (_, seconds) =>
  seconds === 0 ? '' : String(seconds),
);

function flag(value: boolean): string {
  return value ? TRUE : FALSE;
}

/**
 * Writes the local champion, the round and the kill feed into the HUD elements.
 * Every value is compared with the last one written, and the DOM is only
 * touched when it changed, so a steady frame writes and allocates nothing.
 * The cache holds integers only: a flag is 0 or 1 and -1 means not written yet.
 */
export class Hud {
  private readonly names: string[];
  private readonly sides: string[];
  private readonly slotViews: SlotView[] = createSlotViews();
  private readonly round: RoundView = createRoundView();

  private healthKey = -1;
  private maxHealth = -1;
  private energyKey = -1;
  private exReady = -1;
  private ultimateReady = -1;
  private scoreA = -1;
  private scoreB = -1;
  // 0 to 90 for the seconds shown, SUDDEN_KEY for the sudden death text, -1 for not written yet.
  private timerKey = -1;
  private suddenFlag = -1;
  private readonly slotSeconds: number[] = [];
  private readonly slotReady: number[] = [];
  private readonly slotWindup: number[] = [];
  private readonly slotBlocked: number[] = [];
  private readonly lineShown: number[] = [];
  private readonly lineKiller: number[] = [];
  private readonly lineVictim: number[] = [];
  private feedChanges = -1;

  constructor(
    private readonly handles: HudHandles,
    champions: readonly { championId: string; team: TeamId }[],
    private readonly localId: number,
    private readonly killFeed: KillFeed,
  ) {
    const localTeam = champions[localId]?.team;
    this.names = champions.map((champion) => championName(champion.championId));
    this.sides = champions.map((champion) => (champion.team === localTeam ? SIDE_ALLY : SIDE_ENEMY));
    for (let i = 0; i < this.slotViews.length; i++) {
      this.slotSeconds.push(-1);
      this.slotReady.push(-1);
      this.slotWindup.push(-1);
      this.slotBlocked.push(-1);
    }
    for (let i = 0; i < KILL_FEED_LINES; i++) {
      this.lineShown.push(-1);
      this.lineKiller.push(-2);
      this.lineVictim.push(-2);
    }
  }

  update(state: HudState): void {
    const champion = state.champions[this.localId];
    if (champion) {
      this.updateHealth(champion);
      this.updateEnergy(champion.energy);
      this.updateSlots(champion);
    }
    this.updateRound(state);
    this.updateKillFeed(state.tick);
  }

  private updateHealth(champion: { health: number; maxHealth: number }): void {
    const key = Math.ceil(champion.health);
    const max = champion.maxHealth;
    if (key === this.healthKey && max === this.maxHealth) return;
    this.healthKey = key;
    this.maxHealth = max;
    this.handles.healthText.textContent = `${key} / ${max}`;
    this.handles.healthFill.style.transform = `scaleX(${max > 0 ? Math.min(Math.max(key / max, 0), 1) : 0})`;
  }

  private updateEnergy(energy: number): void {
    const key = Math.floor(Math.min(Math.max(energy, 0), MAX_ENERGY));
    if (key !== this.energyKey) {
      this.energyKey = key;
      this.handles.energyFill.style.transform = `scaleX(${key / MAX_ENERGY})`;
    }
    const ex = energy >= EX_ENERGY_COST ? 1 : 0;
    if (ex !== this.exReady) {
      this.exReady = ex;
      this.handles.exMark.setAttribute('data-ready', flag(ex === 1));
    }
    const ultimate = energy >= ULTIMATE_ENERGY_COST ? 1 : 0;
    if (ultimate !== this.ultimateReady) {
      this.ultimateReady = ultimate;
      this.handles.ultimateMark.setAttribute('data-ready', flag(ultimate === 1));
    }
  }

  private updateSlots(source: SlotSource): void {
    readSlotViews(source, this.slotViews);
    for (let i = 0; i < this.slotViews.length; i++) {
      const view = this.slotViews[i] as SlotView;
      const handle = this.handles.slots[i];
      if (!handle) continue;
      if (view.seconds !== this.slotSeconds[i]) {
        this.slotSeconds[i] = view.seconds;
        handle.seconds.textContent = SECONDS_TEXT[view.seconds] ?? String(view.seconds);
      }
      const ready = view.seconds === 0 ? 1 : 0;
      if (ready !== this.slotReady[i]) {
        this.slotReady[i] = ready;
        handle.icon.setAttribute('data-ready', flag(ready === 1));
      }
      const windup = view.windup ? 1 : 0;
      if (windup !== this.slotWindup[i]) {
        this.slotWindup[i] = windup;
        handle.icon.setAttribute('data-windup', flag(windup === 1));
      }
      const blocked = view.blocked ? 1 : 0;
      if (blocked !== this.slotBlocked[i]) {
        this.slotBlocked[i] = blocked;
        handle.icon.setAttribute('data-blocked', flag(blocked === 1));
      }
    }
  }

  private updateRound(state: HudState): void {
    const round = this.round;
    readRoundView(state, round);
    if (round.scoreA !== this.scoreA || round.scoreB !== this.scoreB) {
      this.scoreA = round.scoreA;
      this.scoreB = round.scoreB;
      this.handles.score.textContent = `${round.scoreA} : ${round.scoreB}`;
    }
    // Outside the round phases the timer keeps what it shows.
    if (!round.live) return;
    const key = round.suddenDeath ? SUDDEN_KEY : round.secondsLeft;
    if (key !== this.timerKey) {
      this.timerKey = key;
      this.handles.timer.textContent = round.suddenDeath ? SUDDEN_DEATH_TEXT : (TIMER_TEXT[round.secondsLeft] ?? '');
    }
    const sudden = round.suddenDeath ? 1 : 0;
    if (sudden !== this.suddenFlag) {
      this.suddenFlag = sudden;
      this.handles.timer.setAttribute('data-sudden', flag(sudden === 1));
    }
  }

  private updateKillFeed(tick: number): void {
    const feed = this.killFeed;
    feed.expire(tick);
    if (feed.changes === this.feedChanges) return;
    this.feedChanges = feed.changes;
    for (let i = 0; i < KILL_FEED_LINES; i++) {
      const handle = this.handles.lines[i];
      if (!handle) continue;
      const shown = i < feed.count ? 1 : 0;
      if (shown !== this.lineShown[i]) {
        this.lineShown[i] = shown;
        handle.line.setAttribute('data-visible', flag(shown === 1));
      }
      if (shown === 0) continue;
      const entry = feed.line(i);
      if (entry.killerId !== this.lineKiller[i]) {
        this.lineKiller[i] = entry.killerId;
        handle.killer.textContent = this.names[entry.killerId] ?? RING_NAME;
        handle.killer.setAttribute('data-team', this.sides[entry.killerId] ?? SIDE_RING);
      }
      if (entry.victimId !== this.lineVictim[i]) {
        this.lineVictim[i] = entry.victimId;
        handle.victim.textContent = this.names[entry.victimId] ?? RING_NAME;
        handle.victim.setAttribute('data-team', this.sides[entry.victimId] ?? SIDE_RING);
      }
    }
  }
}
