// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Tasks initial source (#346): a
   source requested through the navigation seam before mount is consumed
   on mount; a request for a source the page cannot render yet (Jira
   before R17-B) falls back to the default source instead of blanking the
   page; a live request while the page is kept mounted re-resolves. */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "./ui/tooltip";
import { TasksPage, clearTasksPageResultCache } from "./TasksPage";
import {
  requestTaskSourceNavigation,
  resetTaskSourceNavigation,
} from "./task-source-navigation";
import type { TasksBridge } from "../../../../shared/tasks-contract";
import type { ProjectGroup } from "../shell/project-adapter";

afterEach(() => {
  cleanup();
  clearTasksPageResultCache();
  resetTaskSourceNavigation();
});

beforeEach(() => {
  localStorage.clear();
});

function groups(): ProjectGroup[] {
  return [
    {
      project: { id: "p1", name: "repo", kind: "git" },
      workspaces: [],
    } as unknown as ProjectGroup,
  ];
}

function fakeBridge(): TasksBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: { code: "x", message: "x", retryable: false },
    });
  return {
    tasksList: () =>
      Promise.resolve({
        ok: true as const,
        result: {
          repo: "example/repo",
          issues: [
            {
              number: 7,
              title: "Fix the sidebar crash",
              state: "open",
              labels: [],
              assignees: [],
              author: "octocat",
              updatedAt: "2026-09-06T12:00:00Z",
              url: "https://github.com/example/repo/issues/7",
              body: null,
            },
          ],
          page: 1,
          perPage: 36,
          hasNextPage: false,
        },
      }),
    tasksShow: refused,
    tasksStart: refused,
    tasksLinks: () =>
      Promise.resolve({ ok: true as const, result: { links: [] } }),
    tasksRemotes: () =>
      Promise.resolve({
        ok: true as const,
        result: { origin: "example/repo" },
      }),
    tasksProjects: () =>
      Promise.resolve({ ok: true as const, result: { projects: [] } }),
    tasksWorktrees: () =>
      Promise.resolve({ ok: true as const, result: { worktrees: [] } }),
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <TasksPage
        bridge={fakeBridge()}
        loadGroups={groups}
        onOpenTerminal={() => {}}
      />
    </TooltipProvider>,
  );
}

/** The SourceBar's source icon buttons carry data-task-source + aria-pressed. */
function sourceButton(id: string): HTMLElement | null {
  return document.querySelector(`[data-task-source='${id}']`);
}

describe("TasksPage initial source", () => {
  test("renders the GitHub source as the default", async () => {
    renderPage();
    await waitFor(() => {
      expect(sourceButton("github")?.getAttribute("aria-pressed")).toBe("true");
    });
  });

  test("consumes a source requested before mount", async () => {
    requestTaskSourceNavigation("github");
    renderPage();
    await waitFor(() => {
      expect(sourceButton("github")?.getAttribute("aria-pressed")).toBe("true");
    });
  });

  test("a Jira request before R17-B falls back to the default source and still renders", async () => {
    requestTaskSourceNavigation("jira");
    renderPage();
    await waitFor(() => {
      expect(sourceButton("github")?.getAttribute("aria-pressed")).toBe("true");
    });
    // The GitHub list content is intact — the page did not blank out.
    expect(await screen.findByText("Fix the sidebar crash")).not.toBeNull();
  });

  test("a live request while kept mounted resolves without remounting", async () => {
    renderPage();
    await waitFor(() => {
      expect(sourceButton("github")?.getAttribute("aria-pressed")).toBe("true");
    });
    // Simulate a sidebar chip click after the page is already alive
    // (App keeps it mounted, hidden, across route switches).
    act(() => {
      requestTaskSourceNavigation("jira");
    });
    await waitFor(() => {
      expect(sourceButton("github")?.getAttribute("aria-pressed")).toBe("true");
    });
    // The GitHub list content is intact — the fallback never blanks the page.
    expect(await screen.findByText("Fix the sidebar crash")).not.toBeNull();
  });
});
