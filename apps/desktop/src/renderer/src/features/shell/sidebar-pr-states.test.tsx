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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type {
  Project,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import type { ProjectGroup } from "./project-adapter";
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
      ]),
    );
    (window as unknown as { drogon: Record<string, unknown> }).drogon = {
      tasks: { tasksList },
    };
    const groups: ProjectGroup[] = [
      {
        project: project(),
        worktrees: ["merged", "ready", "draft", "conflicts", "closed", "open"].map((kind) =>
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
