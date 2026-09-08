// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Tasks fast default load (#238):
   the default view lists with state open and no query (the daemon's cheap
   one-window probe), and the last result per request survives tab switches
   so a return visit paints rows instantly instead of replaying the
   skeleton, then revalidates. Typing is:closed derives state closed like
   the fork's single filter bar. */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "./ui/tooltip";
import {
  TasksPage,
  clearTasksPageResultCache,
  readTasksPageCache,
} from "./TasksPage";
import type { TaskIssue } from "../../../../shared/tasks-contract";
import type { TasksBridge } from "../../../../shared/tasks-contract";
import type { ProjectGroup } from "../shell/project-adapter";

afterEach(() => {
  cleanup();
  clearTasksPageResultCache();
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

function fakeBridge(tasksList: TasksBridge["tasksList"]): TasksBridge {
  return {
    tasksList,
    tasksShow: () =>
      Promise.resolve({ ok: false as const, error: { code: "x", message: "x", retryable: false } }),
    tasksStart: () =>
      Promise.resolve({ ok: false as const, error: { code: "x", message: "x", retryable: false } }),
    tasksLinks: () => Promise.resolve({ ok: true as const, result: { links: [] } }),
    tasksProjects: () => Promise.resolve({ ok: true as const, result: { projects: [] } }),
    tasksWorktrees: () => Promise.resolve({ ok: true as const, result: { worktrees: [] } }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((inner) => {
    resolve = inner;
  });
  return { promise, resolve };
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

describe("tasks default load and result cache", () => {
  test("default view lists open with no query and caches the result", async () => {
    const tasksList = vi.fn(async () => okIssues([[1, "Cached row one"]]));
    render(
      <TooltipProvider>
        <TasksPage
          bridge={fakeBridge(tasksList)}
          loadGroups={groups}
          onOpenTerminal={() => {}}
        />
      </TooltipProvider>,
    );
    await screen.findByText("Cached row one");
    expect(tasksList).toHaveBeenCalledTimes(1);
    // Default preset strips to the cheap path: state open, no query.
    expect(tasksList).toHaveBeenCalledWith({
      projectId: "p1",
      state: "open",
      query: undefined,
      page: 1,
      perPage: 36,
      mode: "issues",
    });
    expect(
      readTasksPageCache({ projectId: "p1", kind: "issues", state: "open", query: undefined, page: 1 })
        ?.workItems.map((item) => item.title),
    ).toEqual(["Cached row one"]);
  });

  test("return visit paints cached rows before the revalidation lands", async () => {
    const pending = deferred<ReturnType<typeof okIssues>>();
    const tasksList = vi.fn(() => pending.promise);
    const first = render(
      <TooltipProvider>
        <TasksPage
          bridge={fakeBridge(async () => okIssues([[2, "Seeded row two"]]))}
          loadGroups={groups}
          onOpenTerminal={() => {}}
        />
      </TooltipProvider>,
    );
    await screen.findByText("Seeded row two");
    first.unmount();

    render(
      <TooltipProvider>
        <TasksPage bridge={fakeBridge(tasksList)} loadGroups={groups} onOpenTerminal={() => {}} />
      </TooltipProvider>,
    );
    // Cache seed: rows paint synchronously, no skeleton re-run.
    expect(await screen.findByText("Seeded row two")).toBeTruthy();
    await waitFor(() => expect(tasksList).toHaveBeenCalledTimes(1));
    pending.resolve(okIssues([[3, "Fresh row three"]]));
    await screen.findByText("Fresh row three");
  });

  test("switching kind back paints cached rows without a skeleton", async () => {
    const revalidation = deferred<ReturnType<typeof okIssues>>();
    let issuesCalls = 0;
    const tasksList = vi.fn(async (input: { mode?: string }) => {
      if (input.mode === "pulls") {
        return {
          ok: true as const,
          result: { repo: "example/repo", issues: [], pulls: [], page: 1, perPage: 36, hasNextPage: false },
        };
      }
      issuesCalls += 1;
      // First visit resolves at once; the switch-back revalidation stays
      // pending so the test observes the seed, not the fetch.
      return issuesCalls === 1 ? okIssues([[5, "Seeded row five"]]) : revalidation.promise;
    });
    render(
      <TooltipProvider>
        <TasksPage
          bridge={fakeBridge(tasksList)}
          loadGroups={groups}
          onOpenTerminal={() => {}}
        />
      </TooltipProvider>,
    );
    await screen.findByText("Seeded row five");
    fireEvent.click(screen.getByRole("button", { name: "PRs" }));
    await waitFor(() => expect(screen.queryByText("Seeded row five")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Issues" }));
    // Cache seed paints synchronously: rows back before the pending
    // revalidation lands, with no skeleton flash.
    expect(screen.getByText("Seeded row five")).toBeTruthy();
    expect(document.querySelector("[data-task-list-scroll=github]")?.innerHTML).not.toMatch(
      "animate-pulse",
    );
    revalidation.resolve(okIssues([[5, "Seeded row five"]]));
    await screen.findByText("Seeded row five");
  });

  test("typing is:closed derives the closed daemon state", async () => {
    const tasksList = vi.fn(async () => okIssues([[4, "Open row four"]]));
    render(
      <TooltipProvider>
        <TasksPage
          bridge={fakeBridge(tasksList)}
          loadGroups={groups}
          onOpenTerminal={() => {}}
        />
      </TooltipProvider>,
    );
    await screen.findByText("Open row four");
    fireEvent.change(screen.getByPlaceholderText("Search GitHub issues..."), {
      target: { value: "is:issue is:closed" },
    });
    await waitFor(() =>
      expect(tasksList).toHaveBeenLastCalledWith({
        projectId: "p1",
        state: "closed",
        query: undefined,
        page: 1,
        perPage: 36,
        mode: "issues",
      }),
    );
  });
});
