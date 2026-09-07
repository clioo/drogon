/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   window.api.shell.openUrl surface (adapter: this repo's drogond-backed
   bridge shape with the same sender/frame gate main/index.ts applies to
   its own bridge; only https URLs may leave the app). Powers the
   landing GitHub star button. */
import { ipcMain, shell } from "electron";
import type { BrowserWindow } from "electron";

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid shell request.",
    retryable: false,
  },
} as const;

/** Only https URLs may leave the app through the shell bridge. */
export function isOpenExternalUrlAllowed(url: unknown): url is string {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:";
}

export async function dispatchOpenExternal(
  input: unknown,
  open: (url: string) => Promise<unknown> = shell.openExternal,
): Promise<{ ok: true } | typeof invalid> {
  if (!isOpenExternalUrlAllowed(input)) return { ...invalid };
  try {
    await open(input);
    return { ok: true };
  } catch {
    return { ...invalid };
  }
}

export function registerShellBridge(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("drogon:openExternal", async (event, input: unknown) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return { ...invalid };
    return dispatchOpenExternal(input);
  });
}
