// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page-localized-options.tsx — GitHub-only
// adaptation. The source icon set shrinks to GitHub (no Linear/Jira/GitLab
// in this repo); the source's qualifier defaults (presetToQuery) prefill the
// search box while projectTasksDaemonQuery strips the qualifiers the daemon
// already encodes via kind + `state` (open|closed|all).

import { GithubIcon } from "./github-icon";

export type GitHubTaskKind = "issues" | "pulls";

export type SourceOption = {
  id: "github";
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  disabled?: boolean;
};

export type GitHubStateFilterId = "open" | "closed" | "all";

export type GitHubStateFilter = {
  id: GitHubStateFilterId;
  label: string;
};

export function getSourceOptions(): SourceOption[] {
  return [
    {
      id: "github",
      label: "GitHub",
      Icon: ({ className }) => <GithubIcon className={className} />,
    },
  ];
}

export function getGitHubStateFilters(): GitHubStateFilter[] {
  return [
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
    { id: "all", label: "All" },
  ];
}

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
