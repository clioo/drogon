/* MIT Copyright (c) 2026 Lovecast Inc. Ported (naming/reuse semantics only,
   no code copied verbatim) from Orca's
   src/renderer/src/store/slices/editor/types/open-file.ts (`id` keyed by
   file path — "use filePath as unique key") and
   src/renderer/src/store/slices/editor/actions/open-file-apply.ts (an open
   request for a path that is already open reuses the existing tab instead
   of minting a second one). Adapter: this build has no diff/conflict/
   markdown-preview modes and no multi-runtime ownership, so the editor tab
   is reduced to the workspace+path identity, a display title and a dirty
   flag. Tabs are workspace-scoped (files never share a tab across
   workspaces) and, like FilesOpenEntry's scopeKey elsewhere in this repo,
   never actively cleared on a workspace switch — a foreign-workspace tab
   is simply filtered out of the visible strip and never becomes active,
   which is also what lets an open-and-switch-workspace request land in the
   same tick without a reset effect racing it. */

/** One open file in the main tab strip, scoped to the workspace it belongs
 *  to. `tabId` combines both: a workspace never has two tabs open for the
 *  same file (opening an already-open path reuses its tab instead of
 *  duplicating it), and the same path in two different workspaces never
 *  collides. */
export interface EditorTabState {
  tabId: string;
  workspaceId: string;
  path: string;
  /** Unsaved-changes indicator shown as a dot on the tab, like the fork. */
  dirty: boolean;
}

/** The stable identity for one workspace's open file. */
export function editorTabId(workspaceId: string, path: string): string {
  return `${workspaceId}::${path}`;
}

/** The tab strip's label for a file: its base name, matching the fork's
 *  editor tabs (never the full relative path). */
export function editorTabLabel(path: string): string {
  const name = path.split("/").pop();
  return name && name.length > 0 ? name : path;
}
