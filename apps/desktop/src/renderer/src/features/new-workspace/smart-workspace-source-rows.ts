/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/new-workspace/smart-workspace-source-results.ts (row model and
   empty hints) for the sources Drogon can back honestly: GitHub via `gh`,
   git branches, and plain text. GitLab/Linear/Jira rows are structurally
   absent — the same way the source hides providers that are not connected.
   The URL-source single-row override collapses to the GitHub URL case. */

import type { GitHubIssueOrPRLink } from "./smart-workspace-github-links";
import type { TaskIssue, TaskPullRequest } from "../../../../shared/tasks-contract";

export type SmartNameMode =
  | "smart"
  | "github"
  | "branches"
  | "text";

export type GitHubWorkItem = {
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  updatedAt: string;
};

export type BranchSearchRow = {
  refName: string;
  localBranchName: string;
};

export type SmartWorkspaceSourceRow =
  | { kind: "use-name"; value: string; name: string }
  | { kind: "create-branch"; value: string; name: string }
  | { kind: "github"; value: string; item: GitHubWorkItem }
  | { kind: "branch"; value: string; refName: string; localBranchName: string };

export type SmartWorkspaceNameSelection = {
  kind: "github-pr" | "github-issue" | "branch";
  label: string;
  url?: string;
};

const EMPTY_HINT_BY_MODE: Record<SmartNameMode, string> = {
  smart: "Start typing to create a name or find a source.",
  github: "Start typing to search GitHub PRs and issues.",
  branches: "No matching branches.",
  text: "",
};

export function getSmartWorkspaceEmptyHint(mode: SmartNameMode): string {
  return EMPTY_HINT_BY_MODE[mode];
}

/** The source's 2048-byte guard: absurd queries never reach a search. */
export const SMART_WORKSPACE_SOURCE_QUERY_MAX_BYTES = 2048;

export function isSmartWorkspaceSourceQueryWithinLimit(query: string): boolean {
  return new TextEncoder().encode(query).length <= SMART_WORKSPACE_SOURCE_QUERY_MAX_BYTES;
}

function toGitHubSourceRow(item: GitHubWorkItem): SmartWorkspaceSourceRow {
  return {
    kind: "github",
    value: `github-${item.type}-${item.number}`,
    item,
  };
}

/**
 * Why: provider arrays lag the live input (200ms debounce). Keep them while
 * the user is still typing, but hide immediately when the field is cleared
 * so prior non-empty results cannot stay selectable until debounce catches
 * up.
 */
export function getVisibleHeldProviderResults<T>({
  items,
  value,
  debouncedQuery,
}: {
  items: readonly T[];
  value: string;
  debouncedQuery: string;
}): T[] {
  if (!isSmartWorkspaceSourceQueryWithinLimit(value)) {
    return [];
  }
  if (value.trim() === "" && debouncedQuery.trim() !== "") {
    return [];
  }
  return items.slice();
}

export function getVisibleBranchResults({
  branches,
  mode,
  resultQuery,
  selectedRepoId,
  value,
}: {
  branches: BranchSearchRow[];
  mode: SmartNameMode;
  resultQuery: string | null;
  selectedRepoId: string | null;
  value: string;
}): BranchSearchRow[] {
  if (!isSmartWorkspaceSourceQueryWithinLimit(value)) {
    return [];
  }
  if (mode !== "branches" && mode !== "smart") {
    return [];
  }
  if (!selectedRepoId || resultQuery === null) {
    return [];
  }
  const currentQuery = value.trim();
  // Why: hold the last settled list while the user extends/trims the query
  // so the dropdown does not blank between debounced keystrokes. Drop the
  // hold when the query diverges (e.g. "feat" → "bug") so unrelated rows do
  // not linger.
  if (currentQuery === "") {
    return resultQuery === "" ? branches : [];
  }
  if (!shouldHoldSourceResultsForQuery({ resultQuery, value: currentQuery })) {
    return [];
  }
  return branches;
}

/** Max |live − settled| length while still treating a prefix as "still
 *  typing". */
const SOURCE_RESULT_HOLD_MAX_DELTA = 4;

/**
 * Why: prefix-only hold lets a settled "f" stick under "fix-unrelated-…" for
 * the whole next debounce. Cap the length delta so hold covers fast typing,
 * not long continuations of a short settled query.
 */
export function shouldHoldSourceResultsForQuery({
  resultQuery,
  value,
}: {
  resultQuery: string;
  value: string;
}): boolean {
  const currentQueryKey = value.trim().toLowerCase();
  const resultQueryKey = resultQuery.trim().toLowerCase();
  if (resultQueryKey === currentQueryKey) {
    return true;
  }
  if (
    !currentQueryKey.startsWith(resultQueryKey) &&
    !resultQueryKey.startsWith(currentQueryKey)
  ) {
    return false;
  }
  return (
    Math.abs(currentQueryKey.length - resultQueryKey.length) <=
    SOURCE_RESULT_HOLD_MAX_DELTA
  );
}

export function buildSmartWorkspaceSourceRows({
  branches,
  githubItems,
  githubUrlIntent,
  mode,
  resultLimit,
  value,
}: {
  branches: BranchSearchRow[];
  githubItems: GitHubWorkItem[];
  /** A pasted GitHub issue/PR URL resolves to exactly that item. */
  githubUrlIntent?: GitHubIssueOrPRLink | null;
  mode: SmartNameMode;
  resultLimit: number;
  value: string;
}): SmartWorkspaceSourceRow[] {
  if (!isSmartWorkspaceSourceQueryWithinLimit(value)) {
    return [];
  }
  // Why: a full task URL is unambiguous, so unrelated held rows must never
  // remain selectable — only the resolved item (if any) stays.
  if (githubUrlIntent) {
    const matching = githubItems.find(
      (item) =>
        item.number === githubUrlIntent.number &&
        item.type === githubUrlIntent.type,
    );
    return matching ? [toGitHubSourceRow(matching)] : [];
  }
  const trimmed = value.trim();
  const nextRows: SmartWorkspaceSourceRow[] = [];
  if (trimmed && mode === "smart") {
    // Why: stable cmdk value — embedding the query remounted the row every
    // keystroke.
    nextRows.push({ kind: "use-name", value: "use-name", name: trimmed });
  }
  if (mode === "text") {
    return nextRows;
  }
  if (mode === "smart" || mode === "github") {
    nextRows.push(...githubItems.map(toGitHubSourceRow));
  }
  const shouldShowBranches =
    mode === "branches" || (mode === "smart" && trimmed.length > 0);
  if (shouldShowBranches) {
    const branchExactMatch = branches.some(
      (branch) =>
        branch.refName === trimmed || branch.localBranchName === trimmed,
    );
    if (trimmed && mode === "branches" && !branchExactMatch) {
      nextRows.push({ kind: "create-branch", value: "create-branch", name: trimmed });
    }
    nextRows.push(
      ...branches.map((branch) => ({
        kind: "branch" as const,
        value: `branch-${branch.refName}`,
        refName: branch.refName,
        localBranchName: branch.localBranchName,
      })),
    );
  }
  return nextRows.slice(0, resultLimit + 1);
}

/** Adapter: a tasks issue/PR row becomes the field's GitHub work item. */
export function toGitHubWorkItem(
  raw: { type: "issue" | "pr"; number: number; title: string; url: string; updatedAt: string },
): GitHubWorkItem {
  return {
    type: raw.type,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    updatedAt: raw.updatedAt,
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
  });
}
