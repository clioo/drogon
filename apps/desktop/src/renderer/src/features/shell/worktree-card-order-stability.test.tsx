// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Regression test for the round-2 sidebar bug: "clicking a worktree moves the
   selected one to the top and hides the one below it".

   Root cause: App fed the sidebar its `selected`-scoped session list, so a
   card for any other worktree saw zero sessions. ProjectList's default
   "Sort by: Recent" comparator (`latestWorktreeActivityAt(worktree,
   sessions)`) therefore fell back to `worktree.createdAt` for every
   non-selected card, and `WorktreeCard` rendered no nested rows for it.

   This file pins the two contracts that make the symptom impossible:
   1. card ORDER and each card's rows are a pure function of the `sessions`
      prop — flipping `selectedWorkspaceId` alone changes nothing; and
   2. the fixed App input (`sidebarSessionView`, sidebar-sessions.ts) is a
      host-wide union, so no selection can shrink it (see
      sidebar-sessions.test.ts for the projection itself). */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type {
  Project,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { ProjectList } from "./ProjectList";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { drogon?: unknown }).drogon;
});

function project(): Project {
  return {
    id: "proj-1",
    hostId: "host-1",
    path: "/repo",
    name: "repo",
    kind: "git",
    defaultBaseRef: "main",
  };
}

function worktree(overrides: Partial<Worktree>): Worktree {
  return {
    id: "wt-a",
    projectId: "proj-1",
    workspaceId: "ws-a",
    path: "/repo/wt-a",
    branch: "wt-a",
    head: "abc123",
    baseRef: null,
    createdAt: "2026-09-10T08:00:00.000Z",
    ...overrides,
  };
}

function session(overrides: Partial<Session>): Session {
  return {
    id: "s-a",
    workspaceId: "ws-a",
    hostId: "host-1",
    incarnation: "inc-a",
    command: "/bin/zsh",
    args: [],
    harnessId: "claude",
    parentSessionId: null,
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-10T08:00:00.000Z",
    ...overrides,
  };
}

/** wt-a is the freshest worktree (its session reported most recently), so
 *  "Sort by: Recent" must always list it first. */
const GROUP: ProjectGroup = {
  project: project(),
  worktrees: [
    worktree({ id: "wt-a", workspaceId: "ws-a" }),
    worktree({
      id: "wt-b",
      workspaceId: "ws-b",
      path: "/repo/wt-b",
      branch: "wt-b",
      createdAt: "2026-09-10T07:00:00.000Z",
    }),
  ],
};

const SESSION_A = session({
  id: "s-a",
  workspaceId: "ws-a",
  agentState: "idle",
  agentStateAt: "2026-09-10T12:00:00.000Z",
});
const SESSION_B = session({
  id: "s-b",
  workspaceId: "ws-b",
  incarnation: "inc-b",
  agentState: "working",
  agentStateAt: "2026-09-10T09:00:00.000Z",
});

const WORKSPACES: Workspace[] = GROUP.worktrees.map((item) => ({
  id: item.workspaceId,
  path: item.path,
  name: item.id,
  kind: "git" as const,
  hostId: GROUP.project.hostId,
}));

function list(sessions: Session[], selectedWorkspaceId: string) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return (
    <TooltipProvider>
      <ProjectList
        groups={[GROUP]}
        workspaces={WORKSPACES}
        sessions={sessions}
        selectedWorkspaceId={selectedWorkspaceId}
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
    </TooltipProvider>
  );
}

function mount(sessions: Session[], selectedWorkspaceId: string) {
  return render(list(sessions, selectedWorkspaceId));
}

function cardIds(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-worktree-card-id]"),
  ].map((card) => card.dataset.worktreeCardId ?? "");
}

function rowSessionIds(worktreeId: string): string[] {
  const card = document.querySelector<HTMLElement>(
    `[data-worktree-card-id="${worktreeId}"]`,
  );
  if (!card) return [];
  return [
    ...card.querySelectorAll<HTMLElement>("[data-worktree-agent-row]"),
  ].map((row) => row.dataset.worktreeAgentRow ?? "");
}

describe("worktree card order and sibling visibility", () => {
  test("selection only moves the highlight: order and rows stay put", () => {
    // The fixed App input: the host-wide union of every workspace's sessions.
    const hostWide = [SESSION_A, SESSION_B];
    const view = mount(hostWide, "ws-a");
    const orderBeforeSelection = cardIds();
    expect(orderBeforeSelection).toEqual(["wt-a", "wt-b"]);
    expect(rowSessionIds("wt-a")).toEqual(["s-a"]);
    expect(rowSessionIds("wt-b")).toEqual(["s-b"]);

    view.rerender(list(hostWide, "ws-b"));

    expect(cardIds()).toEqual(orderBeforeSelection);
    // The sibling below the selected card keeps its own session row.
    expect(rowSessionIds("wt-a")).toEqual(["s-a"]);
    expect(rowSessionIds("wt-b")).toEqual(["s-b"]);
    // Selection is a highlight, not a reorder: only wt-b is active.
    const active = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-worktree-card-id][data-active="true"]',
      ),
    ].map((card) => card.dataset.worktreeCardId);
    expect(active).toEqual(["wt-b"]);
  });

  test("a selection-scoped session list is what emptied the sibling (negative control)", () => {
    // The pre-fix App input: only the selected workspace's own sessions.
    const scopedToB = [SESSION_B];
    mount(scopedToB, "ws-b");
    // wt-b sorts first (its session activity beats wt-a's `createdAt`
    // fallback) and wt-a loses its row entirely — the owner's symptom,
    // reproduced through the same component, unchanged.
    expect(cardIds()).toEqual(["wt-b", "wt-a"]);
    expect(rowSessionIds("wt-a")).toEqual([]);
  });
});
