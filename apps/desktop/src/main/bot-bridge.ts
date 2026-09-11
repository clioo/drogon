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
  botResponsibilityCreateInputSchema,
  botResponsibilityCreateResultSchema,
  botResponsibilityDeleteInputSchema,
  botResponsibilityDeleteResultSchema,
  botDeleteInputSchema,
  botDeleteResultSchema,
  botMonitorListInputSchema,
  botMonitorListResultSchema,
  botMonitorApproveInputSchema,
  botMonitorApproveResultSchema,
} from "../shared/bot-validation";
import type { Result } from "../shared/session-contract";
import type {
  BotScope,
  BotsPanelSnapshot,
  BotRunReceipt,
  BotHistoryResult,
  BotMonitorListResult,
  BotMonitorApproveResult,
  BotResponsibilityCreateInput,
  BotResponsibilityCreateResult,
  BotResponsibilityDeleteInput,
  BotResponsibilityDeleteResult,
  BotDeleteResult,
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
resultSchemas["bot.responsibility_create"] = botResponsibilityCreateResultSchema;
resultSchemas["bot.responsibility_delete"] = botResponsibilityDeleteResultSchema;
resultSchemas["bot.delete"] = botDeleteResultSchema;
resultSchemas["bot.monitor_list"] = botMonitorListResultSchema;
resultSchemas["bot.monitor_approve"] = botMonitorApproveResultSchema;

type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

/** Echo-gate for mutations riding the app-global scope (#348/R17-E
 *  follow-up): native resolves an "" request to the bot's owning workspace
 *  and echoes THAT id back, so an "" request accepts any non-empty echo
 *  while a workspace-scoped request still demands the exact id
 *  (replay/scope safety for non-global callers). The delete receipts are
 *  the exception — native echoes the REQUESTED id verbatim there — so
 *  their callsites pass `echoesRequest: true` to also accept an "" echo
 *  for an applied app-global delete. */
function scopeEchoMatches(
  requestedWorkspaceId: string,
  echoedWorkspaceId: string,
  echoesRequest = false,
): boolean {
  if (requestedWorkspaceId === "") {
    return echoesRequest || echoedWorkspaceId !== "";
  }
  return echoedWorkspaceId === requestedWorkspaceId;
}

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
  if (
    !checked.success ||
    checked.data.hostId !== params.hostId ||
    !scopeEchoMatches(params.workspaceId, checked.data.workspaceId)
  )
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

// R7-E: scheduled-responsibility create/delete dispatchers. Same envelope
// convention as botCreate above: `requestId` travels as the native
// envelope id (ledger key), never inside params.
export async function dispatchBotResponsibilityCreate(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotResponsibilityCreateResult>> {
  const parsed = botResponsibilityCreateInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot responsibility request.",
        retryable: false,
      },
    };
  // `locale` rides the caller's scope triple; native's params deny it.
  const { requestId, locale: _locale, ...params } = parsed.data;
  const result = await call("bot.responsibility_create", params, requestId);
  if (!result.ok) return result;
  const checked = botResponsibilityCreateResultSchema.safeParse(result.result);
  if (
    !checked.success ||
    checked.data.hostId !== params.hostId ||
    !scopeEchoMatches(params.workspaceId, checked.data.workspaceId) ||
    checked.data.botId !== params.botId
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The created responsibility does not match its requested scope or contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

export async function dispatchBotResponsibilityDelete(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotResponsibilityDeleteResult>> {
  const parsed = botResponsibilityDeleteInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot responsibility request.",
        retryable: false,
      },
    };
  // `locale` rides the caller's scope triple; native's params deny it.
  const { requestId, locale: _locale, ...params } = parsed.data;
  const result = await call("bot.responsibility_delete", params, requestId);
  if (!result.ok) return result;
  const checked = botResponsibilityDeleteResultSchema.safeParse(result.result);
  if (
    !checked.success ||
    checked.data.hostId !== params.hostId ||
    !scopeEchoMatches(params.workspaceId, checked.data.workspaceId, true) ||
    checked.data.botId !== params.botId ||
    checked.data.responsibilityId !== params.responsibilityId
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The deleted responsibility does not match its requested scope or contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

/** Bots-page monitor read (`bot.monitor_list`): the durable state behind
 *  the redesigned MONITORS column. Native resolves the bot's owning
 *  workspace when the request rides the app-global "" sentinel and echoes
 *  the RESOLVED scope, so this gate demands a real workspace id back —
 *  plus the exact botId — before the renderer may trust the rows. */
export async function dispatchBotMonitorList(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotMonitorListResult>> {
  const parsed = botMonitorListInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot monitor request.",
        retryable: false,
      },
    };
  const result = await call("bot.monitor_list", parsed.data);
  if (!result.ok) return result;
  const checked = botMonitorListResultSchema.safeParse(result.result);
  if (
    !checked.success ||
    checked.data.hostId !== parsed.data.hostId ||
    checked.data.botId !== parsed.data.botId ||
    checked.data.workspaceId === ""
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The Bot monitor list does not match its requested scope or contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

/** Bots-page parked-watch approval (`bot.monitor_approve`): arms the
 *  monitor's CURRENT rule text through the daemon's hash-bound approval —
 *  the same call the CLI sends, never a second path. Native resolves the
 *  bot's owning workspace for the app-global "" sentinel and echoes the
 *  RESOLVED scope, so this gate demands a real workspace id back, the
 *  exact botId/monitorId, and a confirmed `approved: true` before the
 *  renderer may flip the parked card. */
export async function dispatchBotMonitorApprove(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotMonitorApproveResult>> {
  const parsed = botMonitorApproveInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot monitor approval request.",
        retryable: false,
      },
    };
  const result = await call("bot.monitor_approve", parsed.data);
  if (!result.ok) return result;
  const checked = botMonitorApproveResultSchema.safeParse(result.result);
  if (
    !checked.success ||
    checked.data.hostId !== parsed.data.hostId ||
    checked.data.botId !== parsed.data.botId ||
    checked.data.monitorId !== parsed.data.monitorId ||
    !scopeEchoMatches(parsed.data.workspaceId, checked.data.workspaceId) ||
    checked.data.approved !== true
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The monitor approval does not match its requested scope or contract.",
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

// R9-C: bot-level delete dispatcher. Same envelope convention as the
// responsibility dispatchers above: `requestId` travels as the native
// envelope id (ledger key), never inside params.
export async function dispatchBotDelete(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotDeleteResult>> {
  const parsed = botDeleteInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot delete request.",
        retryable: false,
      },
    };
  // `locale` rides the caller's scope triple; native's params deny it.
  const { requestId, locale: _locale, ...params } = parsed.data;
  const result = await call("bot.delete", params, requestId);
  if (!result.ok) return result;
  const checked = botDeleteResultSchema.safeParse(result.result);
  if (
    !checked.success ||
    checked.data.hostId !== params.hostId ||
    !scopeEchoMatches(params.workspaceId, checked.data.workspaceId, true) ||
    checked.data.botId !== params.botId
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The deleted bot does not match its requested scope or contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

/**
 * Registers `drogon:botCreate`/`drogon:botRun`/`drogon:botHistory`/
 * `drogon:botResponsibilityCreate`/`drogon:botResponsibilityDelete`/
 * `drogon:botDelete` with
 * the same sender/frame gate main/index.ts applies to its own bridge. Own
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
  ipcMain.handle(
    "drogon:botResponsibilityCreate",
    guarded(dispatchBotResponsibilityCreate),
  );
  ipcMain.handle(
    "drogon:botResponsibilityDelete",
    guarded(dispatchBotResponsibilityDelete),
  );
  ipcMain.handle("drogon:botDelete", guarded(dispatchBotDelete));
  ipcMain.handle("drogon:botMonitorList", guarded(dispatchBotMonitorList));
  ipcMain.handle(
    "drogon:botMonitorApprove",
    guarded(dispatchBotMonitorApprove),
  );
}
