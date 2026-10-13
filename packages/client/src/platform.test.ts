import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, type Bindings } from './bindings';
import { SETTINGS_KEY, createBrowserPlatform, readSettings, type Settings } from './platform';

const CUSTOM: Bindings = { ...DEFAULT_BINDINGS, right: 'KeyL', Q: 'KeyT' };
const DEFAULTS: Settings = { version: 2, bindings: DEFAULT_BINDINGS, muted: false };
const MUTED: Settings = { version: 2, bindings: CUSTOM, muted: true };

function memory(): { store: Map<string, string>; storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } } {
  const store = new Map<string, string>();
  return {
    store,
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
    },
  };
}

/** A stored text. `muted` is left out of the text when it is undefined, as a version 1 text has none. */
function text(version: unknown, bindings: unknown, muted?: unknown): string {
  return JSON.stringify({ version, bindings, muted });
}

describe('readSettings', () => {
  it('reads what the platform writes, whole', () => {
    expect(readSettings(text(2, CUSTOM, false))).toEqual({ version: 2, bindings: CUSTOM, muted: false });
    expect(readSettings(text(2, CUSTOM, true))).toEqual(MUTED);
  });

  it('migrates a version 1 text, keeping its bindings and reading sound as on', () => {
    expect(readSettings(text(1, CUSTOM))).toEqual({ version: 2, bindings: CUSTOM, muted: false });
  });

  it('reads the defaults for a version 1 text with unusable bindings', () => {
    expect(readSettings(text(1, { ...CUSTOM, up: 'KeyL' }))).toEqual(DEFAULTS);
  });

  it.each([undefined, 'true', 'false', 1, 0, null, [], {}])('reads the defaults, not the bindings, for a version 2 text with muted %j', (muted) => {
    expect(readSettings(text(2, CUSTOM, muted))).toEqual(DEFAULTS);
  });

  it('reads the defaults when nothing is stored', () => {
    expect(readSettings(null)).toEqual(DEFAULTS);
  });

  it.each(['', '{', 'not json', 'null', '7', '"text"', '[]', '[1]'])('reads the defaults for the text %j', (bad) => {
    expect(readSettings(bad)).toEqual(DEFAULTS);
  });

  it.each([0, 3, '1', '2', null, true, 1.5])('reads the defaults for the version %j', (version) => {
    expect(readSettings(text(version, CUSTOM, true))).toEqual(DEFAULTS);
  });

  it('reads the defaults when the version is missing', () => {
    expect(readSettings(JSON.stringify({ bindings: CUSTOM, muted: true }))).toEqual(DEFAULTS);
  });

  it.each(ACTIONS)('reads the defaults, not a merge, when %s is missing', (action) => {
    const rest: Record<string, string> = { ...CUSTOM };
    delete rest[action];
    expect(readSettings(text(2, rest, true))).toEqual(DEFAULTS);
    expect(readSettings(text(1, rest))).toEqual(DEFAULTS);
  });

  it('reads the defaults when the bindings are not an object', () => {
    for (const bad of [null, 'KeyW', 7, [], ['KeyW']]) expect(readSettings(text(2, bad, true)), JSON.stringify(bad)).toEqual(DEFAULTS);
    expect(readSettings(JSON.stringify({ version: 2, muted: true }))).toEqual(DEFAULTS);
    expect(readSettings(JSON.stringify({ version: 1 }))).toEqual(DEFAULTS);
  });

  it('reads the defaults when two actions share a code', () => {
    expect(readSettings(text(2, { ...CUSTOM, up: 'KeyL' }, true))).toEqual(DEFAULTS);
  });

  it.each(['', 'Escape', 'Tab', 'F3', 'F4', 'ShiftLeft', 'ControlLeft', 'AltRight', 'MetaLeft'])(
    'reads the defaults when an action holds the reserved %j',
    (code) => {
      expect(readSettings(text(2, { ...CUSTOM, F: code }, true))).toEqual(DEFAULTS);
    },
  );

  it('reads the defaults when a code is not a string', () => {
    for (const bad of [7, null, true, ['KeyW'], { code: 'KeyW' }]) {
      expect(readSettings(text(2, { ...CUSTOM, E: bad }, true)), JSON.stringify(bad)).toEqual(DEFAULTS);
    }
  });

  it('reads no inherited key as an action or as muted', () => {
    // JSON.parse makes "__proto__" an own property, so the fields are inherited, not stored.
    const inherited = `{"version":2,"muted":true,"bindings":{"__proto__":${JSON.stringify(CUSTOM)}}}`;
    expect(readSettings(inherited)).toEqual(DEFAULTS);
    const outer = `{"__proto__":{"version":2,"muted":true,"bindings":${JSON.stringify(CUSTOM)}}}`;
    expect(readSettings(outer)).toEqual(DEFAULTS);
  });

  it('reads the defaults as the shared DEFAULT_BINDINGS set', () => {
    expect(readSettings(null).bindings).toBe(DEFAULT_BINDINGS);
  });
});

describe('the browser platform', () => {
  it('loads what it saved', async () => {
    const { storage } = memory();
    const platform = createBrowserPlatform(storage);
    await platform.saveSettings(MUTED);
    expect(await platform.loadSettings()).toEqual(MUTED);
    // A second platform on the same storage, as after a page reload.
    expect(await createBrowserPlatform(storage).loadSettings()).toEqual(MUTED);
  });

  it('saves under the settings key, as JSON carrying schema version 2 and muted', async () => {
    const { store, storage } = memory();
    await createBrowserPlatform(storage).saveSettings(MUTED);
    expect([...store.keys()]).toEqual([SETTINGS_KEY]);
    expect(SETTINGS_KEY).toBe('claudeline-champions.settings');
    expect(JSON.parse(store.get(SETTINGS_KEY) ?? 'null')).toEqual({ version: 2, bindings: CUSTOM, muted: true });
  });

  it('loads a version 1 text as version 2 and writes nothing until the next change', async () => {
    const { store, storage } = memory();
    const old = text(1, CUSTOM);
    store.set(SETTINGS_KEY, old);
    expect(await createBrowserPlatform(storage).loadSettings()).toEqual({ version: 2, bindings: CUSTOM, muted: false });
    expect(store.get(SETTINGS_KEY)).toBe(old);
  });

  it('loads the defaults from an empty store, and writes nothing', async () => {
    const { store, storage } = memory();
    expect(await createBrowserPlatform(storage).loadSettings()).toEqual(DEFAULTS);
    expect(store.size).toBe(0);
  });

  it('loads the defaults when the stored text is unusable', async () => {
    const { store, storage } = memory();
    store.set(SETTINGS_KEY, text(3, CUSTOM, true));
    expect(await createBrowserPlatform(storage).loadSettings()).toEqual(DEFAULTS);
  });

  it('loads the defaults when reading throws', async () => {
    const platform = createBrowserPlatform({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
    });
    expect(await platform.loadSettings()).toEqual(DEFAULTS);
  });

  it('resolves when writing throws, and says so on the console', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      const platform = createBrowserPlatform({
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      });
      await expect(platform.saveSettings(MUTED)).resolves.toBeUndefined();
    } finally {
      console.warn = warn;
    }
    expect(warnings).toHaveLength(1);
  });

  it('loads the defaults and saves nothing without a storage', async () => {
    const platform = createBrowserPlatform(undefined);
    expect(await platform.loadSettings()).toEqual(DEFAULTS);
    await expect(platform.saveSettings(MUTED)).resolves.toBeUndefined();
  });
});
