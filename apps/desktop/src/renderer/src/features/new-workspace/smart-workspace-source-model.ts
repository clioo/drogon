/* MIT Copyright (c) 2026 Lovecast Inc.
   What the composer's source field knows about a GitHub item: the work item
   it offers (an issue or a pull request, plus the pull's own lifecycle and
   the daemon's rolled-up check summary) and the adapters from this repo's
   `tasks.list`/`tasks.show` rows. Split out of
   `smart-workspace-source-rows.ts`, which keeps only the row model and the
   query-hold rules -- and stays the surface its consumers import from. */

import type {
  ProviderCheckSummary,
  TaskIssue,
  TaskPullRequest,
  TaskPullRequestState,
} from "../../../../shared/tasks-contract";

export type GitHubWorkItem = {
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  /** The PR's lifecycle as the daemon's pulls listing reported it; absent on
   *  issue rows (their open/closed state is not presented by this field). */
  state?: TaskPullRequestState;
  /** The daemon's rolled-up `statusCheckRollup`; absent on issue rows and on
   *  a PR whose listing carried no summary. */
  checks?: ProviderCheckSummary;
};

/** Adapter: a tasks issue/PR row becomes the field's GitHub work item. */
export function toGitHubWorkItem(
  raw: {
    type: "issue" | "pr";
    number: number;
    title: string;
    url: string;
    updatedAt: string;
    state?: TaskPullRequestState;
    checks?: ProviderCheckSummary;
  },
): GitHubWorkItem {
  return {
    type: raw.type,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    updatedAt: raw.updatedAt,
    // Why: absent, never `undefined`-valued -- the row's presentation reads
    // presence to decide whether it has a verdict to show at all.
    ...(raw.state ? { state: raw.state } : {}),
    ...(raw.checks ? { checks: raw.checks } : {}),
  };
}

export function issueToWorkItem(issue: TaskIssue): GitHubWorkItem {
  return toGitHubWorkItem({
    type: "issue",
    number: issue.number,
    title: issue.title,
    url: issue.url,
    updatedAt: issue.updatedAt,
  });
}

export function pullToWorkItem(pull: TaskPullRequest): GitHubWorkItem {
  return toGitHubWorkItem({
    type: "pr",
    number: pull.number,
    title: pull.title,
    url: pull.url,
    updatedAt: pull.updatedAt,
    state: pull.state,
    checks: pull.checks,
  });
}
