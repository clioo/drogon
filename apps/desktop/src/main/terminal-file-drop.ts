// MIT Copyright (c) 2026 Lovecast Inc.
// Relays paths resolved by the owning window's preload back to that same
// renderer. Browser guest frames and other webContents never receive drops.
import { ipcMain, type BrowserWindow } from "electron";
import {
  isTerminalFileDropPayload,
  TERMINAL_FILE_DROP_CHANNEL,
  TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL,
} from "../shared/terminal-file-drop-contract";

export function registerTerminalFileDropBridge(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.removeAllListeners(TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL);
  ipcMain.on(
    TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL,
    (event, payload: unknown) => {
      const current = getWindow();
      if (
        !current ||
        current.isDestroyed() ||
        current.webContents.isDestroyed() ||
        event.sender !== current.webContents
      ) {
        return;
      }
      if (!isTerminalFileDropPayload(payload)) return;
      current.webContents.send(TERMINAL_FILE_DROP_CHANNEL, payload);
    },
  );
}
