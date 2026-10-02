/** Lines the feed shows at most, rules.md section 8. */
export const KILL_FEED_LINES = 5;
/** How long a line stays, in sim ticks: 5 s at 60 Hz. */
export const KILL_FEED_TICKS = 300;

export interface KillLine {
  /** The sim tick of the death. */
  tick: number;
  killerId: number;
  victimId: number;
}

/**
 * The last few deaths, oldest first. The five entries are made once and
 * rewritten in place, so a death or an expiry allocates nothing. `changes`
 * counts pushes and expiries, so a reader can tell the feed moved.
 */
export class KillFeed {
  /** Lines showing right now. */
  count = 0;
  /** Pushes and expiries so far. */
  changes = 0;
  private readonly lines: KillLine[] = [];

  constructor() {
    for (let i = 0; i < KILL_FEED_LINES; i++) this.lines.push({ tick: 0, killerId: 0, victimId: 0 });
  }

  /** Line `index`, 0 the oldest. Only indices below `count` hold a death. */
  line(index: number): KillLine {
    return this.lines[index] as KillLine;
  }

  /** Adds a death. With the feed full, the oldest line leaves. */
  push(tick: number, killerId: number, victimId: number): void {
    if (this.count === KILL_FEED_LINES) this.dropOldest();
    const line = this.lines[this.count] as KillLine;
    line.tick = tick;
    line.killerId = killerId;
    line.victimId = victimId;
    this.count += 1;
    this.changes += 1;
  }

  /** Removes the lines older than `KILL_FEED_TICKS` at `tick`. Returns whether any left. */
  expire(tick: number): boolean {
    let removed = false;
    while (this.count > 0 && tick - (this.lines[0] as KillLine).tick >= KILL_FEED_TICKS) {
      this.dropOldest();
      removed = true;
    }
    if (removed) this.changes += 1;
    return removed;
  }

  private dropOldest(): void {
    for (let i = 1; i < this.count; i++) {
      const from = this.lines[i] as KillLine;
      const to = this.lines[i - 1] as KillLine;
      to.tick = from.tick;
      to.killerId = from.killerId;
      to.victimId = from.victimId;
    }
    this.count -= 1;
  }
}

export function createKillFeed(): KillFeed {
  return new KillFeed();
}
