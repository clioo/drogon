/* MIT Copyright (c) 2026 Lovecast Inc. Workspace Options "Group by: PR
   status" real data producer: PR-status grouping requires a real status
   input, not a linked-number-only stand-in. The existing provider bridge
   is `tasks.list`'s `mode: "pulls"` (tasks_rpc.rs,
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

/** A review is live while the provider still reports it open or draft. */
export function isLivePullRequest(pull: Pick<TaskPullRequest, "state">): boolean {
  return pull.state === "open" || pull.state === "draft";
}

/** The worktree identity the canonical review selection reads: the branch
 *  correlation first, the stored linked number second. Both fields are
 *  optional reads so branch-less worktrees and unlinked worktrees share
 *  the one policy. */
export type PullRequestWorktreeRef = Pick<Worktree, "branch" | "linkedPr">;

/**
 * Best branch match, order-independent: every pull whose head branch IS
 * this worktree's branch, live reviews (open/draft) before concluded
 * history, newest number first within each group. A branch routinely
 * carries both concluded history and its next review, and the provider's
 * order is not a recency contract — so selection never depends on input
 * array order. A worktree with no branch never matches.
 */
export function selectBranchPullRequest(
  worktree: Pick<Worktree, "branch">,
  pulls: readonly TaskPullRequest[],
): TaskPullRequest | null {
  const branch = worktree.branch;
  if (!branch) return null;
  const matching = pulls.filter((pull) => pull.headRefName === branch);
  if (matching.length === 0) return null;
  const live = matching.filter(isLivePullRequest);
  const candidates = live.length > 0 ? live : matching;
  return candidates.reduce((best, pull) =>
    pull.number > best.number ? pull : best,
  );
}

/** A stored link names a review only when it is a plausible PR number. */
function storedLinkedPullNumber(
  worktree: Pick<Worktree, "linkedPr">,
): number | null {
  const linked = worktree.linkedPr ?? null;
  return linked !== null && Number.isInteger(linked) && linked > 0
    ? linked
    : null;
}

/**
 * The single canonical selection policy the card AND the "Group by: PR
 * status" grouping share: branch matches first (live-first, newest
 * number — see `selectBranchPullRequest`), then the worktree's real
 * stored linked number when the branch matched nothing (retargeted
 * since, or paged out of the bounded listing — recovered by the
 * targeted `tasks.show` lookup, never guessed). Without both consumers
 * sharing this policy the same data can show "PR #7" on the card while
 * grouping the worktree under "No pull request". Stale listings resolve
 * through the same policy (facts don't expire — only the ready-claim
 * lapses); an unknown linked number resolves to no review, never an
 * invented one.
 */
export function selectCanonicalPullRequest(
  worktree: PullRequestWorktreeRef,
  pulls: readonly TaskPullRequest[],
): TaskPullRequest | null {
  const branched = selectBranchPullRequest(worktree, pulls);
  if (branched) return branched;
  const linked = storedLinkedPullNumber(worktree);
  if (linked === null) return null;
  return pulls.find((pull) => pull.number === linked) ?? null;
}

const PR_STATUS_GROUP_PREFIX = "pr-status:";

/**
 * The branch's best review, if any: the canonical branch half of
 * `selectCanonicalPullRequest` (live-first, newest number,
 * order-independent). Kept under its historical name for existing
 * callers; new code that also honors stored links wants
 * `selectCanonicalPullRequest`. A worktree with no branch (a folder
 * project's implicit worktree, or a detached HEAD) never matches --
 * there is nothing to correlate.
 */
export function findPullRequestForWorktree(
  worktree: Pick<Worktree, "branch">,
  pulls: readonly TaskPullRequest[],
): TaskPullRequest | null {
  return selectBranchPullRequest(worktree, pulls);
}

/**
 * `pulls: null` means the provider bridge call for this worktree's project
 * itself failed (gh missing/unauthenticated/no GitHub remote) -- reported
 * as the real, distinct `unavailable` bucket, never silently folded into
 * `none` (which means "asked, and there really is no PR for this branch").
 * Otherwise the bucket names the state of the SAME review the card shows:
 * the canonical selection (branch first, stored linked number second), so
 * a card reading "PR #7" and its group entry can never disagree. Stale
 * listings resolve through the same policy -- the bucket keeps naming the
 * last-known review while only the card's ready-claim lapses.
 */
export function derivePrStatusBucket(
  worktree: PullRequestWorktreeRef,
  pulls: readonly TaskPullRequest[] | null,
): WorkspacePrStatusBucket {
  if (pulls === null) return "unavailable";
  const pull = selectCanonicalPullRequest(worktree, pulls);
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
