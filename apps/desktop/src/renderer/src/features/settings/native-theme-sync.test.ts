// MIT Copyright (c) 2026 Lovecast Inc.
// Renderer nativeTheme sync (#241): System resolves from main's
// shouldUseDarkColors (not the possibly-stale media query), live OS updates
// re-apply, explicit choices keep winning through the single settings
// store, a choice reported by the section beats a stale persisted read, and
// an absent bridge is a no-op.
import { describe, expect, test, vi } from "vitest";
import {
  persistedTheme,
  reportThemeChoice,
  startNativeThemeSync,
} from "./native-theme-sync";
import type {
  NativeThemeBridge,
  NativeThemeState,
} from "../../../../shared/settings-contract";
import type { ThemeRoot } from "../../theme";

function fakeRoot(...initial: string[]) {
  const classes = new Set<string>(initial);
  const root = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
  } as ThemeRoot & { classList: { contains(name: string): boolean } };
  return { root, classes };
}

type Listener = (state: NativeThemeState) => void;

function fakeBridge(initial: NativeThemeState) {
  const listeners = new Set<Listener>();
  let state = initial;
  const bridge: NativeThemeBridge = {
    state: async () => state,
    setThemeSource: async (themeSource) => {
      state = { ...state, themeSource };
      return state;
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    bridge,
    emit(next: Partial<NativeThemeState>) {
      state = { ...state, ...next };
      for (const listener of listeners) listener(state);
    },
  };
}

function storageWithTheme(theme: unknown) {
  return {
    getItem: () => JSON.stringify({ settings: { theme } }),
  };
}

function sync(overrides: {
  bridge?: NativeThemeBridge;
  storage?: { getItem(key: string): string | null };
  getTheme?: () => "system" | "dark" | "light";
}) {
  const made = fakeRoot();
  const bridge =
    overrides.bridge ??
    fakeBridge({ shouldUseDarkColors: false, themeSource: "system" }).bridge;
  return {
    ...made,
    stop: startNativeThemeSync({
      bridge,
      readPersistedTheme:
        overrides.getTheme ??
        (() =>
          persistedTheme(
            overrides.storage ?? { getItem: () => null },
          )),
      root: made.root as ThemeRoot,
      storage: overrides.storage ?? { getItem: () => null },
    }),
    bridge,
  };
}

describe("persistedTheme", () => {
  test("reads the theme from the settings envelope", () => {
    expect(persistedTheme(storageWithTheme("dark"))).toBe("dark");
    expect(persistedTheme(storageWithTheme("system"))).toBe("system");
  });
  test("falls back to system for missing or malformed envelopes", () => {
    expect(persistedTheme({ getItem: () => null })).toBe("system");
    expect(persistedTheme({ getItem: () => "not json" })).toBe("system");
    expect(
      persistedTheme({ getItem: () => '{"settings":{"theme":"neon"}}' }),
    ).toBe("system");
  });
});

describe("startNativeThemeSync", () => {
  test("absent bridge is a no-op disposer", () => {
    const stop = startNativeThemeSync({});
    expect(() => stop()).not.toThrow();
  });

  test("boot pull resolves System from the native signal, not the media query", async () => {
    const made = sync({
      bridge: fakeBridge({
        shouldUseDarkColors: true,
        themeSource: "system",
      }).bridge,
    });
    await vi.waitFor(() => {
      expect(made.classes.has("dark")).toBe(true);
    });
    made.stop();
  });

  test("boot mirrors the persisted theme into themeSource", async () => {
    const made = fakeBridge({ shouldUseDarkColors: false, themeSource: "system" });
    const setThemeSource = vi.spyOn(made.bridge, "setThemeSource");
    const env = sync({
      bridge: made.bridge,
      storage: storageWithTheme("dark"),
    });
    await vi.waitFor(() => {
      expect(setThemeSource).toHaveBeenCalledWith("dark");
    });
    env.stop();
  });

  test("live OS updates re-apply the resolved theme both directions", async () => {
    const made = fakeBridge({ shouldUseDarkColors: false, themeSource: "system" });
    const env = sync({ bridge: made.bridge });
    await vi.waitFor(() => {
      expect(env.classes.has("dark")).toBe(false);
    });
    made.emit({ shouldUseDarkColors: true });
    await vi.waitFor(() => {
      expect(env.classes.has("dark")).toBe(true);
    });
    made.emit({ shouldUseDarkColors: false });
    await vi.waitFor(() => {
      expect(env.classes.has("dark")).toBe(false);
    });
    env.stop();
  });

  test("a reported explicit choice wins over the native scheme immediately", async () => {
    const made = fakeBridge({ shouldUseDarkColors: true, themeSource: "dark" });
    const env = sync({ bridge: made.bridge });
    await vi.waitFor(() => {
      expect(env.classes.has("dark")).toBe(true);
    });
    reportThemeChoice("light");
    expect(env.classes.has("dark")).toBe(false);
    // A later OS event keeps the explicit choice winning.
    made.emit({ shouldUseDarkColors: true });
    expect(env.classes.has("dark")).toBe(false);
    env.stop();
  });

  test("a reported System choice re-follows the native signal", async () => {
    const made = fakeBridge({ shouldUseDarkColors: true, themeSource: "system" });
    const env = sync({ bridge: made.bridge, getTheme: () => "light" });
    await vi.waitFor(() => {
      expect(env.classes.has("dark")).toBe(false);
    });
    reportThemeChoice("system");
    // currentTheme ("system") beats the stale injected persisted read.
    expect(env.classes.has("dark")).toBe(true);
    env.stop();
  });

  test("a rejected state pull leaves the root untouched", async () => {
    const failing: NativeThemeBridge = {
      state: async () => {
        throw new Error("down");
      },
      setThemeSource: async () => {
        throw new Error("down");
      },
      onChange: () => () => {},
    };
    const env = sync({ bridge: failing });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(env.classes.size).toBe(0);
    env.stop();
  });

  test("dispose stops applications from later events", async () => {
    const made = fakeBridge({ shouldUseDarkColors: false, themeSource: "system" });
    const env = sync({ bridge: made.bridge });
    env.stop();
    made.emit({ shouldUseDarkColors: true });
    expect(env.classes.has("dark")).toBe(false);
    reportThemeChoice("dark");
    expect(env.classes.has("dark")).toBe(false);
  });
});
