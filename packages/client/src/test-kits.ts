// The Hargrim and Quillon kit files as the unit tests load them. main.ts reads the whole
// data/kits folder with import.meta.glob instead, which tsconfig.tools.json
// (types: node) would reject in any module a test imports. A test-only module:
// main.ts never imports it, so it is not in the bundle.
import type { KitDef } from '@claudeline/sim';
import hargrimJson from '../../../data/kits/hargrim.json';
import quillonJson from '../../../data/kits/quillon.json';

// createMatch validates a kit, so the cast needs no check of its own.
export const HARGRIM_KIT = hargrimJson as unknown as KitDef;
export const QUILLON_KIT = quillonJson as unknown as KitDef;
export const TEST_KITS: readonly KitDef[] = [HARGRIM_KIT, QUILLON_KIT];
