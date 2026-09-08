// MIT Copyright (c) 2026 Lovecast Inc.
// Main-process nativeTheme relay (#241): the renderer resolves the "System"
// theme from Electron's nativeTheme instead of trusting the web contents'
// media query, which can miss OS scheme changes (QA r3: System stayed light
// on a dark OS and never adapted).
//
// Ported from the Orca reference (read-only):
//   src/main/startup/main-process-ready-runtime.ts:91
//     (nativeTheme.themeSource mirrors the stored theme at startup)
//   src/main/ipc/settings.ts:188
//     (nativeTheme.themeSource = args.theme on every theme settings write)
// Adapted: this app keeps its settings store in the renderer, so the mirror
// arrives over the two channels below and 'updated' broadcasts state back.
// Everything Electron is injectable so the bridge is unit-testable (same
// seam style as daemon-restart.ts).
import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  nativeThemeSourceSchema,
  type NativeThemeState,
} from "../shared/settings-contract";

/** Minimal nativeTheme surface the bridge needs (Electron satisfies it). */
export type NativeThemeLike = {
  shouldUseDarkColors: boolean;
  themeSource: "system" | "dark" | "light";
  on(event: "updated", listener: () => void): unknown;
  removeListener(event: "updated", listener: () => void): unknown;
};

export type NativeThemeBridgeDeps = {
  nativeTheme: NativeThemeLike;
  // The handler signature mirrors Electron's IpcMainInvite listener shape
  // loosely so the real IpcMain satisfies this structurally.
  ipcMain: {
    handle(
      channel: string,
      handler: (event: unknown, ...args: any[]) => unknown,
    ): unknown;
  };
  /** Current main window; null while gone (closed) — broadcasts then no-op. */
  getWindow(): Pick<BrowserWindow, "webContents" | "isDestroyed"> | null;
};

export const NATIVE_THEME_STATE_CHANNEL = "drogon:nativeThemeState";
export const NATIVE_THEME_SOURCE_CHANNEL = "drogon:nativeThemeSource";
export const NATIVE_THEME_CHANGED_CHANNEL = "drogon:nativeThemeChanged";

function readState(nativeTheme: NativeThemeLike): NativeThemeState {
  return {
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeThemeSourceSchema.parse(nativeTheme.themeSource),
  };
}

/**
 * Registers the state/source channels and the 'updated' broadcast. Returns
 * the disposer (tests only — main keeps the bridge for the process life).
 */
export function installNativeThemeBridge(
  deps: NativeThemeBridgeDeps,
): () => void {
  const { nativeTheme } = deps;
  deps.ipcMain.handle(NATIVE_THEME_STATE_CHANNEL, () =>
    readState(nativeTheme),
  );
  deps.ipcMain.handle(
    NATIVE_THEME_SOURCE_CHANNEL,
    (_event: unknown, theme: unknown) => {
      const validated = nativeThemeSourceSchema.safeParse(theme);
      if (validated.success) nativeTheme.themeSource = validated.data;
      return readState(nativeTheme);
    },
  );
  const onUpdated = () => {
    const target = deps.getWindow();
    if (!target || target.isDestroyed()) return;
    target.webContents.send(NATIVE_THEME_CHANGED_CHANNEL, readState(nativeTheme));
  };
  nativeTheme.on("updated", onUpdated);
  return () => nativeTheme.removeListener("updated", onUpdated);
}
