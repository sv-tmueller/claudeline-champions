import type { GameState } from './state';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit over the UTF-16 code units of `text`, low byte first. */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME);
    if (unit > 0xff) hash = Math.imul(hash ^ (unit >>> 8), FNV_PRIME);
  }
  return hash >>> 0;
}

// Object keys are sorted so the result does not depend on property insertion
// order. Arrays keep index order. Anything that is not plain JSON throws, which
// also turns a NaN anywhere in the state into a loud failure.
function serialize(value: unknown, path: string): string {
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`checksum: non-finite number at ${path}`);
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      if (value === null) return 'null';
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => serialize(item, `${path}[${i}]`)).join(',')}]`;
      }
      const obj = value as Record<string, unknown>;
      const parts = Object.keys(obj)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(obj[key], `${path}.${key}`)}`);
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`checksum: unsupported ${typeof value} at ${path}`);
  }
}

export function checksum(state: GameState): number {
  return fnv1a32(serialize(state, 'state'));
}
