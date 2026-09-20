/* MIT Copyright (c) 2026 Lovecast Inc.
   How a GitHub source row states what the PR it offers actually is. The tone
   tables are not this file's own: `task-page-github-work-item-status.ts` and
   `task-page-checks-pill.ts` already ship the product's PR-state and
   check-verdict colours (the Tasks list pills), so a composer row and a list
   pill can never disagree about what "merged" or "2 failing" looks like.
   Pure projections over the daemon's own pulls fields. */

import type {
  ProviderCheckSummary,
  TaskPullRequestState,
} from "../../../../shared/tasks-contract";
import { getChecksLabel, getChecksPillTone } from "../tasks/task-page-checks-pill";
import {
  getTaskPageGitHubPRIconTone,
  getTaskPageGitHubWorkItemStateLabel,
  isTaskPageGitHubDraftPR,
} from "../tasks/task-page-github-work-item-status";

/** The slice of a composer source row these projections read. */
export type SmartWorkspaceRowStatusItem = {
  type: "issue" | "pr";
  number: number;
  title: string;
  state?: TaskPullRequestState;
  checks?: ProviderCheckSummary;
};

/**
 * Why: the status helpers want a state, and a PR the daemon listed always has
 * one. A row without one is the ordinary open PR -- never silently read as
 * merged or closed.
 */
function asStatusItem(item: SmartWorkspaceRowStatusItem): {
  type: "issue" | "pr";
  state: "open" | "closed" | "merged" | "draft";
} {
  return { type: item.type, state: item.state ?? "open" };
}

/** True for a PR GitHub still reports as a draft. */
export function isSmartWorkspaceDraftPr(
  item: SmartWorkspaceRowStatusItem,
): boolean {
  return isTaskPageGitHubDraftPR(asStatusItem(item));
}

/** The PR icon's colour: emerald open, purple merged, rose closed, muted
 *  draft -- the Tasks list's own PR tones. */
export function getSmartWorkspacePrStateTone(
  state: TaskPullRequestState | undefined,
): string {
  return getTaskPageGitHubPRIconTone({ type: "pr", state: state ?? "open" });
}

/** The same tone, read off a source row. */
export function getSmartWorkspacePrIconTone(
  item: SmartWorkspaceRowStatusItem,
): string {
  return getSmartWorkspacePrStateTone(item.state);
}

/** The state word behind the icon colour, e.g. "Merged". */
export function getSmartWorkspacePrStateLabel(
  item: SmartWorkspaceRowStatusItem,
): string {
  return getTaskPageGitHubWorkItemStateLabel(asStatusItem(item));
}

export type SmartWorkspaceChecksPresentation = {
  /** Which glyph the row draws; the component maps it to a lucide icon. */
  icon: "success" | "failure" | "pending" | "neutral";
  /** The pill's text, e.g. "2 failing" or "5/5 passed". */
  label: string;
  /** The shipped pill tone, so the row's pill matches the list's. */
  tone: string;
};

/**
 * Null when the row has no verdict to show: no summary at all, or an empty
 * rollup (`total === 0`, which the list renders as the "No checks" pill). A
 * row stays icon-only rather than claiming a check state nobody reported.
 */
export function getSmartWorkspaceChecksPresentation(
  checks: ProviderCheckSummary | undefined,
): SmartWorkspaceChecksPresentation | null {
  if (!checks || checks.total === 0) return null;
  const icon =
    checks.state === "success"
      ? "success"
      : checks.state === "failure"
        ? "failure"
        : checks.state === "pending"
          ? "pending"
          : "neutral";
  return {
    icon,
    label: getChecksLabel({ checks }),
    tone: getChecksPillTone({ checks }),
  };
}

/**
 * The row's accessible name, e.g.
 * "Pull request #123, Merged, checks 2 failing: Fix login". The option's own
 * text stops at `#123 <title>`, so the state and the verdict would otherwise
 * live in colour alone.
 */
export function getSmartWorkspaceGithubRowLabel(
  item: SmartWorkspaceRowStatusItem,
): string {
  const parts = [
    `${item.type === "pr" ? "Pull request" : "Issue"} #${item.number}`,
  ];
  if (item.type === "pr") parts.push(getSmartWorkspacePrStateLabel(item));
  const checks = getSmartWorkspaceChecksPresentation(item.checks);
  if (checks) parts.push(`checks ${checks.label}`);
  return `${parts.join(", ")}: ${item.title}`;
}

/** The hover affordance's accessible name, e.g.
 *  "Open pull request #123 in browser". */
export function getSmartWorkspaceOpenLinkLabel(
  item: SmartWorkspaceRowStatusItem,
): string {
  return `Open ${item.type === "pr" ? "pull request" : "issue"} #${item.number} in browser`;
}
