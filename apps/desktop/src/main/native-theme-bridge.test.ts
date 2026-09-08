// MIT Copyright (c) 2026 Lovecast Inc.
// nativeTheme relay seam (#241): a fake nativeTheme plus fake ipcMain/window
// script the whole bridge — state pull, themeSource mirror with validation,
// and the 'updated' broadcast — without a real Electron runtime.
import { describe, expect, test, vi } from "vitest";
import {
  installNativeThemeBridge,
  NATIVE_THEME_CHANGED_CHANNEL,
  NATIVE_THEME_SOURCE_CHANNEL,
  NATIVE_THEME_STATE_CHANNEL,
  type NativeThemeLike,
} from "./native-theme-bridge";

type HandleFn = (...args: unknown[]) => unknown;

type FakeNativeTheme = {
  theme: NativeThemeLike;
  emit: () => void;
};

function fakeNativeTheme(initial: {
  shouldUseDarkColors: boolean;
  themeSource: "system" | "dark" | "light";
}): FakeNativeTheme {
  const listeners = new Set<() => void>();
  const theme: NativeThemeLike = {
    shouldUseDarkColors: initial.shouldUseDarkColors,
    themeSource: initial.themeSource,
    on: vi.fn((_event: "updated", listener: () => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((_event: "updated", listener: () => void) => {
      listeners.delete(listener);
    }),
  };
  return { theme, emit: () => { for (const l of listeners) l(); } };
}

function fakeIpcMain() {
  const handlers = new Map<string, HandleFn>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: HandleFn) => {
      handlers.set(channel, handler);
    }),
  };
}

function install(overrides?: { fakeTheme?: FakeNativeTheme; getWindow?: () => unknown }) {
  const fake = overrides?.fakeTheme ?? fakeNativeTheme({ shouldUseDarkColors: false, themeSource: "system" });
  const ipc = fakeIpcMain();
  const sent: unknown[] = [];
  const win = {
    isDestroyed: () => false,
    webContents: { send: vi.fn((_channel: string, payload: unknown) => sent.push(payload)) },
  };
  const dispose = installNativeThemeBridge({
    nativeTheme: fake.theme,
    ipcMain: ipc as never,
    getWindow: (overrides?.getWindow ?? (() => win)) as never,
  });
  return { fake, theme: fake.theme, ipc, sent, win, dispose };
}

describe("nativeTheme bridge channels", () => {
  test("registers exactly the state and source channels", () => {
    const { ipc } = install();
    expect([...ipc.handlers.keys()].sort()).toEqual(
      [NATIVE_THEME_SOURCE_CHANNEL, NATIVE_THEME_STATE_CHANNEL].sort(),
    );
  });

  test("state reports shouldUseDarkColors and themeSource", () => {
    const { ipc, theme } = install({
      fakeTheme: fakeNativeTheme({ shouldUseDarkColors: true, themeSource: "dark" }),
    });
    expect(ipc.handlers.get(NATIVE_THEME_STATE_CHANNEL)!({})).toEqual({
      shouldUseDarkColors: true,
      themeSource: "dark",
    });
    expect(theme.themeSource).toBe("dark");
  });

  test("setThemeSource mirrors a valid choice and answers the fresh state", () => {
    const { ipc, theme } = install();
    const state = ipc.handlers.get(NATIVE_THEME_SOURCE_CHANNEL)!({}, "dark");
    expect(theme.themeSource).toBe("dark");
    expect(state).toEqual({ shouldUseDarkColors: false, themeSource: "dark" });
  });

  test("setThemeSource ignores invalid payloads, keeps the previous source", () => {
    const { ipc, theme } = install({
      fakeTheme: fakeNativeTheme({ shouldUseDarkColors: false, themeSource: "light" }),
    });
    ipc.handlers.get(NATIVE_THEME_SOURCE_CHANNEL)!({}, "neon");
    expect(theme.themeSource).toBe("light");
  });
});

describe("nativeTheme 'updated' broadcast", () => {
  test("subscribes once and sends fresh state to the window", () => {
    const { fake, theme, win } = install();
    expect(theme.on).toHaveBeenCalledWith("updated", expect.any(Function));
    theme.shouldUseDarkColors = true;
    fake.emit();
    expect(win.webContents.send).toHaveBeenCalledWith(NATIVE_THEME_CHANGED_CHANNEL, {
      shouldUseDarkColors: true,
      themeSource: "system",
    });
  });

  test("a missing window is tolerated (no send)", () => {
    const { fake, win } = install({ getWindow: () => null });
    fake.emit();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  test("dispose removes the 'updated' listener", () => {
    const { fake, theme, win, dispose } = install();
    const listener = vi.mocked(theme.on).mock.calls[0][1] as () => void;
    dispose();
    expect(theme.removeListener).toHaveBeenCalledWith("updated", listener);
    theme.shouldUseDarkColors = true;
    fake.emit();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
