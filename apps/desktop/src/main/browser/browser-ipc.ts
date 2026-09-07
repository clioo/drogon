// IPC registration for the embedded browser pane. Owns the single
// BrowserHost; main/index.ts only imports and calls registerBrowserIpc.

import { ipcMain, WebContentsView, type BrowserWindow } from "electron";
import {
  browserCreateTabSchema,
  browserIpcChannels,
  browserNavigateSchema,
  browserSetBoundsSchema,
  browserTabRefSchema,
  type BrowserTabState,
} from "../../shared/browser-contract";
import { BrowserHost, type BrowserParentWindowLike } from "./browser-host";

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid desktop request.",
    retryable: false,
  },
} as const;

function blocked(message: string) {
  return {
    ok: false as const,
    error: { code: "browser_blocked", message, retryable: false },
  };
}

function missingTab(message: string) {
  return {
    ok: false as const,
    error: { code: "browser_no_tab", message, retryable: false },
  };
}

function noWindow() {
  return {
    ok: false as const,
    error: {
      code: "browser_unavailable",
      message: "Browser window is not ready.",
      retryable: true,
    },
  };
}

function describe(
  result: BrowserTabState | { blocked: string },
): { ok: true; result: BrowserTabState } | { ok: false; error: { code: string; message: string; retryable: boolean } } {
  if ("blocked" in result) {
    // Policy refusals (blocked scheme) vs missing tabs share the caller's
    // retryable=false; only a missing window is retryable (above).
    const code = result.blocked === "Tab is not open." ? "browser_no_tab" : "browser_blocked";
    return { ok: false, error: { code, message: result.blocked, retryable: false } };
  }
  return { ok: true, result };
}

let registered = false;

/**
 * Registers `drogon:browser*` handlers against the main window. The host
 * creates real WebContentsViews; in vitest the electron import below is
 * never evaluated because this module is main-process only.
 */
export function registerBrowserIpc(
  getWindow: () => BrowserWindow | null,
): BrowserHost {
  const host = new BrowserHost(
    () => (getWindow() as unknown as BrowserParentWindowLike | null),
    (options) => new WebContentsView(options),
  );
  if (registered) return host;
  registered = true;
  const withWindow = <T>(run: () => T): T | { ok: false; error: { code: string; message: string; retryable: boolean } } => {
    if (!getWindow()) return noWindow();
    return run();
  };
  const mainFrameOnly = (event: Electron.IpcMainInvokeEvent, window: BrowserWindow) =>
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle(browserIpcChannels.createTab, async (event, input: unknown) => {
    const window = getWindow();
    if (!window || !mainFrameOnly(event, window)) return invalid;
    const validated = browserCreateTabSchema.safeParse(input);
    if (!validated.success) return invalid;
    return withWindow(() => {
      const created = host.createTab(validated.data.workspaceId, validated.data.url);
      return describe(created);
    });
  });
  ipcMain.handle(browserIpcChannels.navigate, async (event, input: unknown) => {
    const window = getWindow();
    if (!window || !mainFrameOnly(event, window)) return invalid;
    const validated = browserNavigateSchema.safeParse(input);
    if (!validated.success) return invalid;
    // A blocked-scheme navigation still resolves per-tab (honest pane
    // state) rather than as a transport error.
    return describe(host.navigate(validated.data.tabId, validated.data.url));
  });
  for (const [channel, run] of [
    [browserIpcChannels.back, (tabId: string) => host.back(tabId)],
    [browserIpcChannels.forward, (tabId: string) => host.forward(tabId)],
    [browserIpcChannels.reload, (tabId: string) => host.reload(tabId)],
    [browserIpcChannels.stop, (tabId: string) => host.stop(tabId)],
  ] as const) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      const window = getWindow();
      if (!window || !mainFrameOnly(event, window)) return invalid;
      const validated = browserTabRefSchema.safeParse(input);
      if (!validated.success) return invalid;
      return describe(run(validated.data.tabId));
    });
  }
  ipcMain.handle(browserIpcChannels.closeTab, async (event, input: unknown) => {
    const window = getWindow();
    if (!window || !mainFrameOnly(event, window)) return invalid;
    const validated = browserTabRefSchema.safeParse(input);
    if (!validated.success) return invalid;
    if (!host.closeTab(validated.data.tabId)) return missingTab("Tab is not open.");
    return { ok: true, result: null };
  });
  ipcMain.handle(browserIpcChannels.setBounds, async (event, input: unknown) => {
    const window = getWindow();
    if (!window || !mainFrameOnly(event, window)) return invalid;
    const validated = browserSetBoundsSchema.safeParse(input);
    if (!validated.success) return invalid;
    host.setBounds(validated.data.tabId, validated.data.bounds);
    return { ok: true, result: null };
  });
  ipcMain.handle(browserIpcChannels.snapshot, async (event, input: unknown) => {
    const window = getWindow();
    if (!window || !mainFrameOnly(event, window)) return invalid;
    const validated = browserTabRefSchema.safeParse(input);
    if (!validated.success) return invalid;
    const snapshot = await host.snapshot(validated.data.tabId);
    if ("blocked" in snapshot) return missingTab(snapshot.blocked);
    return { ok: true, result: snapshot };
  });
  return host;
}
