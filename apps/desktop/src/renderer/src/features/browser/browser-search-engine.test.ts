// Default search-engine preference: persisted engine wins, garbage or
// absent values fall back to google.
import { describe, expect, test } from "vitest";
import {
  DEFAULT_SEARCH_ENGINE,
  readBrowserSearchEngine,
  writeBrowserSearchEngine,
} from "./browser-search-engine";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const backing = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
    clear: () => backing.clear(),
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() {
      return backing.size;
    },
  };
}

describe("browser search engine preference", () => {
  test("absent or invalid values fall back to the google default", () => {
    expect(DEFAULT_SEARCH_ENGINE).toBe("google");
    expect(readBrowserSearchEngine(memoryStorage())).toBe("google");
    expect(readBrowserSearchEngine(memoryStorage({ "drogon:browser:search-engine": "yahoo" }))).toBe(
      "google",
    );
  });

  test("a written engine round-trips", () => {
    const storage = memoryStorage();
    writeBrowserSearchEngine("duckduckgo", storage);
    expect(readBrowserSearchEngine(storage)).toBe("duckduckgo");
    writeBrowserSearchEngine("bing", storage);
    expect(readBrowserSearchEngine(storage)).toBe("bing");
  });
});
