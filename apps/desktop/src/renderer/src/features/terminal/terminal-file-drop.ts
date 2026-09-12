// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/terminal-pane/pane-helpers.ts. The shell
// selection is local-only in Drogon: the daemon currently runs on this host.
import {
  getWorkspaceFileDragRejectionMessage,
  readWorkspaceFileDragPaths,
  WORKSPACE_FILE_PATH_MIME,
  WORKSPACE_FILE_PATHS_MIME,
} from "../file-explorer/workspace-file-drag";

export type TerminalFileDropShell = "posix" | "windows";

export function terminalFileDropShellForPlatform(
  platform: NodeJS.Platform,
): TerminalFileDropShell {
  return platform === "win32" ? "windows" : "posix";
}

export function terminalFileDropShellForUserAgent(
  userAgent: string,
): TerminalFileDropShell {
  return userAgent.includes("Windows") ? "windows" : "posix";
}

/** Quotes a dropped path without allowing its filename to become shell input. */
export function shellEscapeTerminalFilePath(
  filePath: string,
  targetShell: TerminalFileDropShell,
): string {
  if (targetShell === "windows") {
    return /^[a-zA-Z0-9_./@:\\-]+$/.test(filePath) ? filePath : `"${filePath}"`;
  }

  if (/^[a-zA-Z0-9_./@:-]+$/.test(filePath)) return filePath;
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

/** Formats one or more paths as the terminal's normal space-separated input. */
export function formatTerminalFileDropPaths(
  paths: readonly string[],
  targetShell: TerminalFileDropShell,
): string {
  return paths
    .filter((filePath) => filePath.length > 0)
    .map((filePath) => `${shellEscapeTerminalFilePath(filePath, targetShell)} `)
    .join("");
}

export function hasWorkspaceFileDragType(
  types: Iterable<string> | ArrayLike<string> | null | undefined,
): boolean {
  const values = types ? Array.from(types) : [];
  return (
    values.includes(WORKSPACE_FILE_PATH_MIME) ||
    values.includes(WORKSPACE_FILE_PATHS_MIME)
  );
}

/** Converts the Explorer's workspace-relative path to a safe absolute path. */
export function resolveWorkspaceFileDropPath(
  workspacePath: string,
  workspaceRelativePath: string,
): string | null {
  const normalized = workspaceRelativePath.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return null;
  }
  const separator = workspacePath.includes("\\") ? "\\" : "/";
  const root = workspacePath.replace(/[\\/]+$/, "");
  const relative = normalized.replace(/\//g, separator);
  if (!root) return `${separator}${relative}`;
  return `${root}${separator}${relative}`;
}

export type RegisterTerminalInternalFileDropOptions = {
  container: HTMLElement;
  workspaceId: string;
  resolveWorkspacePath: () => Promise<string | null>;
  pasteFilePaths: (paths: readonly string[]) => Promise<void>;
  focus: () => void;
  report: (message: string) => void;
};

/** Handles the renderer-owned File Explorer MIME payload on one pane. */
export function registerTerminalInternalFileDropListeners({
  container,
  workspaceId,
  resolveWorkspacePath,
  pasteFilePaths,
  focus,
  report,
}: RegisterTerminalInternalFileDropOptions): () => void {
  const onDragOver = (event: DragEvent): void => {
    if (!hasWorkspaceFileDragType(event.dataTransfer?.types)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (event: DragEvent): void => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer || !hasWorkspaceFileDragType(dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    const dragPaths = readWorkspaceFileDragPaths(dataTransfer);
    if (dragPaths.status === "rejected") {
      report(getWorkspaceFileDragRejectionMessage(dragPaths.reason));
      return;
    }
    if (dragPaths.paths.length === 0) return;
    void (async () => {
      const workspacePath = await resolveWorkspacePath();
      if (!workspacePath) {
        report(`Workspace ${workspaceId} is not available.`);
        return;
      }
      const paths = dragPaths.paths
        .map((path) => resolveWorkspaceFileDropPath(workspacePath, path))
        .filter((path): path is string => path !== null);
      if (paths.length === 0) {
        report("The dropped workspace paths are invalid.");
        return;
      }
      focus();
      await pasteFilePaths(paths);
    })().catch(() => report("File drop failed."));
  };

  container.addEventListener("dragover", onDragOver, { capture: true });
  container.addEventListener("drop", onDrop, { capture: true });
  return () => {
    container.removeEventListener("dragover", onDragOver, { capture: true });
    container.removeEventListener("drop", onDrop, { capture: true });
  };
}
