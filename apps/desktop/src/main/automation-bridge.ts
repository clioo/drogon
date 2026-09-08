import { ipcMain } from "electron";
import {
  automationInputSchemas,
  automationRequestSchema,
  automationResultSchemas,
} from "../shared/automation-contract";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

export const AUTOMATION_IPC_CHANNEL = "drogon:automation";

type AutomationOp = keyof typeof automationInputSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const NATIVE_METHOD: Record<AutomationOp, keyof typeof automationResultSchemas> = {
  create: "automation.create",
  list: "automation.list",
  update: "automation.update",
  delete: "automation.delete",
  runNow: "automation.run_now",
  history: "automation.history",
  runsAll: "automation.runs_all",
  run: "automation.run",
};

const invalid = (): Result<never> => ({
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid automation request.",
    retryable: false,
  },
});

export async function dispatchAutomationRequest(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const envelope = automationRequestSchema.safeParse(input);
  if (!envelope.success) return invalid();
  const { op, params } = envelope.data;
  const parsed = automationInputSchemas[op].safeParse(params);
  if (!parsed.success) return invalid();
  const nativeMethod = NATIVE_METHOD[op];
  const result = await call(nativeMethod, parsed.data as object);
  if (!result.ok) return result;
  const checked = automationResultSchemas[nativeMethod].safeParse(result.result);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The automation response does not match its contract.",
        retryable: false,
      },
    };
  const output = checked.data as Record<string, unknown>;
  // Identity echo: a response for another automation (or run) is never
  // returned. `list`/`runsAll` are aggregations with no single identity.
  const wantId =
    op === "history"
      ? (parsed.data as { automationId: string }).automationId
      : op === "run"
        ? (parsed.data as { runId: string }).runId
        : (parsed.data as { id?: string }).id;
  if (wantId !== undefined) {
    const gotId =
      op === "history"
        ? (output.runs as { automationId: string }[]).every(
            (run) => run.automationId === wantId,
          )
          ? wantId
          : null
        : ((output.id ?? output.automationId ?? null) as string | null);
    if (gotId !== wantId)
      return {
        ok: false,
        error: {
          code: "internal_error",
          message: "The automation response does not match the requested identity.",
          retryable: false,
        },
      };
  }
  return { ok: true, result: checked.data };
}

/**
 * Single wiring point for the automation channel. The sender guard keeps
 * this channel to the app's own main frame, matching registerBridge.
 */
export function registerAutomationIpc(
  isMainFrameSender: (event: Electron.IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(AUTOMATION_IPC_CHANNEL, async (event, input: unknown) => {
    if (!isMainFrameSender(event)) return invalid();
    return dispatchAutomationRequest(input);
  });
}
