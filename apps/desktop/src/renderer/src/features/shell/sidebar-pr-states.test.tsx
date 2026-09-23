// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   F2: branch-associated reviews render their real state on the card's
   right-hand marker through the actual ProjectList -> WorktreeCard ->
   WorktreeCardPrStateIcon wiring — never pure-mapping dummy props. A
   fixture `tasks.list(mode: "pulls")` provider answers per project (the
   same bridge TasksPage uses); each test then reads the real rendered
   icons, proving fetch params, deterministic selection, honest states,
   and failure handling end to end. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type {
  Project,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import type { ProjectGroup } from "./project-adapter";
import {
  SIDEBAR_PULLS_REFRESH_MS,
  SIDEBAR_PULLS_RETRY_BASE_MS,
} from "./sidebar-pr-fetch";
import { ProjectList } from "./ProjectList";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { drogon?: unknown }).drogon;
});

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    hostId: "host-1",
    path: "/repo",
    name: "repo",
    kind: "git",
    defaultBaseRef: "main",
    ...overrides,
  };
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    projectId: "proj-1",
    workspaceId: "ws-1",
    path: "/repo/wt-1",
    branch: "feature",
    head: "abc123",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

function pull(overrides: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    number: 1,
    title: "Add the thing",
    state: "open",
    labels: [],
    assignees: [],
    isDraft: false,
    headRefName: "feature",
    updatedAt: "2026-09-09T00:00:00Z",
    url: "https://github.com/example/repo/pull/1",
    ...overrides,
  };
}

function mount(
  overrides: {
    groups?: ProjectGroup[];
    workspaces?: Workspace[];
  } = {},
) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <ProjectList
        groups={overrides.groups ?? []}
        workspaces={overrides.workspaces ?? []}
        sessions={[]}
        selectedWorkspaceId=""
        activeSessionId=""
        tabStrip={EMPTY_TAB_STRIP_STATE}
        onSelectSession={() => {}}
        disabled={false}
        addDisabled={false}
        sidebarWidth={300}
        worktreesAvailable={true}
        action={null}
        onSelectWorkspace={() => {}}
        onAddProject={() => {}}
        onCreateWorkspace={() => {}}
        onOpenAction={() => {}}
        onCloseAction={() => {}}
        onOpenProjectSettings={() => {}}
        onBrowse={async () => null}
        onSubmitAdd={async () => null}
        onSubmitRemove={async () => null}
        onSubmitRemoveProject={async () => null}
        onSubmitRename={async () => null}
      />
    </TooltipProvider>,
  );
}

function okPulls(pulls: TaskPullRequest[]) {
  return {
    ok: true as const,
    result: {
      repo: "example/repo",
      issues: [],
      pulls,
      page: 1,
      perPage: 100,
      hasNextPage: false,
    },
  };
}

function cardPrState(container: HTMLElement, worktreeId: string): string | null {
  return (
    container
      .querySelector(`[data-worktree-card-id="${worktreeId}"] [data-worktree-card-pr-state]`)
      ?.getAttribute("data-worktree-card-pr-state") ?? null
  );
}

describe("sidebar PR states: ProjectList wiring", () => {
  test("asks the provider for every state in one bounded page", async () => {
    const tasksList = vi.fn(async () => okPulls([]));
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    mount({ groups: [{ project: project(), worktrees: [worktree()] }] });
    await waitFor(() => expect(tasksList).toHaveBeenCalledTimes(1));
    expect(tasksList).toHaveBeenCalledWith({
      projectId: "proj-1",
      mode: "pulls",
      state: "all",
      perPage: 100,
    });
  });

  test("renders every real review state on its own card", async () => {
    const tasksList = vi.fn(async () =>
      okPulls([
        pull({ number: 11, title: "Landed", state: "merged", headRefName: "b-merged" }),
        pull({
          number: 12,
          title: "Confirmed",
          state: "open",
          mergeable: "MERGEABLE",
          checks: { state: "success", total: 2, passed: 2, failed: 0, pending: 0, neutral: 0 },
          headRefName: "b-ready",
        }),
        pull({ number: 13, title: "Wip", state: "draft", isDraft: true, headRefName: "b-draft" }),
        pull({ number: 14, title: "Clash", state: "open", mergeable: "CONFLICTING", headRefName: "b-conflicts" }),
        pull({ number: 15, title: "Abandoned", state: "closed", headRefName: "b-closed" }),
        pull({ number: 16, title: "Uncomputed", state: "open", mergeable: "UNKNOWN", headRefName: "b-open" }),
        pull({
          number: 17,
          title: "Checks running",
          state: "open",
          mergeable: "MERGEABLE",
          checks: { state: "pending", total: 2, passed: 1, failed: 0, pending: 1, neutral: 0 },
          headRefName: "b-pending",
        }),
      ]),
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const groups: ProjectGroup[] = [
      {
        project: project(),
        worktrees: ["merged", "ready", "draft", "conflicts", "closed", "open", "pending"].map((kind) =>
          worktree({ id: `wt-${kind}`, branch: `b-${kind}` }),
        ),
      },
    ];
    const { container } = mount({ groups });
    await waitFor(() => expect(cardPrState(container, "wt-merged")).toBe("merged"));
    expect(cardPrState(container, "wt-ready")).toBe("ready");
    expect(cardPrState(container, "wt-draft")).toBe("draft");
    expect(cardPrState(container, "wt-conflicts")).toBe("conflicts");
    expect(cardPrState(container, "wt-closed")).toBe("closed");
    // Unknown mergeability stays honestly open, never "Ready to merge".
    expect(cardPrState(container, "wt-open")).toBe("open");
    // Pending required checks are not a merge confirmation either.
    expect(cardPrState(container, "wt-pending")).toBe("open");
    expect(screen.getByLabelText("Linked PR #17 checks: Pending")).toBeTruthy();
    expect(screen.getByLabelText("Linked PR #11: Merged")).toBeTruthy();
    expect(screen.getByLabelText("Linked PR #15: Closed")).toBeTruthy();
  });

  test("a branch carrying merged history and its next review names the live review", async () => {
    const tasksList = vi.fn(async () =>
      okPulls([
        pull({ number: 641, title: "Older", state: "merged", headRefName: "collapsable-widgets" }),
        pull({
          number: 642,
          title: "Newer",
          state: "open",
          mergeable: "MERGEABLE",
          checks: { state: "success", total: 1, passed: 1, failed: 0, pending: 0, neutral: 0 },
          headRefName: "collapsable-widgets",
        }),
      ]),
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const { container } = mount({
      groups: [
        {
          project: project(),
          worktrees: [worktree({ id: "wt-both", branch: "collapsable-widgets" })],
        },
      ],
    });
    await waitFor(() => expect(cardPrState(container, "wt-both")).toBe("ready"));
    expect(screen.getByLabelText("Linked PR #642 checks: Passing")).toBeTruthy();
    expect(screen.queryByLabelText("Linked PR #641: Merged")).toBeNull();
  });

  test("a failing check rollup never claims ready (real #642 shape)", async () => {
    const tasksList = vi.fn(async () =>
      okPulls([
        pull({
          number: 642,
          title: "Sidebar follow-up",
          state: "open",
          mergeable: "MERGEABLE",
          reviewDecision: undefined,
          checks: { state: "failure", total: 5, passed: 4, failed: 1, pending: 0, neutral: 0 },
          headRefName: "collapsable-widgets",
        }),
      ]),
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const { container } = mount({
      groups: [
        {
          project: project(),
          worktrees: [worktree({ id: "wt-642", branch: "collapsable-widgets" })],
        },
      ],
    });
    await waitFor(() => expect(cardPrState(container, "wt-642")).toBe("open"));
    expect(screen.getByLabelText("Linked PR #642 checks: Failed")).toBeTruthy();
  });

  test("a failed fetch and a PR-less branch draw no marker rather than a false state", async () => {
    const tasksList = vi.fn(async ({ projectId }: { projectId: string }) => {
      if (projectId === "bad") {
        return { ok: false, error: { code: "gh_unavailable", message: "no gh", retryable: false } };
      }
      return okPulls([pull({ headRefName: "elsewhere" })]);
    });
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const { container } = mount({
      groups: [
        { project: project({ id: "good", name: "Good" }), worktrees: [worktree({ id: "wt-none", projectId: "good", branch: "lonely" })] },
        { project: project({ id: "bad", name: "Bad" }), worktrees: [worktree({ id: "wt-bad", projectId: "bad", branch: "feature" })] },
      ],
    });
    await waitFor(() => expect(tasksList).toHaveBeenCalledTimes(2));
    // Let both generations settle before asserting absence.
    await waitFor(() => expect(cardPrState(container, "wt-none")).toBeNull());
    expect(cardPrState(container, "wt-bad")).toBeNull();
    expect(container.querySelector("[data-worktree-card-pr-state]")).toBeNull();
  });

  test("a failed project retries once the visible project set changes", async () => {
    const tasksList = vi.fn(async (_input: { projectId: string }) => ({
      ok: false as const,
      error: { code: "gh_unavailable", message: "no gh", retryable: false },
    }));
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const first: ProjectGroup[] = [
      { project: project({ id: "a", name: "A" }), worktrees: [worktree({ id: "wa", projectId: "a" })] },
    ];
    const { rerender } = mount({ groups: first });
    await waitFor(() => expect(tasksList).toHaveBeenCalledTimes(1));
    // Same set re-rendered: no retry, no per-render polling.
    rerender(
      <TooltipProvider>
        <ProjectList
          groups={first}
          workspaces={[]}
          sessions={[]}
          selectedWorkspaceId=""
          activeSessionId=""
          tabStrip={EMPTY_TAB_STRIP_STATE}
          onSelectSession={() => {}}
          disabled={false}
          addDisabled={false}
          sidebarWidth={300}
          worktreesAvailable={true}
          action={null}
          onSelectWorkspace={() => {}}
          onAddProject={() => {}}
          onCreateWorkspace={() => {}}
          onOpenAction={() => {}}
          onCloseAction={() => {}}
          onOpenProjectSettings={() => {}}
          onBrowse={async () => null}
          onSubmitAdd={async () => null}
          onSubmitRemove={async () => null}
          onSubmitRemoveProject={async () => null}
          onSubmitRename={async () => null}
        />
      </TooltipProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tasksList).toHaveBeenCalledTimes(1);
    // A new project joins the set: the newcomer is fetched and the old
    // failure gets exactly one retry.
    const second: ProjectGroup[] = [
      ...first,
      { project: project({ id: "b", name: "B" }), worktrees: [worktree({ id: "wb", projectId: "b" })] },
    ];
    rerender(
      <TooltipProvider>
        <ProjectList
          groups={second}
          workspaces={[]}
          sessions={[]}
          selectedWorkspaceId=""
          activeSessionId=""
          tabStrip={EMPTY_TAB_STRIP_STATE}
          onSelectSession={() => {}}
          disabled={false}
          addDisabled={false}
          sidebarWidth={300}
          worktreesAvailable={true}
          action={null}
          onSelectWorkspace={() => {}}
          onAddProject={() => {}}
          onCreateWorkspace={() => {}}
          onOpenAction={() => {}}
          onCloseAction={() => {}}
          onOpenProjectSettings={() => {}}
          onBrowse={async () => null}
          onSubmitAdd={async () => null}
          onSubmitRemove={async () => null}
          onSubmitRemoveProject={async () => null}
          onSubmitRename={async () => null}
        />
      </TooltipProvider>,
    );
    await waitFor(() => expect(tasksList).toHaveBeenCalledTimes(3));
    const ids = tasksList.mock.calls.map((call) => (call[0] as { projectId: string }).projectId).sort();
    expect(ids).toEqual(["a", "a", "b"]);
  });

  test("a review past the first window is found through the bounded page walk", async () => {
    const page1 = {
      ok: true as const,
      result: {
        repo: "example/repo",
        issues: [],
        pulls: [pull({ number: 10, title: "Early", state: "open", headRefName: "early" })],
        page: 1,
        perPage: 100,
        hasNextPage: true,
      },
    };
    const page2 = {
      ok: true as const,
      result: {
        repo: "example/repo",
        issues: [],
        pulls: [pull({ number: 9, title: "Late", state: "merged", headRefName: "late-branch" })],
        page: 2,
        perPage: 100,
        hasNextPage: false,
      },
    };
    const tasksList = vi.fn(async (input: { projectId: string; page?: number }) =>
      (input.page ?? 1) === 1 ? page1 : page2,
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const { container } = mount({
      groups: [
        {
          project: project(),
          worktrees: [
            worktree({ id: "wt-early", branch: "early" }),
            // Explicitly no stored link: the walk itself must find this one.
            worktree({ id: "wt-late", branch: "late-branch", linkedPr: null }),
          ],
        },
      ],
    });
    await waitFor(() => expect(cardPrState(container, "wt-late")).toBe("merged"));
    expect(cardPrState(container, "wt-early")).toBe("open");
    // Page 1 keeps its call shape (no page param); the walk names page 2.
    expect(tasksList).toHaveBeenCalledWith({
      projectId: "proj-1",
      mode: "pulls",
      state: "all",
      perPage: 100,
    });
    expect(tasksList).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", page: 2 }),
    );
    expect(tasksList).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Linked PR #9: Merged")).toBeTruthy();
  });

  test("the same stored number in two projects looks up both reviews", async () => {
    // The listing names an unrelated review: neither stored link is listed,
    // so both need their targeted lookup.
    const tasksList = vi.fn(async () => okPulls([pull({ number: 2, headRefName: "elsewhere" })]));
    const tasksShow = vi.fn(
      async ({ projectId, number }: { projectId: string; number: number }) => ({
        ok: true as const,
        result: {
          pull: pull({
            number,
            title: `Review in ${projectId}`,
            state: "open",
            headRefName: "renamed",
          }),
        },
      }),
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList, tasksShow },
    };
    mount({
      groups: [
        {
          project: project({ id: "repo-a", name: "Repo A" }),
          worktrees: [worktree({ id: "wa", projectId: "repo-a", branch: "feature", linkedPr: 1 })],
        },
        {
          project: project({ id: "repo-b", name: "Repo B" }),
          worktrees: [worktree({ id: "wb", projectId: "repo-b", branch: "feature", linkedPr: 1 })],
        },
      ],
    });
    // A global number dedupe would stop at one; per-project attempts fetch both.
    await waitFor(() => expect(tasksShow).toHaveBeenCalledTimes(2));
    expect(tasksShow).toHaveBeenCalledWith({ projectId: "repo-a", number: 1, mode: "pulls" });
    expect(tasksShow).toHaveBeenCalledWith({ projectId: "repo-b", number: 1, mode: "pulls" });
  });

  test("a newly added worktree's stored link triggers its lookup on a stable set", async () => {
    const tasksList = vi.fn(async () => okPulls([pull({ number: 2, headRefName: "elsewhere" })]));
    const tasksShow = vi.fn(async () => ({
      ok: true as const,
      result: {
        pull: pull({ number: 7, title: "Added", state: "open", headRefName: "renamed" }),
      },
    }));
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList, tasksShow },
    };
    const groups: ProjectGroup[] = [
      { project: project(), worktrees: [worktree({ id: "wt-old", branch: "feature" })] },
    ];
    const { container, rerender } = mount({ groups });
    await waitFor(() => expect(tasksList).toHaveBeenCalledTimes(1));
    expect(tasksShow).not.toHaveBeenCalled();
    // The project set is stable; only a worktree joins, carrying a stored
    // link the listing misses — it gets its one targeted lookup.
    rerender(
      <TooltipProvider>
        <ProjectList
          groups={[
            {
              project: project(),
              worktrees: [
                worktree({ id: "wt-old", branch: "feature" }),
                worktree({ id: "wt-new", branch: "fresh", linkedPr: 7 }),
              ],
            },
          ]}
          workspaces={[]}
          sessions={[]}
          selectedWorkspaceId=""
          activeSessionId=""
          tabStrip={EMPTY_TAB_STRIP_STATE}
          onSelectSession={() => {}}
          disabled={false}
          addDisabled={false}
          sidebarWidth={300}
          worktreesAvailable={true}
          action={null}
          onSelectWorkspace={() => {}}
          onAddProject={() => {}}
          onCreateWorkspace={() => {}}
          onOpenAction={() => {}}
          onCloseAction={() => {}}
          onOpenProjectSettings={() => {}}
          onBrowse={async () => null}
          onSubmitAdd={async () => null}
          onSubmitRemove={async () => null}
          onSubmitRemoveProject={async () => null}
          onSubmitRename={async () => null}
        />
      </TooltipProvider>,
    );
    await waitFor(() =>
      expect(tasksShow).toHaveBeenCalledWith({ projectId: "proj-1", number: 7, mode: "pulls" }),
    );
    await waitFor(() => expect(cardPrState(container, "wt-new")).toBe("open"));
    expect(tasksShow).toHaveBeenCalledTimes(1);
  });

  test("a stable project set revalidates: open becomes merged without any set change", async () => {
    vi.useFakeTimers();
    try {
      let truth: TaskPullRequest[] = [
        pull({ number: 5, title: "Live", state: "open", headRefName: "feature" }),
      ];
      const tasksList = vi.fn(async () => okPulls(truth));
      (window as unknown as { drogon: Record<string, unknown> }).drogon = {
        tasks: { tasksList },
      };
      const { container } = mount({
        groups: [{ project: project(), worktrees: [worktree({ id: "wt-1" })] }],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(cardPrState(container, "wt-1")).toBe("open");
      expect(tasksList).toHaveBeenCalledTimes(1);
      // The review merges while the sidebar stays open; the scheduled
      // revalidation picks it up on the unchanged project set.
      truth = [pull({ number: 5, title: "Live", state: "merged", headRefName: "feature" })];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SIDEBAR_PULLS_REFRESH_MS + 1_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(tasksList).toHaveBeenCalledTimes(2);
      expect(cardPrState(container, "wt-1")).toBe("merged");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a failed refresh keeps markers but lapses ready, then recovers", async () => {
    vi.useFakeTimers();
    try {
      const readyPull = pull({
        number: 6,
        title: "Ready",
        state: "open",
        mergeable: "MERGEABLE",
        checks: { state: "success", total: 1, passed: 1, failed: 0, pending: 0, neutral: 0 },
        headRefName: "feature",
      });
      let fail = false;
      const tasksList = vi.fn(async () =>
        fail
          ? { ok: false as const, error: { code: "gh_unavailable", message: "no gh", retryable: true } }
          : okPulls([readyPull]),
      );
      (window as unknown as { drogon: Record<string, unknown> }).drogon = {
        tasks: { tasksList },
      };
      const { container } = mount({
        groups: [{ project: project(), worktrees: [worktree({ id: "wt-1" })] }],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(cardPrState(container, "wt-1")).toBe("ready");
      // The refresh fails: markers stay (facts don't expire) but the
      // ready-claim lapses until the next success.
      fail = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SIDEBAR_PULLS_REFRESH_MS + 1_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(tasksList).toHaveBeenCalledTimes(2);
      expect(cardPrState(container, "wt-1")).toBe("open");
      // Recovery rides the failure backoff on the same stable set.
      fail = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000 + 1_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(tasksList).toHaveBeenCalledTimes(3);
      expect(cardPrState(container, "wt-1")).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a page-1 concluded review does not hide a page-2 live review for the same branch", async () => {
    // The walk defect: page 1 names a newer CLOSED review for branch X and
    // the walk stops, so the older OPEN review for X on page 2 is never
    // discovered and live-first selection is defeated. Against the actual
    // ProjectList (not a helper): the card must name the live review.
    const page1 = {
      ok: true as const,
      result: {
        repo: "example/repo",
        issues: [],
        pulls: [pull({ number: 10, title: "Closed newer", state: "closed", headRefName: "x" })],
        page: 1,
        perPage: 100,
        hasNextPage: true,
      },
    };
    const page2 = {
      ok: true as const,
      result: {
        repo: "example/repo",
        issues: [],
        pulls: [pull({ number: 9, title: "Open older", state: "open", headRefName: "x" })],
        page: 2,
        perPage: 100,
        hasNextPage: false,
      },
    };
    const tasksList = vi.fn(async (input: { projectId: string; page?: number }) =>
      (input.page ?? 1) === 1 ? page1 : page2,
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const { container } = mount({
      groups: [
        {
          project: project(),
          worktrees: [worktree({ id: "wt-x", branch: "x" })],
        },
      ],
    });
    await waitFor(() => expect(cardPrState(container, "wt-x")).toBe("open"));
    expect(screen.getByLabelText("Linked PR #9: Open")).toBeTruthy();
    expect(tasksList).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", page: 2 }),
    );
    expect(tasksList).toHaveBeenCalledTimes(2);
  });

  test("a thrown page-2 failure keeps the page-1 marker, lapses ready, then recovers on retry", async () => {
    vi.useFakeTimers();
    try {
      const readyPull = pull({
        number: 6,
        title: "Ready",
        state: "open",
        mergeable: "MERGEABLE",
        checks: { state: "success", total: 1, passed: 1, failed: 0, pending: 0, neutral: 0 },
        headRefName: "feature",
      });
      const page1 = {
        ok: true as const,
        result: {
          repo: "example/repo",
          issues: [],
          pulls: [readyPull],
          page: 1,
          perPage: 100,
          hasNextPage: true,
        },
      };
      let failPage2 = true;
      const page2ok = {
        ok: true as const,
        result: {
          repo: "example/repo",
          issues: [],
          pulls: [pull({ number: 1, title: "Elsewhere", state: "open", headRefName: "elsewhere" })],
          page: 2,
          perPage: 100,
          hasNextPage: false,
        },
      };
      const tasksList = vi.fn(async (input: { projectId: string; page?: number }) => {
        if ((input.page ?? 1) === 1) return page1;
        if (failPage2) throw new Error("gh exploded mid-walk");
        return page2ok;
      });
      (window as unknown as { drogon: Record<string, unknown> }).drogon = {
        tasks: { tasksList },
      };
      const { container } = mount({
        groups: [
          {
            project: project(),
            worktrees: [
              worktree({ id: "wt-1", branch: "feature" }),
              // Lives only past the failed window: no marker, never a success claim.
              worktree({ id: "wt-late", branch: "late-branch" }),
            ],
          },
        ],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(tasksList).toHaveBeenCalledTimes(2);
      // Page-1 facts stay visible behind the failure, but the ready-claim
      // lapses: no Ready claim from incomplete knowledge.
      expect(screen.getByLabelText("Linked PR #6 checks: Passing")).toBeTruthy();
      expect(cardPrState(container, "wt-1")).toBe("open");
      // The later branch has no marker at all — explicitly unavailable, not empty-success.
      expect(cardPrState(container, "wt-late")).toBeNull();
      // The failure streak schedules a bounded retry on the stable set.
      failPage2 = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SIDEBAR_PULLS_RETRY_BASE_MS + 1_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      // Retry re-walks from page 1 through page 2 (the late branch still
      // holds the walk open) and confirms the ready-claim again.
      expect(tasksList).toHaveBeenCalledTimes(4);
      expect(cardPrState(container, "wt-1")).toBe("ready");
      expect(cardPrState(container, "wt-late")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a typed page-2 failure keeps the page-1 marker and never fetches after unmount", async () => {
    vi.useFakeTimers();
    try {
      const page1 = {
        ok: true as const,
        result: {
          repo: "example/repo",
          issues: [],
          pulls: [pull({ number: 5, title: "Live", state: "open", headRefName: "feature" })],
          page: 1,
          perPage: 100,
          hasNextPage: true,
        },
      };
      const page2 = {
        ok: false as const,
        error: { code: "gh_unavailable", message: "no gh", retryable: true },
      };
      const tasksList = vi.fn(async (input: { projectId: string; page?: number }) =>
        (input.page ?? 1) === 1 ? page1 : page2,
      );
      (window as unknown as { drogon: Record<string, unknown> }).drogon = {
        tasks: { tasksList },
      };
      const { container, unmount } = mount({
        groups: [
          {
            project: project(),
            worktrees: [
              worktree({ id: "wt-1", branch: "feature" }),
              // Unmatched on page 1, so the walk must attempt page 2.
              worktree({ id: "wt-late", branch: "late-branch" }),
            ],
          },
        ],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(tasksList).toHaveBeenCalledTimes(2);
      // The successfully fetched page survives the typed failure (the old
      // code blanked it to null); the marker is honestly unconfirmed.
      expect(screen.getByLabelText("Linked PR #5: Open")).toBeTruthy();
      expect(cardPrState(container, "wt-1")).toBe("open");
      // Unmount drops the scheduled retry: no fetch after teardown.
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SIDEBAR_PULLS_RETRY_BASE_MS + 60_000);
      });
      expect(tasksList).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a linked review the branch misses shows on the card AND in its PR-status group", async () => {
    // The reported contradiction, end to end: branch "feature" matches
    // nothing while stored link #7 names a merged review. Group-by PR
    // status must bucket the worktree under Merged — never No pull request.
    localStorage.setItem(
      "drogon:shell:workspace-options",
      JSON.stringify({ groupBy: "pr-status" }),
    );
    const tasksList = vi.fn(async () =>
      okPulls([pull({ number: 7, title: "Renamed", state: "merged", headRefName: "renamed" })]),
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const { container } = mount({
      groups: [
        {
          project: project(),
          worktrees: [worktree({ id: "wt-linked", branch: "feature", linkedPr: 7 })],
        },
      ],
    });
    await waitFor(() => expect(screen.getByLabelText("Linked PR #7: Merged")).toBeTruthy());
    // The group key lives on the header row; the card is its section sibling.
    const mergedSection = container
      .querySelector('[data-entry-group-key="merged"]')
      ?.closest(".shell-project");
    expect(mergedSection?.textContent).toContain("Merged");
    expect(
      mergedSection?.querySelector('[data-worktree-card-id="wt-linked"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-entry-group-key="none"]')).toBeNull();
  });

  test("a stored linkedPr falls back to one targeted show lookup", async () => {
    const tasksList = vi.fn(async () => okPulls([pull({ headRefName: "elsewhere" })]));
    const tasksShow = vi.fn(async () => ({
      ok: true as const,
      result: {
        pull: pull({ number: 99, title: "Retargeted", state: "open", mergeable: "MERGEABLE", headRefName: "renamed" }),
      },
    }));
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList, tasksShow },
    };
    const { container } = mount({
      groups: [
        {
          project: project(),
          worktrees: [worktree({ id: "wt-linked", branch: "feature", linkedPr: 99 })],
        },
      ],
    });
    await waitFor(() => expect(tasksShow).toHaveBeenCalledWith({
      projectId: "proj-1",
      number: 99,
      mode: "pulls",
    }));
    await waitFor(() => expect(cardPrState(container, "wt-linked")).toBe("ready"));
    expect(screen.getByLabelText("Linked PR #99: Open")).toBeTruthy();
    expect(tasksShow).toHaveBeenCalledTimes(1);
  });
});
