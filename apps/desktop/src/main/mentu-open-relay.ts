// Main-process half of `drogon-cli mentu open` (Mentu-as-tab). The daemon
// relay (`desktop.commands.poll`) delivers one `mentu.open` command here;
// the Mentu tab is renderer state, so main forwards the request to the
// loaded window and waits for that window's own verdict before completing
// the relay command. A missing window, a timed-out window and an explicit
// renderer refusal are three distinct answers — never silently "opened".
//
// The electron import is only touched at call time (the module can be
// imported and unit-tested without a real Electron process, the same
// discipline as main/mentu-bridge.ts).

import { randomUUID } from "node:crypto";
import { ipcMain, type BrowserWindow } from "electron";
import {
  MENTU_OPEN_TAB_CHANNEL,
  MENTU_OPEN_TAB_RESULT_CHANNEL,
  mentuOpenTabResultSchema,
  type MentuOpenTabResult,
} from "../shared/mentu-contract";

/** Structural outcome the browser relay poller already speaks. */
export type MentuOpenOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

/**
 * How long the main process waits for the renderer's verdict. The daemon's
 * own relay timeout (15 s default) is the outer bound; this one is shorter
 * so the CLI always gets a typed `mentu_open_timeout` instead of the generic
 * `desktop_not_connected`.
 */
export const MENTU_OPEN_ACK_TIMEOUT_MS = 10_000;

type PendingOpen = {
  resolve: (outcome: MentuOpenOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Echoed back into the successful result so the CLI can report which
   *  workspace/tab the desktop actually opened. */
  workspaceId: string;
  recipeId?: string;
};

const pending = new Map<string, PendingOpen>();

/**
 * Resolves the pending request with the renderer's verdict. Returns false
 * for an unknown/already-settled request id, so a duplicate or forged
 * report can never resolve a second waiter.
 */
export function settleMentuOpenTab(result: MentuOpenTabResult): boolean {
  const entry = pending.get(result.requestId);
  if (!entry) return false;
  pending.delete(result.requestId);
  clearTimeout(entry.timer);
  entry.resolve(
    result.ok
      ? {
          ok: true,
          result: {
            ...result,
            workspaceId: entry.workspaceId,
            ...(entry.recipeId ? { recipeId: entry.recipeId } : {}),
            opened: true,
          },
        }
      : {
          ok: false,
          error: {
            code: result.code ?? "mentu_open_refused",
            message:
              result.message ??
              "The Drogon window refused to open the Mentu tab.",
          },
        },
  );
  return true;
}

/**
 * Sends one open request to `window` and resolves once the renderer answers
 * (or the ack budget expires). Never throws.
 */
export function openMentuTabInRenderer(
  window: BrowserWindow | null,
  workspaceId: string,
  recipeId?: string,
  ackTimeoutMs = MENTU_OPEN_ACK_TIMEOUT_MS,
): Promise<MentuOpenOutcome> {
  if (!window) {
    return Promise.resolve({
      ok: false,
      error: {
        code: "desktop_unavailable",
        message: "No Drogon window is loaded to open the Mentu tab in.",
      },
    } as const);
  }
  const requestId = randomUUID();
  return new Promise<MentuOpenOutcome>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({
        ok: false,
        error: {
          code: "mentu_open_timeout",
          message: `The Drogon window did not confirm the Mentu tab within ${ackTimeoutMs}ms.`,
        },
      });
    }, ackTimeoutMs);
    pending.set(requestId, {
      resolve,
      timer,
      workspaceId,
      ...(recipeId ? { recipeId } : {}),
    });
    try {
      window.webContents.send(MENTU_OPEN_TAB_CHANNEL, {
        requestId,
        workspaceId,
        ...(recipeId ? { recipeId } : {}),
      });
    } catch (error) {
      settleMentuOpenTab({
        requestId,
        ok: false,
        code: "mentu_open_unsupported",
        message: `The Drogon window could not receive the Mentu request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  });
}

let bound: (() => BrowserWindow | null) | null = null;

/** The window getter the relay's commands are delivered to. */
export function bindMentuOpenWindow(getWindow: () => BrowserWindow | null): void {
  bound = getWindow;
}

/** Entry point the browser relay poller calls for a `mentu.open` command. */
export function openMentuTabInBoundWindow(
  workspaceId: string,
  recipeId?: string,
): Promise<MentuOpenOutcome> {
  return openMentuTabInRenderer(bound ? bound() : null, workspaceId, recipeId);
}

let handlerRegistered = false;

/**
 * Registers the renderer's verdict channel. Requires the same
 * sender/frame gate the rest of the bridge uses: only the app's own main
 * frame can settle a request.
 */
export function registerMentuOpenTabResult(
  getWindow: () => BrowserWindow | null,
): void {
  bindMentuOpenWindow(getWindow);
  if (handlerRegistered) return;
  handlerRegistered = true;
  ipcMain.handle(MENTU_OPEN_TAB_RESULT_CHANNEL, (event, input: unknown) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return false;
    const parsed = mentuOpenTabResultSchema.safeParse(input);
    if (!parsed.success) return false;
    return settleMentuOpenTab(parsed.data);
  });
}

/** Test seam: forget every waiter (vitest file isolation, no cross-talk). */
export function resetMentuOpenRelay(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}
