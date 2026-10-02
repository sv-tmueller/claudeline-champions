import { describe, expect, it } from 'vitest';
import arena01 from '../../../data/arenas/arena01.json';
import { MAX_ARENA_METERS, parseArenaDef } from '../src/index';

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(arena01)) as Record<string, unknown>;
}

describe('parseArenaDef', () => {
  it('accepts arena01 and returns an equal but separate object', () => {
    const parsed = parseArenaDef(arena01);
    expect(parsed).toEqual(arena01);
    expect(parsed).not.toBe(arena01);
    expect(parsed.obstacles).not.toBe(arena01.obstacles);
    expect(parsed.spawns.teamA[0]).not.toBe(arena01.spawns.teamA[0]);
  });

  it('ignores extra keys', () => {
    const data = clone();
    data['note'] = 'extra';
    expect(parseArenaDef(data)).toEqual(arena01);
  });

  it('rejects a missing ring and names it', () => {
    const data = clone();
    delete data['ring'];
    expect(() => parseArenaDef(data)).toThrow('Invalid arena definition: ring: missing');
  });

  it('rejects a string size.width and names the path', () => {
    const data = clone();
    data['size'] = { width: '30', height: 20 };
    expect(() => parseArenaDef(data)).toThrow(
      'Invalid arena definition: size.width: expected a number, got string',
    );
  });

  it('rejects an unknown obstacle type and names it', () => {
    const data = clone();
    data['obstacles'] = [{ type: 'triangle' }];
    expect(() => parseArenaDef(data)).toThrow(
      'Invalid arena definition: obstacles[0].type: unknown obstacle type "triangle"',
    );
  });

  it('rejects data that is not an object', () => {
    expect(() => parseArenaDef(null)).toThrow('Invalid arena definition: (root): expected an object');
  });

  it('rejects a non-positive size, radius, width or height', () => {
    const size = clone();
    size['size'] = { width: 0, height: 20 };
    expect(() => parseArenaDef(size)).toThrow('size.width: expected a number above 0');

    const circle = clone();
    circle['obstacles'] = [
      { type: 'circle', x: 0, y: 0, r: 0, height: 1, blocksProjectiles: true },
    ];
    expect(() => parseArenaDef(circle)).toThrow('obstacles[0].r: expected a number above 0');

    const rect = clone();
    rect['obstacles'] = [
      { type: 'rect', x: 0, y: 0, w: 1, h: -1, height: 1, blocksProjectiles: true },
    ];
    expect(() => parseArenaDef(rect)).toThrow('obstacles[0].h: expected a number above 0');
  });

  it('rejects a non-finite number, a bad spawn point and a non-boolean flag', () => {
    const infinite = clone();
    infinite['ring'] = { startRadius: Infinity, endRadius: 3, damagePerSecond: 10 };
    expect(() => parseArenaDef(infinite)).toThrow('ring.startRadius: expected a number');

    const spawn = clone();
    spawn['spawns'] = { teamA: [[1, 'a']], teamB: [] };
    expect(() => parseArenaDef(spawn)).toThrow('spawns.teamA[0][1]: expected a number, got string');

    const flag = clone();
    flag['obstacles'] = [
      { type: 'circle', x: 0, y: 0, r: 1, height: 1, blocksProjectiles: 'yes' },
    ];
    expect(() => parseArenaDef(flag)).toThrow(
      'obstacles[0].blocksProjectiles: expected a boolean, got string',
    );
  });

  it('rejects a non-positive obstacle height', () => {
    for (const height of [0, -1]) {
      const data = clone();
      data['obstacles'] = [
        { type: 'circle', x: 0, y: 0, r: 1, height, blocksProjectiles: true },
      ];
      expect(() => parseArenaDef(data)).toThrow('obstacles[0].height: expected a number above 0');
    }
  });

  it('rejects a non-positive ring damagePerSecond', () => {
    for (const damagePerSecond of [0, -5]) {
      const data = clone();
      data['ring'] = { startRadius: 18, endRadius: 3, damagePerSecond };
      expect(() => parseArenaDef(data)).toThrow('ring.damagePerSecond: expected a number above 0');
    }
  });

  it('rejects a ring radius at or below 0 or above the arena bound, with the full message', () => {
    const cases: [number, number, string][] = [
      [0, 3, 'Invalid arena definition: ring.startRadius: expected a number above 0'],
      [18, 0, 'Invalid arena definition: ring.endRadius: expected a number above 0'],
      [1e6 + 1, 3, 'Invalid arena definition: ring.startRadius: expected a number at most 1000000'],
      [18, 1e6 + 1, 'Invalid arena definition: ring.endRadius: expected a number at most 1000000'],
    ];
    for (const [startRadius, endRadius, message] of cases) {
      const data = clone();
      data['ring'] = { startRadius, endRadius, damagePerSecond: 10 };
      expect(() => parseArenaDef(data)).toThrow(message);
    }
  });

  it('rejects an end radius that is not below the start radius', () => {
    for (const endRadius of [18, 19]) {
      const data = clone();
      data['ring'] = { startRadius: 18, endRadius, damagePerSecond: 10 };
      expect(() => parseArenaDef(data)).toThrow(
        'Invalid arena definition: ring.endRadius: expected a number below ring.startRadius',
      );
    }
  });

  it('accepts a start radius of exactly the arena bound', () => {
    const data = clone();
    data['ring'] = { startRadius: 1e6, endRadius: 3, damagePerSecond: 10 };
    expect(parseArenaDef(data).ring.startRadius).toBe(1e6);
  });

  it('parses a -0 coordinate as +0', () => {
    const data = JSON.parse(
      JSON.stringify(arena01).replace('"x":0,"y":0,"r":1.5', '"x":-0,"y":-0,"r":1.5'),
    ) as Record<string, unknown>;
    const parsed = parseArenaDef(data);
    const first = parsed.obstacles[0];
    expect(Object.is(first?.x, 0)).toBe(true);
    expect(Object.is(first?.y, 0)).toBe(true);
  });

  it('rejects a size above the arena bound and names the path', () => {
    const data = clone();
    data['size'] = { width: 1e6 + 1, height: 20 };
    expect(() => parseArenaDef(data)).toThrow(
      'Invalid arena definition: size.width: expected a number at most 1000000',
    );
    data['size'] = { width: 30, height: 1e300 };
    expect(() => parseArenaDef(data)).toThrow(
      'Invalid arena definition: size.height: expected a number at most 1000000',
    );
  });

  it('rejects a spawn coordinate beyond the arena bound in either sign', () => {
    for (const value of [1e6 + 1, -1e6 - 1]) {
      const data = clone();
      data['spawns'] = { teamA: [[value, 0]], teamB: [[0, value]] };
      expect(() => parseArenaDef(data)).toThrow(
        'Invalid arena definition: spawns.teamA[0][0]: expected a number with magnitude at most 1000000',
      );
      data['spawns'] = { teamA: [[0, 0]], teamB: [[0, value]] };
      expect(() => parseArenaDef(data)).toThrow(
        'Invalid arena definition: spawns.teamB[0][1]: expected a number with magnitude at most 1000000',
      );
    }
  });

  it('rejects an obstacle x, y, r, w or h beyond the arena bound', () => {
    const over = 1e6 + 1;
    const circle = (fields: Record<string, number>) => ({
      type: 'circle', x: 0, y: 0, r: 1, height: 1, blocksProjectiles: true, ...fields,
    });
    const rect = (fields: Record<string, number>) => ({
      type: 'rect', x: 0, y: 0, w: 1, h: 1, height: 1, blocksProjectiles: true, ...fields,
    });
    const cases: [unknown, string][] = [
      [circle({ x: over }), 'obstacles[0].x: expected a number with magnitude at most 1000000'],
      [circle({ y: -over }), 'obstacles[0].y: expected a number with magnitude at most 1000000'],
      [circle({ r: over }), 'obstacles[0].r: expected a number at most 1000000'],
      [rect({ x: -over }), 'obstacles[0].x: expected a number with magnitude at most 1000000'],
      [rect({ y: over }), 'obstacles[0].y: expected a number with magnitude at most 1000000'],
      [rect({ w: over }), 'obstacles[0].w: expected a number at most 1000000'],
      [rect({ h: over }), 'obstacles[0].h: expected a number at most 1000000'],
    ];
    for (const [obstacle, message] of cases) {
      const data = clone();
      data['obstacles'] = [obstacle];
      expect(() => parseArenaDef(data), message).toThrow(
        `Invalid arena definition: ${message}`,
      );
    }
  });

  it('accepts values exactly at the arena bound', () => {
    expect(MAX_ARENA_METERS).toBe(1e6);
    const data = clone();
    data['size'] = { width: 1e6, height: 1e6 };
    data['spawns'] = { teamA: [[-1e6, 1e6]], teamB: [[1e6, -1e6]] };
    data['obstacles'] = [
      { type: 'circle', x: 1e6, y: -1e6, r: 1e6, height: 1, blocksProjectiles: true },
      { type: 'rect', x: -1e6, y: 1e6, w: 1e6, h: 1e6, height: 1, blocksProjectiles: false },
    ];
    const parsed = parseArenaDef(data);
    expect(parsed.size).toEqual({ width: 1e6, height: 1e6 });
    expect(parsed.spawns.teamA).toEqual([[-1e6, 1e6]]);
    expect(parsed.obstacles).toHaveLength(2);
  });
});
