// The Hargrim, Quillon and Lumeth kit files as the unit tests load them. main.ts reads the whole
// data/kits folder with import.meta.glob instead, which tsconfig.tools.json
// (types: node) would reject in any module a test imports. A test-only module:
// main.ts never imports it, so it is not in the bundle.
import type { KitDef } from '@claudeline/sim';
import hargrimJson from '../../../data/kits/hargrim.json';
import lumethJson from '../../../data/kits/lumeth.json';
import quillonJson from '../../../data/kits/quillon.json';
import skerrowJson from '../../../data/kits/skerrow.json';

// createMatch validates a kit, so the cast needs no check of its own.
export const HARGRIM_KIT = hargrimJson as unknown as KitDef;
export const QUILLON_KIT = quillonJson as unknown as KitDef;
// Not in TEST_KITS, so the 2v2 tests keep their kits: only the 3v3 roster has a Lumeth. A test that
// plays that roster passes `[...TEST_KITS, LUMETH_KIT]`, since createMatch accepts a champion with
// no kit and a missing one would quietly play a Lumeth with no abilities.
export const LUMETH_KIT = lumethJson as unknown as KitDef;
// Not in TEST_KITS either: the only champion with a silence (Quiet Dart, Q). hud-scene.test.ts plays
// the roster with a Skerrow that has her kit, so the local champion can be silenced.
export const SKERROW_KIT = skerrowJson as unknown as KitDef;
export const TEST_KITS: readonly KitDef[] = [HARGRIM_KIT, QUILLON_KIT];
