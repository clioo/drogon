/* MIT Copyright (c) 2026 Lovecast Inc.
   Board row type and the Drogon data-layer adapter for the kanban slice,
   ported from Orca pinned source c9790628 (clioo/drogon-orca):
   - `displayName`/branch label resolution from
     src/renderer/src/lib/worktree-default-display-name.ts (same coalescing
     order: custom name -> branch -> path basename, with the same
     non-optional-at-type/absent-at-runtime guards),
   - host identity from src/shared/worktree/host-qualified-identity.ts.
   This file is the ONLY place Orca's worktree shape meets Drogon's
   `Worktree`/`Project`/`Workspace` contract: a Drogon worktree carries its
   host on the owning Project/Workspace and has no persisted status/order
   fields, so the caller supplies the controlled `statusByIdentity` /
   `manualOrderByIdentity` maps (C02-B owns any durable writer; none is
   invented here). `KanbanWorktree` keeps the source field names
   (`displayName`, `comment`, `manualOrder`, `workspaceStatus`, `hostId`) so
   the ported primitives read exactly like their originals. */
import type {
  Project,
  Worktree as DrogonWorktree,
  Workspace,
} from "../../../../shared/session-contract";
import { composeWorktreeHostIdentity } from "./host-identity";
import type { WorkspaceStatus } from "./workspace-status";

/** Orca's lib/git-utils branchName: strip the refs/heads/ prefix only. */
export function branchName(branch: string): string {
  return branch.replace(/^refs\/heads\//, "");
}

function basename(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? ""
  );
}

/**
 * `branch` is typed non-optional but is absent on folder workspaces and
 * partially hydrated rows, and `branchName` throws on undefined. Every render
 * and search read of the branch label must go through here.
 */
export function resolveWorktreeBranchLabel(worktree: {
  branch?: string | null;
}): string {
  return typeof worktree.branch === "string" ? branchName(worktree.branch) : "";
}

/**
 * Renderer mirror of main-side naming: a missing or blank custom name falls
 * back to the branch, then the folder. `title` is optional and can arrive
 * nullish at runtime, so every read must go through here instead of
 * dereferencing it.
 */
export function resolveWorktreeDisplayName(worktree: {
  title?: string | null;
  branch?: string | null;
  path: string;
}): string {
  const custom =
    typeof worktree.title === "string" ? worktree.title.trim() : "";
  if (custom) {
    return custom;
  }

  const branch = resolveWorktreeBranchLabel(worktree).trim();
  if (branch) {
    return branch;
  }

  return typeof worktree.path === "string"
    ? basename(worktree.path).trim()
    : "";
}

/**
 * One board card. Drogon's `Worktree` plus exactly the projection fields the
 * ported sidebar primitives read off Orca's `Worktree`. Nothing here persists:
 * `workspaceStatus`/`manualOrder` come from the caller's controlled maps.
 */
export type KanbanWorktree = DrogonWorktree & {
  /** Host-qualified identity input (STA-4343): from the owning Project/Workspace. */
  hostId: string;
  /** Source coalescing: custom title -> branch -> path basename. */
  displayName: string;
  /** Composer note; the board's only supporting-evidence text. */
  comment: string;
  /** Controlled column assignment; nullish reads as the default lane. */
  workspaceStatus: WorkspaceStatus | null;
  /** Controlled manual order (source semantics: higher renders earlier). */
  manualOrder?: number;
};

export type KanbanBoardInput = {
  worktrees: readonly DrogonWorktree[];
  /** Owning project per worktree (`projectId`); supplies the host id + repo name. */
  projectById: ReadonlyMap<string, Project>;
  /** Owning folder workspace per worktree (`workspaceId`); host fallback for folder projects. */
  workspaceById: ReadonlyMap<string, Workspace>;
  /** Controlled column assignment keyed by host-qualified identity. */
  statusByIdentity?: ReadonlyMap<string, WorkspaceStatus>;
  /** Controlled manual order keyed by host-qualified identity. */
  manualOrderByIdentity?: ReadonlyMap<string, number>;
};

/** Builds the board rows the ported primitives consume. Pure: no persistence. */
export function buildKanbanWorktrees(
  input: KanbanBoardInput,
): KanbanWorktree[] {
  return input.worktrees.map((worktree) => {
    const project = input.projectById.get(worktree.projectId);
    const workspace = input.workspaceById.get(worktree.workspaceId);
    const hostId = project?.hostId ?? workspace?.hostId ?? "";
    const identity = composeWorktreeHostIdentity(hostId, worktree.id);
    const workspaceStatus = input.statusByIdentity?.get(identity) ?? null;
    const manualOrder = input.manualOrderByIdentity?.get(identity);
    return {
      ...worktree,
      hostId,
      displayName: resolveWorktreeDisplayName({
        title: worktree.title,
        branch: worktree.branch,
        path: worktree.path,
      }),
      comment: worktree.note ?? "",
      workspaceStatus,
      manualOrder,
    };
  });
}
