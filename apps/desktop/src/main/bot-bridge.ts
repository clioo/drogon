import {
  botSnapshotInputSchema,
  botSnapshotResultSchema,
} from "../shared/bot-validation";
import type { Result } from "../shared/session-contract";
import type { BotScope, BotsPanelSnapshot } from "../shared/bot-contract";
import { callNative } from "./native-client";

type NativeCall = (method: string, params: object) => Promise<Result<unknown>>;

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
