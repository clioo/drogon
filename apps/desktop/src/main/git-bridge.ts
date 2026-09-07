import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { gitBridgeSchemas, gitResultSchemas } from "../shared/git-contract";
import { resultSchemas } from "../shared/result-validation";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

// The git result schemas live in shared/git-contract.ts (this vertical's
// granted file) rather than shared/result-validation.ts (coordinator-owned):
// registering them here keeps native-client's `resultSchemas[method]` lookup
// exact without touching that file. If the coordinator later moves them into
// result-validation.ts, delete this loop — the keys are identical.
for (const [method, schema] of Object.entries(gitResultSchemas)) {
  resultSchemas[method] = schema;
}

export type GitMethod = keyof typeof gitBridgeSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const nativeMethodFor: Record<GitMethod, string> = {
  gitStatus: "git.status",
  gitDiff: "git.diff",
  gitStage: "git.stage",
  gitUnstage: "git.unstage",
  gitCommit: "git.commit",
  gitPush: "git.push",
  gitPrCreate: "git.pr_create",
};

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid git request.",
    retryable: false,
  },
} as const;

export async function dispatchGitRequest(
  method: GitMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = gitBridgeSchemas[method].safeParse(input);
  if (!parsed.success) return { ...invalid };
  const value = parsed.data as { hostId: string; workspaceId: string };
  const nativeMethod = nativeMethodFor[method];
  const result = await call(nativeMethod, parsed.data);
  if (!result.ok) return result;
  const checked =
    gitResultSchemas[nativeMethod as keyof typeof gitResultSchemas].safeParse(
      result.result,
    );
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The git response does not match its contract.",
        retryable: false,
      },
    };
  const output = checked.data as { hostId: string; workspaceId: string };
  if (output.hostId !== value.hostId || output.workspaceId !== value.workspaceId)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The git response does not match the requested scope.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

const channelFor: Record<GitMethod, string> = {
  gitStatus: "drogon:gitStatus",
  gitDiff: "drogon:gitDiff",
  gitStage: "drogon:gitStage",
  gitUnstage: "drogon:gitUnstage",
  gitCommit: "drogon:gitCommit",
  gitPush: "drogon:gitPush",
  gitPrCreate: "drogon:gitPrCreate",
};

/**
 * Registers one `ipcMain.handle` per git channel with the same
 * sender/frame gate main/index.ts applies to its own bridge. Own
 * registration (rather than bridgeSchemas entries) because that map is
 * coordinator-owned; the schemas enforced here are identical in spirit.
 */
export function registerGitBridge(
  getWindow: () => BrowserWindow | null,
): void {
  for (const method of Object.keys(gitBridgeSchemas) as GitMethod[]) {
    ipcMain.handle(channelFor[method], async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      return dispatchGitRequest(method, input);
    });
  }
}
