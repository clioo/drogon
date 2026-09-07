// Self-registering usage IPC. Imported once (for side effects) by the main
// entry; validates every input with the shared contract and validates every
// snapshot before it crosses the boundary (fail closed, never a half shape).
import { BrowserWindow, ipcMain } from "electron";
import {
  setAwakeInputSchema,
  usageSnapshotSchema,
  type UsageResult,
  type UsageSnapshot,
} from "../../shared/usage-contract";
import { UsageStore } from "./store";

let store: UsageStore | null = null;

export function getUsageStore(): UsageStore {
  if (!store) store = new UsageStore();
  return store;
}

/** Test seam: swap the singleton store. */
export function setUsageStore(next: UsageStore | null): void {
  store = next;
}

function errorResult(message: string): UsageResult<never> {
  return { ok: false, error: { code: "internal_error", message, retryable: false } };
}

function snapshotResult(snapshot: UsageSnapshot): UsageResult<UsageSnapshot> {
  const parsed = usageSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) return errorResult("Usage snapshot failed validation.");
  return { ok: true, result: parsed.data };
}

// Same posture as the main bridge: only our own window's main frame, never a
// guest frame or a second sender.
function isAppMainFrame(event: Electron.IpcMainInvokeEvent): boolean {
  return BrowserWindow.getAllWindows().some(
    (candidate) =>
      event.sender === candidate.webContents &&
      event.senderFrame === candidate.webContents.mainFrame,
  );
}

/** Registers drogon:usageSnapshot / drogon:usageRefresh / drogon:usageSetAwake. */
export function registerUsageIpc(): void {
  ipcMain.handle("drogon:usageSnapshot", (event) => {
    if (!isAppMainFrame(event)) return errorResult("Invalid desktop request.");
    return snapshotResult(getUsageStore().getSnapshot());
  });
  ipcMain.handle("drogon:usageRefresh", async (event) => {
    if (!isAppMainFrame(event)) return errorResult("Invalid desktop request.");
    try {
      return snapshotResult(await getUsageStore().refresh());
    } catch {
      return errorResult("Usage refresh failed.");
    }
  });
  ipcMain.handle("drogon:usageSetAwake", (event, input: unknown) => {
    if (!isAppMainFrame(event)) return errorResult("Invalid desktop request.");
    const parsed = setAwakeInputSchema.safeParse(input);
    if (!parsed.success) return errorResult("Invalid awake mode.");
    try {
      return { ok: true as const, result: getUsageStore().setAwake(parsed.data) };
    } catch {
      return errorResult("Could not change the awake mode.");
    }
  });
}
