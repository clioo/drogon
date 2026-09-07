// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/main/ipc/shell.ts (`shell:openUrl` handler: parse, http(s)-only gate,
// shell.openExternal). Adapter: the `drogon:openExternal` channel, this
// repo's Result envelope and sender check (same shape as
// tasks-bridge.ts/mentu-bridge.ts), and an injectable opener so the IPC
// handler is unit-testable without Electron.
import { ipcMain, shell } from "electron";
import type { BrowserWindow } from "electron";
import {
  isExternalUrlAllowed,
  SHELL_OPEN_EXTERNAL_CHANNEL,
} from "../shared/shell-contract";
import type { Result } from "../shared/session-contract";
import type { ShellOpenExternalResult } from "../shared/shell-contract";

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid shell request.",
    retryable: false,
  },
} as const;

export type ShellOpen = (url: string) => Promise<void>;

/**
 * Validates one `openExternal` request and opens it in the system browser.
 * Disallowed input never reaches the shell; an opener failure is an honest
 * internal error, never a silent drop.
 */
export async function dispatchOpenExternalRequest(
  input: unknown,
  open: ShellOpen = (url) => shell.openExternal(url),
): Promise<Result<ShellOpenExternalResult>> {
  if (!isExternalUrlAllowed(input)) return { ...invalid };
  try {
    await open(input);
    return { ok: true, result: { opened: true } };
  } catch {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The system browser could not be opened.",
        retryable: false,
      },
    };
  }
}

export function registerShellBridge(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(
    SHELL_OPEN_EXTERNAL_CHANNEL,
    async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      return dispatchOpenExternalRequest(input);
    },
  );
}
