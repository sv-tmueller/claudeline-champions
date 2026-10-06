import type { ArenaDef } from '@claudeline/sim';

/**
 * The arena with the id. The launch only ever names an id from the loaded list,
 * so a missing one is a defect and throws, as the kit lookup of match-setup does.
 */
export function arenaById(arenas: readonly ArenaDef[], id: string): ArenaDef {
  const arena = arenas.find((candidate) => candidate.id === id);
  if (!arena) throw new Error(`the arena "${id}" is not loaded`);
  return arena;
}
