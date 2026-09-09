// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 3, coordinator review (msg_c48e2acbef42):
   ChatsList-only tests proved the section itself works, but not that
   Sidebar wires it correctly with `onNewSession` present -- the exact
   condition that used to also mount RecentSessions (now deleted), which
   rendered every quick session a second time above Projects. This suite
   mounts the real Sidebar (not App.tsx's full tree -- disproportionate to
   what's being proven, and Sidebar is the actual seam that owned the
   duplication) with onNewSession provided, and asserts: a quick session
   renders exactly once, positioned below Projects, its create action
   still reaches onNewSession, and deleting it removes it from every
   navigation surface after a simulated reload (a fresh render with the
   daemon's post-delete group list, exactly how App.tsx's own refresh
   flow re-renders after project.remove settles). */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  Project,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { Sidebar } from "./Sidebar";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import { TooltipProvider } from "../../components/ui/tooltip";

afterEach(() => {
  cleanup();
  localStorage.clear();
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

function quickSessionGroup(overrides: Partial<Project> = {}): ProjectGroup {
  const p: Project = {
    id: "proj-chat-1",
    hostId: "host-1",
    path: "/data/quick-sessions/session-1",
    name: "My Chat",
    kind: "folder",
    defaultBaseRef: null,
    quickSession: true,
    ...overrides,
  };
  const wt: Worktree = {
    id: p.id,
    projectId: p.id,
    workspaceId: `ws-${p.id}`,
    path: p.path,
    branch: "",
    head: "",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
  };
  return { project: p, worktrees: [wt] };
}

/** worktreeDisplayName (project-adapter.ts) resolves a card's title from
 *  the matching Workspace row's `name` when the worktree carries no
 *  explicit `title` -- exactly the shape App.tsx's real project.list +
 *  workspace.list combine produces. Auto-derived here so every fixture
 *  group's card reads its intended name (e.g. "My Chat") without every
 *  test having to hand-list a parallel workspaces array. */
function workspacesForGroups(groups: ProjectGroup[]): Workspace[] {
  return groups.flatMap((group) =>
    group.worktrees.map((worktree) => ({
      id: worktree.workspaceId,
      path: worktree.path,
      name: group.project.name,
      kind: group.project.kind,
      hostId: group.project.hostId,
    })),
  );
}

function sidebarProps(overrides: {
  groups: ProjectGroup[];
  workspaces?: Workspace[];
  sessions?: Session[];
  onNewSession?: () => void;
  onSubmitRemoveProject?: (project: Project) => Promise<string | null>;
}) {
  return {
    open: true,
    width: 300,
    onWidthChange: () => {},
    route: null,
    onSelectRoute: () => {},
    onOpenPalette: () => {},
    onNewSession: overrides.onNewSession,
    groups: overrides.groups,
    workspaces: overrides.workspaces ?? workspacesForGroups(overrides.groups),
    sessions: overrides.sessions ?? [],
    selectedWorkspaceId: "",
    activeSessionId: "",
    tabStrip: EMPTY_TAB_STRIP_STATE,
    onSelectSession: () => {},
    workspaceDisabled: false,
    addDisabled: false,
    onSelectWorkspace: () => {},
    onAddProject: () => {},
    onCreateWorkspace: () => {},
    worktreesAvailable: true,
    projectAction: null,
    onOpenProjectAction: () => {},
    onCloseProjectAction: () => {},
    onBrowseProject: async () => null,
    onSubmitAddProject: async () => null,
    onSubmitRemoveWorktree: async () => null,
    onSubmitRemoveProject: overrides.onSubmitRemoveProject ?? (async () => null),
    onSubmitRenameWorktree: async () => null,
    onOpenProjectSettings: () => {},
    onOpenSettings: () => {},
  };
}

function mount(overrides: {
  groups: ProjectGroup[];
  workspaces?: Workspace[];
  sessions?: Session[];
  onNewSession?: () => void;
  onSubmitRemoveProject?: (project: Project) => Promise<string | null>;
}) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <Sidebar {...sidebarProps(overrides)} />
    </TooltipProvider>,
  );
}

describe("Sidebar: Chats has exactly one home, below Projects", () => {
  test("a quick session renders exactly once (RecentSessions no longer duplicates it)", () => {
    mount({
      groups: [
        { project: project(), worktrees: [worktree()] },
        quickSessionGroup(),
      ],
      onNewSession: () => {},
    });
    // Old RecentSessions rendered its own "Recents" region above Projects;
    // it must be gone entirely, not merely stop listing quick sessions.
    expect(screen.queryByText("Recents")).toBeNull();
    expect(screen.getAllByText("My Chat")).toHaveLength(1);
  });

  test("Projects renders above the Chats section in DOM order", () => {
    mount({
      groups: [
        { project: project(), worktrees: [worktree()] },
        quickSessionGroup(),
      ],
      onNewSession: () => {},
    });
    const projectsTitle = screen.getByText("Projects");
    const chats = screen.getByTestId("sidebar-chats-section");
    // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) means the
    // Chats node comes after (below) the Projects title in tree order.
    // eslint-disable-next-line no-bitwise
    const position = projectsTitle.compareDocumentPosition(chats);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("the Chats header's create action still reaches onNewSession (RecentSessions' former trigger)", () => {
    const onNewSession = vi.fn();
    mount({ groups: [quickSessionGroup()], onNewSession });
    fireEvent.click(
      within(screen.getByTestId("sidebar-chats-section")).getByRole(
        "button",
        { name: "New chat" },
      ),
    );
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  test("Chats create action is absent (not merely disabled) when onNewSession is not provided", () => {
    mount({ groups: [quickSessionGroup()] });
    expect(
      within(screen.getByTestId("sidebar-chats-section")).queryByRole(
        "button",
        { name: "New chat" },
      ),
    ).toBeNull();
  });
});

describe("Sidebar: deleting a Chat removes it from every navigation surface after reload", () => {
  test("a re-render with the post-delete group list (App's own refresh-after-remove shape) shows the Chat nowhere", () => {
    const groupsBeforeDelete = [
      { project: project(), worktrees: [worktree()] },
      quickSessionGroup(),
    ];
    const { rerender } = render(
      <TooltipProvider>
        <Sidebar {...sidebarProps({ groups: groupsBeforeDelete, onNewSession: () => {} })} />
      </TooltipProvider>,
    );
    expect(screen.getAllByText("My Chat")).toHaveLength(1);

    // Simulates project.remove succeeding and App.tsx's refresh() re-fetching
    // project.list -- the same prop transition a real reload produces, since
    // the daemon-backed group list simply no longer contains the removed row.
    const groupsAfterDelete = [groupsBeforeDelete[0]!];
    rerender(
      <TooltipProvider>
        <Sidebar {...sidebarProps({ groups: groupsAfterDelete, onNewSession: () => {} })} />
      </TooltipProvider>,
    );

    expect(screen.queryByText("My Chat")).toBeNull();
    // The Chats section itself survives (header + create action, now with
    // an empty-state message) -- it's the row that's gone, not the section.
    expect(screen.getByTestId("sidebar-chats-section")).toBeTruthy();
    expect(screen.getByText("No chats yet")).toBeTruthy();
  });
});
