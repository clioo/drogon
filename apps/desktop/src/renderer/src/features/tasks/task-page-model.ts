// Adapter model for the ported Orca task-page components. The source
// threads one giant `TaskPageComposerActionsModel` through every component;
// this repo keeps the same field names but only the GitHub + Jira subset
// the components actually read, assembled by TasksPage.tsx from the
// bridges.
import type { Dispatch, JSX, RefObject, SetStateAction } from "react";
import type {
  CheckState,
  PRMergeableState,
  PRReviewDecision,
  TaskIssue,
  TaskLink,
  TaskPullRequest,
  TasksProjectRef,
} from "../../../../shared/tasks-contract";
import type { GitHubWorkItemLike } from "./task-page-github-work-item-status";
import type {
  GitHubTaskKind,
  GitHubTaskPresetId,
  SourceOption,
} from "./task-page-localized-options";
import type { RepoBackedTaskEmptyState } from "./task-page-empty-state";
import type {
  GitHubOwnerRepo,
  IssueSourcePreference,
} from "./issue-source-selector";
import type { TaskSource } from "./task-source-navigation";
import type {
  JiraBridge,
  JiraConnectionStatus,
  JiraIssue,
  JiraProject,
  JiraSite,
} from "../../../../shared/jira-contract";
import type { JiraPreset, JiraPresetId } from "./task-page-localized-options";
import type { TaskPageJiraLoadError } from "./jira/jira-list-load-state";
import type {
  JiraIssueSortColumn,
  JiraIssueSortDirection,
} from "./jira/jira-issue-sorter";
import type { JiraIssueCreationDialogState } from "./jira/use-jira-issue-creation";

/** One row of the GitHub list: a TaskIssue/TaskPullRequest projected into the source's work-item shape. */
export type TaskPageWorkItem = GitHubWorkItemLike & {
  id: string;
  type: "issue" | "pr";
  number: number;
  title: string;
  state: "open" | "closed" | "merged" | "draft";
  url: string;
  labels: string[];
  updatedAt: string;
  author: string | null;
  assignees: { login: string; name?: string | null; avatarUrl?: string | null }[];
  repoId: string;
  /** PR-only: the daemon's `gh` fields; absent on issue rows. */
  reviewDecision?: PRReviewDecision | null;
  checks?: {
    state: CheckState;
    total: number;
    passed: number;
    failed: number;
    pending: number;
    neutral: number;
  } | null;
  mergeable?: PRMergeableState | null;
  headRefName?: string | null;
  baseRefName?: string | null;
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

/** Projects a TaskPullRequest into the source's PR row shape (`pr:<n>` id, draft state from `isDraft`). */
export function toPullWorkItem(pull: TaskPullRequest, repoId: string): TaskPageWorkItem {
  return {
    id: `pr:${pull.number}`,
    type: "pr",
    number: pull.number,
    title: pull.title,
    state: pull.state,
    url: pull.url,
    labels: pull.labels.map((label) => label.name),
    updatedAt: pull.updatedAt,
    author: pull.author ?? null,
    assignees: pull.assignees.map((login) => ({ login })),
    repoId,
    reviewDecision: pull.reviewDecision ?? null,
    checks: pull.checks ?? null,
    mergeable: pull.mergeable ?? null,
    headRefName: pull.headRefName ?? null,
    baseRefName: pull.baseRefName ?? null,
  };
}

export type TaskPickerRepo = { id: string; name: string; kind: "git" | "folder" };

export type TaskPageSourceContextSummary = { label: string; title: string };

export type TaskPageSourceAvailabilityNotice = { label: string; blocking: boolean } | null;

export type TaskPageModel = {
  // Source bar. Wider than today's GitHub-only options so a deep-linked
  // source (sidebar chips, #346) stays selected for R17-B's Jira surface.
  taskSource: TaskSource;
  visibleSourceOptions: SourceOption[];
  taskSourceAvailabilityNoticeByProvider: Partial<
    Record<string, { label: string; blocking: boolean }>
  >;
  taskSourceContextSummary: TaskPageSourceContextSummary;
  closeTaskPage: () => void;

  // List chrome.
  taskSourceAvailabilityNotice: { label: string; title: string } | null;
  taskPageListChromeHidden: boolean;

  // Mode controls (repo combobox + external link, Issues/PRs kind switch).
  taskPickerRepos: TaskPickerRepo[];
  repoSelection: Set<string>;
  setRepoSelection: (next: Set<string>) => void;
  selectedGitHubRepoExternalLink: { url: string; label: string } | null;
  githubTaskKind: GitHubTaskKind;
  onSelectGithubTaskKind: (kind: GitHubTaskKind) => void;
  githubModeButtons: { id: GitHubTaskKind; label: string }[];
  /** True in pulls mode: rows render Reviewers/Checks/Merge instead of Assignees/Status. */
  showPRManagementColumns: boolean;

  // Filters: one bar like the fork (preset pills + search). The daemon
  // `state` is derived from the applied search text in TasksPage.tsx
  // (projectTasksDaemonState), never a second control.
  githubMode: "items";
  /** Source preset pill (fork Filters.tsx row); null once the user types. */
  activeTaskPreset: GitHubTaskPresetId | null;
  onSelectTaskPreset: (preset: GitHubTaskPresetId) => void;
  taskSearchInput: string;
  setTaskSearchInput: Dispatch<SetStateAction<string>>;
  appliedTaskSearch: string;
  handleTaskSearchChange: (value: string) => void;
  handleResetGithubTaskSearch: () => void;
  handleRefreshGithubTasks: () => void;
  githubTasksBusy: boolean;
  /** `https://github.com/<repo>/issues/new`; null until a repo resolves. */
  newGitHubIssueUrl: string | null;
  /** System-browser opener (`window.drogon.shell.openExternal`); null off-app (tests/SSR). */
  openExternal: TasksOpenExternal | null;

  // Issue source (fork Filters.tsx bottom row): the Upstream/Origin
  // segmented control, rendered only when the selected repo's origin and
  // upstream remotes resolve to different GitHub slugs.
  /** Origin slug from `tasks.remotes`; null while unresolved/absent. */
  issueSourceOrigin: GitHubOwnerRepo | null;
  /** Upstream slug from `tasks.remotes`; null when the repo has none. */
  issueSourceUpstream: GitHubOwnerRepo | null;
  /** The persisted per-repo pin; undefined is the fork's `'auto'`. */
  issueSourcePreference: IssueSourcePreference | undefined;
  onSelectIssueSource: (next: IssueSourcePreference) => void;

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
} & TaskPageJiraModelFields;

// R17-B: the Jira source surface (fork task-page/jira/Content.tsx +
// Filters.tsx + SourceBar.tsx wiring), assembled by TasksPage.tsx over
// the jira.v1 bridge. Field names mirror the fork's model keys; kept as
// an intersected field set so chrome tests can spread
// jiraSurfaceModelDefaults().
export type TaskPageJiraModelFields = {
  onSelectTaskSource: (source: TaskSource) => void;
  hideTaskSource: (source: TaskSource, label: string) => void;
  jiraStatus: JiraConnectionStatus | null;
  jiraStatusReady: boolean;
  jiraConnected: boolean;
  jiraSites: JiraSite[];
  selectedJiraSiteId: string | null;
  onSelectJiraSite: (siteId: string) => void;
  jiraConnectOpen: boolean;
  setJiraConnectOpen: (open: boolean) => void;
  /** Re-reads jira.status after the connect dialog succeeds. */
  refreshJiraStatus: () => void;
  jiraPresets: JiraPreset[];
  jiraLoading: boolean;
  jiraSearchInput: string;
  setJiraSearchInput: Dispatch<SetStateAction<string>>;
  setAppliedJiraSearch: Dispatch<SetStateAction<string>>;
  activeJiraPreset: JiraPresetId;
  onSelectJiraPreset: (preset: JiraPresetId) => void;
  handleRefreshJiraIssues: () => void;
  jiraProjectsLoading: boolean;
  sortedAvailableJiraProjects: JiraProject[];
  onOpenNewJiraIssue: () => void;
  jiraIssues: JiraIssue[];
  jiraError: TaskPageJiraLoadError | null;
  jiraErrorDetailsOpen: boolean;
  setJiraErrorDetailsOpen: (open: boolean) => void;
  jiraOrderBy: JiraIssueSortColumn;
  jiraOrderDirection: JiraIssueSortDirection;
  handleJiraSort: (column: JiraIssueSortColumn) => void;
  sortedJiraIssues: JiraIssue[];
  selectedJiraIssue: JiraIssue | null;
  openJiraDetailPage: (issue: JiraIssue) => void;
  closeJiraDetailPage: () => void;
  handleUseJiraItem: (issue: JiraIssue) => void;
  jiraWorkspaceBridge: JiraBridge;
  jiraWorkspaceSiteId: string | null;
  openJiraIssueUrl: (url: string) => Promise<unknown> | unknown;
  writeJiraClipboardText: (text: string) => Promise<unknown> | unknown;
  onJiraIssuePatched: (issue: JiraIssue) => void;
  /** The R17-C create dialog state (the fork's newJiraIssue* slice). */
  jiraCreationDialog: JiraIssueCreationDialogState;
};

export type TaskPageModelProps = { model: TaskPageModel };

/** System-browser opener (the `window.drogon.shell.openExternal` shape). */
export type TasksOpenExternal = (url: string) => Promise<unknown> | unknown;

/** The page-level container element type shared by the ported frame components. */
export type TaskPageElement = JSX.Element;
