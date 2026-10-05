import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CHAMPION_URL, arenaModelUrl, championModelUrl } from './models';
import { ROSTER_IDS } from './roster';

const assetsDir = fileURLToPath(new URL('../../../assets/', import.meta.url));

describe('model urls', () => {
  it('builds the arena url from the id', () => {
    expect(arenaModelUrl('arena01')).toBe('models/arenas/arena01.glb');
  });

  it('has no leading slash, so the build works under a subdirectory', () => {
    expect(arenaModelUrl('arena01').startsWith('/')).toBe(false);
    expect(PLACEHOLDER_CHAMPION_URL.startsWith('/')).toBe(false);
  });

  it('points at files that exist under assets/', () => {
    expect(existsSync(assetsDir + arenaModelUrl('arena01'))).toBe(true);
    expect(existsSync(assetsDir + PLACEHOLDER_CHAMPION_URL)).toBe(true);
  });

  it('gives every roster id its own champion model, in a file that exists', () => {
    for (const id of ROSTER_IDS) {
      expect(championModelUrl(id)).toBe(`models/champions/${id}.glb`);
      expect(existsSync(assetsDir + championModelUrl(id)), id).toBe(true);
    }
  });

  it('falls back to the placeholder by id, not by a failed load', () => {
    expect(championModelUrl('placeholder')).toBe(PLACEHOLDER_CHAMPION_URL);
    expect(championModelUrl('nobody')).toBe(PLACEHOLDER_CHAMPION_URL);
    expect(championModelUrl('')).toBe(PLACEHOLDER_CHAMPION_URL);
    expect(championModelUrl('constructor')).toBe(PLACEHOLDER_CHAMPION_URL);
  });

  it('has no leading slash in any champion url', () => {
    for (const id of [...ROSTER_IDS, 'nobody']) expect(championModelUrl(id).startsWith('/')).toBe(false);
  });
});
