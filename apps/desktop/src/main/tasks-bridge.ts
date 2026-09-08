import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  tasksBridgeSchemas,
  tasksResultSchemas,
} from "../shared/tasks-contract";
import { resultSchemas } from "../shared/result-validation";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

// The tasks result schemas live in shared/tasks-contract.ts (this vertical's
// granted file) rather than shared/result-validation.ts (coordinator-owned):
// registering them here keeps native-client's `resultSchemas[method]` lookup
// exact without touching that file. If the coordinator later moves them into
// result-validation.ts, delete this loop — the keys are identical.
for (const [method, schema] of Object.entries(tasksResultSchemas)) {
  resultSchemas[method] = schema;
}

export type TasksMethod = keyof typeof tasksBridgeSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const nativeMethodFor: Record<TasksMethod, string> = {
  tasksList: "tasks.list",
  tasksShow: "tasks.show",
  tasksStart: "tasks.start",
  tasksLinks: "tasks.links",
  tasksRemotes: "tasks.remotes",
  tasksProjects: "project.list",
  tasksWorktrees: "worktree.list",
};

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid tasks request.",
    retryable: false,
  },
} as const;

export async function dispatchTasksRequest(
  method: TasksMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = tasksBridgeSchemas[method].safeParse(input);
  if (!parsed.success) return { ...invalid };
  const value = parsed.data as { projectId: string };
  const nativeMethod = nativeMethodFor[method];
  // The project/worktree passthroughs below own their dispatch (fan-out
  // and workspace merge); this path only serves the four tasks.* methods.
  if (method === "tasksProjects" || method === "tasksWorktrees")
    return dispatchTasksProjectRequest(method, input, call);
  const result = await call(nativeMethod, parsed.data);
  if (!result.ok) return result;
  const checked =
    tasksResultSchemas[
      nativeMethod as keyof typeof tasksResultSchemas
    ].safeParse(result.result);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The tasks response does not match its contract.",
        retryable: false,
      },
    };
  // Only `tasks.start` echoes the project back (on its worktree and
  // link); list/show return the derived repo slug and the issue, which
  // carry no scope to check — never invent one.
  if (nativeMethod === "tasks.start") {
    const output = checked.data as {
      worktree: { projectId: string };
      link: { projectId: string };
    };
    if (
      output.worktree.projectId !== value.projectId ||
      output.link.projectId !== value.projectId
    )
      return {
        ok: false,
        error: {
          code: "internal_error",
          message: "The tasks response does not match the requested scope.",
          retryable: false,
        },
      };
  }
  return { ok: true, result: checked.data };
}

type ProjectRef = {
  id: string;
  hostId: string;
  path: string;
  name: string;
  kind: "git" | "folder";
  defaultBaseRef: string | null;
};
type WorkspaceRef = {
  id: string;
  path: string;
  name: string;
  kind: "folder" | "git";
  hostId: string;
};
type WorktreeRef = {
  id: string;
  projectId: string;
  workspaceId: string;
  path: string;
  branch: string;
  head: string;
  baseRef: string | null;
  // Synthetic rows have no daemon row to rename; daemon rows always carry
  // the key (null when never renamed), so this stays required, never absent.
  title: string | null;
  createdAt: string;
};

async function checkedNative<T>(
  call: NativeCall,
  method: string,
  params: object,
): Promise<T | null> {
  const result = await call(method, params);
  if (!result.ok) return null;
  const schema =
    tasksResultSchemas[method as keyof typeof tasksResultSchemas];
  const checked = schema.safeParse(result.result);
  return checked.success ? (checked.data as T) : null;
}

/**
 * Interim project/worktree serving (journey J6): real `project.list` /
 * `worktree.list` / `workspace.list` data through this bridge until the
 * coordinator lands the first-class project bridge. `tasksProjects`
 * merges plain workspaces (registered without a project) as synthetic
 * folder projects using the renderer's own `folder:` convention, so the
 * sidebar keeps showing them instead of losing the Add-folder flow; a
 * workspace whose path a real project covers is skipped, never doubled.
 * `tasksWorktrees` without a projectId fans out per project (the daemon
 * synthesizes each folder project's implicit worktree itself) plus one
 * implicit worktree per uncovered workspace. Every row is contract-
 * validated; a failing project is skipped, never invented.
 */
export async function dispatchTasksProjectRequest(
  method: "tasksProjects" | "tasksWorktrees",
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = tasksBridgeSchemas[method].safeParse(input);
  if (!parsed.success) return { ...invalid };
  if (method === "tasksProjects") {
    const projects = await checkedNative<{ projects: ProjectRef[] }>(
      call,
      "project.list",
      {},
    );
    const workspaces = await checkedNative<{ workspaces: WorkspaceRef[] }>(
      call,
      "workspace.list",
      {},
    );
    if (!projects || !workspaces) return { ...invalid };
    // A project's own path plus every worktree checkout it owns cover
    // their workspaces: without the worktree paths, each started task
    // would reappear as a duplicate synthetic folder next to its card.
    const covered = new Set(projects.projects.map((item) => item.path));
    for (const project of projects.projects) {
      const trees = await checkedNative<{ worktrees: WorktreeRef[] }>(
        call,
        "worktree.list",
        { projectId: project.id },
      );
      if (!trees) return { ...invalid };
      for (const tree of trees.worktrees) covered.add(tree.path);
    }
    const merged = [...projects.projects];
    for (const workspace of workspaces.workspaces) {
      if (covered.has(workspace.path)) continue;
      merged.push({
        id: `folder:${workspace.id}`,
        hostId: workspace.hostId,
        path: workspace.path,
        name: workspace.name,
        kind: workspace.kind,
        defaultBaseRef: null,
      });
    }
    const checked = tasksResultSchemas["project.list"].safeParse({
      projects: merged,
    });
    if (!checked.success) return { ...invalid };
    return { ok: true, result: checked.data };
  }
  // Fail-closed throughout: any native failure refuses the whole call
  // (callers fall back to the workspace projection) instead of reporting
  // a partial or empty list as the full picture.
  const projectId = (parsed.data as { projectId?: string }).projectId;
  const projects =
    projectId !== undefined
      ? null
      : await checkedNative<{ projects: ProjectRef[] }>(
          call,
          "project.list",
          {},
        );
  if (projectId === undefined && !projects) return { ...invalid };
  const ids: string[] =
    projectId !== undefined
      ? [projectId]
      : projects!.projects.map((item) => item.id);
  const worktrees: WorktreeRef[] = [];
  for (const id of ids) {
    const listed = await checkedNative<{ worktrees: WorktreeRef[] }>(
      call,
      "worktree.list",
      { projectId: id },
    );
    if (!listed) return { ...invalid };
    worktrees.push(...listed.worktrees);
  }
  if (projectId === undefined) {
    const workspaces = await checkedNative<{ workspaces: WorkspaceRef[] }>(
      call,
      "workspace.list",
      {},
    );
    if (!workspaces) return { ...invalid };
    const covered = new Set(projects!.projects.map((item) => item.path));
    for (const workspace of workspaces.workspaces) {
      if (covered.has(workspace.path)) continue;
      worktrees.push({
        id: `implicit:${workspace.id}`,
        projectId: `folder:${workspace.id}`,
        workspaceId: workspace.id,
        path: workspace.path,
        branch: "",
        head: "",
        baseRef: null,
        title: null,
        createdAt: "",
      });
    }
  }
  const checked = tasksResultSchemas["worktree.list"].safeParse({ worktrees });
  if (!checked.success) return { ...invalid };
  return { ok: true, result: checked.data };
}

const channelFor: Record<TasksMethod, string> = {
  tasksList: "drogon:tasksList",
  tasksShow: "drogon:tasksShow",
  tasksStart: "drogon:tasksStart",
  tasksLinks: "drogon:tasksLinks",
  tasksRemotes: "drogon:tasksRemotes",
  tasksProjects: "drogon:tasksProjects",
  tasksWorktrees: "drogon:tasksWorktrees",
};

/**
 * Registers one `ipcMain.handle` per tasks channel with the same
 * sender/frame gate main/index.ts applies to its own bridge. Own
 * registration (rather than bridgeSchemas entries) because that map is
 * coordinator-owned; the schemas enforced here are identical in spirit.
 */
export function registerTasksBridge(
  getWindow: () => BrowserWindow | null,
): void {
  for (const method of Object.keys(tasksBridgeSchemas) as TasksMethod[]) {
    ipcMain.handle(channelFor[method], async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      return dispatchTasksRequest(method, input);
    });
  }
}
