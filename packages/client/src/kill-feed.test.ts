import { describe, expect, it } from 'vitest';
import { KILL_FEED_LINES, KILL_FEED_TICKS, KILL_KIND_DEATH, KILL_KIND_ORB, createKillFeed } from './kill-feed';

describe('kill feed', () => {
  it('shows at most 5 lines for 300 ticks (5 s), rules.md section 8', () => {
    expect(KILL_FEED_LINES).toBe(5);
    expect(KILL_FEED_TICKS).toBe(300);
  });

  it('starts empty', () => {
    const feed = createKillFeed();
    expect(feed.count).toBe(0);
    expect(feed.changes).toBe(0);
  });

  it('keeps a pushed line in order, oldest first', () => {
    const feed = createKillFeed();
    feed.push(10, 0, 2);
    feed.push(20, 3, 1);
    expect(feed.count).toBe(2);
    expect(feed.line(0)).toEqual({ tick: 10, killerId: 0, victimId: 2, kind: 0 });
    expect(feed.line(1)).toEqual({ tick: 20, killerId: 3, victimId: 1, kind: 0 });
    expect(feed.changes).toBe(2);
  });

  it('keeps the kind of a line: a push is a death, pushOrb is an orb pickup with the taker as the killer', () => {
    const feed = createKillFeed();
    feed.push(10, 0, 2);
    feed.pushOrb(20, 1);
    expect(KILL_KIND_DEATH).toBe(0);
    expect(KILL_KIND_ORB).toBe(1);
    expect(feed.line(0)).toEqual({ tick: 10, killerId: 0, victimId: 2, kind: KILL_KIND_DEATH });
    expect(feed.line(1).kind).toBe(KILL_KIND_ORB);
    expect(feed.line(1).killerId).toBe(1);
    expect(feed.line(1).tick).toBe(20);
    expect(feed.count).toBe(2);
    expect(feed.changes).toBe(2);
  });

  it('moves the kind with the line when the oldest leaves, by expiry and by overflow', () => {
    const feed = createKillFeed();
    feed.push(0, 0, 2);
    feed.pushOrb(100, 3);
    feed.expire(300);
    expect(feed.count).toBe(1);
    expect(feed.line(0).kind).toBe(KILL_KIND_ORB);
    const full = createKillFeed();
    full.pushOrb(0, 1);
    for (let i = 1; i < 5; i++) full.push(i, 0, 2);
    full.push(5, 0, 2);
    expect(full.line(0).kind).toBe(KILL_KIND_DEATH);
    full.pushOrb(6, 2);
    expect(full.line(4).kind).toBe(KILL_KIND_ORB);
    expect(full.line(3).kind).toBe(KILL_KIND_DEATH);
  });

  it('shows a line from tick T at T + 299 and not at T + 300', () => {
    const feed = createKillFeed();
    feed.push(100, 0, 2);
    const changes = feed.changes;
    feed.expire(399);
    expect(feed.count).toBe(1);
    expect(feed.changes).toBe(changes);
    feed.expire(400);
    expect(feed.count).toBe(0);
    expect(feed.changes).toBe(changes + 1);
    feed.expire(401);
    expect(feed.changes).toBe(changes + 1);
  });

  it('expires lines one by one, oldest first, and counts each change', () => {
    const feed = createKillFeed();
    feed.push(100, 0, 2);
    feed.push(150, 1, 3);
    const changes = feed.changes;
    feed.expire(400);
    expect(feed.count).toBe(1);
    expect(feed.line(0)).toEqual({ tick: 150, killerId: 1, victimId: 3, kind: 0 });
    expect(feed.changes).toBe(changes + 1);
    feed.expire(450);
    expect(feed.count).toBe(0);
    expect(feed.changes).toBe(changes + 2);
  });

  it('drops the oldest line when a sixth is pushed', () => {
    const feed = createKillFeed();
    for (let i = 0; i < 6; i++) feed.push(i, i, i + 10);
    expect(feed.count).toBe(5);
    expect(feed.line(0)).toEqual({ tick: 1, killerId: 1, victimId: 11, kind: 0 });
    expect(feed.line(4)).toEqual({ tick: 5, killerId: 5, victimId: 15, kind: 0 });
  });

  it('reuses its entries, so pushes and expiries allocate nothing', () => {
    const feed = createKillFeed();
    const entries = [0, 1, 2, 3, 4].map((i) => feed.line(i));
    for (let i = 0; i < 12; i++) feed.push(i, 0, 1);
    feed.expire(1000);
    feed.push(1000, 2, 3);
    for (let i = 0; i < 5; i++) expect(feed.line(i)).toBe(entries[i]);
  });
});
