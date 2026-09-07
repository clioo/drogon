// Adapter model for the ported Orca task-page components. The source
// threads one giant `TaskPageComposerActionsModel` through every component;
// this repo keeps the same field names but only the GitHub-only subset the
// components actually read, assembled by TasksPage.tsx from the bridge.
import type { Dispatch, JSX, RefObject, SetStateAction } from "react";
import type { TaskIssue, TaskLink, TasksProjectRef } from "../../../../shared/tasks-contract";
import type { GitHubWorkItemLike } from "./task-page-github-work-item-status";
import type {
  GitHubStateFilterId,
  SourceOption,
} from "./task-page-localized-options";
import type { RepoBackedTaskEmptyState } from "./task-page-empty-state";

/** One row of the GitHub list: a TaskIssue projected into the source's work-item shape. */
export type TaskPageWorkItem = GitHubWorkItemLike & {
  id: string;
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  labels: string[];
  updatedAt: string;
  author: string | null;
  assignees: { login: string; name?: string | null; avatarUrl?: string | null }[];
  repoId: string;
};

export function toWorkItem(issue: TaskIssue, repoId: string): TaskPageWorkItem {
  return {
    id: `issue:${issue.number}`,
    type: "issue",
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.url,
    labels: issue.labels.map((label) => label.name),
    updatedAt: issue.updatedAt,
    author: issue.author ?? null,
    assignees: issue.assignees.map((login) => ({ login })),
    repoId,
  };
}

export type TaskPickerRepo = { id: string; name: string; kind: "git" | "folder" };

export type TaskPageSourceContextSummary = { label: string; title: string };

export type TaskPageSourceAvailabilityNotice = { label: string; blocking: boolean } | null;

export type TaskPageModel = {
  // Source bar.
  taskSource: "github";
  visibleSourceOptions: SourceOption[];
  taskSourceAvailabilityNoticeByProvider: Partial<
    Record<string, { label: string; blocking: boolean }>
  >;
  taskSourceContextSummary: TaskPageSourceContextSummary;
  closeTaskPage: () => void;

  // List chrome.
  taskSourceAvailabilityNotice: { label: string; title: string } | null;
  taskPageListChromeHidden: boolean;

  // Mode controls (repo combobox + external link; Projects/PRs modes do not exist here).
  taskPickerRepos: TaskPickerRepo[];
  repoSelection: Set<string>;
  setRepoSelection: (next: Set<string>) => void;
  selectedGitHubRepoExternalLink: { url: string; label: string } | null;

  // Filters.
  githubMode: "items";
  stateFilter: GitHubStateFilterId;
  onStateFilter: (state: GitHubStateFilterId) => void;
  taskSearchInput: string;
  setTaskSearchInput: Dispatch<SetStateAction<string>>;
  appliedTaskSearch: string;
  handleTaskSearchChange: (value: string) => void;
  handleResetGithubTaskSearch: () => void;
  handleRefreshGithubTasks: () => void;
  githubTasksBusy: boolean;

  // List state.
  selectedRepos: TaskPickerRepo[];
  repoMap: Map<string, TaskPickerRepo & { displayName: string; badgeColor: string }>;
  filteredWorkItems: TaskPageWorkItem[];
  taskLinks: TaskLink[];
  githubEmptyState: RepoBackedTaskEmptyState;
  tasksLoading: boolean;
  tasksError: string | null;
  githubUnavailable: boolean;
  showGitHubTaskSkeletons: boolean;
  githubTaskGridClass: string;

  // Pagination.
  currentPage: number;
  totalPages: number;
  loadingTargetPage: number | null;
  handleLoadPage: (page: number) => void;

  // Row actions.
  handleStartWorkItem: (item: TaskPageWorkItem) => void;
  startBusyNumber: number | null;

  // Refs (scroll position reset across page changes).
  githubListScrollRef: RefObject<HTMLDivElement | null>;
};

export type TaskPageModelProps = { model: TaskPageModel };

/** The page-level container element type shared by the ported frame components. */
export type TaskPageElement = JSX.Element;
