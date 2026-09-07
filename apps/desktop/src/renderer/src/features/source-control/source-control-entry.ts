// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/shared/git-status-types.ts (GitUncommittedEntry area/status shape)
// and src/renderer/src/components/right-sidebar/status-display.ts
// (STATUS_LABELS, STATUS_COLORS). Adapter: the daemon speaks the
// git-contract porcelain XY codes, so this maps one protocol entry to the
// per-area rows the panel renders; conflict/submodule fields do not exist
// in the MVP contract and are omitted.

import type {
  GitLineCount,
  GitStatusEntry,
} from "../../../../shared/git-contract";

export type SourceControlArea = "staged" | "unstaged" | "untracked";

export type SourceControlFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "copied";

/** One rendered row: a single staging area of a single path. */
export type SourceControlEntry = {
  path: string;
  area: SourceControlArea;
  status: SourceControlFileStatus;
  origPath?: string;
  /** Working-tree line counts for this row's area; absent when unknown. */
  added?: number;
  removed?: number;
};

export const STATUS_LABELS: Record<SourceControlFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  copied: "C",
};

export const STATUS_COLORS: Record<SourceControlFileStatus, string> = {
  modified: "var(--git-decoration-modified)",
  added: "var(--git-decoration-added)",
  deleted: "var(--git-decoration-deleted)",
  renamed: "var(--git-decoration-renamed)",
  untracked: "var(--git-decoration-untracked)",
  copied: "var(--git-decoration-copied)",
};

function statusForCode(code: string, fallback: SourceControlFileStatus): SourceControlFileStatus {
  switch (code) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "?":
      return "untracked";
    // Typechange/updated-but-unmerged codes have no dedicated letter;
    // the row still changed, so it renders as modified.
    default:
      return fallback;
  }
}

/**
 * Expands one protocol status entry into per-area rows. An entry changed on
 * both sides ("MM") yields a staged and an unstaged row, matching Git
 * clients; untracked paths yield one row; ignored paths yield none.
 * Unmerged conflicts have no resolution flow in the MVP and render as
 * unstaged modifications so they stay visible and stageable.
 */
export function rowsForEntry(
  entry: GitStatusEntry,
  counts?: GitLineCount,
): SourceControlEntry[] {
  if (entry.kind === "ignored") return [];
  if (entry.kind === "untracked") {
    return [
      {
        path: entry.path,
        area: "untracked",
        status: "untracked",
        added: counts?.unstagedAdded ?? undefined,
        removed: counts?.unstagedRemoved ?? undefined,
      },
    ];
  }
  if (entry.kind === "unmerged") {
    return [
      {
        path: entry.path,
        area: "unstaged",
        status: "modified",
        added: counts?.unstagedAdded ?? undefined,
        removed: counts?.unstagedRemoved ?? undefined,
      },
    ];
  }
  const base =
    entry.kind === "rename"
      ? { status: "renamed" as const, origPath: entry.origPath }
      : entry.kind === "copy"
        ? { status: "copied" as const, origPath: entry.origPath }
        : {};
  const rows: SourceControlEntry[] = [];
  if (entry.staged !== "." && entry.staged !== " ") {
    rows.push({
      path: entry.path,
      area: "staged",
      status: base.status ?? statusForCode(entry.staged, "modified"),
      ...(base.origPath ? { origPath: base.origPath } : null),
      added: counts?.stagedAdded ?? undefined,
      removed: counts?.stagedRemoved ?? undefined,
    });
  }
  if (entry.unstaged !== "." && entry.unstaged !== " ") {
    rows.push({
      path: entry.path,
      area: "unstaged",
      status: base.status ?? statusForCode(entry.unstaged, "modified"),
      ...(base.origPath ? { origPath: base.origPath } : null),
      added: counts?.unstagedAdded ?? undefined,
      removed: counts?.unstagedRemoved ?? undefined,
    });
  }
  if (rows.length === 0) {
    // No marker on either side: the path came from status, so it changed
    // somewhere — show it unstaged rather than dropping it.
    rows.push({
      path: entry.path,
      area: "unstaged",
      status: base.status ?? "modified",
      ...(base.origPath ? { origPath: base.origPath } : null),
      added: counts?.unstagedAdded ?? undefined,
      removed: counts?.unstagedRemoved ?? undefined,
    });
  }
  return rows;
}

/** Row key shared by selection, open-file tracking and counts lookup. */
export function rowKey(area: SourceControlArea, path: string): string {
  return `${area}::${path}`;
}

/** Whether anything is staged and a commit can run. */
export function canCommitEntries(entries: readonly SourceControlEntry[]): boolean {
  return entries.some((entry) => entry.area === "staged");
}
