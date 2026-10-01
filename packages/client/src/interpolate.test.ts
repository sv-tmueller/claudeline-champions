import { describe, expect, it } from 'vitest';
import { capturePoses, createPoses, interpolatePoses, lerpAngle, type Pose } from './interpolate';

const DEG = Math.PI / 180;

function champion(x: number, y: number, facing: number): Pose {
  return { x, y, facing };
}

/** Compares two angles on the circle. */
function expectSameAngle(actual: number, expected: number): void {
  expect(Math.cos(actual)).toBeCloseTo(Math.cos(expected), 9);
  expect(Math.sin(actual)).toBeCloseTo(Math.sin(expected), 9);
}

describe('lerpAngle', () => {
  it('goes from 170 to -170 degrees through 180, not through 0', () => {
    const mid = lerpAngle(170 * DEG, -170 * DEG, 0.5);
    expect(Math.cos(mid)).toBeCloseTo(-1, 9);
    expect(Math.abs(Math.sin(mid))).toBeLessThan(1e-9);
  });

  it('goes from -170 to 170 degrees through 180 as well', () => {
    const mid = lerpAngle(-170 * DEG, 170 * DEG, 0.5);
    expect(Math.cos(mid)).toBeCloseTo(-1, 9);
  });

  it('puts a quarter of the 20 degree arc at 175 degrees', () => {
    expectSameAngle(lerpAngle(170 * DEG, -170 * DEG, 0.25), 175 * DEG);
  });

  it('goes from 0 to pi/2 through pi/4', () => {
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('returns the start at 0 and the end modulo 2 pi at 1', () => {
    expect(lerpAngle(3, -3, 0)).toBe(3);
    expectSameAngle(lerpAngle(3, -3, 1), -3);
    expect(lerpAngle(1, 1, 0.7)).toBeCloseTo(1, 12);
  });
});

describe('capturePoses', () => {
  it('copies the champion positions and facings', () => {
    const poses = createPoses(2);
    capturePoses([champion(1, 2, 0.5), champion(3, 4, -1)], poses);
    expect(poses).toEqual([champion(1, 2, 0.5), champion(3, 4, -1)]);
  });

  it('is unaffected by later champion changes and reuses its objects', () => {
    const poses = createPoses(1);
    const pose = poses[0];
    const champions = [champion(1, 2, 0.5)];
    capturePoses(champions, poses);
    champions[0] = champion(9, 9, 9);
    expect(poses[0]).toEqual(champion(1, 2, 0.5));
    capturePoses(champions, poses);
    expect(poses[0]).toBe(pose);
    expect(poses[0]).toEqual(champion(9, 9, 9));
  });

  it('keeps champion fields that are not poses out of the buffer', () => {
    const poses = createPoses(1);
    const withHealth = { ...champion(1, 2, 0.5), health: 7 };
    capturePoses([withHealth], poses);
    expect(Object.keys(poses[0] ?? {}).sort()).toEqual(['facing', 'x', 'y']);
  });
});

describe('interpolatePoses', () => {
  const previous = [champion(0, 0, 0), champion(10, -4, 170 * DEG)];
  const current = [champion(2, 6, Math.PI / 2), champion(12, -8, -170 * DEG)];

  it('equals the previous pose at alpha 0', () => {
    const out = createPoses(2);
    interpolatePoses(previous, current, 0, out);
    expect(out[0]).toEqual(previous[0]);
    expect(out[1]).toEqual(previous[1]);
  });

  it('is halfway at alpha 0.5, with facing along the shortest arc', () => {
    const out = createPoses(2);
    interpolatePoses(previous, current, 0.5, out);
    expect(out[0]?.x).toBeCloseTo(1, 12);
    expect(out[0]?.y).toBeCloseTo(3, 12);
    expect(out[0]?.facing).toBeCloseTo(Math.PI / 4, 12);
    expect(out[1]?.x).toBeCloseTo(11, 12);
    expect(out[1]?.y).toBeCloseTo(-6, 12);
    expect(Math.cos(out[1]?.facing ?? 0)).toBeCloseTo(-1, 9);
  });

  it('equals the current pose at alpha 1, facing modulo 2 pi', () => {
    const out = createPoses(2);
    interpolatePoses(previous, current, 1, out);
    for (const [i, pose] of out.entries()) {
      expect(pose.x).toBeCloseTo(current[i]?.x ?? NaN, 12);
      expect(pose.y).toBeCloseTo(current[i]?.y ?? NaN, 12);
      expectSameAngle(pose.facing, current[i]?.facing ?? NaN);
    }
  });

  it('writes into the given buffer without replacing its objects', () => {
    const out = createPoses(2);
    const first = out[0];
    interpolatePoses(previous, current, 0.5, out);
    expect(out[0]).toBe(first);
  });
});
