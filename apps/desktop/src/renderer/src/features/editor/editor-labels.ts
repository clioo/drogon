// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/editor-labels.ts. The source picks a
// label across many OpenFile modes (diff/markdown-preview/conflict-review/
// check-details); this rewrite's EditorPane only ever shows one file in
// plain edit mode (diffs render through the separate source-control
// DiffViewer), so the mode branching collapses to the three path variants.

// Why only two variants (not the source's three): this app never surfaces
// an absolute filesystem path to the renderer — the daemon resolves
// hostId/workspaceId/path server-side and never returns the absolute form —
// so there is no distinct "fullPath" to show; the workspace-relative `path`
// IS the most specific label this editor can display.
export type EditorLabelVariant = "fileName" | "relativePath";

/** The last path segment, with no dependency on Node's `path` module (renderer-safe). */
export function basename(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Display label for the open file: its workspace-relative path or just the file name. */
export function getEditorDisplayLabel(
  path: string,
  variant: EditorLabelVariant = "fileName",
): string {
  return variant === "relativePath" ? path : basename(path);
}
