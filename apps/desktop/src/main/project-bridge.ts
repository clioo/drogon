import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  projectBridgeSchemas,
  projectResultSchemas,
} from "../shared/project-contract";
import { resultSchemas } from "../shared/result-validation";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

// Same registration trick as main/git-bridge.ts: the project/worktree
// result schemas live in the granted shared/project-contract.ts rather
// than the coordinator-owned result-validation.ts, keeping native-client's
// `resultSchemas[method]` lookup exact without touching that file.
for (const [method, schema] of Object.entries(projectResultSchemas)) {
  resultSchemas[method] = schema;
}

export type ProjectMethod = keyof typeof projectBridgeSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const nativeMethodFor: Record<ProjectMethod, string> = {
  projectAdd: "project.add",
  projectList: "project.list",
  projectRemove: "project.remove",
  worktreeCreate: "worktree.create",
  worktreeList: "worktree.list",
  worktreeRemove: "worktree.remove",
};

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid project request.",
    retryable: false,
  },
} as const;

export async function dispatchProjectRequest(
  method: ProjectMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = projectBridgeSchemas[method].safeParse(input);
  if (!parsed.success) return { ...invalid };
  const nativeMethod = nativeMethodFor[method];
  const params =
    parsed.data === undefined
      ? {}
      : (parsed.data as Record<string, unknown>);
  const result = await call(nativeMethod, params);
  if (!result.ok) return result;
  const checked = projectResultSchemas[
    nativeMethod as keyof typeof projectResultSchemas
  ].safeParse(result.result);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The project response does not match its contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

const channelFor: Record<ProjectMethod, string> = {
  projectAdd: "drogon:projectAdd",
  projectList: "drogon:projectList",
  projectRemove: "drogon:projectRemove",
  worktreeCreate: "drogon:worktreeCreate",
  worktreeList: "drogon:worktreeList",
  worktreeRemove: "drogon:worktreeRemove",
};

/**
 * Registers one `ipcMain.handle` per project/worktree channel with the
 * same sender/frame gate main/index.ts applies to its own bridge. Own
 * registration (rather than bridgeSchemas entries) because that map is
 * coordinator-owned; the schemas enforced here are identical in spirit.
 */
export function registerProjectBridge(
  getWindow: () => BrowserWindow | null,
): void {
  for (const method of Object.keys(projectBridgeSchemas) as ProjectMethod[]) {
    ipcMain.handle(channelFor[method], async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      return dispatchProjectRequest(method, input);
    });
  }
}
