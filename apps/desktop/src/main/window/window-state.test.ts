// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/window/main-window-state-lifecycle.test.ts (debounce, near-min
//     guard, maximized pair, freeze semantics)
// Adapted to the JSON-file persistence under a test-owned state path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  onMock,
  sendMock,
  isMaximizedMock,
  getBoundsMock,
  isDestroyedMock,
  isFullScreenMock,
  beforeQuitListeners,
} = vi.hoisted(() => ({
  onMock: vi.fn(),
  sendMock: vi.fn(),
  isMaximizedMock: vi.fn(() => false),
  getBoundsMock: vi.fn(() => ({ x: 10, y: 20, width: 1200, height: 800 })),
  isDestroyedMock: vi.fn(() => false),
  isFullScreenMock: vi.fn(() => false),
  beforeQuitListeners: [] as Array<() => void>,
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
    on: vi.fn((event: string, listener: () => void) => {
      if (event === "before-quit") beforeQuitListeners.push(listener);
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      const at = beforeQuitListeners.indexOf(listener);
      if (at >= 0) beforeQuitListeners.splice(at, 1);
    }),
  },
  screen: {
    getAllDisplays: vi.fn(() => [
      { workArea: { x: 0, y: 0, width: 2560, height: 1440 } },
    ]),
  },
}));

import {
  installWindowStateLifecycle,
  restorableBounds,
  revealRestoredWindow,
  type MainWindowStateLifecycle,
} from "./window-state";
import {
  DEFAULT_RESTORED_WINDOW_STATE,
  isNearMinimumBounds,
  parseWindowStateFile,
} from "../../shared/window-state-contract";
import { readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeWindow() {
  onMock.mockReset();
  sendMock.mockReset();
  isMaximizedMock.mockReturnValue(false);
  getBoundsMock.mockReturnValue({ x: 10, y: 20, width: 1200, height: 800 });
  isDestroyedMock.mockReturnValue(false);
  isFullScreenMock.mockReturnValue(false);
  return {
    on: onMock,
    webContents: { send: sendMock },
    isMaximized: isMaximizedMock,
    getBounds: getBoundsMock,
    isDestroyed: isDestroyedMock,
    isFullScreen: isFullScreenMock,
  } as unknown as Electron.BrowserWindow;
}

/** Registers installed listeners by event name, like a real EventEmitter. */
function listenersByEvent(): Map<string, Array<() => void>> {
  const map = new Map<string, Array<() => void>>();
  for (const call of onMock.mock.calls) {
    const [event, listener] = call as [string, () => void];
    const list = map.get(event) ?? [];
    list.push(listener);
    map.set(event, list);
  }
  return map;
}

describe("window state persistence", () => {
  let statePath: string;
  let dir: string;
  let lifecycle: MainWindowStateLifecycle | null = null;
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  beforeEach(() => {
    beforeQuitListeners.length = 0;
    dir = join(tmpdir(), `drogon-window-state-test-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    statePath = join(dir, "window-state.json");
  });

  afterEach(() => {
    lifecycle?.dispose();
    lifecycle = null;
    for (const timer of timers.splice(0)) clearTimeout(timer);
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function install() {
    lifecycle = installWindowStateLifecycle({
      mainWindow: makeWindow(),
      statePath,
      setTimeoutFn: ((fn: () => void, _ms?: number) => {
        const handle = setTimeout(fn, 0);
        timers.push(handle);
        return handle;
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: ((handle: Parameters<typeof clearTimeout>[0]) => {
        const at = timers.indexOf(handle as ReturnType<typeof setTimeout>);
        if (at >= 0) timers.splice(at, 1);
        clearTimeout(handle);
      }) as typeof clearTimeout,
    });
    return lifecycle;
  }

  async function flushDebounce() {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  it("persists the bounds+maximized pair after the debounce, not on every event", async () => {
    install();
    const resize = listenersByEvent().get("resize") ?? [];
    expect(resize.length).toBe(1);

    resize[0]();
    resize[0]();
    resize[0]();
    // Nothing written before the debounce elapses.
    expect(() => readFileSync(statePath, "utf8")).toThrow();

    await flushDebounce();
    expect(parseWindowStateFile(readFileSync(statePath, "utf8"))).toEqual({
      bounds: { x: 10, y: 20, width: 1200, height: 800 },
      maximized: false,
    });
  });

  it("skips persisting near-minimum bounds but still unsets maximized", async () => {
    install();
    getBoundsMock.mockReturnValue({ x: 0, y: 0, width: 720, height: 480 });
    (listenersByEvent().get("resize") ?? [])[0]();
    await flushDebounce();

    const state = parseWindowStateFile(readFileSync(statePath, "utf8"));
    expect(state.bounds).toBeNull();
    expect(state.maximized).toBe(false);
  });

  it("persists maximized alone and keeps the previously saved bounds", async () => {
    install();
    const listeners = listenersByEvent();
    listeners.get("resize")![0]();
    await flushDebounce();

    isMaximizedMock.mockReturnValue(true);
    listeners.get("maximize")![0]();
    await flushDebounce();

    const state = parseWindowStateFile(readFileSync(statePath, "utf8"));
    expect(state.maximized).toBe(true);
    // Source Store.updateUI merge: the maximize write must not drop bounds.
    expect(state.bounds).toEqual({ x: 10, y: 20, width: 1200, height: 800 });
    expect(sendMock).toHaveBeenCalledWith("window:maximize-changed", true);
  });

  it("freezes persistence on before-quit and drops pending debounces", async () => {
    install();
    const listeners = listenersByEvent();
    listeners.get("resize")![0]();

    expect(beforeQuitListeners.length).toBe(1);
    beforeQuitListeners[0]();

    await flushDebounce();
    expect(() => readFileSync(statePath, "utf8")).toThrow();
    expect(lifecycle?.isWindowClosing()).toBe(true);
  });

  it("skips persisting while full screen", async () => {
    install();
    isFullScreenMock.mockReturnValue(true);
    (listenersByEvent().get("resize") ?? [])[0]();
    await flushDebounce();
    expect(() => readFileSync(statePath, "utf8")).toThrow();
  });

  it("unmaximize persists restored bounds like the source", async () => {
    install();
    const listeners = listenersByEvent();
    isMaximizedMock.mockReturnValue(false);
    listeners.get("unmaximize")![0]();
    await flushDebounce();

    expect(parseWindowStateFile(readFileSync(statePath, "utf8"))).toEqual({
      bounds: { x: 10, y: 20, width: 1200, height: 800 },
      maximized: false,
    });
    expect(sendMock).toHaveBeenCalledWith("window:maximize-changed", false);
  });

  it("relays fullscreen changes to the renderer", () => {
    install();
    const listeners = listenersByEvent();
    listeners.get("enter-full-screen")![0]();
    listeners.get("leave-full-screen")![0]();
    expect(sendMock).toHaveBeenCalledWith("window:fullscreen-changed", true);
    expect(sendMock).toHaveBeenCalledWith("window:fullscreen-changed", false);
  });
});

describe("revealRestoredWindow flag guards", () => {
  function makeRevealWindow() {
    return {
      maximize: vi.fn(),
      show: vi.fn(),
      showInactive: vi.fn(),
      focus: vi.fn(),
      moveTop: vi.fn(),
    };
  }

  it("keeps a saved maximized window hidden during background validation", () => {
    const win = makeRevealWindow();
    revealRestoredWindow({
      window: win,
      savedMaximized: true,
      backgroundWindow: true,
    });
    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.showInactive).not.toHaveBeenCalled();
    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
    expect(win.moveTop).not.toHaveBeenCalled();
  });

  it("reveals focused in a normal foreground launch", () => {
    const win = makeRevealWindow();
    revealRestoredWindow({
      window: win,
      savedMaximized: false,
      backgroundWindow: false,
    });
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.showInactive).not.toHaveBeenCalled();
    expect(win.maximize).not.toHaveBeenCalled();
  });

  it("skips maximize when nothing was saved maximized", () => {
    const win = makeRevealWindow();
    revealRestoredWindow({
      window: win,
      savedMaximized: false,
      backgroundWindow: true,
    });
    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.showInactive).not.toHaveBeenCalled();
    expect(win.show).not.toHaveBeenCalled();
  });
});

describe("restorableBounds admission", () => {
  it("accepts bounds bigger than the minimum and visible on a display", () => {
    expect(
      restorableBounds(
        { bounds: { x: 0, y: 0, width: 1400, height: 920 }, maximized: false },
        720,
        480,
      ),
    ).toEqual({ x: 0, y: 0, width: 1400, height: 920 });
  });

  it("rejects off-screen and under-minimum bounds with the default fallback", () => {
    expect(
      restorableBounds(
        { bounds: { x: -50000, y: -50000, width: 1400, height: 920 }, maximized: false },
        720,
        480,
      ),
    ).toBeNull();
    expect(
      restorableBounds(
        { bounds: { x: 0, y: 0, width: 720, height: 480 }, maximized: false },
        720,
        480,
      ),
    ).toBeNull();
  });
});

describe("window-state contract", () => {
  it("falls back to first-launch defaults on malformed files", () => {
    expect(parseWindowStateFile(null)).toEqual(DEFAULT_RESTORED_WINDOW_STATE);
    expect(parseWindowStateFile("not json")).toEqual(DEFAULT_RESTORED_WINDOW_STATE);
    expect(parseWindowStateFile('{"version":2}')).toEqual(
      DEFAULT_RESTORED_WINDOW_STATE,
    );
    expect(
      parseWindowStateFile(
        '{"version":1,"bounds":{"x":0,"y":0,"width":100,"height":50},"maximized":false}',
      ),
    ).toEqual(DEFAULT_RESTORED_WINDOW_STATE);
  });

  it("flags exactly-minimum bounds as near-minimum like the source guard", () => {
    expect(isNearMinimumBounds({ width: 721, height: 900 })).toBe(false);
    expect(isNearMinimumBounds({ width: 720, height: 900 })).toBe(true);
    expect(isNearMinimumBounds({ width: 900, height: 480 })).toBe(true);
  });
});
