import { describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  TasksView,
  type TasksViewCallbacks,
  type TasksViewData,
} from "./TasksPage";

const noop: TasksViewCallbacks = {
  onSelectProject: () => {},
  onListState: () => {},
  onQuery: () => {},
  onToggleLabel: () => {},
  onToggleAssignee: () => {},
  onSelectIssue: () => {},
  onStart: () => {},
  onRefresh: () => {},
};

function base(): TasksViewData {
  return {
    projects: [{ id: "p1", name: "repo", kind: "git" }],
    projectId: "p1",
    projectKind: "git",
    listState: "open",
    query: "",
    activeLabel: null,
    activeAssignee: null,
    labels: ["bug", "enhancement"],
    assignees: ["octocat"],
    issues: [
      {
        number: 7,
        title: "Fix the sidebar crash",
        state: "open",
        labels: [{ name: "bug", color: "d73a4a" }],
        assignees: ["octocat"],
        updatedAt: "2026-09-06T12:00:00Z",
        url: "https://github.com/example/repo/issues/7",
        body: null,
      },
      {
        number: 9,
        title: "Add browser pane",
        state: "open",
        labels: [{ name: "enhancement", color: null }],
        assignees: [],
        updatedAt: "2026-09-05T09:30:00Z",
        url: "https://github.com/example/repo/issues/9",
        body: null,
      },
    ],
    list: { phase: "ready", repo: "example/repo" },
    selectedNumber: null,
    detail: null,
    detailLoad: { phase: "idle" },
    startBusy: false,
    startError: null,
    startDisabledReason: null,
  };
}

function render(data: TasksViewData): string {
  return renderToString(
    createElement(TasksView, { data, callbacks: noop }),
  ).replace(/<!-- -->/g, "");
}

describe("tasks view", () => {
  test("renders the issue list with numbers, labels and assignees", () => {
    const html = render(base());
    expect(html).toContain("#7");
    expect(html).toContain("Fix the sidebar crash");
    expect(html).toContain("bug");
    expect(html).toContain("@octocat");
    expect(html).toContain("enhancement");
  });

  test("renders the selected issue detail with body and start action", () => {
    const data = base();
    data.selectedNumber = 7;
    data.detail = { ...data.issues[0]!, body: "Steps to reproduce." };
    data.detailLoad = { phase: "ready" };
    const html = render(data);
    expect(html).toContain("Steps to reproduce.");
    expect(html).toContain("Start task");
  });

  test("shows the honest disabled reason for folder projects", () => {
    const data = base();
    data.projects = [{ id: "f1", name: "docs", kind: "folder" }];
    data.projectId = "f1";
    data.projectKind = "folder";
    data.issues = [];
    data.labels = [];
    data.assignees = [];
    data.selectedNumber = 7;
    data.detail = {
      ...base().issues[0]!,
      body: "Steps.",
    };
    data.detailLoad = { phase: "ready" };
    data.startDisabledReason =
      "Tasks needs a GitHub remote: folder projects have none.";
    const html = render(data);
    expect(html).toContain("no GitHub remote");
    expect(html).toContain("folder project");
  });

  test("surfaces list errors with a retry", () => {
    const data = base();
    data.issues = [];
    data.list = {
      phase: "error",
      message: "gh executable could not be spawned: install gh or check PATH",
    };
    const html = render(data);
    expect(html).toContain("install gh");
    expect(html).toContain("Retry");
  });

  test("row selection calls back with the issue number", () => {
    const onSelectIssue = vi.fn();
    const html = renderToString(
      createElement(TasksView, { data: base(), callbacks: { ...noop, onSelectIssue } }),
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("#9");
    expect(onSelectIssue).not.toHaveBeenCalled();
  });
});
