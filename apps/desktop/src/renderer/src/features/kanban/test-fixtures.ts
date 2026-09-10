// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Test fixture factory for the kanban slice. Mirrors the source tests'
   worktree() helpers (Orca pinned source c9790628): a full Drogon `Worktree`
   plus the projection fields the adapter would add, so every ported test
   builds rows exactly like `buildKanbanWorktrees` produces. */
import type { Worktree as DrogonWorktree } from "../../../../shared/session-contract";
import type { KanbanWorktree } from "./kanban-worktree";

export function drogonWorktree({
  id,
  title,
  ...overrides
}: Partial<DrogonWorktree> & Pick<DrogonWorktree, "id">): DrogonWorktree {
  return {
    projectId: "proj",
    workspaceId: "ws",
    id,
    path: `/tmp/${id}`,
    branch: id,
    head: "head",
    baseRef: null,
    title: title ?? null,
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

export function worktree(
  id: string,
  overrides: {
    hostId?: string;
    displayName?: string;
    comment?: string;
    workspaceStatus?: string | null;
    manualOrder?: number;
    title?: string | null;
    projectId?: string;
    branch?: string;
  } = {},
): KanbanWorktree {
  const base = drogonWorktree({
    id,
    title: overrides.title ?? null,
    projectId: overrides.projectId ?? "proj",
    branch: overrides.branch ?? id,
  });
  return {
    ...base,
    hostId: overrides.hostId ?? "local",
    displayName:
      overrides.displayName ?? overrides.title ?? overrides.branch ?? id,
    comment: overrides.comment ?? "",
    workspaceStatus: overrides.workspaceStatus ?? null,
    manualOrder: overrides.manualOrder,
  };
}
