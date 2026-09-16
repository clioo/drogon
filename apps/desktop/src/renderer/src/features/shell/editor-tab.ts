/* MIT Copyright (c) 2026 Lovecast Inc. Ported (naming/reuse semantics only,
   no code copied verbatim) from Orca's
   src/renderer/src/store/slices/editor/types/open-file.ts (`id` keyed by
   file path — "use filePath as unique key") and
   src/renderer/src/store/slices/editor/actions/open-file-apply.ts (an open
   request for a path that is already open reuses the existing tab instead
   of minting a second one), plus editor-labels.ts's diff source suffixes.
   Adapter: this build has no conflict/markdown-preview modes and no
   multi-runtime ownership. R16-BJ (#294) adds the fork's diff-tab flavor
   (`mode: 'diff'` + diffSource) as `diff`, its per-file editor view mode
   (`editorViewMode`) as `view`, and #302's missing-file tombstone
   (`externalMutation`) as `missing`. Tabs are workspace-scoped (files
   never share a tab across workspaces) and, like FilesOpenEntry's scopeKey
   elsewhere in this repo, never actively cleared on a workspace switch —
   a foreign-workspace tab is simply filtered out of the visible strip and
   never becomes active, which is also what lets an open-and-switch-
   workspace request land in the same tick without a reset effect racing
   it. */

/** Which uncommitted side a diff tab shows. Matches the fork's DiffSource
 *  subset (`staged`/`unstaged`); untracked rows open as unstaged. */
export type EditorTabDiffArea = "staged" | "unstaged";

/** Per-tab editor view mode (fork `editorViewMode`): the Changes view of
 *  the Edit/Changes toggle. Undefined reads as "edit". */
export type EditorTabView = "changes";

/** Why the tab's file vanished from its path. Fork `externalMutation`
 *  subset: the coarse workspace tick carries no paths, so a rename can
 *  only ever surface as "deleted" (the fork marks uncorrelated renames
 *  "deleted" too). */
export type EditorTabMissingKind = "deleted" | "renamed";

/** One open file in the main tab strip, scoped to the workspace it belongs
 *  to. `tabId` combines both: a workspace never has two tabs open for the
 *  same file (opening an already-open path reuses its tab instead of
 *  duplicating it), and the same path in two different workspaces never
 *  collides. A diff tab is additionally keyed by its diff area, so the
 *  staged and unstaged diffs of one file coexist as two tabs (fork
 *  buildDiffEditorFileId). */
export interface EditorTabState {
  tabId: string;
  workspaceId: string;
  path: string;
  /** Unsaved-changes indicator shown as a dot on the tab, like the fork. */
  dirty: boolean;
  /** Present when the tab shows a diff of `path` instead of the file. */
  diff?: EditorTabDiffArea;
  /** Changes view requested for this file's edit tab (fork editorViewMode). */
  view?: EditorTabView;
  /** File gone from `path` while the tab was open (fork externalMutation). */
  missing?: EditorTabMissingKind;
}

/** The stable identity for one workspace's open file. */
export function editorTabId(workspaceId: string, path: string): string {
  return `${workspaceId}::${path}`;
}

/** The stable identity for one workspace's diff tab of a file. Mirrors the
 *  fork's legacy id shape `${worktreeId}::diff::${diffSource}::${path}`. */
export function editorDiffTabId(
  workspaceId: string,
  area: EditorTabDiffArea,
  path: string,
): string {
  return `${workspaceId}::diff::${area}::${path}`;
}

/** The tab strip's label for a file: its base name, matching the fork's
 *  editor tabs (never the full relative path). */
export function editorTabLabel(path: string): string {
  const name = path.split("/").pop();
  return name && name.length > 0 ? name : path;
}

/** Fork editor-labels.ts DIFF_SOURCE_LABELS: the diff tab's label carries
 *  its source ("file.ts (diff)", staged reads "(staged diff)"). */
const DIFF_SOURCE_LABELS: Record<EditorTabDiffArea, string> = {
  staged: "staged diff",
  unstaged: "diff",
};

export function editorDiffTabLabel(path: string, area: EditorTabDiffArea): string {
  return `${editorTabLabel(path)} (${DIFF_SOURCE_LABELS[area]})`;
}

/** Workspace-relative path for renaming `path` to `newName` in its own directory. */
export function renameTargetPath(path: string, newName: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? newName : `${path.slice(0, slash + 1)}${newName}`;
}

export type EditorTabRenameResult = {
  tabs: EditorTabState[];
  /**
   * Tab to activate after the rename: the retargeted tab, the pre-existing
   * tab when the target was already open, or null when nothing changed.
   */
  activatedTabId: string | null;
};

/**
 * Retarget the open tab after a daemon-confirmed file rename (#335): the tab
 * keeps its slot under the new path/identity instead of tombstoning as
 * deleted while a second tab opens for the new path. A target that is
 * already open absorbs the renamed tab (open-file reuse semantics: one tab
 * per path). Diff tabs never rename (their content comes from git).
 */
export function retargetEditorTabsAfterRename(
  tabs: readonly EditorTabState[],
  tabId: string,
  nextPath: string,
): EditorTabRenameResult {
  const tab = tabs.find((candidate) => candidate.tabId === tabId);
  if (!tab || tab.diff !== undefined || tab.path === nextPath) {
    return { tabs: [...tabs], activatedTabId: null };
  }
  const nextTabId = editorTabId(tab.workspaceId, nextPath);
  const absorbed = tabs.some(
    (candidate) => candidate.tabId === nextTabId && candidate.tabId !== tabId,
  );
  if (absorbed) {
    return {
      tabs: tabs.filter((candidate) => candidate.tabId !== tabId),
      activatedTabId: nextTabId,
    };
  }
  return {
    tabs: tabs.map((candidate) => {
      if (candidate.tabId !== tabId) return candidate;
      const next = { ...candidate, tabId: nextTabId, path: nextPath };
      delete next.missing;
      return next;
    }),
    activatedTabId: nextTabId,
  };
}
