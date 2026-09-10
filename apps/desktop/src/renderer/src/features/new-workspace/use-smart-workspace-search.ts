/* MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
   use-smart-workspace-github-search.ts and
   use-smart-workspace-secondary-searches.ts over this repo's bridges: the
   GitHub source reads the daemon's `gh` integration (tasks.list issues +
   pulls, tasks.show with the additive pulls mode) and the branch source
   reads `worktree.branch_search`. GitLab/Linear/Jira searches do not exist
   here. Same debounce, limit and query-limit rules as the source. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Result } from "../../../../shared/session-contract";
import type {
  TaskIssue,
  TaskPullRequest,
  TasksBridge,
} from "../../../../shared/tasks-contract";
import {
  issueToWorkItem,
  pullToWorkItem,
  type BranchSearchRow,
  type GitHubWorkItem,
  type SmartNameMode,
} from "./smart-workspace-source-rows";
import {
  parseGitHubIssueOrPRLink,
  parseGitHubIssueOrPRNumber,
} from "./smart-workspace-github-links";

export const SEARCH_DEBOUNCE_MS = 200;
export const RESULT_LIMIT = 12;

type TasksTasksBridge = Pick<TasksBridge, "tasksList" | "tasksShow">;

export type SmartWorkspaceSearchState = {
  githubItems: GitHubWorkItem[];
  branches: BranchSearchRow[];
  /** Settled branch query backing `branches` (the hold logic reads it). */
  branchResultsSource: { repoId: string; query: string } | null;
  loading: boolean;
};

export function useSmartWorkspaceSearch({
  tasks,
  branchSearch,
  projectId,
  value,
  debouncedQuery,
  mode,
  disabled,
  repoSlug,
}: {
  tasks: TasksTasksBridge | null;
  /** `worktree.branch_search` bridge; absent keeps the branch source empty
   *  (an older daemon simply has no branch rows). */
  branchSearch:
    | ((input: {
        projectId: string;
        query?: string;
        limit?: number;
      }) => Promise<Result<{ branches: BranchSearchRow[] }>>)
    | null;
  projectId: string | null;
  value: string;
  debouncedQuery: string;
  mode: SmartNameMode;
  disabled: boolean;
  /** The project's GitHub `owner/repo` slug, when resolvable. */
  repoSlug: { owner: string; repo: string } | null;
}): SmartWorkspaceSearchState {
  const [githubItems, setGithubItems] = useState<GitHubWorkItem[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [branches, setBranches] = useState<BranchSearchRow[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchResultsSource, setBranchResultsSource] = useState<{
    repoId: string;
    query: string;
  } | null>(null);

  const shouldQueryGithub =
    !disabled &&
    projectId !== null &&
    tasks !== null &&
    (mode === "smart" || mode === "github");
  const shouldQueryBranches =
    !disabled &&
    projectId !== null &&
    branchSearch !== null &&
    (mode === "branches" || (mode === "smart" && debouncedQuery.trim().length > 0));

  // The branch hold logic keys results to the settled query + project.
  useEffect(() => {
    if (!shouldQueryBranches || !projectId || !branchSearch) {
      setBranches([]);
      setBranchResultsSource(null);
      setBranchesLoading(false);
      return;
    }
    let stale = false;
    setBranchesLoading(true);
    branchSearch({ projectId, query: debouncedQuery.trim(), limit: RESULT_LIMIT })
      .then((result) => {
        if (stale) return;
        if (result.ok) {
          setBranches(result.result.branches);
          setBranchResultsSource({ repoId: projectId, query: debouncedQuery.trim() });
        } else {
          setBranches([]);
        }
      })
      .catch(() => {
        if (!stale) setBranches([]);
      })
      .finally(() => {
        if (!stale) setBranchesLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [debouncedQuery, projectId, shouldQueryBranches, branchSearch]);

  useEffect(() => {
    if (!shouldQueryGithub || !projectId || !tasks) {
      setGithubItems([]);
      setGithubLoading(false);
      return;
    }
    let stale = false;
    // Why: clearing the field must not briefly paint the previous non-empty
    // results.
    if (debouncedQuery.trim() === "") {
      setGithubItems([]);
    }
    const run = async (): Promise<void> => {
      const trimmed = debouncedQuery.trim();
      const urlLink = parseGitHubIssueOrPRLink(trimmed);
      const directNumber = urlLink
        ? // A full URL only resolves when its slug is the project's repo —
          // Drogon reads one repo per project, like the fork's same-repo
          // fast path. A foreign slug degrades to "no rows" instead of a
          // wrong repo's item.
          repoSlug && sameHostSlug(urlLink.slug, repoSlug)
          ? urlLink.number
          : null
        : parseGitHubIssueOrPRNumber(trimmed);
      if (urlLink && directNumber === null) {
        setGithubItems([]);
        return;
      }
      if (directNumber !== null) {
        setGithubLoading(true);
        const issue = await tasks
          .tasksShow({ projectId, number: directNumber })
          .catch(() => null);
        if (stale) return;
        if (issue?.ok && issue.result.issue) {
          setGithubItems([issueToWorkItem(issue.result.issue)]);
        } else {
          const pull = await tasks
            .tasksShow({ projectId, number: directNumber, mode: "pulls" })
            .catch(() => null);
          if (stale) return;
          setGithubItems(
            pull?.ok && pull.result.pull
              ? [pullToWorkItem(pull.result.pull)]
              : [],
          );
        }
        return;
      }
      const query = trimmed;
      setGithubLoading(true);
      const [issues, pulls] = await Promise.all([
        tasks
          .tasksList({
            projectId,
            state: "all",
            query,
            page: 1,
            perPage: RESULT_LIMIT,
            mode: "issues",
          })
          .catch(() => null),
        tasks
          .tasksList({
            projectId,
            state: "all",
            query,
            page: 1,
            perPage: RESULT_LIMIT,
            mode: "pulls",
          })
          .catch(() => null),
      ]);
      if (stale) return;
      const merged: GitHubWorkItem[] = [
        ...(issues?.ok ? issues.result.issues.map(issueToWorkItem) : []),
        ...(pulls?.ok ? (pulls.result.pulls ?? []).map(pullToWorkItem) : []),
      ]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, RESULT_LIMIT);
      setGithubItems(merged);
    };
    void run()
      .catch(() => {
        if (!stale) setGithubItems([]);
      })
      .finally(() => {
        if (!stale) setGithubLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [debouncedQuery, projectId, shouldQueryGithub, tasks, repoSlug]);

  // Why: the live input leads the debounced search (the source's
  // `isQueryStale`); the field freezes highlight until the query catches up.
  const queryStaleRef = useRef(false);
  queryStaleRef.current =
    value.trim().length > 0 && debouncedQuery.trim() !== value.trim();

  const loading = githubLoading || branchesLoading;
  return useMemo(
    () => ({
      githubItems,
      branches,
      branchResultsSource,
      loading,
    }),
    [githubItems, branches, branchResultsSource, loading],
  );
}

function sameHostSlug(
  a: { owner: string; repo: string },
  b: { owner: string; repo: string },
): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}
