import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  PROJECTS_CHANGED_CHANNEL,
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
  worktreeRename: "worktree.rename",
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
  worktreeRename: "drogon:worktreeRename",
};

/**
 * How often main re-reads the daemon's `project.changes` digest. One
 * second keeps a `drogon-cli project add` visibly live (issue #146's
 * "within 2 s" proof) for one tiny indexed query per tick; the digest
 * itself is a single sha256 over the small registry tables.
 */
export const PROJECT_REGISTRY_POLL_INTERVAL_MS = 1_000;

export type ProjectRegistryWatcherDeps = {
  getWindow: () => BrowserWindow | null;
  /** The current registry revision, or null when unreadable (daemon down, contract violation). */
  readRevision: () => Promise<string | null>;
  pollIntervalMs?: number;
};

/**
 * Polls the registry revision and pushes `drogon:projectsChanged` to the
 * renderer exactly when the registry moved (issue #146). Same posture as
 * the notifications watcher: the first sighting is the baseline rather
 * than a change, a failed read keeps the previous baseline so no move is
 * lost or double-reported, and the interval never keeps the app alive.
 */
export function startProjectRegistryWatcher(
  deps: ProjectRegistryWatcherDeps,
): { tick: () => Promise<void>; stop: () => void } {
  let baseline: string | null = null;
  let inFlight = false;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const revision = await deps.readRevision();
      // Unreadable keeps the baseline: the next tick diffs against it.
      if (revision === null) return;
      if (baseline === null) {
        baseline = revision;
        return;
      }
      if (revision === baseline) return;
      baseline = revision;
      const window = deps.getWindow();
      if (window && !window.isDestroyed())
        window.webContents.send(PROJECTS_CHANGED_CHANNEL, revision);
    } catch {
      // A throwing reader is an unreadable one: keep the baseline.
    } finally {
      inFlight = false;
    }
  }

  const timer = setInterval(
    () => void tick(),
    deps.pollIntervalMs ?? PROJECT_REGISTRY_POLL_INTERVAL_MS,
  );
  // An interval alone must never keep the app alive past its windows.
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    tick,
    stop: () => {
      clearInterval(timer);
    },
  };
}

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
  // Issue #146: out-of-band registry moves (another process's
  // `drogon-cli project add`) reach the renderer as a push. `callNative`
  // already validates `project.changes` against the granted
  // projectResultSchemas entry above; a non-string here only means the
  // contract moved under us, which reads as "unreadable" rather than a
  // push.
  startProjectRegistryWatcher({
    getWindow,
    readRevision: async () => {
      const result = await callNative("project.changes", {});
      if (!result.ok) return null;
      const revision = (result.result as { revision?: unknown }).revision;
      return typeof revision === "string" ? revision : null;
    },
  });
}
