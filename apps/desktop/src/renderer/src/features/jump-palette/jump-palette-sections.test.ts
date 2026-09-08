import { describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import {
  buildJumpBrowserTabs,
  buildJumpQuickActions,
  buildJumpTabs,
  buildJumpWorktrees,
  projectJumpSections,
  rollupAgentState,
} from "./jump-palette-sections";

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    workspaceId: "ws-1",
    hostId: "host",
    incarnation: "inc",
    command: "claude",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function groups(): ProjectGroup[] {
  return [
    {
      project: {
        id: "p-beta",
        hostId: "host",
        path: "/repos/beta",
        name: "beta",
        kind: "git",
        defaultBaseRef: null,
      },
      worktrees: [
        {
          id: "w-beta-main",
          projectId: "p-beta",
          workspaceId: "ws-beta",
          path: "/repos/beta",
          branch: "main",
          head: "abc",
          baseRef: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      project: {
        id: "p-alpha",
        hostId: "host",
        path: "/repos/alpha",
        name: "alpha",
        kind: "git",
        defaultBaseRef: null,
      },
      worktrees: [
        {
          id: "w-alpha-feat",
          projectId: "p-alpha",
          workspaceId: "ws-alpha",
          path: "/repos/alpha-feat",
          branch: "feat",
          head: "def",
          baseRef: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
  ];
}

describe("rollupAgentState", () => {
  test("working wins over waiting and idle", () => {
    expect(rollupAgentState(["idle", "needs_input", "working"])).toBe("working");
    expect(rollupAgentState(["idle", "needs_input"])).toBe("needs_input");
    expect(rollupAgentState([])).toBeNull();
    expect(rollupAgentState(["exited"])).toBe("exited");
  });
});

describe("buildJumpWorktrees", () => {
  test("groups rows by project and rolls up agent state", () => {
    const sessions = [
      session({ id: "s-1", workspaceId: "ws-beta", agentState: "working" }),
      session({ id: "s-2", workspaceId: "ws-beta", agentState: "idle" }),
    ];
    const rows = buildJumpWorktrees(groups(), sessions, "ws-alpha");
    // Grouped by project name: alpha first despite input order.
    expect(rows.map((row) => row.projectName)).toEqual(["alpha", "beta"]);
    const beta = rows.find((row) => row.projectName === "beta");
    expect(beta?.agentState).toBe("working");
    expect(beta?.sessionCount).toBe(2);
    expect(beta?.isCurrent).toBe(false);
    const alpha = rows.find((row) => row.projectName === "alpha");
    expect(alpha?.agentState).toBeNull();
    expect(alpha?.isCurrent).toBe(true);
    expect(alpha?.name).toBe("feat");
  });
});

describe("projectJumpSections", () => {
  test("empty query orders recent tabs, worktrees, browser tabs, actions", () => {
    const tabs = buildJumpTabs(
      [session({ id: "s-1" }), session({ id: "s-2", command: "pi" })],
      "s-2",
    );
    const worktrees = buildJumpWorktrees(groups(), [], "ws-1");
    const browserTabs = buildJumpBrowserTabs(
      [
        {
          tabId: "b-1",
          workspaceId: "ws-1",
          url: "https://example.com",
          title: "Example",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          error: null,
        },
      ],
      null,
    );
    const quickActions = buildJumpQuickActions({
      canCreateWorktree: true,
      canNewTerminal: true,
      canNewBrowserTab: true,
      canAddProject: true,
    });
    const { sections, createWorktreeName } = projectJumpSections({
      tabs,
      worktrees,
      browserTabs,
      quickActions,
      query: "",
      canCreateWorktree: true,
    });
    expect(sections.map((section) => section.id)).toEqual([
      "recent-tabs",
      "worktrees",
      "open-tabs",
      "quick-actions",
    ]);
    expect(sections[0].label).toBe("Recent Chats & Terminals");
    // Active tab leads the recent section.
    expect(sections[0].items[0]).toMatchObject({ kind: "tab" });
    const firstTab = sections[0].items[0];
    expect(firstTab.kind === "tab" && firstTab.tab.id).toBe("s-2");
    expect(sections[1].label).toBe("Recent Worktrees");
    expect(sections[3].label).toBe("Actions & Settings");
    expect(createWorktreeName).toBeNull();
  });

  test("empty query caps recent tabs at six", () => {
    const tabs = buildJumpTabs(
      Array.from({ length: 8 }, (_, index) =>
        session({ id: `s-${index}`, command: `cmd-${index}` }),
      ),
      "s-0",
    );
    const { sections } = projectJumpSections({
      tabs,
      worktrees: [],
      browserTabs: [],
      quickActions: [],
      query: "",
      canCreateWorktree: false,
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].items).toHaveLength(6);
  });

  test("typed query filters every section and offers create-worktree", () => {
    const tabs = buildJumpTabs([session({ id: "s-1", command: "claude" })], "s-1");
    const worktrees = buildJumpWorktrees(groups(), [], "ws-1");
    const browserTabs = buildJumpBrowserTabs([], null);
    const quickActions = buildJumpQuickActions({
      canCreateWorktree: true,
      canNewTerminal: true,
      canNewBrowserTab: true,
      canAddProject: true,
    });
    const { sections, createWorktreeName } = projectJumpSections({
      tabs,
      worktrees,
      browserTabs,
      quickActions,
      query: "alp",
      canCreateWorktree: true,
    });
    const worktreeSection = sections.find((section) => section.id === "worktrees");
    expect(worktreeSection?.items).toHaveLength(1);
    expect(sections.find((section) => section.id === "recent-tabs")).toBeUndefined();
    expect(createWorktreeName).toBe("alp");
  });

  test("exact worktree name suppresses the create row", () => {
    const worktrees = buildJumpWorktrees(groups(), [], "ws-1");
    const { createWorktreeName } = projectJumpSections({
      tabs: [],
      worktrees,
      browserTabs: [],
      quickActions: [],
      query: "feat",
      canCreateWorktree: true,
    });
    expect(createWorktreeName).toBeNull();
  });

  test("unavailable actions are omitted", () => {
    const quickActions = buildJumpQuickActions({
      canCreateWorktree: false,
      canNewTerminal: false,
      canNewBrowserTab: false,
      canAddProject: false,
    });
    expect(quickActions.map((action) => action.id)).toEqual(["settings.open"]);
  });
});
