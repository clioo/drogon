import { describe, expect, test } from "vitest";
import type { TaskIssue } from "../../../../shared/tasks-contract";
import {
  collectAssignees,
  collectLabels,
  filterIssues,
  startDisabledReason,
} from "./issue-filters";

function issue(overrides: Partial<TaskIssue> = {}): TaskIssue {
  return {
    number: 7,
    title: "Fix the sidebar crash",
    state: "open",
    labels: [{ name: "bug", color: "d73a4a" }],
    assignees: ["octocat"],
    updatedAt: "2026-09-06T12:00:00Z",
    url: "https://github.com/example/repo/issues/7",
    body: null,
    ...overrides,
  };
}

describe("filterIssues", () => {
  const issues = [
    issue(),
    issue({
      number: 9,
      title: "Add browser pane",
      labels: [{ name: "enhancement", color: null }],
      assignees: [],
    }),
  ];

  test("matches titles case-insensitively and issue numbers", () => {
    expect(filterIssues(issues, "", { label: null, assignee: null })).toHaveLength(2);
    expect(
      filterIssues(issues, "sidebar", { label: null, assignee: null }),
    ).toHaveLength(1);
    expect(
      filterIssues(issues, "BROWSER", { label: null, assignee: null }),
    ).toHaveLength(1);
    expect(
      filterIssues(issues, "#9", { label: null, assignee: null })[0]?.number,
    ).toBe(9);
    expect(
      filterIssues(issues, "nope", { label: null, assignee: null }),
    ).toHaveLength(0);
  });

  test("narrows by label and assignee chips", () => {
    expect(
      filterIssues(issues, "", { label: "bug", assignee: null }),
    ).toHaveLength(1);
    expect(
      filterIssues(issues, "", { label: null, assignee: "octocat" }),
    ).toHaveLength(1);
    expect(
      filterIssues(issues, "", { label: "bug", assignee: "someone-else" }),
    ).toHaveLength(0);
  });

  test("collects sorted unique chips", () => {
    expect(collectLabels(issues)).toEqual(["bug", "enhancement"]);
    expect(collectAssignees(issues)).toEqual(["octocat"]);
  });
});

describe("startDisabledReason", () => {
  test("names the cause instead of silently disabling", () => {
    expect(
      startDisabledReason({ projectKind: "git", busy: false }),
    ).toBeNull();
    expect(startDisabledReason({ projectKind: "git", busy: true })).toContain(
      "Starting",
    );
    expect(
      startDisabledReason({ projectKind: "folder", busy: false }),
    ).toContain("folder");
    expect(startDisabledReason({ projectKind: null, busy: false })).toContain(
      "Git project",
    );
  });
});
