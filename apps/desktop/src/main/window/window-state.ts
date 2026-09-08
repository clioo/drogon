// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/window/main-window-state-lifecycle.ts (debounced persist,
//     near-minimum guard, atomic bounds+maximized pair, close/before-quit
//     freeze, maximize/unmaximize and fullscreen change relay)
//   src/main/window/window-bounds-validation.ts
//     (rectHasVisibleAreaOnAnyDisplay)
//   src/main/window/createMainWindow.ts (saved-bounds admission rule)
// Adapted: the source persists through its Store (windowMaximized /
// windowBounds inside the UI state); Drogon persists the same pair to one
// JSON file under app.getPath("userData"). An update that carries no new
// bounds (maximize, near-min guard) keeps the previously saved bounds, like
// the source's Store.updateUI merge. First launch falls back to the
// 1400×920 default. The ready-to-show reveal/zoom plumbing stays in
// main/index.ts, which only needs restore + lifecycle here.
import { app, screen, type BrowserWindow } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_RESTORED_WINDOW_STATE,
  WINDOW_STATE_FILE_NAME,
  isNearMinimumBounds,
  parseWindowStateFile,
  type RestoredWindowState,
  type WindowBounds,
} from "../../shared/window-state-contract";

export type MainWindowStateLifecycle = {
  dispose: () => void;
  freezeBoundsOnQuit: () => void;
  isWindowClosing: () => boolean;
};

/**
 * True when `rect` overlaps some currently-attached display's workArea by at
 * least the given visible width/height. Used to reject persisted bounds that
 * would restore a window off-screen — e.g. saved while an external monitor
 * was connected. workArea excludes the menu bar / dock, so a rect hidden
 * entirely under the dock is also correctly rejected. Requiring a
 * *meaningful* overlap (not just >0) avoids a one-pixel sliver leaving the
 * titlebar unreachable.
 */
export function rectHasVisibleAreaOnAnyDisplay(
  rect: WindowBounds,
  minVisibleWidth: number,
  minVisibleHeight: number,
): boolean {
  try {
    return screen.getAllDisplays().some((display) => {
      const wa = display.workArea;
      const overlapX = Math.max(
        0,
        Math.min(rect.x + rect.width, wa.x + wa.width) - Math.max(rect.x, wa.x),
      );
      const overlapY = Math.max(
        0,
        Math.min(rect.y + rect.height, wa.y + wa.height) - Math.max(rect.y, wa.y),
      );
      return overlapX >= minVisibleWidth && overlapY >= minVisibleHeight;
    });
  } catch (err) {
    console.warn("[window] screen.getAllDisplays() threw; treating bounds as off-screen", err);
    return false;
  }
}

function stateFilePath(): string {
  return join(app.getPath("userData"), WINDOW_STATE_FILE_NAME);
}

function safeReadFile(statePath: string): string | null {
  try {
    return readFileSync(statePath, "utf8");
  } catch {
    return null;
  }
}

type WindowStateUpdate = { bounds?: WindowBounds | null; maximized?: boolean };

/**
 * Persist one update of the bounds+maximized pair. The JSON file is the
 * equivalent of the source's `Store.updateUI`, so an update that carries no
 * new bounds keeps the previously saved pair instead of dropping it.
 */
function makePersister(statePath: string) {
  return (update: WindowStateUpdate): void => {
    const current = parseWindowStateFile(safeReadFile(statePath));
    const next = {
      version: 1 as const,
      bounds: update.bounds !== undefined ? update.bounds : current.bounds,
      maximized: update.maximized !== undefined ? update.maximized : current.maximized,
    };
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, JSON.stringify(next, null, 2));
    } catch (error) {
      console.error("[window] Failed to persist window state:", error);
    }
  };
}

/**
 * Ready-to-show reveal of the restored window (source revealInitialWindow:
 * maximize-then-show). Under the background/acceptance flag the window is
 * revealed inactive (the source's showWindowWithoutStealingFocus) and never
 * shown focused, focused programmatically, or raised; maximize() itself is a
 * bounds op that precedes the reveal in both paths.
 */
export function revealRestoredWindow(args: {
  window: Pick<
    BrowserWindow,
    "maximize" | "show" | "showInactive" | "focus" | "moveTop"
  >;
  savedMaximized: boolean;
  backgroundWindow: boolean;
}): void {
  const { window, savedMaximized, backgroundWindow } = args;
  if (savedMaximized) window.maximize();
  if (backgroundWindow) window.showInactive();
  else window.show();
}

/** Reads the persisted pair; anything unreadable falls back to first launch. */
export function loadWindowState(): RestoredWindowState {
  return parseWindowStateFile(safeReadFile(stateFilePath()));
}

/**
 * Admission rule from the source createMainWindow: bounds win only when
 * bigger than the minimum and meaningfully visible on an attached display;
 * anything else falls back to the default size with an honest warning.
 */
export function restorableBounds(
  state: RestoredWindowState,
  minWidth: number,
  minHeight: number,
): WindowBounds | null {
  const raw = state.bounds;
  if (
    raw &&
    raw.width > minWidth &&
    raw.height > minHeight &&
    rectHasVisibleAreaOnAnyDisplay(raw, minWidth / 2, minHeight / 2)
  ) {
    return raw;
  }
  if (raw) {
    console.warn(
      "[window] Discarding persisted windowBounds and falling back to defaultBounds:",
      raw,
    );
  }
  return null;
}

/**
 * Debounced persist of the bounds+maximized pair (source saveBounds): resize
 * drags coalesce into one write 500ms after the last event; the near-minimum
 * guard and the fullscreen skip keep teardown races and full-screen grabs
 * from clobbering the remembered size; closing freezes persistence.
 */
export function installWindowStateLifecycle(args: {
  mainWindow: BrowserWindow;
  /** Test seam: overrides the userData path used for the JSON file. */
  statePath?: string;
  /** Test seam: replaces the 500ms debounce timer. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): MainWindowStateLifecycle {
  const { mainWindow } = args;
  const setTimeoutFn = args.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = args.clearTimeoutFn ?? clearTimeout;
  const persist = makePersister(args.statePath ?? stateFilePath());

  // Why: persist window bounds to restore last position/size; debounce to avoid hammering persistence during resize drags.
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  // Why: teardown still emits resize/move/unmaximize at near-min bounds; freeze persistence once closing so they can't clobber the saved size.
  let windowClosing = false;
  const saveBounds = (): void => {
    if (boundsTimer) {
      clearTimeoutFn(boundsTimer);
    }
    boundsTimer = setTimeoutFn(() => {
      boundsTimer = null;
      if (windowClosing || mainWindow.isDestroyed() || mainWindow.isFullScreen()) {
        return;
      }
      // Why: persist maximized and bounds atomically; the near-min guard must not leave them a mismatched pair.
      const isMaximized = mainWindow.isMaximized();
      if (isMaximized) {
        persist({ maximized: true });
        return;
      }
      const bounds = mainWindow.getBounds();
      // Why: never persist shrink-to-min bounds (teardown race past the freeze); fall back to defaultBounds next launch.
      if (isNearMinimumBounds(bounds)) {
        console.warn("[window] Skipping persist of near-minimum windowBounds:", bounds);
        persist({ maximized: false });
        return;
      }
      persist({ bounds, maximized: false });
    }, 500);
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  // Why: latch on app 'before-quit' too, so teardown-time resize/move events cannot clobber the saved bounds.
  const freezeBoundsOnQuit = (): void => {
    windowClosing = true;
    if (boundsTimer) {
      clearTimeoutFn(boundsTimer);
      boundsTimer = null;
    }
  };
  app.on("before-quit", freezeBoundsOnQuit);

  mainWindow.on("maximize", () => {
    if (windowClosing) {
      return;
    }
    persist({ maximized: true });
    mainWindow.webContents.send("window:maximize-changed", true);
  });
  mainWindow.on("unmaximize", () => {
    if (windowClosing) {
      return;
    }
    mainWindow.webContents.send("window:maximize-changed", false);
    const bounds = mainWindow.getBounds();
    // Why: mirror the saveBounds guard — unmaximize during teardown can land at min size; don't persist that as remembered size.
    if (isNearMinimumBounds(bounds)) {
      console.warn("[window] Skipping unmaximize-time persist of near-min bounds:", bounds);
      persist({ maximized: false });
      return;
    }
    persist({ bounds, maximized: false });
  });

  mainWindow.on("enter-full-screen", () => {
    mainWindow.webContents.send("window:fullscreen-changed", true);
  });

  mainWindow.on("leave-full-screen", () => {
    mainWindow.webContents.send("window:fullscreen-changed", false);
  });

  mainWindow.on("closed", () => {
    windowClosing = true;
  });

  return {
    dispose: () => app.removeListener("before-quit", freezeBoundsOnQuit),
    freezeBoundsOnQuit,
    isWindowClosing: () => windowClosing,
  };
}
