import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  mentuBridgeSchemas,
  mentuResultSchemas,
} from "../shared/mentu-contract";
import { resultSchemas } from "../shared/result-validation";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

// Registered here rather than editing shared/result-validation.ts directly:
// identical precedent to main/tasks-bridge.ts's registration of
// `tasksResultSchemas`.
for (const [method, schema] of Object.entries(mentuResultSchemas)) {
  resultSchemas[method] = schema;
}

export type MentuMethod = keyof typeof mentuBridgeSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const nativeMethodFor: Record<MentuMethod, string> = {
  mentuRecipes: "mentu.recipes",
  mentuRecipe: "mentu.recipe",
  mentuRecipeSave: "mentu.recipe_save",
  mentuRuntime: "mentu.runtime",
  mentuApprove: "mentu.approve",
  mentuRun: "mentu.run",
  mentuRuns: "mentu.runs",
  mentuRunStatus: "mentu.run_status",
  mentuRunEvidence: "mentu.run_evidence",
  mentuRetry: "mentu.retry",
  mentuCancel: "mentu.cancel",
};

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid Mentu request.",
    retryable: false,
  },
} as const;

export async function dispatchMentuRequest(
  method: MentuMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = mentuBridgeSchemas[method].safeParse(input);
  if (!parsed.success) return { ...invalid };
  const nativeMethod = nativeMethodFor[method];
  const result = await call(nativeMethod, parsed.data);
  if (!result.ok) return result;
  const checked =
    mentuResultSchemas[
      nativeMethod as keyof typeof mentuResultSchemas
    ].safeParse(result.result);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The Mentu response does not match its contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

const channelFor: Record<MentuMethod, string> = {
  mentuRecipes: "drogon:mentuRecipes",
  mentuRecipe: "drogon:mentuRecipe",
  mentuRecipeSave: "drogon:mentuRecipeSave",
  mentuRuntime: "drogon:mentuRuntime",
  mentuApprove: "drogon:mentuApprove",
  mentuRun: "drogon:mentuRun",
  mentuRuns: "drogon:mentuRuns",
  mentuRunStatus: "drogon:mentuRunStatus",
  mentuRunEvidence: "drogon:mentuRunEvidence",
  mentuRetry: "drogon:mentuRetry",
  mentuCancel: "drogon:mentuCancel",
};

/**
 * Registers one `ipcMain.handle` per Mentu channel with the same
 * sender/frame gate main/index.ts applies to its own bridge. Own
 * registration (rather than `bridgeSchemas` entries) because that map is
 * coordinator-owned; see `main/tasks-bridge.ts` for the identical
 * precedent.
 */
export function registerMentuBridge(
  getWindow: () => BrowserWindow | null,
): void {
  for (const method of Object.keys(mentuBridgeSchemas) as MentuMethod[]) {
    ipcMain.handle(channelFor[method], async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      return dispatchMentuRequest(method, input);
    });
  }
}
