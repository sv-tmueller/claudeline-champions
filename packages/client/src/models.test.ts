import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CHAMPION_URL, arenaModelUrl } from './models';

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
});
