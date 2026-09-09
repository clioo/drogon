import { ipcMain, type BrowserWindow } from "electron";
import { z } from "zod";
import {
  agentSettingsResultSchema,
  agentSettingsUpdateSchema,
} from "../shared/agent-settings-contract";
import { callNative } from "./native-client";

const updateInput = z
  .object({
    updates: agentSettingsUpdateSchema,
    onlyIfUninitialized: z.boolean().optional(),
  })
  .strict();
export function registerAgentSettingsBridge(
  getWindow: () => BrowserWindow | null,
): void {
  for (const [channel, method, schema] of [
    ["drogon:agentSettingsGet", "agent.settings", z.undefined()],
    ["drogon:agentSettingsUpdate", "agent.settings_update", updateInput],
  ] as const) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      const window = getWindow();
      const parsed = schema.safeParse(input);
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        !parsed.success
      ) {
        return {
          ok: false,
          error: {
            code: "invalid_argument",
            message: "Invalid agent settings request",
            retryable: false,
          },
        };
      }
      const result = await callNative(method, parsed.data ?? {});
      if (!result.ok) return result;
      const checked = agentSettingsResultSchema.safeParse(result.result);
      return checked.success
        ? { ok: true, result: checked.data }
        : {
            ok: false,
            error: {
              code: "contract_violation",
              message: "Invalid agent settings response",
              retryable: false,
            },
          };
    });
  }
}
