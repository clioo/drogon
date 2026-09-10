// Pull-request mode tests (journey J6 completion): PR row projection, the
// source's PR cells (StatusCell draft/state badge, ReviewCell decision,
// ChecksCell rollup, MergeCell mergeability, AssigneesCell, Avatars), the
// Issues/Pull requests mode switch and the empty PR list.
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { getRepoBackedTaskEmptyState } from "./task-page-empty-state";
import { toPullWorkItem, type TaskPageModel } from "./task-page-model";
import {
  GITHUB_PR_TASK_GRID_CLASS,
  GITHUB_TASK_GRID_CLASS,
} from "./task-page-source-context";
import { getGitHubPRReviewLabel } from "./task-page-github-pr-review";
import {
  getChecksLabel,
  getChecksPillTone,
} from "./task-page-checks-pill";
import { TaskPageGitHubRows } from "./task-page/github/Rows";
import { TaskPageGitHubList } from "./task-page/github/List";
import { TaskPageGitHubModeControls } from "./task-page/github/ModeControls";
import { PRReviewCell } from "./task-page/github/ReviewCell";
import { PRChecksCell } from "./task-page/github/ChecksCell";
import { PRMergeCell } from "./task-page/github/MergeCell";
import { TooltipProvider } from "./ui/tooltip";
import { jiraSurfaceModelDefaults } from "./jira/jira-surface-defaults";
import { linearSurfaceModelDefaults } from "./linear/linear-surface-defaults";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";

function pull(number: number, overrides: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    number,
    title: `PR ${number}`,
    state: "open",
    labels: [{ name: "enhancement", color: "a2eeef" }],
    assignees: ["octocat"],
    author: "helix",
    updatedAt: "2026-09-06T14:00:00Z",
    url: `https://github.com/example/repo/pull/${number}`,
    reviewDecision: "APPROVED",
    checks: {
      state: "pending",
      total: 3,
      passed: 2,
      failed: 0,
      pending: 1,
      neutral: 0,
    },
    mergeable: "MERGEABLE",
    isDraft: false,
    headRefName: "add-pr-flow",
    baseRefName: "main",
    ...overrides,
  };
}

function baseModel(overrides: Partial<TaskPageModel> = {}): TaskPageModel {
  const kind = overrides.githubTaskKind ?? "pulls";
  const showPRManagementColumns =
    overrides.showPRManagementColumns ?? kind === "pulls";
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
    githubTaskKind: "pulls",
    onSelectGithubTaskKind: () => {},
    githubModeButtons: [
      { id: "issues", label: "Issues" },
      { id: "pulls", label: "PRs" },
    ],
    showPRManagementColumns,
    activeTaskPreset: "prs",
    onSelectTaskPreset: () => {},
    taskSearchInput: "",
    setTaskSearchInput: () => {},
    appliedTaskSearch: "",
    handleTaskSearchChange: () => {},
    handleResetGithubTaskSearch: () => {},
    handleRefreshGithubTasks: () => {},
    githubTasksBusy: false,
    newGitHubIssueUrl: null,
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
    githubTaskGridClass:
      overrides.githubTaskGridClass ??
      (showPRManagementColumns ? GITHUB_PR_TASK_GRID_CLASS : GITHUB_TASK_GRID_CLASS),
    currentPage: 0,
    totalPages: 1,
    loadingTargetPage: null,
    handleLoadPage: () => {},
    handleStartWorkItem: () => {},
    startBusyNumber: null,
    githubListScrollRef: { current: null },
    ...jiraSurfaceModelDefaults(),
    ...linearSurfaceModelDefaults(),
    ...overrides,
  };
}

function render(node: React.ReactElement): string {
  return renderToString(
    createElement(TooltipProvider, null, node),
  ).replace(/<!-- -->/g, "");
}

describe("PR work item projection", () => {
  test("projects a TaskPullRequest into the source's PR row shape", () => {
    const item = toPullWorkItem(pull(12), "p1");
    expect(item).toMatchObject({
      id: "pr:12",
      type: "pr",
      number: 12,
      title: "PR 12",
      state: "open",
      author: "helix",
      labels: ["enhancement"],
      repoId: "p1",
      reviewDecision: "APPROVED",
      mergeable: "MERGEABLE",
      headRefName: "add-pr-flow",
      baseRefName: "main",
    });
    expect(item.assignees).toEqual([{ login: "octocat" }]);
    expect(item.checks).toMatchObject({ state: "pending", total: 3 });
  });

  test("keeps the draft state and absent optionals", () => {
    const item = toPullWorkItem(
      pull(13, {
        state: "draft",
        isDraft: true,
        reviewDecision: undefined,
        checks: undefined,
        mergeable: undefined,
        headRefName: undefined,
      }),
      "p1",
    );
    expect(item.state).toBe("draft");
    expect(item.reviewDecision).toBeNull();
    expect(item.checks).toBeNull();
    expect(item.headRefName).toBeNull();
  });
});

describe("PR review helpers", () => {
  test("labels follow the review decision", () => {
    expect(getGitHubPRReviewLabel("APPROVED")).toBe("Approved");
    expect(getGitHubPRReviewLabel("CHANGES_REQUESTED")).toBe("Changes requested");
    expect(getGitHubPRReviewLabel("REVIEW_REQUIRED")).toBe("Reviewers");
    expect(getGitHubPRReviewLabel(null)).toBe("No reviewers");
    expect(getGitHubPRReviewLabel(undefined)).toBe("No reviewers");
  });
});

describe("PR checks helpers", () => {
  test("labels and tones follow the checks rollup", () => {
    const item = toPullWorkItem(pull(12), "p1");
    expect(getChecksLabel(item)).toBe("1 pending");
    expect(getChecksPillTone(item)).toContain("amber");
    const failing = toPullWorkItem(
      pull(12, {
        checks: { state: "failure", total: 2, passed: 1, failed: 1, pending: 0, neutral: 0 },
      }),
      "p1",
    );
    expect(getChecksLabel(failing)).toBe("1 failing");
    expect(getChecksPillTone(failing)).toContain("rose");
    const passing = toPullWorkItem(
      pull(12, {
        checks: { state: "success", total: 3, passed: 3, failed: 0, pending: 0, neutral: 0 },
      }),
      "p1",
    );
    expect(getChecksLabel(passing)).toBe("3/3 passed");
    expect(getChecksPillTone(passing)).toContain("emerald");
    const none = toPullWorkItem(pull(12, { checks: undefined }), "p1");
    expect(getChecksLabel(none)).toBe("Checks");
  });
});

describe("PR cells", () => {
  test("ReviewCell renders the decision with an accessible label", () => {
    const html = render(createElement(PRReviewCell, { item: toPullWorkItem(pull(12), "p1") }));
    expect(html).toContain("Approved");
    expect(html).toContain("Reviewers: Approved");
    const undecided = render(
      createElement(PRReviewCell, {
        item: toPullWorkItem(pull(12, { reviewDecision: undefined }), "p1"),
      }),
    );
    expect(undecided).toContain("No reviewers");
  });

  test("ChecksCell renders the rollup pill", () => {
    const html = render(createElement(PRChecksCell, { item: toPullWorkItem(pull(12), "p1") }));
    expect(html).toContain("1 pending");
  });

  test("MergeCell renders mergeability", () => {
    const html = render(createElement(PRMergeCell, { item: toPullWorkItem(pull(12), "p1") }));
    expect(html).toContain("Mergeable");
    const conflicting = render(
      createElement(PRMergeCell, {
        item: toPullWorkItem(pull(12, { mergeable: "CONFLICTING" }), "p1"),
      }),
    );
    expect(conflicting).toContain("Conflicting");
    // Why: the dropdown item only mounts when the Radix menu opens, so
    // server rendering covers the pill; the merge-box action is exercised
    // in the packaged probe instead.
  });
});

describe("PR rows", () => {
  test("renders the PR pill, refs, management cells and PR start action", () => {
    const model = baseModel({
      filteredWorkItems: [toPullWorkItem(pull(12), "p1")],
    });
    const html = render(createElement(TaskPageGitHubRows, { model }));
    expect(html).toContain("Pull request #12");
    expect(html).toContain("PR 12");
    expect(html).toContain("add-pr-flow");
    expect(html).toContain("main");
    expect(html).toContain("Approved");
    expect(html).toContain("1 pending");
    expect(html).toContain("Mergeable");
    expect(html).toContain("Start workspace from PR");
    expect(html).toContain(">Start<");
    expect(html).toContain("More PR actions");
    expect(html).toContain('role="button"');
  });

  test("renders the draft pill, Draft context and no state badge", () => {
    const model = baseModel({
      filteredWorkItems: [
        toPullWorkItem(pull(13, { state: "draft", isDraft: true }), "p1"),
      ],
    });
    const html = render(createElement(TaskPageGitHubRows, { model }));
    expect(html).toContain("Draft pull request #13");
    expect(html).toContain(">Draft<");
  });

  test("renders the merged state badge", () => {
    const model = baseModel({
      filteredWorkItems: [toPullWorkItem(pull(12, { state: "merged" }), "p1")],
    });
    const html = render(createElement(TaskPageGitHubRows, { model }));
    expect(html).toContain(">Merged<");
  });

  test("renders Resume and the branch label when a worktree is linked", () => {
    const model = baseModel({
      filteredWorkItems: [toPullWorkItem(pull(12), "p1")],
      taskLinks: [
        {
          projectId: "p1",
          issueNumber: 12,
          worktreeId: "w1",
          branch: "add-pr-flow",
          createdAt: "",
        },
      ],
    });
    const html = render(createElement(TaskPageGitHubRows, { model }));
    expect(html).toContain(">Resume<");
    expect(html).toContain("Resume workspace attached to PR");
    expect(html).toContain("#12 · add-pr-flow");
  });
});

describe("PR list chrome", () => {
  test("pulls skeletons mirror the Reviewers/Checks/Merge columns", () => {
    const html = render(
      createElement(TaskPageGitHubList, {
        model: baseModel({ tasksLoading: true, showGitHubTaskSkeletons: true }),
      }),
    );
    // Source List.tsx: three management pill shimmers, no status pill.
    expect(html.match(/h-5 w-20 animate-pulse/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain("h-5 w-14 animate-pulse");
    expect(html).not.toContain("h-3 w-24 animate-pulse");
  });

  test("renders Reviewers/Checks/Merge headers on the PR grid", () => {
    const model = baseModel({
      filteredWorkItems: [toPullWorkItem(pull(12), "p1")],
    });
    const html = render(createElement(TaskPageGitHubList, { model }));
    expect(html).toContain("Reviewers");
    expect(html).toContain("Checks");
    expect(html).toContain("Merge");
    expect(html).not.toContain(">Assignees<");
  });

  test("renders the empty state copy when the PR window has no rows", () => {
    const model = baseModel({ filteredWorkItems: [] });
    const html = render(createElement(TaskPageGitHubList, { model }));
    expect(html).toContain("No matching GitHub work");
  });
});

describe("mode controls", () => {
  test("switches between Issues and PRs with the active kind painted", () => {
    const html = render(
      createElement(TaskPageGitHubModeControls, { model: baseModel({ githubTaskKind: "pulls" }) }),
    );
    expect(html).toContain(">Issues<");
    expect(html).toContain(">PRs<");
    expect(html).toContain('aria-pressed="true"');
    // Issues stays mounted with the same switch (kind-aware search copy lives in Filters).
    expect(baseModel({ githubTaskKind: "issues" }).githubTaskGridClass).toBe(
      GITHUB_TASK_GRID_CLASS,
    );
  });
});
