// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/main/ipc/shell.ts (`shell:openUrl` handler: parse, http(s)-only gate,
// shell.openExternal). Adapter: the `drogon:openExternal` channel, this
// repo's Result envelope and sender check (same shape as
// tasks-bridge.ts/mentu-bridge.ts), and an injectable opener so the IPC
// handler is unit-testable without Electron.
import { ipcMain, shell } from "electron";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import {
  isExternalUrlAllowed,
  SHELL_OPEN_EXTERNAL_CHANNEL,
} from "../shared/shell-contract";
import type { Result } from "../shared/session-contract";
import type { ShellOpenExternalResult } from "../shared/shell-contract";
import { suppressForegroundSideEffect } from "./background-test-mode";


// Worktree card menu actions (R9-A): Reveal in Finder / Open in editor go
// through Electron's `shell` module, the same surface Orca's window.api
// exposes for these menu actions. The renderer already holds the absolute
// worktree path, so there is no daemon round-trip.
const fsPath = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes("\0"));

export const shellBridgeSchemas = {
  showItemInFolder: z.object({ path: fsPath }),
  openPath: z.object({ path: fsPath }),
};

export type ShellMethod = keyof typeof shellBridgeSchemas;

const channelFor: Record<ShellMethod, string> = {
  showItemInFolder: "drogon:showItemInFolder",
  openPath: "drogon:openPath",
};

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
  // Test instances never raise the system browser over the user.
  if (suppressForegroundSideEffect("openExternal", input))
    return { ok: true, result: { opened: true } };
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
  for (const method of Object.keys(shellBridgeSchemas) as ShellMethod[]) {
    ipcMain.handle(channelFor[method], async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      const parsed = shellBridgeSchemas[method].safeParse(input);
      if (!parsed.success) return { ...invalid };
      if (method === "showItemInFolder") {
        if (!suppressForegroundSideEffect("showItemInFolder", parsed.data.path))
          shell.showItemInFolder(parsed.data.path);
        return { ok: true as const, result: { shown: true } };
      }
      if (suppressForegroundSideEffect("openPath", parsed.data.path))
        return { ok: true as const, result: { opened: true } };
      const error = await shell.openPath(parsed.data.path);
      if (error)
        return {
          ok: false as const,
          error: { code: "io_error", message: error, retryable: false },
        };
      return { ok: true as const, result: { opened: true } };
    });
  }
}
