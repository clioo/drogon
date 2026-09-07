// Renderer settings store for the V2 settings UX. Implements the frozen
// SP-contract distinctions from docs/migration/parity-settings-persistence-contracts.md:
// ordered precedence defaults < persisted < migration < launchOverride, where
// explicit false, absent and migration stamps are different states; 1s save
// debounce with a 5s maximum pending delay; storage reads/writes are guarded
// (no durability or encryption promise).
//
// Scope: the initial UI-chrome subset only. Anchored to the frozen catalog
// docs/migration/parity-settings-properties.json (schema
// drogon.parity-settings-properties/2): `theme` is declared
// 'system' | 'dark' | 'light' with builder default 'system'. `inspectorVisible`
// and `locale` are provisional renderer keys (the catalog has no inspector
// field; `uiLanguage` exists but its locale mapping is unverified). The
// catalog's statusNote: per-field UI mapping for the full 214-field catalog is
// unverified — do NOT claim full closure from this file.
//
// Extension point for the remaining catalog fields: extend SettingsSubset and
// SETTINGS_DEFAULTS (anchor each default to the catalog builder default), add
// one field guard in parsePersistedSettings, and mirror it in serializeState
// if it needs more than plain JSON. mergeSettingLayers, the debounce and the
// storage key need no changes.

export type Theme = "system" | "dark" | "light";
export type SettingsSubset = {
  theme: Theme;
  inspectorVisible: boolean;
  locale: string;
};

/** localStorage shape the store needs; injectable for tests and alternative stores. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const SETTINGS_DEFAULTS: SettingsSubset = {
  theme: "system",
  inspectorVisible: true,
  locale: "en",
};

const DEBOUNCE_MS = 1000;
const MAX_PENDING_MS = 5000;

export function settingsStorageKey(namespace: string): string {
  return `drogon:settings:${namespace}`;
}
/**
 * Applies layers in order; a key that is absent (undefined) in an upper layer
 * never overrides lower layers, so an explicit false survives migrations that
 * leave the key untouched.
 */
export function mergeSettingLayers(input: {
  defaults: SettingsSubset;
  persisted?: Partial<SettingsSubset> | null;
  migration?: Partial<SettingsSubset> | null;
  launchOverride?: Partial<SettingsSubset> | null;
}): SettingsSubset {
  const merged: SettingsSubset = { ...input.defaults };
  const record = merged as Record<keyof SettingsSubset, unknown>;
  for (const layer of [
    input.persisted,
    input.migration,
    input.launchOverride,
  ]) {
    if (!layer) continue;
    for (const key of Object.keys(merged) as (keyof SettingsSubset)[]) {
      const value = layer[key];
      if (value !== undefined) record[key] = value;
    }
  }
  return merged;
}

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "dark" || value === "light";
}

/**
 * Parses the persisted envelope { settings: {...} }. Anything malformed or
 * foreign (other schemas' envelopes, arrays, primitives) yields no overrides
 * instead of throwing; unknown or wrongly typed fields inside the envelope are
 * dropped individually.
 */
export function parsePersistedSettings(
  raw: string | null | undefined,
): Partial<SettingsSubset> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const settings = (parsed as { settings?: unknown }).settings;
    if (
      typeof settings !== "object" ||
      settings === null ||
      Array.isArray(settings)
    )
      return {};
    const candidate = settings as Record<string, unknown>;
    const out: Partial<SettingsSubset> = {};
    if (isTheme(candidate.theme)) out.theme = candidate.theme;
    if (typeof candidate.inspectorVisible === "boolean")
      out.inspectorVisible = candidate.inspectorVisible;
    if (typeof candidate.locale === "string" && candidate.locale.length > 0)
      out.locale = candidate.locale;
    return out;
  } catch {
    return {};
  }
}

/** Small typed store: get/set with defaults, persisted state, migrations and launch overrides; debounced guarded saves. */
export class SettingsStore {
  #storage: StorageLike;
  #key: string;
  #state: SettingsSubset;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #firstPendingAt: number | null = null;

  constructor(
    storage: StorageLike,
    options: {
      namespace: string;
      defaults?: SettingsSubset;
      migration?: Partial<SettingsSubset>;
      launchOverride?: Partial<SettingsSubset>;
    },
  ) {
    this.#storage = storage;
    this.#key = settingsStorageKey(options.namespace);
    let persisted: Partial<SettingsSubset> = {};
    try {
      persisted = parsePersistedSettings(storage.getItem(this.#key));
    } catch {
      persisted = {};
    }
    this.#state = mergeSettingLayers({
      defaults: options.defaults ?? SETTINGS_DEFAULTS,
      persisted,
      migration: options.migration,
      launchOverride: options.launchOverride,
    });
  }

  get<K extends keyof SettingsSubset>(key: K): SettingsSubset[K] {
    return this.#state[key];
  }

  /** Updates in-memory state, returns it, and schedules a debounced save (1s, at most 5s pending). */
  set<K extends keyof SettingsSubset>(
    key: K,
    value: SettingsSubset[K],
  ): SettingsSubset {
    this.#state = { ...this.#state, [key]: value };
    const now = Date.now();
    if (this.#firstPendingAt === null) this.#firstPendingAt = now;
    const delay = Math.min(DEBOUNCE_MS, MAX_PENDING_MS - (now - this.#firstPendingAt));
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), Math.max(0, delay));
    return this.#state;
  }

  /** Writes immediately and clears the pending window. Storage failures are swallowed; in-memory state stays authoritative. */
  flush(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#firstPendingAt = null;
    try {
      this.#storage.setItem(this.#key, JSON.stringify({ settings: this.#state }));
    } catch {
      // Storage unavailable: keep serving in-memory state; no durability promise.
    }
  }
}
