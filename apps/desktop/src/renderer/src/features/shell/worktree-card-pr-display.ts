/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-pr-display.ts
   (adapter: MVP subset — the reference resolves linked reviews across
   GitHub/GitLab/Bitbucket/Azure/Gitea with suppression rules; this repo
   has no PR link store yet, so the card accepts an already-known PR and
   this module projects exactly that known-PR chip. Pure, unit-tested.) */

import type { Worktree } from "../../../../shared/session-contract";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import { findPullRequestForWorktree } from "../../../../shared/workspace-pr-status";

export function resolveCardPullRequest(worktree: Worktree, pulls: readonly TaskPullRequest[]): WorktreeCardPrDisplay | null {
  const pull = findPullRequestForWorktree(worktree, pulls);
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
    mergeable: pull.mergeable,
    isDraft: pull.isDraft,
    reviewDecision: pull.reviewDecision,
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
 * The four states the card's right-hand icon can draw (owner's sidebar
 * design), plus `closed` for a review that was abandoned rather than
 * merged:
 *  - `merged`: the review landed.
 *  - `conflicts`: the provider reports a conflicting branch — the one state
 *    that will not merge until a human acts, so it outranks `ready`.
 *  - `draft`: still a draft (never "ready").
 *  - `ready`: open, not a draft, no conflicts.
 *  - `closed`: closed without merging.
 * `null` means no review is linked: the card draws no icon at all rather
 * than a placeholder claiming a state.
 */
export type WorktreeCardPrState =
  | "merged"
  | "conflicts"
  | "draft"
  | "ready"
  | "closed";

export function resolveCardPrState(
  pr: WorktreeCardPrDisplay | null,
): WorktreeCardPrState | null {
  if (!pr) return null;
  if (pr.state === "merged") return "merged";
  if (pr.mergeable === "CONFLICTING") return "conflicts";
  if (pr.state === "closed") return "closed";
  if (pr.state === "draft" || pr.isDraft === true) return "draft";
  return "ready";
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
