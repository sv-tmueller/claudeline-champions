import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, type Bindings } from './bindings';
import { SETTINGS_KEY, createBrowserPlatform, readSettings, type Settings } from './platform';

const CUSTOM: Bindings = { ...DEFAULT_BINDINGS, right: 'KeyL', Q: 'KeyT' };
const DEFAULTS: Settings = { version: 1, bindings: DEFAULT_BINDINGS };

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

function text(version: unknown, bindings: unknown): string {
  return JSON.stringify({ version, bindings });
}

describe('readSettings', () => {
  it('reads what the platform writes, whole', () => {
    expect(readSettings(text(1, CUSTOM))).toEqual({ version: 1, bindings: CUSTOM });
  });

  it('reads the defaults when nothing is stored', () => {
    expect(readSettings(null)).toEqual(DEFAULTS);
  });

  it.each(['', '{', 'not json', 'null', '7', '"text"', '[]', '[1]'])('reads the defaults for the text %j', (bad) => {
    expect(readSettings(bad)).toEqual(DEFAULTS);
  });

  it.each([0, 2, '1', null, true, 1.5])('reads the defaults for the version %j', (version) => {
    expect(readSettings(text(version, CUSTOM))).toEqual(DEFAULTS);
  });

  it('reads the defaults when the version is missing', () => {
    expect(readSettings(JSON.stringify({ bindings: CUSTOM }))).toEqual(DEFAULTS);
  });

  it.each(ACTIONS)('reads the defaults, not a merge, when %s is missing', (action) => {
    const rest: Record<string, string> = { ...CUSTOM };
    delete rest[action];
    expect(readSettings(text(1, rest))).toEqual(DEFAULTS);
  });

  it('reads the defaults when the bindings are not an object', () => {
    for (const bad of [null, 'KeyW', 7, [], ['KeyW']]) expect(readSettings(text(1, bad)), JSON.stringify(bad)).toEqual(DEFAULTS);
    expect(readSettings(JSON.stringify({ version: 1 }))).toEqual(DEFAULTS);
  });

  it('reads the defaults when two actions share a code', () => {
    expect(readSettings(text(1, { ...CUSTOM, up: 'KeyL' }))).toEqual(DEFAULTS);
  });

  it.each(['', 'Escape', 'Tab', 'F3', 'F4', 'ShiftLeft', 'ControlLeft', 'AltRight', 'MetaLeft'])(
    'reads the defaults when an action holds the reserved %j',
    (code) => {
      expect(readSettings(text(1, { ...CUSTOM, F: code }))).toEqual(DEFAULTS);
    },
  );

  it('reads the defaults when a code is not a string', () => {
    for (const bad of [7, null, true, ['KeyW'], { code: 'KeyW' }]) {
      expect(readSettings(text(1, { ...CUSTOM, E: bad })), JSON.stringify(bad)).toEqual(DEFAULTS);
    }
  });

  it('reads no inherited key as an action', () => {
    // JSON.parse makes "__proto__" an own property, so the actions are inherited, not stored.
    const inherited = `{"version":1,"bindings":{"__proto__":${JSON.stringify(CUSTOM)}}}`;
    expect(readSettings(inherited)).toEqual(DEFAULTS);
    const outer = `{"__proto__":{"version":1,"bindings":${JSON.stringify(CUSTOM)}}}`;
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
    await platform.saveSettings({ version: 1, bindings: CUSTOM });
    expect(await platform.loadSettings()).toEqual({ version: 1, bindings: CUSTOM });
    // A second platform on the same storage, as after a page reload.
    expect(await createBrowserPlatform(storage).loadSettings()).toEqual({ version: 1, bindings: CUSTOM });
  });

  it('saves under the settings key, as JSON carrying schema version 1', async () => {
    const { store, storage } = memory();
    await createBrowserPlatform(storage).saveSettings({ version: 1, bindings: CUSTOM });
    expect([...store.keys()]).toEqual([SETTINGS_KEY]);
    expect(SETTINGS_KEY).toBe('claudeline-champions.settings');
    expect(JSON.parse(store.get(SETTINGS_KEY) ?? 'null')).toEqual({ version: 1, bindings: CUSTOM });
  });

  it('loads the defaults from an empty store, and writes nothing', async () => {
    const { store, storage } = memory();
    expect(await createBrowserPlatform(storage).loadSettings()).toEqual(DEFAULTS);
    expect(store.size).toBe(0);
  });

  it('loads the defaults when the stored text is unusable', async () => {
    const { store, storage } = memory();
    store.set(SETTINGS_KEY, text(2, CUSTOM));
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
      await expect(platform.saveSettings({ version: 1, bindings: CUSTOM })).resolves.toBeUndefined();
    } finally {
      console.warn = warn;
    }
    expect(warnings).toHaveLength(1);
  });

  it('loads the defaults and saves nothing without a storage', async () => {
    const platform = createBrowserPlatform(undefined);
    expect(await platform.loadSettings()).toEqual(DEFAULTS);
    await expect(platform.saveSettings({ version: 1, bindings: CUSTOM })).resolves.toBeUndefined();
  });
});
