// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page-localized-options.tsx — GitHub +
// Jira adaptation. The source icon set shrinks to GitHub and Jira (no
// Linear/GitLab in this repo); the source's qualifier defaults
// (presetToQuery) prefill the search box while projectTasksDaemonQuery
// strips the qualifiers the daemon already encodes via kind + `state`
// (open|closed|all). The Jira preset pills and the Jira source option are
// the fork's (R17-B).

import { GithubIcon } from "./github-icon";
import { JiraIcon } from "./jira/jira-issue-workspace-content";
import type { TaskIssueState } from "../../../../shared/tasks-contract";

export type GitHubTaskKind = "issues" | "pulls";

export type SourceOption = {
  id: "github" | "jira";
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  disabled?: boolean;
};

export function getSourceOptions(): SourceOption[] {
  return [
    {
      id: "github",
      label: "GitHub",
      Icon: ({ className }) => <GithubIcon className={className} />,
    },
    {
      id: "jira",
      label: "Jira",
      Icon: ({ className }) => <JiraIcon className={className} />,
    },
  ];
}

// R17-B: the fork's four Jira filter tabs (task-page-localized-options.tsx
// getJiraPresets); the ids double as this repo's JiraIssueFilter contract.
export type JiraPresetId = "assigned" | "reported" | "all" | "done";

export type JiraPreset = { id: JiraPresetId; label: string };

export function getJiraPresets(): JiraPreset[] {
  return [
    { id: "assigned", label: "Assigned" },
    { id: "reported", label: "Reported" },
    { id: "all", label: "All Open" },
    { id: "done", label: "Done" },
  ];
}

export type GitHubTaskPresetId = "issues" | "my-issues" | "prs" | "my-prs";

export type GitHubTaskPreset = {
  id: GitHubTaskPresetId;
  label: string;
  query: string;
};

// Why: the source's mode buttons are Issues/PRs/Projects; this repo's daemon
// serves no Projects board, so only the two `gh`-backed kinds survive, with
// the source's button classes applied in ModeControls.
export function getGitHubModeButtons(): { id: GitHubTaskKind; label: string }[] {
  return [
    { id: "issues", label: "Issues" },
    { id: "pulls", label: "PRs" },
  ];
}

// Source defaults (ui-slice-hydration-sanitizers.ts presetToQuery): the
// search box opens prefilled with the kind's qualifier query.
export const GITHUB_DEFAULT_ISSUE_QUERY = "is:issue is:open";
export const GITHUB_DEFAULT_PR_QUERY = "is:pr is:open";

export function getGitHubDefaultQuery(kind: GitHubTaskKind): string {
  return kind === "pulls" ? GITHUB_DEFAULT_PR_QUERY : GITHUB_DEFAULT_ISSUE_QUERY;
}

// Source preset row (task-page-localized-options.tsx
// getGitHubTaskKindPresets): the pill row above the search box. The fork
// also offers a `review` (Needs review, `review-requested:@me`) PR preset,
// which has no daemon counterpart — `gh pr list` returns no review-request
// data, so the button would always render zero rows and is omitted.
export function getGitHubTaskKindPresets(kind: GitHubTaskKind): GitHubTaskPreset[] {
  return kind === "pulls"
    ? [
        { id: "prs", label: "Open", query: GITHUB_DEFAULT_PR_QUERY },
        { id: "my-prs", label: "Mine", query: "author:@me is:pr is:open" },
      ]
    : [
        { id: "issues", label: "Open", query: GITHUB_DEFAULT_ISSUE_QUERY },
        { id: "my-issues", label: "Assigned to me", query: "assignee:@me is:issue is:open" },
      ];
}

export function getGitHubDefaultPreset(kind: GitHubTaskKind): GitHubTaskPresetId {
  return kind === "pulls" ? "prs" : "issues";
}

export function getGitHubTaskPresetQuery(preset: GitHubTaskPresetId): string {
  switch (preset) {
    case "issues":
      return GITHUB_DEFAULT_ISSUE_QUERY;
    case "my-issues":
      return "assignee:@me is:issue is:open";
    case "prs":
      return GITHUB_DEFAULT_PR_QUERY;
    case "my-prs":
      return "author:@me is:pr is:open";
  }
}

/** The fork opens issue filing outside the list (here: the system browser, never a create RPC). */
export function buildNewGitHubIssueUrl(repo: string): string | null {
  const slug = repo.trim();
  return slug === "" ? null : `https://github.com/${slug}/issues/new`;
}

// Qualifiers the daemon already encodes elsewhere: the kind switch carries
// is:issue/is:pr and the state filter carries is:open/is:closed, so they are
// stripped before the remainder goes out as the daemon's title/number
// substring query. Anything else passes through untouched.
const DAEMON_IMPLIED_QUALIFIERS = new Set([
  "is:issue",
  "is:pr",
  "is:open",
  "is:closed",
]);

export function projectTasksDaemonQuery(applied: string): string | undefined {
  const remainder = applied
    .split(/\s+/)
    .filter((token) => token !== "" && !DAEMON_IMPLIED_QUALIFIERS.has(token.toLowerCase()))
    .join(" ")
    .trim();
  return remainder === "" ? undefined : remainder;
}

// Fork parity (#238): the fork has no Open/Closed/All row — closed is
// expressed through the search text (`is:closed`), exactly like its state
// dropdown does by rewriting the query. The daemon `state` is derived from
// the same applied query the `query` projection above reads, so one filter
// bar drives both: `is:closed` (without `is:open`) narrows to closed, a
// query with no state qualifier widens to all, and everything else
// (including every preset) stays on open.
export function projectTasksDaemonState(applied: string): TaskIssueState {
  const tokens = applied
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token !== "");
  const hasClosed = tokens.includes("is:closed");
  const hasOpen = tokens.includes("is:open");
  if (hasClosed && !hasOpen) return "closed";
  if (!hasClosed && !hasOpen) return "all";
  return "open";
}
