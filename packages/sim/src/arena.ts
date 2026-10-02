import { MAX_ARENA_METERS } from './constants';

export type SpawnPoint = [number, number];

export interface CircleObstacle {
  type: 'circle';
  x: number;
  y: number;
  r: number;
  height: number;
  blocksProjectiles: boolean;
}

export interface RectObstacle {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  height: number;
  blocksProjectiles: boolean;
}

export type Obstacle = CircleObstacle | RectObstacle;

export interface ArenaDef {
  id: string;
  name: string;
  size: { width: number; height: number };
  spawns: { teamA: SpawnPoint[]; teamB: SpawnPoint[] };
  obstacles: Obstacle[];
  ring: { startRadius: number; endRadius: number; damagePerSecond: number };
}

type JsonObject = Record<string, unknown>;

function fail(path: string, problem: string): never {
  throw new Error(`Invalid arena definition: ${path}: ${problem}`);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function child(path: string, key: string): string {
  return path === '(root)' ? key : `${path}.${key}`;
}

function readObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, `expected an object, got ${describeType(value)}`);
  }
  return value as JsonObject;
}

function readField(obj: JsonObject, key: string, path: string): unknown {
  const value = obj[key];
  if (value === undefined) return fail(child(path, key), 'missing');
  return value;
}

/**
 * `bounded` keeps a size, a coordinate or an obstacle dimension within `MAX_ARENA_METERS`, so that
 * the sums and products the sim forms from them (a teleport spanning the arena, a sweep square)
 * stay far from overflow.
 */
function readNumber(value: unknown, path: string, positive = false, bounded = false): number {
  if (typeof value !== 'number') {
    return fail(path, `expected a number, got ${describeType(value)}`);
  }
  if (!Number.isFinite(value)) return fail(path, 'expected a number, got a non-finite value');
  if (positive && value <= 0) return fail(path, 'expected a number above 0');
  if (bounded && Math.abs(value) > MAX_ARENA_METERS) {
    return fail(
      path,
      positive
        ? `expected a number at most ${MAX_ARENA_METERS}`
        : `expected a number with magnitude at most ${MAX_ARENA_METERS}`,
    );
  }
  // JSON.parse('-0') gives -0, which would not survive a JSON round trip of the state.
  return value + 0;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    return fail(path, `expected a string, got ${describeType(value)}`);
  }
  return value;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    return fail(path, `expected a boolean, got ${describeType(value)}`);
  }
  return value;
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return fail(path, `expected an array, got ${describeType(value)}`);
  return value;
}

function readPoint(value: unknown, path: string): SpawnPoint {
  const arr = readArray(value, path);
  if (arr.length !== 2) return fail(path, `expected 2 numbers, got ${arr.length}`);
  return [
    readNumber(arr[0], `${path}[0]`, false, true),
    readNumber(arr[1], `${path}[1]`, false, true),
  ];
}

function readPoints(value: unknown, path: string): SpawnPoint[] {
  return readArray(value, path).map((p, i) => readPoint(p, `${path}[${i}]`));
}

function readObstacle(value: unknown, path: string): Obstacle {
  const obj = readObject(value, path);
  const type = readField(obj, 'type', path);
  const num = (key: string, positive = false, bounded = false) =>
    readNumber(readField(obj, key, path), child(path, key), positive, bounded);
  const common = () => ({
    height: num('height', true),
    blocksProjectiles: readBoolean(
      readField(obj, 'blocksProjectiles', path),
      child(path, 'blocksProjectiles'),
    ),
  });
  if (type === 'circle') {
    return {
      type,
      x: num('x', false, true),
      y: num('y', false, true),
      r: num('r', true, true),
      ...common(),
    };
  }
  if (type === 'rect') {
    return {
      type,
      x: num('x', false, true),
      y: num('y', false, true),
      w: num('w', true, true),
      h: num('h', true, true),
      ...common(),
    };
  }
  return fail(child(path, 'type'), `unknown obstacle type ${JSON.stringify(type)}`);
}

export function parseArenaDef(data: unknown): ArenaDef {
  const root = readObject(data, '(root)');

  const size = readObject(readField(root, 'size', '(root)'), 'size');
  const spawns = readObject(readField(root, 'spawns', '(root)'), 'spawns');
  const ring = readObject(readField(root, 'ring', '(root)'), 'ring');
  const obstacles = readArray(readField(root, 'obstacles', '(root)'), 'obstacles');

  return {
    id: readString(readField(root, 'id', '(root)'), 'id'),
    name: readString(readField(root, 'name', '(root)'), 'name'),
    size: {
      width: readNumber(readField(size, 'width', 'size'), 'size.width', true, true),
      height: readNumber(readField(size, 'height', 'size'), 'size.height', true, true),
    },
    spawns: {
      teamA: readPoints(readField(spawns, 'teamA', 'spawns'), 'spawns.teamA'),
      teamB: readPoints(readField(spawns, 'teamB', 'spawns'), 'spawns.teamB'),
    },
    obstacles: obstacles.map((o, i) => readObstacle(o, `obstacles[${i}]`)),
    ring: {
      startRadius: readNumber(readField(ring, 'startRadius', 'ring'), 'ring.startRadius'),
      endRadius: readNumber(readField(ring, 'endRadius', 'ring'), 'ring.endRadius'),
      damagePerSecond: readNumber(
        readField(ring, 'damagePerSecond', 'ring'),
        'ring.damagePerSecond',
        true,
      ),
    },
  };
}
