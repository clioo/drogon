// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/
// use-row-opening.ts (handleOpenDiff) and split-open.ts. The source routes
// row clicks through the zustand store (openDiff / openFile +
// setEditorViewMode); this build's panels are isolated mounts with no
// shared store, so the request rides a window CustomEvent that App — the
// only owner of the main tab strip — turns into an editor tab. The fork's
// split-open modifiers (alt/ctrl/meta/shift open a fresh split group) and
// preview-tab semantics have no counterpart in this build and are not
// ported: a plain click is a permanent tab, exactly the fork's
// openAsPermanent behavior.

export const SOURCE_CONTROL_ROW_OPEN_EVENT = "drogon:open-source-control-row";

/** The uncommitted area the diff belongs to; untracked rides as unstaged
 *  (the fork's openDiff does the same: `staged ? 'staged' : 'unstaged'`). */
export type SourceControlDiffArea = "staged" | "unstaged";

export type SourceControlRowOpenDetail =
  | {
      kind: "diff";
      workspaceId: string;
      /** Workspace-relative path of the changed file. */
      path: string;
      area: SourceControlDiffArea;
    }
  // Fork parity (use-row-opening.ts): an unstaged markdown row opens the
  // file's EDIT tab with the Changes view active instead of a diff tab.
  | { kind: "edit-changes"; workspaceId: string; path: string };

export function dispatchSourceControlRowOpen(detail: SourceControlRowOpenDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SourceControlRowOpenDetail>(SOURCE_CONTROL_ROW_OPEN_EVENT, { detail }),
  );
}

/** The detail carried by a row-open event, validated defensively at the
 *  listener (the event is a window-level contract, not a typed call). */
export function parseSourceControlRowOpenDetail(value: unknown): SourceControlRowOpenDetail | null {
  if (typeof value !== "object" || value === null) return null;
  const detail = value as Record<string, unknown>;
  if (typeof detail.workspaceId !== "string" || detail.workspaceId === "") return null;
  if (typeof detail.path !== "string" || detail.path === "") return null;
  if (detail.kind === "diff") {
    if (detail.area !== "staged" && detail.area !== "unstaged") return null;
    return {
      kind: "diff",
      workspaceId: detail.workspaceId,
      path: detail.path,
      area: detail.area,
    };
  }
  if (detail.kind === "edit-changes") {
    return { kind: "edit-changes", workspaceId: detail.workspaceId, path: detail.path };
  }
  return null;
}
