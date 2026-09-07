/* MIT Copyright (c) 2026 Lovecast Inc. Preload side of the shell
   bridge; the main side lives in main/shell-bridge.ts. Exposes only
   opening https URLs in the OS browser. */
import { ipcRenderer } from "electron";

export type ShellBridge = {
  openExternal: (url: string) => Promise<{ ok: true } | { ok: false }>;
};

export const shellBridge: ShellBridge = {
  openExternal: (url) => ipcRenderer.invoke("drogon:openExternal", url),
};
