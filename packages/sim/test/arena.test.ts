import { describe, expect, it } from 'vitest';
import arena01 from '../../../data/arenas/arena01.json';
import { parseArenaDef } from '../src/index';

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
});
