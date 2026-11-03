/** Lines the feed shows at most, rules.md section 8. */
export const KILL_FEED_LINES = 5;
/** How long a line stays, in sim ticks: 5 s at 60 Hz. */
export const KILL_FEED_TICKS = 300;

/** A line of a champion's death, by a champion or by the ring. */
export const KILL_KIND_DEATH = 0;
/** A line of an energy orb pickup: the killer is the taker and the victim is unused. */
export const KILL_KIND_ORB = 1;

export interface KillLine {
  /** The sim tick of the death or the pickup. */
  tick: number;
  killerId: number;
  victimId: number;
  /** `KILL_KIND_DEATH` or `KILL_KIND_ORB`, an integer. */
  kind: number;
}

/**
 * The last few deaths and orb pickups, oldest first. The five entries are made once and
 * rewritten in place, so a death or an expiry allocates nothing. `changes`
 * counts pushes and expiries, so the HUD can skip its lines while the feed has
 * not moved.
 */
export class KillFeed {
  /** Lines showing right now. */
  count = 0;
  /** Pushes and expiries so far. */
  changes = 0;
  private readonly lines: KillLine[] = [];

  constructor() {
    for (let i = 0; i < KILL_FEED_LINES; i++) this.lines.push({ tick: 0, killerId: 0, victimId: 0, kind: KILL_KIND_DEATH });
  }

  /** Line `index`, 0 the oldest. Only indices below `count` hold a line. */
  line(index: number): KillLine {
    return this.lines[index] as KillLine;
  }

  /** Adds a death. With the feed full, the oldest line leaves. */
  push(tick: number, killerId: number, victimId: number): void {
    this.add(tick, killerId, victimId, KILL_KIND_DEATH);
  }

  /** Adds an orb pickup by champion `takerId`. With the feed full, the oldest line leaves. */
  pushOrb(tick: number, takerId: number): void {
    this.add(tick, takerId, -1, KILL_KIND_ORB);
  }

  private add(tick: number, killerId: number, victimId: number, kind: number): void {
    if (this.count === KILL_FEED_LINES) this.dropOldest();
    const line = this.lines[this.count] as KillLine;
    line.tick = tick;
    line.killerId = killerId;
    line.victimId = victimId;
    line.kind = kind;
    this.count += 1;
    this.changes += 1;
  }

  /** Removes the lines older than `KILL_FEED_TICKS` at `tick`. Counts one change when any left. */
  expire(tick: number): void {
    let removed = false;
    while (this.count > 0 && tick - (this.lines[0] as KillLine).tick >= KILL_FEED_TICKS) {
      this.dropOldest();
      removed = true;
    }
    if (removed) this.changes += 1;
  }

  private dropOldest(): void {
    for (let i = 1; i < this.count; i++) {
      const from = this.lines[i] as KillLine;
      const to = this.lines[i - 1] as KillLine;
      to.tick = from.tick;
      to.killerId = from.killerId;
      to.victimId = from.victimId;
      to.kind = from.kind;
    }
    this.count -= 1;
  }
}

export function createKillFeed(): KillFeed {
  return new KillFeed();
}
