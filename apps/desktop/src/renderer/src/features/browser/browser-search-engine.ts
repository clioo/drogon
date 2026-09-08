// MIT Copyright (c) 2026 Lovecast Inc.
// Default search-engine preference for the browser address bar (journey
// J4). Ported seam from the Orca reference (read-only):
//   src/renderer/src/store slices ui.* (browserDefaultSearchEngine, null =
//   google) + src/renderer/src/components/settings/BrowserSearchEngineSetting.tsx
// Adapted: no zustand store and no Browser settings pane in this build, so
// the preference lives in the same localStorage envelope pattern as the
// other single-key browser preferences (browser-recent-urls.ts); the
// Settings row (features/settings/browser-search-engine-setting.tsx) and
// the address bar read/write through here so they can never diverge.

import {
  DEFAULT_SEARCH_ENGINE,
  SEARCH_ENGINE_LABELS,
  type SearchEngine,
} from "../../../../shared/browser-url";

export type { SearchEngine };
export { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINE_LABELS };

const STORAGE_KEY = "drogon:browser:search-engine";

const ENGINES: readonly SearchEngine[] = ["google", "duckduckgo", "bing", "kagi"];

export function isSearchEngine(value: unknown): value is SearchEngine {
  return (
    typeof value === "string" && (ENGINES as readonly string[]).includes(value)
  );
}

/** Engine list in the fork's settings order (SEARCH_ENGINE_LABELS keys). */
export function listSearchEngines(): SearchEngine[] {
  return [...ENGINES];
}

/** Reads the persisted engine; unknown/absent values fall back to google. */
export function readBrowserSearchEngine(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage !== "undefined"
    ? localStorage
    : undefined,
): SearchEngine {
  try {
    if (!storage) return DEFAULT_SEARCH_ENGINE;
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null && isSearchEngine(raw)) return raw;
  } catch {
    // Storage unavailable: the default still resolves every input.
  }
  return DEFAULT_SEARCH_ENGINE;
}

/** Persists the engine; storage failures are swallowed (default still applies). */
export function writeBrowserSearchEngine(
  engine: SearchEngine,
  storage: Pick<Storage, "setItem"> | undefined = typeof localStorage !== "undefined"
    ? localStorage
    : undefined,
): void {
  try {
    storage?.setItem(STORAGE_KEY, engine);
  } catch {
    // Best-effort preference write; the address bar keeps the default.
  }
}
