import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { loadRoomData } from '../src/data';

// The server is the authority on data (online design section 5, Lists): all kits sorted by id, the
// arenas through parseArenaDef, the roster and the listings with each arena's largest team size.

const repoData = new URL('../../../data/', import.meta.url);

function jsonNames(dir: string): string[] {
  return readdirSync(new URL(dir, repoData))
    .filter((name) => name.endsWith('.json'))
    .sort();
}

describe('loadRoomData on the shipped data', () => {
  const data = loadRoomData();

  it('holds every kit file, sorted by id, and the roster is their ids in that order', () => {
    const ids = jsonNames('kits/').map((name) => {
      const kit = JSON.parse(readFileSync(new URL(`kits/${name}`, repoData), 'utf8')) as { id: string };
      return kit.id;
    });
    expect(data.kits.map((k) => k.id)).toEqual([...ids].sort());
    expect(data.roster).toEqual(data.kits.map((k) => k.id));
    expect(data.roster.length).toBeGreaterThanOrEqual(4);
  });

  it('holds every arena file, sorted by id, with a listing each', () => {
    expect(data.arenas.map((a) => a.id)).toEqual(data.listings.map((l) => l.id));
    expect(data.arenas.length).toBe(jsonNames('arenas/').length);
    expect([...data.arenas.map((a) => a.id)].sort()).toEqual(data.arenas.map((a) => a.id));
    for (const listing of data.listings) {
      const arena = data.arenas.find((a) => a.id === listing.id);
      expect(listing.name).toBe(arena?.name);
      const spawns = Math.min(arena?.spawns.teamA.length ?? 0, arena?.spawns.teamB.length ?? 0);
      expect(listing.maxTeamSize).toBe(spawns >= 3 ? 3 : 2);
    }
  });
});

describe('loadRoomData on a data directory of its own', () => {
  function arenaFile(id: string, teamA: number, teamB: number): string {
    const base = JSON.parse(readFileSync(new URL('arenas/arena01.json', repoData), 'utf8')) as {
      id: string;
      name: string;
      spawns: { teamA: [number, number][]; teamB: [number, number][] };
    };
    const spawn = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [1 + i, 1]);
    return JSON.stringify({ ...base, id, name: `Arena ${id}`, spawns: { teamA: spawn(teamA), teamB: spawn(teamB) } });
  }

  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  function dataDir(): { root: URL; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), '167-data-'));
    made.push(dir);
    mkdirSync(join(dir, 'kits'));
    mkdirSync(join(dir, 'arenas'));
    const kit = JSON.parse(readFileSync(new URL('kits/hargrim.json', repoData), 'utf8')) as object;
    writeFileSync(join(dir, 'kits', 'b.json'), JSON.stringify({ ...kit, id: 'zeta' }));
    writeFileSync(join(dir, 'kits', 'a.json'), JSON.stringify({ ...kit, id: 'alpha' }));
    return { root: pathToFileURL(`${dir}/`), dir };
  }

  it('sorts by id rather than by file name, caps the team size at 3 and drops arenas under 2', () => {
    const { root, dir } = dataDir();
    writeFileSync(join(dir, 'arenas', 'a.json'), arenaFile('zz', 5, 4));
    writeFileSync(join(dir, 'arenas', 'b.json'), arenaFile('mm', 3, 2));
    writeFileSync(join(dir, 'arenas', 'c.json'), arenaFile('aa', 1, 3));
    writeFileSync(join(dir, 'arenas', 'd.json'), arenaFile('bb', 2, 2));
    const data = loadRoomData(root);
    expect(data.kits.map((k) => k.id)).toEqual(['alpha', 'zeta']);
    expect(data.roster).toEqual(['alpha', 'zeta']);
    expect(data.listings).toEqual([
      { id: 'bb', name: 'Arena bb', maxTeamSize: 2 },
      { id: 'mm', name: 'Arena mm', maxTeamSize: 2 },
      { id: 'zz', name: 'Arena zz', maxTeamSize: 3 },
    ]);
    expect(data.arenas.map((a) => a.id)).toEqual(['bb', 'mm', 'zz']);
  });

  it('refuses a data directory with no arena a team of two fits', () => {
    const { root, dir } = dataDir();
    writeFileSync(join(dir, 'arenas', 'a.json'), arenaFile('tiny', 1, 1));
    expect(() => loadRoomData(root)).toThrow(/arena/);
  });
});
