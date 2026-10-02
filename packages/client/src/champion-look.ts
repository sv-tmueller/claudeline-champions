import { Mesh, MeshBasicMaterial, type Material, type Object3D } from 'three';

export type LookMode = 'normal' | 'flash' | 'dead';

export const FLASH_COLOUR = '#ffffff';
export const DEAD_COLOUR = '#5a6070';
export const DEAD_OPACITY = 0.45;

/** A hit flash shows even on a champion that just died. */
export function lookMode(flashing: boolean, alive: boolean): LookMode {
  if (flashing) return 'flash';
  return alive ? 'normal' : 'dead';
}

interface Part {
  mesh: Mesh;
  original: Material | Material[];
}

/**
 * Swaps the materials of each champion view between its own, a white flash
 * and a faded grey. Champion clones share their materials, so the originals
 * are swapped back in and never edited.
 */
export class ChampionLooks {
  private readonly parts: Part[][] = [];
  private readonly modes: LookMode[] = [];
  private readonly flash = new MeshBasicMaterial({ color: FLASH_COLOUR });
  private readonly dead = new MeshBasicMaterial({
    color: DEAD_COLOUR,
    transparent: true,
    opacity: DEAD_OPACITY,
  });

  constructor(roots: readonly Object3D[]) {
    for (const root of roots) {
      const parts: Part[] = [];
      root.traverse((object) => {
        if (object instanceof Mesh) parts.push({ mesh: object, original: object.material });
      });
      this.parts.push(parts);
      this.modes.push('normal');
    }
  }

  /** Assigns materials only when the mode differs from the last one set. */
  set(index: number, mode: LookMode): void {
    const parts = this.parts[index];
    if (!parts || this.modes[index] === mode) return;
    this.modes[index] = mode;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as Part;
      part.mesh.material =
        mode === 'normal' ? part.original : mode === 'flash' ? this.flash : this.dead;
    }
  }
}

export function createChampionLooks(roots: readonly Object3D[]): ChampionLooks {
  return new ChampionLooks(roots);
}
