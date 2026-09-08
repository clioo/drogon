// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Tasks issue-source wiring (#246):
   the Upstream/Origin pills render for a two-remote repo and clicking one
   pins the source so `tasks.list` reads that remote's repo. */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "./ui/tooltip";
import { TasksPage, clearTasksPageResultCache } from "./TasksPage";
import type { TaskIssue, TasksBridge } from "../../../../shared/tasks-contract";
import type { ProjectGroup } from "../shell/project-adapter";

afterEach(() => {
  cleanup();
  clearTasksPageResultCache();
});

beforeEach(() => {
  localStorage.clear();
});

function issue(number: number, title: string): TaskIssue {
  return {
    number,
    title,
    state: "open",
    labels: [],
    assignees: [],
    author: "octocat",
    updatedAt: "2026-09-06T12:00:00Z",
    url: `https://github.com/example/repo/issues/${number}`,
    body: null,
  };
}

function groups(): ProjectGroup[] {
  return [
    {
      project: { id: "p1", name: "repo", kind: "git" },
      workspaces: [],
    } as unknown as ProjectGroup,
  ];
}

function fakeBridge({
  tasksList,
  remotes,
}: {
  tasksList: TasksBridge["tasksList"];
  remotes: { origin?: string; upstream?: string };
}): TasksBridge {
  return {
    tasksList,
    tasksShow: () =>
      Promise.resolve({ ok: false as const, error: { code: "x", message: "x", retryable: false } }),
    tasksStart: () =>
      Promise.resolve({ ok: false as const, error: { code: "x", message: "x", retryable: false } }),
    tasksLinks: () => Promise.resolve({ ok: true as const, result: { links: [] } }),
    tasksRemotes: () => Promise.resolve({ ok: true as const, result: remotes }),
    tasksProjects: () => Promise.resolve({ ok: true as const, result: { projects: [] } }),
    tasksWorktrees: () => Promise.resolve({ ok: true as const, result: { worktrees: [] } }),
  };
}

function okIssues(titles: [number, string][], repo = "example/repo") {
  return {
    ok: true as const,
    result: {
      repo,
      issues: titles.map(([number, title]) => issue(number, title)),
      page: 1,
      perPage: 36,
      hasNextPage: false,
    },
  };
}

function renderPage(bridge: TasksBridge) {
  return render(
    <TooltipProvider>
      <TasksPage bridge={bridge} loadGroups={groups} onOpenTerminal={() => {}} />
    </TooltipProvider>,
  );
}

describe("tasks issue-source selector wiring", () => {
  test("renders the pills for a two-remote repo and pins the source on click", async () => {
    const tasksList = vi.fn(async (input: { source?: string }) =>
      okIssues([[7, "Fix the sidebar crash"]], input.source === "origin" ? "example/repo" : "upstream-org/repo"),
    );
    renderPage(
      fakeBridge({
        tasksList: tasksList as TasksBridge["tasksList"],
        remotes: { origin: "example/repo", upstream: "upstream-org/repo" },
      }),
    );

    // Topology arrives via tasks.remotes; auto highlights Upstream.
    const upstream = await screen.findByRole("button", { name: "Upstream" });
    const origin = screen.getByRole("button", { name: "Origin" });
    expect(upstream.getAttribute("aria-pressed")).toBe("true");
    expect(origin.getAttribute("aria-pressed")).toBe("false");
    // Auto sends no explicit source; the daemon resolves upstream-first.
    expect(tasksList).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", source: undefined }),
    );

    fireEvent.click(origin);
    await waitFor(() => {
      expect(origin.getAttribute("aria-pressed")).toBe("true");
    });
    expect(upstream.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => {
      expect(tasksList).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "p1", source: "origin" }),
      );
    });
    // The pin persists (fork: setIssueSourcePreference).
    expect(localStorage.getItem("drogon:tasks-issue-source:p1")).toBe("origin");
  });

  test("a stored pin applies to the first list call and its pill starts pressed", async () => {
    localStorage.setItem("drogon:tasks-issue-source:p1", "origin");
    const tasksList = vi.fn(async () => okIssues([[7, "Fix the sidebar crash"]]));
    renderPage(
      fakeBridge({
        tasksList,
        remotes: { origin: "example/repo", upstream: "upstream-org/repo" },
      }),
    );
    const origin = await screen.findByRole("button", { name: "Origin" });
    expect(origin.getAttribute("aria-pressed")).toBe("true");
    expect(tasksList).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", source: "origin" }),
    );
  });

  test("a single-remote repo renders no selector (closed #126 stays closed)", async () => {
    const tasksList = vi.fn(async () => okIssues([[7, "Fix the sidebar crash"]]));
    renderPage(
      fakeBridge({ tasksList, remotes: { origin: "example/repo" } }),
    );
    await screen.findByText("Fix the sidebar crash");
    expect(screen.queryByRole("group", { name: "Issue source" })).toBeNull();
  });

  test("same-slug remotes render no selector", async () => {
    const tasksList = vi.fn(async () => okIssues([[7, "Fix the sidebar crash"]]));
    renderPage(
      fakeBridge({
        tasksList,
        remotes: { origin: "example/repo", upstream: "Example/Repo" },
      }),
    );
    await screen.findByText("Fix the sidebar crash");
    expect(screen.queryByRole("group", { name: "Issue source" })).toBeNull();
  });
});
