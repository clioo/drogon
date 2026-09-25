// Work board — main-process bridge. One channel, one validated request
// shape (`{ op, params }`), each op mapped onto exactly one daemon method,
// and every answer re-validated against the shared contract before it
// reaches the renderer.
import { ipcMain } from "electron";
import { WORK_OPS, workRequestSchema } from "../shared/work-contract";
import type { Result } from "../shared/session-contract";
import { callNative, callNativeHold } from "./native-client";
import { resultSchemas } from "../shared/result-validation";

// The native client refuses any method whose result has no registered
// schema; the Work methods register theirs here (as daemon-restart does for
// runtime.shutdown) so the contract lives next to the only caller.
for (const { method, schema } of Object.values(WORK_OPS)) {
  (resultSchemas as Record<string, unknown>)[method] = schema;
}

export const WORK_IPC_CHANNEL = "drogon:work";

/** Ops that reach a ticket source over the network (a big Linear team or a
 *  GitHub account with many repositories takes seconds), or start agent
 *  sessions. They get a dedicated connection with a long absolute deadline
 *  instead of the pool's short idle timeout. */
export const WORK_SLOW_OPS: ReadonlySet<string> = new Set([
  "providerBoards",
  "importPreview",
  "boardImport",
  "boardSync",
  "boardPush",
  "ticketPush",
  "ticketResolve",
  "sourceConnect",
  "sources",
  "columnSend",
  "ticketMove",
  "ticketCreate",
  "ticketSessionStart",
  "sessionOpen",
]);
export const WORK_SLOW_TIMEOUT_MS = 180_000;

const holdCall: NativeCall = (method, params, requestId) =>
  callNativeHold(method, params as Record<string, unknown>, WORK_SLOW_TIMEOUT_MS, false, requestId);

type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const invalid = (): Result<never> => ({
  ok: false,
  error: { code: "invalid_argument", message: "Invalid work request.", retryable: false },
});

export async function dispatchWorkRequest(
  input: unknown,
  call: NativeCall = callNative,
  slowCall: NativeCall = holdCall,
): Promise<Result<unknown>> {
  const envelope = workRequestSchema.safeParse(input);
  if (!envelope.success) return invalid();
  const { method, schema } = WORK_OPS[envelope.data.op];
  const transport = WORK_SLOW_OPS.has(envelope.data.op) ? slowCall : call;
  const result = await transport(method, envelope.data.params ?? {});
  if (!result.ok) return result;
  const checked = schema.safeParse(result.result);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: `The ${method} response does not match its contract.`,
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

export function registerWorkIpc(
  isMainFrameSender: (event: Electron.IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(WORK_IPC_CHANNEL, async (event, input: unknown) => {
    if (!isMainFrameSender(event)) return invalid();
    return dispatchWorkRequest(input);
  });
}
