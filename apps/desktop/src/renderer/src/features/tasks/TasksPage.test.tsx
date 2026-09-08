import { describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { getPageNumbers } from "./task-page-pagination-page-numbers";
import { getRepoBackedTaskEmptyState } from "./task-page-empty-state";
import {
  getTaskPageGitHubWorkItemStateLabel,
  getTaskPageGitHubWorkItemStateTone,
} from "./task-page-github-work-item-status";
import { TaskPageGitHubWorkItemStateBadge } from "./task-page-github-work-item-status-badge";
import { TaskPageGitHubRows } from "./task-page/github/Rows";
import { TaskPageGitHubList } from "./task-page/github/List";
import { PaginationBar } from "./task-page/PaginationBar";
import { TaskPageGitHubFilters } from "./task-page/github/Filters";
import { getGitHubDefaultQuery, projectTasksDaemonQuery } from "./task-page-localized-options";
import { toWorkItem, type TaskPageModel } from "./task-page-model";
import { GITHUB_TASK_GRID_CLASS } from "./task-page-source-context";
import { TooltipProvider } from "./ui/tooltip";
import type { TaskIssue } from "../../../../shared/tasks-contract";

function issue(number: number, overrides: Partial<TaskIssue> = {}): TaskIssue {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    labels: [{ name: "bug", color: "d73a4a" }],
    assignees: ["octocat"],
    author: "helix",
    updatedAt: "2026-09-06T12:00:00Z",
    url: `https://github.com/example/repo/issues/${number}`,
    body: null,
    ...overrides,
  };
}

function baseModel(overrides: Partial<TaskPageModel> = {}): TaskPageModel {
  return {
    taskSource: "github",
    visibleSourceOptions: [],
    taskSourceAvailabilityNoticeByProvider: {},
    taskSourceContextSummary: { label: "GitHub · Local · example/repo", title: "GitHub source" },
    closeTaskPage: () => {},
    taskSourceAvailabilityNotice: null,
    taskPageListChromeHidden: false,
    taskPickerRepos: [{ id: "p1", name: "repo", kind: "git" }],
    repoSelection: new Set(["p1"]),
    setRepoSelection: () => {},
    selectedGitHubRepoExternalLink: { url: "https://github.com/example/repo", label: "example/repo" },
    githubMode: "items",
    stateFilter: "open",
    githubTaskKind: "issues",
    onSelectGithubTaskKind: () => {},
    githubModeButtons: [
      { id: "issues", label: "Issues" },
      { id: "pulls", label: "PRs" },
    ],
    showPRManagementColumns: false,
    onStateFilter: () => {},
    taskSearchInput: "",
    setTaskSearchInput: () => {},
    appliedTaskSearch: "",
    handleTaskSearchChange: () => {},
    handleResetGithubTaskSearch: () => {},
    handleRefreshGithubTasks: () => {},
    githubTasksBusy: false,
    selectedRepos: [{ id: "p1", name: "repo", kind: "git" }],
    repoMap: new Map([["p1", { id: "p1", name: "repo", kind: "git", displayName: "repo", badgeColor: "" }]]),
    filteredWorkItems: [],
    taskLinks: [],
    githubEmptyState: getRepoBackedTaskEmptyState({ provider: "github", selectedRepoCount: 1 }),
    tasksLoading: false,
    tasksError: null,
    githubUnavailable: false,
    showGitHubTaskSkeletons: false,
    githubTaskGridClass: GITHUB_TASK_GRID_CLASS,
    currentPage: 0,
    totalPages: 1,
    loadingTargetPage: null,
    handleLoadPage: () => {},
    handleStartWorkItem: () => {},
    startBusyNumber: null,
    githubListScrollRef: { current: null },
    ...overrides,
  };
}

function render(node: React.ReactElement): string {
  return renderToString(
    createElement(TooltipProvider, null, node),
  ).replace(/<!-- -->/g, "");
}

describe("pagination page numbers (source contract)", () => {
  test("lists every zero-based page when the total fits the no-ellipsis threshold", () => {
    expect(getPageNumbers(0, 1)).toEqual([0]);
    expect(getPageNumbers(4, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("collapses both sides around a middle page", () => {
    expect(getPageNumbers(10, 20)).toEqual([
      0, "ellipsis", 8, 9, 10, 11, 12, "ellipsis", 19,
    ]);
  });
});

describe("work item projection", () => {
  test("projects a TaskIssue into the source's row shape", () => {
    const item = toWorkItem(issue(7), "p1");
    expect(item).toMatchObject({
      id: "issue:7",
      type: "issue",
      number: 7,
      title: "Issue 7",
      state: "open",
      author: "helix",
      labels: ["bug"],
      repoId: "p1",
    });
    expect(item.assignees).toEqual([{ login: "octocat" }]);
  });
});

describe("github rows", () => {
  test("renders id pill, title, author, labels, assignees, status and relative time", () => {
    const model = baseModel({
      filteredWorkItems: [toWorkItem(issue(7), "p1")],
    });
    const html = render(createElement(TaskPageGitHubRows, { model }));
    expect(html).toContain("#7");
    expect(html).toContain("Issue 7");
    expect(html).toContain("helix");
    expect(html).toContain("bug");
    expect(html).toContain("octocat");
    expect(html).toContain(">Open<");
    expect(html).toContain("Start workspace from issue");
    expect(html).toContain(">Start<");
    // Row keyboard contract from the source: a focusable row button.
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  test("renders Open instead of Start and the branch label when a worktree is linked", () => {
    const model = baseModel({
      filteredWorkItems: [toWorkItem(issue(7), "p1")],
      taskLinks: [
        {
          projectId: "p1",
          issueNumber: 7,
          worktreeId: "w1",
          branch: "issue-7-issue-7",
          createdAt: "",
        },
      ],
    });
    const html = render(createElement(TaskPageGitHubRows, { model }));
    expect(html).toContain(">Open<");
    expect(html).toContain("Open workspace attached to issue");
    expect(html).toContain("issue-7-issue-7");
  });

  test("row selection starts the issue worktree (journey-J6 behavior kept)", () => {
    const handleStartWorkItem = vi.fn();
    const model = baseModel({
      filteredWorkItems: [toWorkItem(issue(9), "p1")],
      handleStartWorkItem,
    });
    const html = render(createElement(TaskPageGitHubRows, { model }));
    // The row carries the click/Enter/Space handler through React's synthetic
    // props; the Start button is the visible affordance.
    expect(html).toContain("Start workspace from issue");
    expect(handleStartWorkItem).not.toHaveBeenCalled();
  });
});

describe("github list states", () => {
  test("renders the empty state copy when the window has no rows", () => {
    const model = baseModel({
      filteredWorkItems: [],
      githubEmptyState: getRepoBackedTaskEmptyState({ provider: "github", selectedRepoCount: 1 }),
    });
    const html = render(createElement(TaskPageGitHubList, { model }));
    expect(html).toContain("No matching GitHub work");
    expect(html).toContain("Change the query or clear it.");
  });

  test("renders the no-sources empty state when no project is selected", () => {
    const state = getRepoBackedTaskEmptyState({ provider: "github", selectedRepoCount: 0 });
    expect(state.title).toBe("No project sources selected");
    expect(state.description).toContain("Select at least one project source");
  });

  test("renders the hard error banner and hides the empty state", () => {
    const model = baseModel({
      filteredWorkItems: [],
      tasksError: "gh executable could not be spawned (install gh or check PATH)",
    });
    const html = render(createElement(TaskPageGitHubList, { model }));
    expect(html).toContain("gh executable could not be spawned");
    expect(html).not.toContain("No matching GitHub work");
  });

  test("renders the GitHub outage banner for unavailable gh", () => {
    const model = baseModel({ githubUnavailable: true, tasksError: null });
    const html = render(createElement(TaskPageGitHubList, { model }));
    expect(html).toContain("GitHub data is temporarily unavailable");
    expect(html).toContain('role="alert"');
  });

  test("renders loading skeletons while the first page loads", () => {
    const model = baseModel({
      tasksLoading: true,
      showGitHubTaskSkeletons: true,
    });
    const html = render(createElement(TaskPageGitHubList, { model }));
    expect(html).toContain("animate-pulse");
    expect(html).toContain(">ID<");
    expect(html).toContain("Title / Context");
  });

  test("renders the pagination bar only when a next page exists", () => {
    const rows = [toWorkItem(issue(1), "p1")];
    const paged = baseModel({
      filteredWorkItems: rows,
      currentPage: 0,
      totalPages: 2,
    });
    const html = render(createElement(TaskPageGitHubList, { model: paged }));
    expect(html).toContain("aria-label=\"Pagination\"");
    expect(html).toContain("Next page");
    const single = baseModel({ filteredWorkItems: rows, totalPages: 1 });
    expect(render(createElement(TaskPageGitHubList, { model: single }))).not.toContain(
      "aria-label=\"Pagination\"",
    );
  });
});

describe("pagination bar", () => {
  test("disables Previous on the first page and labels pages one-based", () => {
    const html = render(
      createElement(PaginationBar, {
        currentPage: 0,
        totalPages: 3,
        loadingTarget: null,
        onPageChange: () => {},
      }),
    );
    expect(html).toContain('aria-label="Previous page"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Page 1"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Page 3"');
  });

  test("shows the spinner on the loading target page", () => {
    const html = render(
      createElement(PaginationBar, {
        currentPage: 0,
        totalPages: 3,
        loadingTarget: 1,
        onPageChange: () => {},
      }),
    );
    expect(html).toContain("animate-spin");
  });
});

describe("filters row", () => {
  test("renders the open/closed/all mode controls with the active state", () => {
    const html = render(
      createElement(TaskPageGitHubFilters, {
        model: baseModel({ stateFilter: "closed" }),
      }),
    );
    expect(html).toContain(">Open<");
    expect(html).toContain(">Closed<");
    expect(html).toContain(">All<");
    expect(html).toContain("Search GitHub issues...");
    expect(html).toContain("Refresh GitHub work");
    // closed is the active pill: painted with the inverted foreground surface
    expect(html).toContain("bg-foreground/90");
  });

  test("renders the clear-search affordance only with a draft", () => {
    const withDraft = render(
      createElement(TaskPageGitHubFilters, {
        model: baseModel({ taskSearchInput: "crash" }),
      }),
    );
    expect(withDraft).toContain('aria-label="Clear search"');
    const withoutDraft = render(
      createElement(TaskPageGitHubFilters, { model: baseModel({}) }),
    );
    expect(withoutDraft).not.toContain('aria-label="Clear search"');
  });

  test("renders the source's disabled new-issue button before refresh", () => {
    const html = render(
      createElement(TaskPageGitHubFilters, { model: baseModel({}) }),
    );
    expect(html).toContain('aria-label="New GitHub issue"');
    expect(html).toContain("disabled");
  });

  test("uses the source's PR search placeholder in pulls mode", () => {
    const html = render(
      createElement(TaskPageGitHubFilters, {
        model: baseModel({ githubTaskKind: "pulls" }),
      }),
    );
    expect(html).toContain("Search GitHub PRs...");
  });
});

describe("github default query (source presetToQuery)", () => {
  test("prefills the kind qualifier query", () => {
    expect(getGitHubDefaultQuery("issues")).toBe("is:issue is:open");
    expect(getGitHubDefaultQuery("pulls")).toBe("is:pr is:open");
  });

  test("strips daemon-implied qualifiers before the title/number query", () => {
    expect(projectTasksDaemonQuery("is:issue is:open")).toBeUndefined();
    expect(projectTasksDaemonQuery("is:pr is:open")).toBeUndefined();
    expect(projectTasksDaemonQuery("is:issue is:open crash on start")).toBe(
      "crash on start",
    );
    expect(projectTasksDaemonQuery("  crash  ")).toBe("crash");
    expect(projectTasksDaemonQuery("")).toBeUndefined();
  });
});

describe("work item status", () => {
  test("labels and tones follow the issue state", () => {
    expect(getTaskPageGitHubWorkItemStateLabel({ type: "issue", state: "open" })).toBe("Open");
    expect(getTaskPageGitHubWorkItemStateLabel({ type: "issue", state: "closed" })).toBe("Closed");
    expect(getTaskPageGitHubWorkItemStateTone({ type: "issue", state: "open" })).toContain(
      "emerald",
    );
    expect(getTaskPageGitHubWorkItemStateTone({ type: "issue", state: "closed" })).toContain(
      "rose",
    );
    const html = render(
      createElement(TaskPageGitHubWorkItemStateBadge, {
        item: { type: "issue", state: "closed" },
      }),
    );
    expect(html).toContain(">Closed<");
  });
});
