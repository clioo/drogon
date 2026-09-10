import type { GitBridge } from "../../../../shared/git-contract";
import type { ProjectBridge } from "../../../../shared/project-contract";
import type { ShellBridge as NativeShellBridge } from "../../../../shared/shell-contract";

/**
 * Renderer-side shape of the granted `window.drogon.shell.*` namespace
 * (main/shell-bridge.ts). Declared here instead of imported from
 * preload/shell.ts: the renderer bundle must not import Electron code.
 */
export type ShellBridge = Partial<Pick<NativeShellBridge, "openExternal">> & {
  showItemInFolder(input: { path: string }): Promise<
    | { ok: true; result: { shown: boolean } }
    | { ok: false; error: { code: string; message: string; retryable: boolean } }
  >;
  openPath(input: { path: string }): Promise<
    | { ok: true; result: { opened: boolean } }
    | { ok: false; error: { code: string; message: string; retryable: boolean } }
  >;
};

/**
 * The granted `window.drogon.shell.*` / `project.worktreeRename` /
 * `git.gitStatus` namespaces for worktree card actions. DesktopBridge
 * (coordinator-owned) does not declare them yet, so the casts live here
 * — one place — rather than at every call site. Follow-up for the
 * coordinator: declare `shell`, `project` and `git` on DesktopBridge and
 * delete these helpers (same note as changes-mount.ts `windowGitBridge`).
 */
export function windowShellBridge(): ShellBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window.drogon as unknown as { shell?: ShellBridge } | undefined)?.shell;
  return bridge ?? null;
}

export function windowWorktreeRenameBridge(): Pick<
  ProjectBridge,
  "worktreeRename"
> | null {
  const project = (
    window.drogon as unknown as {
      project?: Pick<ProjectBridge, "worktreeRename">;
    }
  ).project;
  return project?.worktreeRename ? project : null;
}

export function windowCardGitBridge(): Pick<GitBridge, "gitStatus"> | null {
  const git = (
    window.drogon as unknown as { git?: Pick<GitBridge, "gitStatus"> }
  ).git;
  return git?.gitStatus ? git : null;
}
