import { expect, test } from "vitest";
import type { Session, Workspace } from "../../../../shared/session-contract";
import {
  filterProjectGroups,
  groupProjectWorktrees,
  isProjectsAvailable,
  isWorktreesAvailable,
  loadProjectView,
  projectWorkspacesAsFolderProjects,
  relativeActivityTime,
  summarizeCardSessions,
  worktreeDisplayName,
} from "./project-adapter";

const workspace: Workspace = {
  id: "w1",
  path: "/repo/a",
  name: "a",
  kind: "folder",
  hostId: "h",
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    workspaceId: "w1",
    hostId: "h",
    incarnation: "i1",
    command: "sh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

test("capability gates require the advertised ids", () => {
  expect(isProjectsAvailable([])).toBe(false);
  expect(isProjectsAvailable(["project.v1"])).toBe(true);
  expect(isWorktreesAvailable(["worktree.v1"])).toBe(true);
  expect(isWorktreesAvailable(["project.v1"])).toBe(false);
});

test("workspace fallback projects one folder project with one implicit worktree", () => {
  const groups = projectWorkspacesAsFolderProjects([workspace]);
  expect(groups).toHaveLength(1);
  expect(groups[0].project.kind).toBe("folder");
  expect(groups[0].project.path).toBe("/repo/a");
  expect(groups[0].worktrees).toHaveLength(1);
  // Selecting the card selects the workspace it was projected from.
  expect(groups[0].worktrees[0].workspaceId).toBe("w1");
  expect(groups[0].worktrees[0].branch).toBe("");
});

test("loader falls back while the daemon withholds the capabilities", async () => {
  const view = await loadProjectView({}, [], [workspace]);
  expect(view.source).toBe("workspace-fallback");
  expect(view.groups).toHaveLength(1);
  expect(view.groups[0].worktrees[0].workspaceId).toBe("w1");
});

test("loader falls back when capabilities are advertised but RPCs are absent", async () => {
  const view = await loadProjectView(
    {},
    ["project.v1", "worktree.v1"],
    [workspace],
  );
  expect(view.source).toBe("workspace-fallback");
});

test("loader uses real projects when capability and RPCs are present", async () => {
  const view = await loadProjectView(
    {
      projectList: async () => ({
        ok: true,
        result: {
          projects: [
            {
              id: "p1",
              hostId: "h",
              path: "/repo",
              name: "repo",
              kind: "git",
              defaultBaseRef: "main",
            },
          ],
        },
      }),
      worktreeList: async () => ({
        ok: true,
        result: {
          worktrees: [
            {
              id: "t1",
              projectId: "p1",
              workspaceId: "w9",
              path: "/repo-wt",
              branch: "feat",
              head: "abc",
              baseRef: "main",
              createdAt: "2026-09-06T00:00:00Z",
            },
          ],
        },
      }),
    },
    ["project.v1", "worktree.v1"],
    [workspace],
  );
  expect(view.source).toBe("rpc");
  expect(view.groups).toHaveLength(1);
  expect(view.groups[0].worktrees[0].branch).toBe("feat");
});

test("loader falls back when an advertised RPC fails", async () => {
  const view = await loadProjectView(
    {
      projectList: async () => ({
        ok: false,
        error: { code: "boom", message: "down", retryable: true },
      }),
      worktreeList: async () => ({
        ok: true,
        result: { worktrees: [] },
      }),
    },
    ["project.v1", "worktree.v1"],
    [workspace],
  );
  expect(view.source).toBe("workspace-fallback");
  expect(view.groups).toHaveLength(1);
});

test("orphan worktrees never render without their project", () => {
  const groups = groupProjectWorktrees([], [
    {
      id: "t1",
      projectId: "missing",
      workspaceId: "w1",
      path: "/x",
      branch: "b",
      head: "",
      baseRef: null,
      createdAt: "",
    },
  ]);
  expect(groups).toEqual([]);
});

test("card display name prefers the workspace name, then branch", () => {
  const tree = projectWorkspacesAsFolderProjects([workspace])[0].worktrees[0];
  expect(worktreeDisplayName(tree, [workspace])).toBe("a");
  expect(worktreeDisplayName({ ...tree, workspaceId: "gone" }, [])).toBe(
    tree.id.slice(0, 8),
  );
});

test("relative time renders short stamps and hides the unknown", () => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  expect(relativeActivityTime(null, now)).toBe("");
  expect(relativeActivityTime("not-a-date", now)).toBe("");
  expect(
    relativeActivityTime("2026-09-07T11:59:30Z", now),
  ).toBe("just now");
  expect(relativeActivityTime("2026-09-07T11:55:00Z", now)).toBe("5m ago");
  expect(relativeActivityTime("2026-09-07T10:00:00Z", now)).toBe("2h ago");
  expect(relativeActivityTime("2026-09-04T12:00:00Z", now)).toBe("3d ago");
});

test("filter narrows cards by branch and keeps empty groups out", () => {
  const groups = projectWorkspacesAsFolderProjects([
    workspace,
    { ...workspace, id: "w2", name: "beta", path: "/repo/beta" },
  ]);
  expect(filterProjectGroups(groups, [], "")).toHaveLength(2);
  const narrowed = filterProjectGroups(groups, [], "beta");
  expect(narrowed).toHaveLength(1);
  expect(narrowed[0].project.name).toBe("beta");
  expect(filterProjectGroups(groups, [], "zzz")).toEqual([]);
});

test("card summary never invents a state and flags needs_input as unread", () => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  expect(summarizeCardSessions([], now)).toEqual({
    state: "unknown",
    unread: false,
    activeRelative: "",
  });
  expect(
    summarizeCardSessions([session({ agentState: undefined })], now).state,
  ).toBe("unknown");
  const summary = summarizeCardSessions(
    [
      session({
        id: "idle-one",
        agentState: "idle",
        agentStateAt: "2026-09-07T11:00:00Z",
      }),
      session({
        id: "needs-one",
        agentState: "needs_input",
        agentStateAt: "2026-09-07T11:30:00Z",
      }),
    ],
    now,
  );
  expect(summary.state).toBe("needs_input");
  expect(summary.unread).toBe(true);
  expect(summary.activeRelative).toBe("30m ago");
});
