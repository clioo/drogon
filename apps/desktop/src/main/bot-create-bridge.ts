import {
  botCreateInputSchema,
  botCreateResultSchema,
} from "../shared/bot-validation";
import type { BotsPanelBot } from "../shared/bot-contract";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

export async function dispatchBotCreate(
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<BotsPanelBot>> {
  const parsed = botCreateInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid Bot creation request.",
        retryable: false,
      },
    };
  const { requestId, ...params } = parsed.data;
  const result = await call("bot.create", params, requestId);
  if (!result.ok) return result;
  const checked = botCreateResultSchema.safeParse(result.result);
  if (
    !checked.success ||
    (params.botId != null && checked.data.id !== params.botId)
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The created Bot does not match the requested identity or born-empty contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}
