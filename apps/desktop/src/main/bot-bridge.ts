import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  botSnapshotInputSchema,
  botSnapshotResultSchema,
  botCreateResultSchema,
  botRunInputSchema,
  botRunResultSchema,
  botHistoryInputSchema,
  botHistoryResultSchema,
} from "../shared/bot-validation";
import type { Result } from "../shared/session-contract";
import type {
  BotScope,
  BotsPanelSnapshot,
  BotRunReceipt,
  BotHistoryResult,
} from "../shared/bot-contract";
import { dispatchBotCreate } from "./bot-create-bridge";
import { callNative } from "./native-client";
import { resultSchemas } from "../shared/result-validation";

// native-client.ts's callNative validates every raw native result against
// `resultSchemas[method]` (shared/result-validation.ts, coordinator-owned)
// BEFORE any bridge-level schema runs; a method with no entry there throws
// inside that generic gate (`resultSchemas[method].parse` on `undefined`),
// surfacing as "The service response does not match the expected contract."
// Registered here rather than editing that file directly -- identical
// precedent to main/git-bridge.ts's registration of `gitResultSchemas`. The
// schemas are the same ones the bridge-level dispatchers below already
// validate against, so there is exactly one native-shape definition per
// method, not two.
resultSchemas["bot.snapshot"] = botSnapshotResultSchema;
resultSchemas["bot.create"] = botCreateResultSchema;
resultSchemas["bot.run"] = botRunResultSchema;
resultSchemas["bot.history"] = botHistoryResultSchema;

type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

export async function dispatchBotSnapshot(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotScope & BotsPanelSnapshot>> {
  const parsed = botSnapshotInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot snapshot request.",
        retryable: false,
      },
    };
  const result = await call("bot.snapshot", parsed.data);
  if (!result.ok) return result;
  const checked = botSnapshotResultSchema.safeParse(result.result);
  if (
    !checked.success ||
    checked.data.hostId !== parsed.data.hostId ||
    checked.data.workspaceId !== parsed.data.workspaceId
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The Bot snapshot does not match its requested scope or contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

export async function dispatchBotRun(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotRunReceipt>> {
  const parsed = botRunInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot run request.",
        retryable: false,
      },
    };
  const { requestId, ...params } = parsed.data;
  const result = await call("bot.run", params, requestId);
  if (!result.ok) return result;
  const checked = botRunResultSchema.safeParse(result.result);
  if (!checked.success || checked.data.workspaceId !== params.workspaceId)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The Bot run receipt does not match its requested contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

export async function dispatchBotHistory(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotHistoryResult>> {
  const parsed = botHistoryInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot history request.",
        retryable: false,
      },
    };
  const result = await call("bot.history", parsed.data);
  if (!result.ok) return result;
  const checked = botHistoryResultSchema.safeParse(result.result);
  if (
    !checked.success ||
    checked.data.hostId !== parsed.data.hostId ||
    checked.data.workspaceId !== parsed.data.workspaceId ||
    checked.data.botId !== parsed.data.botId
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The Bot history does not match its requested scope or contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid Bot request.",
    retryable: false,
  },
} as const;

/**
 * Registers `drogon:botCreate`/`drogon:botRun`/`drogon:botHistory` with the
 * same sender/frame gate main/index.ts applies to its own bridge. Own
 * registration (rather than `bridgeSchemas` entries) because that map is
 * coordinator-owned; see `main/git-bridge.ts` for the identical precedent.
 * `drogon:botSnapshot` is untouched -- it stays registered through the
 * generic `bridgeSchemas` loop in main/index.ts.
 */
export function registerBotBridge(getWindow: () => BrowserWindow | null): void {
  const guarded =
    <T>(dispatch: (input: unknown) => Promise<Result<T>>) =>
    async (event: Electron.IpcMainInvokeEvent, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return invalid;
      return dispatch(input);
    };
  ipcMain.handle("drogon:botCreate", guarded(dispatchBotCreate));
  ipcMain.handle("drogon:botRun", guarded(dispatchBotRun));
  ipcMain.handle("drogon:botHistory", guarded(dispatchBotHistory));
}
