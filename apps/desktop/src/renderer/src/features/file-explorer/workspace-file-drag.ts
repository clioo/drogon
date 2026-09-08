// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/lib/workspace-file-drag.ts: the internal workspace-file
// drag payload (single + multi path MIME), top-level path filtering, and the
// rejection copy. Adapted: this explorer addresses rows by workspace-
// relative paths (the fork normalizes absolute runtime paths), so the
// normalization here is the relative-path equivalent; the native OS file
// drop branch (import via preload relay) stays out of MVP scope, like the
// source-gated import surface.
//
// Internal-app MIME tokens kept verbatim from the source.

export const WORKSPACE_FILE_PATH_MIME = "text/x-orca-file-path";
export const WORKSPACE_FILE_PATHS_MIME = "text/x-orca-file-paths";

const MAX_DRAG_PATHS = 256;

export type WorkspaceFileDragRejectionReason = "paths-too-large" | "too-many-paths";

export type WorkspaceFileDragPathsReadResult =
  | { pathCount: number; paths: string[]; status: "accepted" }
  | { pathCount: number; reason: WorkspaceFileDragRejectionReason; status: "rejected" };

/** Multi-selection rides the plural MIME; single paths the legacy one. */
export function encodeWorkspaceFilePaths(paths: readonly string[]): string {
  return paths.length === 1 ? paths[0] : JSON.stringify(paths);
}

function decodeWorkspaceFilePathPayload(
  data: string,
  maxPaths: number,
): { pathCount: number; paths: string[]; status: "accepted" } | { pathCount: number; reason: "too-many-paths"; status: "rejected" } {
  if (!data) {
    return { pathCount: 0, paths: [], status: "accepted" };
  }
  try {
    const parsed: unknown = JSON.parse(data);
    if (Array.isArray(parsed)) {
      const paths: string[] = [];
      let pathCount = 0;
      for (const value of parsed) {
        if (typeof value !== "string") continue;
        pathCount += 1;
        if (pathCount <= maxPaths) paths.push(value);
      }
      if (pathCount > maxPaths) return { pathCount, reason: "too-many-paths", status: "rejected" };
      return { pathCount, paths, status: "accepted" };
    }
  } catch {
    // Plain path string from legacy single-file drags.
  }
  if (maxPaths < 1) return { pathCount: 1, reason: "too-many-paths", status: "rejected" };
  return { pathCount: 1, paths: [data], status: "accepted" };
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
}

function isSameOrDescendant(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/**
 * Why top-level filtering: moving a selected folder already moves its
 * descendants; issuing extra moves for selected children races against
 * paths that no longer exist (source comment, verbatim reasoning).
 */
function getTopLevelWorkspaceFilePaths(paths: readonly string[]): string[] {
  const unique: { normalized: string; path: string }[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    const normalized = normalizeRelPath(path);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push({ normalized, path });
    }
  }
  return unique
    .filter(
      (entry) =>
        !unique.some(
          (candidateRoot) =>
            candidateRoot.normalized !== entry.normalized &&
            isSameOrDescendant(entry.normalized, candidateRoot.normalized),
        ),
    )
    .map((entry) => entry.path);
}

/** Test hook: exposes the top-level filter for the payload unit tests. */
export function getTopLevelForTests(paths: readonly string[]): string[] {
  return getTopLevelWorkspaceFilePaths(paths);
}

export function readWorkspaceFileDragPaths(
  dataTransfer: Pick<DataTransfer, "getData">,
): WorkspaceFileDragPathsReadResult {
  const multiPathData = dataTransfer.getData(WORKSPACE_FILE_PATHS_MIME);
  const data = multiPathData || dataTransfer.getData(WORKSPACE_FILE_PATH_MIME);
  if (!data) {
    return { pathCount: 0, paths: [], status: "accepted" };
  }
  if (data.length > 65_536) {
    return { pathCount: 0, reason: "paths-too-large", status: "rejected" };
  }
  const decoded = decodeWorkspaceFilePathPayload(data, MAX_DRAG_PATHS);
  if (decoded.status === "rejected") {
    return { pathCount: decoded.pathCount, reason: decoded.reason, status: "rejected" };
  }
  const paths = getTopLevelWorkspaceFilePaths(decoded.paths);
  return { pathCount: paths.length, paths, status: "accepted" };
}

export function getWorkspaceFileDragPaths(dataTransfer: Pick<DataTransfer, "getData">): string[] {
  const result = readWorkspaceFileDragPaths(dataTransfer);
  return result.status === "accepted" ? result.paths : [];
}

export function getWorkspaceFileDragRejectionMessage(
  reason: WorkspaceFileDragRejectionReason,
): string {
  if (reason === "too-many-paths") {
    return "Drop contains too many paths.";
  }
  return "Drop path list is too large.";
}
