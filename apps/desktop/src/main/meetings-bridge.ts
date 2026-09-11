// MIT Copyright (c) 2026 Lovecast Inc.
// Meetings (the owner's own Write That Down notes) — main-process bridge.
// Adapted from orca-drogon's src/main/meetings/write-that-down-bridge.ts
// (IPC registration + trusted-sender check + zod-validated result) with a
// different data layer: the reference resolved + parsed the notes in the
// Electron main process, this build asks the daemon (`meeting.list` /
// `meeting.read`) so the desktop, the CLI and a Bot all read the SAME index
// through the same validation.
//
// Both methods are reads. Nothing here can write to the notes directory:
// there is no write op on the channel, and the daemon advertises the index
// as read-only.
import { ipcMain } from "electron";
import {
  meetingAnalysisSchema,
  meetingCommitmentPageSchema,
  meetingCommitmentSchema,
  meetingReadSchema,
  meetingsPageSchema,
  meetingsRequestSchema,
} from "../shared/meetings-contract";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

export const MEETINGS_IPC_CHANNEL = "drogon:meetings";

type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const invalid = (): Result<never> => ({
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid meetings request.",
    retryable: false,
  },
});

/**
 * Answers one validated request. The response is re-validated against the
 * shared contract before it reaches the renderer: the page's honest states
 * depend on the availability taxonomy, on every extracted suggestion
 * carrying a verified quote, and on a commitment never being open and
 * resolved at once — so a malformed daemon answer is refused instead of
 * rendered.
 *
 * `meeting.analyze` runs the free local model and can take minutes; that is
 * the daemon's own bounded run (it kills its process group on timeout), so
 * this bridge adds no second timeout of its own.
 */
export async function dispatchMeetingsRequest(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const envelope = meetingsRequestSchema.safeParse(input);
  if (!envelope.success) return invalid();
  const { op, params } = envelope.data;
  switch (op) {
    case "list": {
      const result = await call("meeting.list", params ?? {});
      if (!result.ok) return result;
      return revalidate(result.result, meetingsPageSchema);
    }
    case "read": {
      const result = await call("meeting.read", params);
      if (!result.ok) return result;
      return revalidate(result.result, meetingReadSchema);
    }
    case "analyze": {
      const result = await call("meeting.analyze", params);
      if (!result.ok) return result;
      return revalidate(result.result, meetingAnalysisSchema);
    }
    case "commitments": {
      const result = await call("meeting.commitment_list", params ?? {});
      if (!result.ok) return result;
      return revalidate(result.result, meetingCommitmentPageSchema);
    }
    case "accept": {
      const result = await call("meeting.commitment_create", params);
      if (!result.ok) return result;
      return revalidate(result.result, meetingCommitmentSchema);
    }
    case "resolve": {
      const result = await call("meeting.commitment_update", params);
      if (!result.ok) return result;
      return revalidate(result.result, meetingCommitmentSchema);
    }
    default:
      return invalid();
  }
}

function revalidate<T>(
  value: unknown,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T } },
): Result<unknown> {
  const checked = schema.safeParse(value);
  if (!checked.success || checked.data === undefined) return contractViolation();
  return { ok: true, result: checked.data };
}

function contractViolation(): Result<never> {
  return {
    ok: false,
    error: {
      code: "internal_error",
      message:
        "The meetings response does not match its contract (the notes index must report read-only states).",
      retryable: false,
    },
  };
}

export function registerMeetingsIpc(
  isMainFrameSender: (event: Electron.IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(MEETINGS_IPC_CHANNEL, async (event, input: unknown) => {
    if (!isMainFrameSender(event)) return invalid();
    return dispatchMeetingsRequest(input);
  });
}
