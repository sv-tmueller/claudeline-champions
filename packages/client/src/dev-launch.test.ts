import { describe, expect, it } from 'vitest';
import { MAX_TIME_SCALE, readDevLaunch } from './dev-launch';

describe('readDevLaunch', () => {
  it('reads no time scale as 1', () => {
    expect(readDevLaunch('')).toEqual({ timeScale: 1 });
    expect(readDevLaunch('?champion=quillon')).toEqual({ timeScale: 1 });
  });

  it('reads an integer from 1 to the maximum', () => {
    expect(readDevLaunch('?timescale=1').timeScale).toBe(1);
    expect(readDevLaunch('?timescale=100').timeScale).toBe(100);
    expect(readDevLaunch('timescale=7').timeScale).toBe(7);
    expect(readDevLaunch(`?timescale=${MAX_TIME_SCALE}`).timeScale).toBe(MAX_TIME_SCALE);
    expect(MAX_TIME_SCALE).toBe(200);
  });

  it('reads anything else as 1', () => {
    for (const bad of ['0', '-3', '1.5', '100.0', 'abc', '', '1e2', '0x10', ' 5', '201', '99999']) {
      expect(readDevLaunch(`?timescale=${bad}`).timeScale, bad).toBe(1);
    }
  });

  it('reads the scale next to the other launch parameters', () => {
    expect(readDevLaunch('?scene=sandbox&timescale=100&champion=quillon').timeScale).toBe(100);
  });
});
