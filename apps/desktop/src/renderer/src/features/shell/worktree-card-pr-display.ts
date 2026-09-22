/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-pr-display.ts
   (adapter: MVP subset — the reference resolves linked reviews across
   GitHub/GitLab/Bitbucket/Azure/Gitea with suppression rules; this repo
   has no PR link store yet, so the card accepts an already-known PR and
   this module projects exactly that known-PR chip. Pure, unit-tested.) */

import type { Worktree } from "../../../../shared/session-contract";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";

/**
 * The review the card's marker names: every pull whose head branch IS this
 * worktree's branch, best first. A branch routinely carries both concluded
 * history and its next review (e.g. `collapsable-widgets` holds MERGED
 * #641 beneath OPEN #642), and the provider's order is not a recency
 * contract — so a still-live review (open/draft) deterministically wins
 * over concluded history, and the newest number wins within each group.
 * A worktree with no branch (a folder project's implicit worktree, or a
 * detached HEAD) never matches: there is nothing to correlate.
 */
export function selectCardPull(
  worktree: Pick<Worktree, "branch">,
  pulls: readonly TaskPullRequest[],
): TaskPullRequest | null {
  const branch = worktree.branch;
  if (!branch) return null;
  const matching = pulls.filter((pull) => pull.headRefName === branch);
  if (matching.length === 0) return null;
  const live = matching.filter(
    (pull) => pull.state === "open" || pull.state === "draft",
  );
  const candidates = live.length > 0 ? live : matching;
  return candidates.reduce((best, pull) =>
    pull.number > best.number ? pull : best,
  );
}

export function resolveCardPullRequest(worktree: Worktree, pulls: readonly TaskPullRequest[]): WorktreeCardPrDisplay | null {
  // A stored link names the review explicitly (retargeted since, or paged
  // out of the bounded listing); the branch correlation below stays the
  // primary path, never a guess.
  const linked = worktree.linkedPr ?? null;
  const pull =
    selectCardPull(worktree, pulls) ??
    (linked !== null && Number.isInteger(linked) && linked > 0
      ? (pulls.find((candidate) => candidate.number === linked) ?? null)
      : null);
  if (!pull) return null;
  return {
    provider: "github",
    number: pull.number,
    title: pull.title,
    state: pull.state,
    url: pull.url,
    // Owner's sidebar design (2026-09-21): the card's right-hand icon names
    // the review's own state, so the fields that decide it travel with the
    // display — the provider's mergeable flag and draft flag, never a guess.
    // Checks arrive as the producer's rollup summary; only a terminal
    // failure/success/pending verdict travels (neutral/none carry no claim).
    mergeable: pull.mergeable,
    isDraft: pull.isDraft,
    reviewDecision: pull.reviewDecision,
    // Only a terminal failure/success/pending verdict travels. A neutral
    // rollup (completed checks with no pass/fail verdict) is NOT a pass, so
    // it rides as "pending": unconfirmed, never ready-claiming.
    checks:
      pull.checks?.state === "failure"
        ? "failure"
        : pull.checks?.state === "pending" || pull.checks?.state === "neutral"
          ? "pending"
          : pull.checks?.state === "success"
            ? "success"
            : undefined,
  };
}

export type WorktreeCardPrDisplay = {
  provider: "github" | "gitlab" | "bitbucket" | "azure-devops" | "gitea";
  number: number;
  title: string;
  state?: "open" | "draft" | "merged" | "closed";
  url?: string;
  checks?: "failure" | "pending" | "success";
  /** Provider mergeability: `CONFLICTING` is the owner's red state. */
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** GitHub's own draft flag; `state` already carries it when gh says so. */
  isDraft?: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
};

/**
 * The states the card's right-hand icon can draw (owner's sidebar design),
 * plus `closed` for a review that was abandoned rather than merged, plus
 * `open` for a live review whose mergeability is not confirmed:
 *  - `merged`: the review landed.
 *  - `conflicts`: the provider reports a conflicting branch — the one state
 *    that will not merge until a human acts, so it outranks `ready`.
 *  - `draft`: still a draft (never "ready").
 *  - `ready`: open, not a draft, confirmed MERGEABLE, checks passing (or
 *    no checks at all), and no outstanding review — APPROVED or no known
 *    review requirement — the only state that claims "Ready to merge".
 *  - `open`: live but unconfirmed (unknown mergeability, failing/pending/
 *    neutral checks, requested changes, or a required review still
 *    outstanding) — honest, never "Ready to merge".
 *  - `closed`: closed without merging.
 * `null` means no review is linked: the card draws no icon at all rather
 * than a placeholder claiming a state.
 */
export type WorktreeCardPrState =
  | "merged"
  | "conflicts"
  | "draft"
  | "ready"
  | "open"
  | "closed";

export function resolveCardPrState(
  pr: WorktreeCardPrDisplay | null,
): WorktreeCardPrState | null {
  if (!pr) return null;
  if (pr.state === "merged") return "merged";
  if (pr.mergeable === "CONFLICTING") return "conflicts";
  if (pr.state === "closed") return "closed";
  if (pr.state === "draft" || pr.isDraft === true) return "draft";
  if (pr.state === "open" || pr.state === undefined) {
    // "Ready" is a confirmed claim: the provider computed MERGEABLE and
    // nothing on record blocks the merge. Unknown mergeability (gh reports
    // UNKNOWN while computing, and for every concluded review), a
    // failing/pending/neutral check rollup, requested changes, or a still
    // outstanding required review (REVIEW_REQUIRED) all stay honestly
    // `open` — pending required checks are not a merge confirmation, and a
    // conflict-free branch alone never claims merge-readiness.
    if (
      pr.mergeable === "MERGEABLE" &&
      pr.checks !== "failure" &&
      pr.checks !== "pending" &&
      pr.reviewDecision !== "CHANGES_REQUESTED" &&
      pr.reviewDecision !== "REVIEW_REQUIRED"
    ) {
      return "ready";
    }
    return "open";
  }
  return null;
}

/**
 * Expires the mergeability confirmation behind a `ready` claim when a
 * scheduled refresh fails: the facts (merged/closed/draft/conflicts, the
 * check verdict) are untouched — they resolve before mergeability is ever
 * consulted — but a MERGEABLE verdict we can no longer re-confirm reads as
 * UNKNOWN, so the marker falls back to honestly `open` until the next
 * successful refresh. A non-stale display is returned unchanged.
 */
export function applySidebarPrStaleness(
  pr: WorktreeCardPrDisplay | null,
  isStale: boolean,
): WorktreeCardPrDisplay | null {
  if (!pr || !isStale) return pr;
  if (pr.mergeable === "MERGEABLE") return { ...pr, mergeable: "UNKNOWN" };
  return pr;
}

function providerLabel(provider: WorktreeCardPrDisplay["provider"]): string {
  return provider === "gitlab" ? "MR" : "PR";
}

/** Chip text for a known PR, e.g. "PR #123". */
export function getPrChipLabel(pr: WorktreeCardPrDisplay): string {
  return `${providerLabel(pr.provider)} #${pr.number}`;
}

/** How each state reads to a screen reader, e.g. "Merged". */
export function getPrStateLabel(state: WorktreeCardPrState): string {
  switch (state) {
    case "merged":
      return "Merged";
    case "conflicts":
      return "Conflicts with the base branch";
    case "draft":
      return "Draft";
    case "ready":
      return "Ready to merge";
    case "open":
      return "Open";
    case "closed":
      return "Closed";
  }
}

/** Accessible label for the chip/icon, e.g. "Linked PR #123: Merged". */
export function getPrChipAccessibleLabel(pr: WorktreeCardPrDisplay): string {
  const kind = providerLabel(pr.provider);
  if (pr.state === "merged") return `Linked ${kind} #${pr.number}: Merged`;
  if (pr.state === "closed") return `Linked ${kind} #${pr.number}: Closed`;
  if (pr.state === "draft") return `Linked ${kind} #${pr.number}: Draft`;
  if (pr.mergeable === "CONFLICTING")
    return `Linked ${kind} #${pr.number}: Conflicts with the base branch`;
  if (pr.checks === "failure")
    return `Linked ${kind} #${pr.number} checks: Failed`;
  if (pr.checks === "pending")
    return `Linked ${kind} #${pr.number} checks: Pending`;
  if (pr.checks === "success")
    return `Linked ${kind} #${pr.number} checks: Passing`;
  return `Linked ${kind} #${pr.number}: Open`;
}
