/* MIT Copyright (c) 2026 Lovecast Inc. */
// `drogon:uiGet`/`drogon:uiSet` -- the Workspace Options shared
// preferences store's IPC surface, same sender/frame gate
// settings-bridge.ts applies to its own channels.
import { app, ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { join } from "node:path";
import type { WorkspaceUIPreferences } from "../shared/workspace-ui-preferences-contract";
import {
  WORKSPACE_UI_PREFERENCES_FILE_NAME,
  WorkspaceUIPreferencesStore,
} from "./workspace-ui-preferences";

let store: WorkspaceUIPreferencesStore | null = null;

function getStore(): WorkspaceUIPreferencesStore {
  if (!store) {
    store = new WorkspaceUIPreferencesStore(
      join(app.getPath("userData"), WORKSPACE_UI_PREFERENCES_FILE_NAME),
    );
  }
  return store;
}

/** Test seam: replaces the singleton with one backed by an arbitrary path
 *  (or memory-only, for `null`). */
export function setWorkspaceUIPreferencesStoreForTesting(
  next: WorkspaceUIPreferencesStore | null,
): void {
  store = next;
}

export function registerWorkspaceUIPreferencesBridge(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("drogon:uiGet", (event): WorkspaceUIPreferences | null => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      return null;
    }
    return getStore().get();
  });

  ipcMain.handle(
    "drogon:uiSet",
    (event, partial: unknown): WorkspaceUIPreferences | null => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      ) {
        return null;
      }
      const safePartial =
        typeof partial === "object" && partial !== null
          ? (partial as Partial<WorkspaceUIPreferences>)
          : {};
      return getStore().set(safePartial);
    },
  );
}
