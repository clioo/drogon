/* MIT Copyright (c) 2026 Lovecast Inc. Workspace Options "Group by: PR
   status" real data producer (coordinator review, msg_cc2acea0c485: "PR-
   status grouping cannot be replaced with linked-number-only grouping;
   implement real status input via existing provider bridge"). The existing
   provider bridge is `tasks.list`'s `mode: "pulls"` (tasks_rpc.rs,
   TasksBridge.tasksList in tasks-contract.ts): a real, already-shipped
   `gh`-CLI-backed pull-request listing per project, complete with
   open/draft/merged/closed state and headRefName. This module only
   correlates that real listing against each worktree's branch -- it adds
   no new backend RPC, no new credentials, and no new network calls of its
   own. When the listing call itself fails (`gh_unavailable`/
   `gh_unauthenticated`/no GitHub remote), the caller passes `pulls: null`
   here and every worktree in that project reports the `unavailable`
   bucket -- a real, distinct state, never fabricated as `none`. */
import type { TaskPullRequest } from "./tasks-contract";
import type { Worktree } from "./session-contract";

export type WorkspacePrStatusBucket =
  | "open"
  | "draft"
  | "merged"
  | "closed"
  | "none"
  | "unavailable";

const PR_STATUS_GROUP_PREFIX = "pr-status:";

/**
 * The PR whose `headRefName` matches this worktree's branch, if any. A
 * worktree with no branch (a folder project's implicit worktree, or a
 * detached HEAD) never matches -- there is nothing to correlate.
 */
export function findPullRequestForWorktree(
  worktree: Pick<Worktree, "branch">,
  pulls: readonly TaskPullRequest[],
): TaskPullRequest | null {
  if (!worktree.branch) return null;
  return pulls.find((pull) => pull.headRefName === worktree.branch) ?? null;
}

/**
 * `pulls: null` means the provider bridge call for this worktree's project
 * itself failed (gh missing/unauthenticated/no GitHub remote) -- reported
 * as the real, distinct `unavailable` bucket, never silently folded into
 * `none` (which means "asked, and there really is no PR for this branch").
 */
export function derivePrStatusBucket(
  worktree: Pick<Worktree, "branch">,
  pulls: readonly TaskPullRequest[] | null,
): WorkspacePrStatusBucket {
  if (pulls === null) return "unavailable";
  const pull = findPullRequestForWorktree(worktree, pulls);
  if (!pull) return "none";
  return pull.state;
}

export function getPrStatusGroupKey(bucket: WorkspacePrStatusBucket): string {
  return `${PR_STATUS_GROUP_PREFIX}${bucket}`;
}

export function getPrStatusBucketFromGroupKey(
  groupKey: string,
): WorkspacePrStatusBucket | null {
  if (!groupKey.startsWith(PR_STATUS_GROUP_PREFIX)) return null;
  const bucket = groupKey.slice(PR_STATUS_GROUP_PREFIX.length);
  const known: readonly WorkspacePrStatusBucket[] = [
    "open",
    "draft",
    "merged",
    "closed",
    "none",
    "unavailable",
  ];
  return (known as readonly string[]).includes(bucket)
    ? (bucket as WorkspacePrStatusBucket)
    : null;
}

export const PR_STATUS_BUCKET_LABEL: Record<WorkspacePrStatusBucket, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
  none: "No pull request",
  unavailable: "PR status unavailable",
};
