import { describe, expect, test, vi, afterEach } from "vitest";
import { resolvePaletteFocusRestoreTarget } from "./focus-restore";
import { capPaletteSection, PALETTE_SECTION_RENDER_CAP } from "./render-cap";
import type { StorageLike } from "../../settings-store";
import {
  loadRecentCommands,
  MAX_RECENT_COMMANDS,
  recordRecentCommand,
} from "./recent-commands";

function memoryStorage(seed?: Record<string, string>): StorageLike {
  const store = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("resolvePaletteFocusRestoreTarget", () => {
  // Node has no DOM: stub the global the port checks against and hand back
  // real instances of it from the fake document.
  const StubElement = class {};
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("prefers the element focused before the palette opened", () => {
    const preferred = { isConnected: true } as unknown as HTMLElement;
    const doc = {
      querySelector: () => ({}) as unknown as Element,
    } as unknown as Document;
    expect(resolvePaletteFocusRestoreTarget(preferred, doc)).toBe(preferred);
  });

  test("a disconnected preferred target falls back to the terminal", () => {
    vi.stubGlobal("HTMLElement", StubElement);
    const xterm = new StubElement() as unknown as Element;
    const doc = {
      querySelector: (selector: string) =>
        selector === ".xterm-helper-textarea" ? xterm : null,
    } as unknown as Document;
    expect(
      resolvePaletteFocusRestoreTarget(
        { isConnected: false } as unknown as HTMLElement,
        doc,
      ),
    ).toBe(xterm);
  });

  test("falls through to the editor textarea, then null", () => {
    vi.stubGlobal("HTMLElement", StubElement);
    const empty = { querySelector: () => null } as unknown as Document;
    expect(resolvePaletteFocusRestoreTarget(null, empty)).toBeNull();
    const monaco = new StubElement() as unknown as Element;
    const editorOnly = {
      querySelector: (selector: string) =>
        selector === ".monaco-editor textarea" ? monaco : null,
    } as unknown as Document;
    expect(resolvePaletteFocusRestoreTarget(null, editorOnly)).toBe(monaco);
  });
});

describe("capPaletteSection", () => {
  test("short lists pass through with zero overflow", () => {
    expect(capPaletteSection(["a", "b"], 50)).toEqual({
      visible: ["a", "b"],
      overflowCount: 0,
    });
  });

  test("long lists are sliced at the cap with an overflow count", () => {
    const items = Array.from({ length: 61 }, (_, i) => `item-${i}`);
    const { visible, overflowCount } = capPaletteSection(items);
    expect(visible).toHaveLength(PALETTE_SECTION_RENDER_CAP);
    expect(visible[0]).toBe("item-0");
    expect(overflowCount).toBe(61 - PALETTE_SECTION_RENDER_CAP);
  });

  test("a non-finite or negative cap never drops rows", () => {
    const items = ["a", "b"];
    expect(capPaletteSection(items, Number.NaN).overflowCount).toBe(0);
    expect(capPaletteSection(items, -1).visible).toEqual(items);
  });
});

describe("recent commands persistence", () => {
  test("empty or malformed storage loads as no recents", () => {
    expect(loadRecentCommands(memoryStorage())).toEqual([]);
    expect(
      loadRecentCommands(memoryStorage({ "drogon:settings:palette": "not-json{{{" })),
    ).toEqual([]);
    expect(
      loadRecentCommands(
        memoryStorage({
          "drogon:settings:palette": JSON.stringify({ settings: { recentCommandIds: [1, null, "ok"] } }),
        }),
      ),
    ).toEqual(["ok"]);
  });

  test("recording is most-recent-first, deduped and capped", () => {
    const storage = memoryStorage();
    recordRecentCommand(storage, "a");
    recordRecentCommand(storage, "b");
    expect(loadRecentCommands(storage)).toEqual(["b", "a"]);
    recordRecentCommand(storage, "a");
    expect(loadRecentCommands(storage)).toEqual(["a", "b"]);
    for (let i = 0; i < MAX_RECENT_COMMANDS + 4; i += 1)
      recordRecentCommand(storage, `cmd-${i}`);
    const loaded = loadRecentCommands(storage);
    expect(loaded).toHaveLength(MAX_RECENT_COMMANDS);
    expect(loaded[0]).toBe(`cmd-${MAX_RECENT_COMMANDS + 3}`);
  });

  test("a throwing store still returns the in-memory order", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(recordRecentCommand(storage, "theme.dark")).toEqual([
      "theme.dark",
    ]);
  });
});
