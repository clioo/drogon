// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Click behavior for the Tasks filter
   chrome (#126): preset pills select the source query, the New GitHub issue
   button opens the repo's filing page in the system browser (never a create
   RPC), and the mode-controls external link uses the same shell seam —
   main denies window.open, so the fork's shell.openUrl is the only opener. */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TaskPageGitHubFilters } from "./task-page/github/Filters";
import { TaskPageGitHubModeControls } from "./task-page/github/ModeControls";
import { getRepoBackedTaskEmptyState } from "./task-page-empty-state";
import { GITHUB_TASK_GRID_CLASS } from "./task-page-source-context";
import { TooltipProvider } from "./ui/tooltip";
import type { TaskPageModel } from "./task-page-model";

afterEach(cleanup);

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
    githubTaskKind: "issues",
    onSelectGithubTaskKind: () => {},
    githubModeButtons: [
      { id: "issues", label: "Issues" },
      { id: "pulls", label: "PRs" },
    ],
    showPRManagementColumns: false,
    activeTaskPreset: "issues",
    onSelectTaskPreset: () => {},
    taskSearchInput: "is:issue is:open",
    setTaskSearchInput: () => {},
    appliedTaskSearch: "is:issue is:open",
    handleTaskSearchChange: () => {},
    handleResetGithubTaskSearch: () => {},
    handleRefreshGithubTasks: () => {},
    githubTasksBusy: false,
    newGitHubIssueUrl: "https://github.com/example/repo/issues/new",
    openExternal: () => {},
    issueSourceOrigin: null,
    issueSourceUpstream: null,
    issueSourcePreference: undefined,
    onSelectIssueSource: () => {},
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

function renderFilters(model: TaskPageModel) {
  return render(
    <TooltipProvider>
      <TaskPageGitHubFilters model={model} />
    </TooltipProvider>,
  );
}

describe("preset pill clicks", () => {
  test("selects the assignee preset query", () => {
    const onSelectTaskPreset = vi.fn();
    renderFilters(baseModel({ onSelectTaskPreset }));
    fireEvent.click(screen.getByRole("button", { name: "Assigned to me" }));
    expect(onSelectTaskPreset).toHaveBeenCalledTimes(1);
    expect(onSelectTaskPreset).toHaveBeenCalledWith("my-issues");
  });

  test("selects the Mine preset in pulls mode", () => {
    const onSelectTaskPreset = vi.fn();
    renderFilters(baseModel({ githubTaskKind: "pulls", onSelectTaskPreset }));
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(onSelectTaskPreset).toHaveBeenCalledWith("my-prs");
  });
});

describe("new GitHub issue button", () => {
  test("opens the repo filing page in the system browser", () => {
    const openExternal = vi.fn();
    renderFilters(baseModel({ openExternal }));
    fireEvent.click(screen.getByRole("button", { name: "New GitHub issue" }));
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://github.com/example/repo/issues/new");
  });

  test("stays disabled with no resolved repo and never calls the opener", () => {
    const openExternal = vi.fn();
    renderFilters(baseModel({ newGitHubIssueUrl: null, openExternal }));
    const button = screen.getByRole("button", { name: "New GitHub issue" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("mode controls external link", () => {
  test("opens the repo in the system browser instead of window.open", () => {
    const openExternal = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      render(
        <TooltipProvider>
          <TaskPageGitHubModeControls model={baseModel({ openExternal })} />
        </TooltipProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open example/repo in GitHub" }));
      expect(openExternal).toHaveBeenCalledWith("https://github.com/example/repo");
      // Main denies window.open: the shell bridge is the only opener.
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });
});
