// MIT Copyright (c) 2026 Lovecast Inc.
// Native file-drop contract for terminal panes. The preload resolves the
// filesystem paths while it still owns Electron's File objects; only the
// bounded, pane-routed payload crosses into the renderer.

export const TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL =
  "drogon:terminalFileDropFromPreload";
export const TERMINAL_FILE_DROP_CHANNEL = "drogon:terminalFileDrop";

/** Internal explorer drags must stay on their existing workspace-path path. */
export const WORKSPACE_FILE_PATH_MIME = "text/x-orca-file-path";
export const WORKSPACE_FILE_PATHS_MIME = "text/x-orca-file-paths";

export const MAX_TERMINAL_FILE_DROP_PATHS = 256;
export const MAX_TERMINAL_FILE_DROP_BYTES = 256 * 1024;

export type TerminalFileDropPathEntry = {
  nativeFileDropTarget?: string;
  terminalTabId?: string;
  terminalPaneLeafId?: string;
};

export type TerminalFileDropTarget = {
  tabId?: string;
  paneLeafId?: string;
};

export type TerminalFileDropPayload = {
  paths: string[];
  tabId?: string;
  paneLeafId?: string;
};

export type TerminalFileDropBridge = {
  onDrop(listener: (payload: TerminalFileDropPayload) => void): () => void;
};

/** True for an OS file drag, but false for an in-app Explorer path drag. */
export function hasNativeTerminalFileDragTypes(
  types: Iterable<string> | ArrayLike<string> | null | undefined,
): boolean {
  const values = types ? Array.from(types) : [];
  return (
    values.includes("Files") &&
    !values.includes(WORKSPACE_FILE_PATH_MIME) &&
    !values.includes(WORKSPACE_FILE_PATHS_MIME)
  );
}

/** Finds the nearest terminal pane marker in a composed DOM event path. */
export function resolveTerminalFileDropTarget(
  entries: readonly TerminalFileDropPathEntry[],
): TerminalFileDropTarget | null {
  for (const entry of entries) {
    if (entry.nativeFileDropTarget !== "terminal") continue;
    return {
      ...(entry.terminalTabId ? { tabId: entry.terminalTabId } : {}),
      ...(entry.terminalPaneLeafId
        ? { paneLeafId: entry.terminalPaneLeafId }
        : {}),
    };
  }
  return null;
}

export type TerminalFileDropPathValidation =
  | { status: "accepted"; byteLength: number; pathCount: number }
  | {
      status: "rejected";
      byteLength: number;
      pathCount: number;
      reason: "paths-too-large" | "too-many-paths";
    };

export function validateTerminalFileDropPaths(
  paths: readonly string[],
): TerminalFileDropPathValidation {
  if (paths.length > MAX_TERMINAL_FILE_DROP_PATHS) {
    return {
      status: "rejected",
      byteLength: 0,
      pathCount: paths.length,
      reason: "too-many-paths",
    };
  }

  let byteLength = 0;
  for (const path of paths) {
    if (!path) {
      return {
        status: "rejected",
        byteLength,
        pathCount: paths.length,
        reason: "paths-too-large",
      };
    }
    byteLength += new TextEncoder().encode(path).length;
    if (byteLength > MAX_TERMINAL_FILE_DROP_BYTES) {
      return {
        status: "rejected",
        byteLength,
        pathCount: paths.length,
        reason: "paths-too-large",
      };
    }
  }
  return { status: "accepted", byteLength, pathCount: paths.length };
}

export function isTerminalFileDropPayload(
  value: unknown,
): value is TerminalFileDropPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (
    !Array.isArray(payload.paths) ||
    !payload.paths.every((path) => typeof path === "string")
  ) {
    return false;
  }
  if (
    (payload.tabId !== undefined && typeof payload.tabId !== "string") ||
    (payload.paneLeafId !== undefined && typeof payload.paneLeafId !== "string")
  ) {
    return false;
  }
  return validateTerminalFileDropPaths(payload.paths).status === "accepted";
}

declare module "./session-contract" {
  interface DesktopBridge {
    terminalFileDrop?: TerminalFileDropBridge;
  }
}
