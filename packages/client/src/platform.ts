import { DEFAULT_BINDINGS, parseBindings, type Bindings } from './bindings';

/** What the platform stores. Only the key bindings so far; `version` is the schema. */
export interface Settings {
  version: 1;
  bindings: Bindings;
}

/**
 * The part of the platform interface that is built (spec section 5, client.md).
 * `identity`, `unlockAchievement` and `openUrl` join with their first user. The
 * methods are asynchronous so an Electron renderer can reach files over IPC with
 * no change of signature (milestone 8).
 */
export interface Platform {
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
}

/** The part of `localStorage` the browser platform uses, so a test passes its own. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'claudeline-champions.settings';

function defaults(): Settings {
  return { version: 1, bindings: DEFAULT_BINDINGS };
}

/**
 * Reads the stored text. Anything unusable reads as the defaults, whole: no text,
 * bad JSON, a version other than exactly the number 1, or bindings that
 * `parseBindings` refuses. JSON.parse makes `__proto__` an own property, so no
 * inherited key can stand in for a field.
 */
export function readSettings(text: string | null): Settings {
  if (text === null) return defaults();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return defaults();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults();
  if ((value as { version: unknown }).version !== 1) return defaults();
  const bindings = parseBindings((value as { bindings: unknown }).bindings);
  return bindings === undefined ? defaults() : { version: 1, bindings };
}

/**
 * The browser's platform: the settings are one JSON text in the storage.
 * Without a storage (a browser that denies it) the defaults load and a save does
 * nothing. A storage that throws never fails the game: a read gives the defaults,
 * and a write warns on the console (a console error would fail every e2e spec).
 */
export function createBrowserPlatform(storage: SettingsStorage | undefined): Platform {
  return {
    loadSettings(): Promise<Settings> {
      let text: string | null;
      try {
        text = storage?.getItem(SETTINGS_KEY) ?? null;
      } catch {
        text = null;
      }
      return Promise.resolve(readSettings(text));
    },
    saveSettings(settings: Settings): Promise<void> {
      try {
        storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (error) {
        console.warn('the settings were not saved', error);
      }
      return Promise.resolve();
    },
  };
}
