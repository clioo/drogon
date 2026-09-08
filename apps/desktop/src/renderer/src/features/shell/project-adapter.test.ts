import { expect, test } from "vitest";
import type { Session, Workspace } from "../../../../shared/session-contract";
import {
  createRegistryRevisionHandler,
  filterProjectGroups,
  findWorkspaceForPath,
  gitProjectForWorkspace,
  groupProjectWorktrees,
  isProjectsAvailable,
  isWorktreesAvailable,
  loadProjectView,
  projectWorkspacesAsFolderProjects,
  relativeActivityTime,
  reloadWorkspacesSnapshot,
  subscribeProjectRegistryRefresh,
  summarizeCardSessions,
  windowProjectBridge,
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

test("registry refresh stays inert without the push channel (older preload)", () => {
  let calls = 0;
  const stop = subscribeProjectRegistryRefresh({}, () => {
    calls += 1;
  });
  expect(stop).toBeNull();
  expect(calls).toBe(0);
});

test("registry refresh forwards each pushed revision and unsubscribes (issue #146)", () => {
  const seen: string[] = [];
  let live = true;
  const stop = subscribeProjectRegistryRefresh(
    {
      onProjectsChanged: (listener) => {
        listener("rev-1");
        listener("rev-2");
        return () => {
          live = false;
        };
      },
    },
    (revision) => {
      seen.push(revision);
    },
  );
  expect(typeof stop).toBe("function");
  // The push arrives synchronously through the bridge: the refresh path
  // the App hook drives (bump the reload tick, re-read project.list) sees
  // every revision main observed.
  expect(seen).toEqual(["rev-1", "rev-2"]);
  stop!();
  expect(live).toBe(false);
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

test("loader fans worktree.list out once per project id", async () => {
  const seen: string[] = [];
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
            {
              id: "p2",
              hostId: "h",
              path: "/docs",
              name: "docs",
              kind: "folder",
              defaultBaseRef: null,
            },
          ],
        },
      }),
      worktreeList: async (input: { projectId: string }) => {
        seen.push(input.projectId);
        return {
          ok: true,
          result: {
            worktrees:
              input.projectId === "p1"
                ? [
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
                  ]
                : [],
          },
        };
      },
    },
    ["project.v1", "worktree.v1"],
    [workspace],
  );
  expect(view.source).toBe("rpc");
  expect(seen.sort()).toEqual(["p1", "p2"]);
  expect(view.groups).toHaveLength(2);
  expect(view.groups[0].worktrees[0].branch).toBe("feat");
});

test("loader falls back when one project's worktree.list fails", async () => {
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
        ok: false,
        error: { code: "boom", message: "down", retryable: true },
      }),
    },
    ["project.v1", "worktree.v1"],
    [workspace],
  );
  expect(view.source).toBe("workspace-fallback");
});

test("windowProjectBridge reads the live project namespace, absent means {}", () => {
  const bridge = { projectList: async () => null };
  expect(windowProjectBridge({ project: bridge })).toBe(bridge);
  expect(windowProjectBridge({})).toEqual({});
  expect(windowProjectBridge(null)).toEqual({});
});

test("findWorkspaceForPath matches the daemon-canonical path slash-insensitively", () => {
  expect(findWorkspaceForPath([workspace], "/repo/a")).toEqual(workspace);
  expect(findWorkspaceForPath([workspace], "/repo/a/")).toEqual(workspace);
  expect(findWorkspaceForPath([workspace], "/other")).toBeNull();
  expect(findWorkspaceForPath([], "/repo/a")).toBeNull();
});

test("gitProjectForWorkspace targets git owners only", () => {
  const groups = [
    ...projectWorkspacesAsFolderProjects([workspace]),
    {
      project: {
        id: "p1",
        hostId: "h",
        path: "/repo",
        name: "repo",
        kind: "git" as const,
        defaultBaseRef: "main",
      },
      worktrees: [
        {
          id: "t1",
          projectId: "p1",
          workspaceId: "w9",
          path: "/repo-wt",
          branch: "feat",
          head: "abc",
          baseRef: "main",
          createdAt: "",
        },
      ],
    },
  ];
  expect(gitProjectForWorkspace(groups, "w1")).toBeNull();
  expect(gitProjectForWorkspace(groups, "w9")?.id).toBe("p1");
  expect(gitProjectForWorkspace(groups, "gone")).toBeNull();
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

test("registry revision fans out to projects and workspaces exactly once per change (issue #218)", () => {
  let bumps = 0;
  const revisions: string[] = [];
  const handle = createRegistryRevisionHandler({
    bumpProjects: () => {
      bumps += 1;
    },
    refreshWorkspaces: (revision) => {
      revisions.push(revision);
    },
  });
  handle("rev-1");
  handle("rev-2");
  expect(bumps).toBe(2);
  expect(revisions).toEqual(["rev-1", "rev-2"]);
});

test("CLI-created worktree arriving via the digest refreshes workspaces exactly once per change (issue #218)", async () => {
  // Simulates `drogon-cli worktree create --name qa2` landing in another
  // process: main's project.changes poller observes one new revision per
  // change and pushes it over drogon:projectsChanged. Each push must
  // re-read workspaces() exactly once, so the session area (not just the
  // sidebar) sees the new worktree with no restart.
  const cliWorktree: Workspace = {
    id: "w-qa2",
    path: "/repo/qa2",
    name: "qa2",
    kind: "git",
    hostId: "h",
  };
  const snapshots: Workspace[][] = [[workspace], [workspace, cliWorktree]];
  let loads = 0;
  const load = async () => {
    const index = Math.min(loads, snapshots.length - 1);
    loads += 1;
    return { ok: true as const, result: { workspaces: snapshots[index]! } };
  };
  const delivered: Workspace[][] = [];
  const pending: Promise<unknown>[] = [];
  let bumps = 0;
  let emit!: (revision: string) => void;
  const stop = subscribeProjectRegistryRefresh(
    {
      onProjectsChanged: (listener) => {
        emit = listener;
        return () => {};
      },
    },
    createRegistryRevisionHandler({
      bumpProjects: () => {
        bumps += 1;
      },
      refreshWorkspaces: () => {
        pending.push(
          reloadWorkspacesSnapshot(load).then((next) => {
            if (next) delivered.push(next);
          }),
        );
      },
    }),
  );
  expect(typeof stop).toBe("function");
  emit("rev-1");
  emit("rev-2");
  await Promise.all(pending);
  expect(bumps).toBe(2);
  expect(loads).toBe(2);
  expect(delivered).toHaveLength(2);
  expect(delivered[0]).toEqual([workspace]);
  expect(delivered[1]).toEqual([workspace, cliWorktree]);
  stop!();
});

test("failed workspaces reload keeps the prior list (issue #218)", async () => {
  expect(
    await reloadWorkspacesSnapshot(async () => ({
      ok: false as const,
      error: { code: "gone", message: "daemon unreachable", retryable: true },
    })),
  ).toBeNull();
  expect(
    await reloadWorkspacesSnapshot(async () => {
      throw new Error("boom");
    }),
  ).toBeNull();
});
