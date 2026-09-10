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
  return pull ? { provider: "github", number: pull.number, title: pull.title, state: pull.state, url: pull.url } : null;
}

export type WorktreeCardPrDisplay = {
  provider: "github" | "gitlab" | "bitbucket" | "azure-devops" | "gitea";
  number: number;
  title: string;
  state?: "open" | "draft" | "merged" | "closed";
  url?: string;
  checks?: "failure" | "pending" | "success";
};

function providerLabel(provider: WorktreeCardPrDisplay["provider"]): string {
  return provider === "gitlab" ? "MR" : "PR";
}

/** Chip text for a known PR, e.g. "PR #123". */
export function getPrChipLabel(pr: WorktreeCardPrDisplay): string {
  return `${providerLabel(pr.provider)} #${pr.number}`;
}

/** Accessible label for the chip, e.g. "Linked PR #123: Merged". */
export function getPrChipAccessibleLabel(pr: WorktreeCardPrDisplay): string {
  const kind = providerLabel(pr.provider);
  if (pr.state === "merged") return `Linked ${kind} #${pr.number}: Merged`;
  if (pr.state === "closed") return `Linked ${kind} #${pr.number}: Closed`;
  if (pr.state === "draft") return `Linked ${kind} #${pr.number}: Draft`;
  if (pr.checks === "failure")
    return `Linked ${kind} #${pr.number} checks: Failed`;
  if (pr.checks === "pending")
    return `Linked ${kind} #${pr.number} checks: Pending`;
  if (pr.checks === "success")
    return `Linked ${kind} #${pr.number} checks: Passing`;
  return `Linked ${kind} #${pr.number}: Open`;
}
