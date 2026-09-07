import { describe, expect, it } from "vitest";
import {
  dispatchTasksProjectRequest,
  dispatchTasksRequest,
  type TasksMethod,
} from "./tasks-bridge";
import type { Result } from "../shared/session-contract";

const listResult = {
  repo: "example/repo",
  issues: [
    {
      number: 7,
      title: "Fix the sidebar crash",
      state: "open",
      labels: [{ name: "bug", color: "d73a4a" }],
      assignees: ["octocat"],
      updatedAt: "2026-09-06T12:00:00Z",
      url: "https://github.com/example/repo/issues/7",
    },
  ],
};

describe("tasks bridge admission", () => {
  it("validates input before invoking the service", async () => {
    let called = false;
    const result = await dispatchTasksRequest(
      "tasksList",
      { state: "open" },
      async () => {
        called = true;
        return { ok: true, result: listResult };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("rejects non-positive issue numbers locally", async () => {
    let called = false;
    const spy = async (): Promise<Result<unknown>> => {
      called = true;
      return { ok: true, result: {} };
    };
    for (const method of ["tasksShow", "tasksStart"] as TasksMethod[]) {
      const result = await dispatchTasksRequest(
        method,
        { projectId: "p", number: 0 },
        spy,
      );
      expect(result.ok).toBe(false);
    }
    expect(called).toBe(false);
  });

  it("passes typed service errors through untouched", async () => {
    const result = await dispatchTasksRequest(
      "tasksList",
      { projectId: "p" },
      async () => ({
        ok: false,
        error: {
          code: "gh_unavailable",
          message: "install gh",
          retryable: false,
        },
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "gh_unavailable" },
    });
  });

  it("rejects a start response for another project", async () => {
    const result = await dispatchTasksRequest(
      "tasksStart",
      { projectId: "p", number: 7 },
      async () => ({
        ok: true,
        result: {
          issueNumber: 7,
          worktree: {
            id: "w",
            projectId: "other",
            workspaceId: "ws",
            path: "/w",
            branch: "issue-7-x",
            head: "abc",
            baseRef: null,
            createdAt: "",
          },
          link: {
            projectId: "other",
            issueNumber: 7,
            worktreeId: "w",
            branch: "issue-7-x",
            createdAt: "",
          },
        },
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
  });

  it("accepts a well-formed list response", async () => {
    const result = await dispatchTasksRequest(
      "tasksList",
      { projectId: "p", state: "open" },
      async () => ({ ok: true, result: listResult }),
    );
    expect(result.ok).toBe(true);
  });
});

const nativeProject = {
  id: "p1",
  hostId: "h",
  path: "/repo",
  name: "repo",
  kind: "git",
  defaultBaseRef: null,
};
const nativeWorktree = {
  id: "w1",
  projectId: "p1",
  workspaceId: "ws1",
  path: "/repo-wt",
  branch: "issue-7-x",
  head: "abc",
  baseRef: null,
  createdAt: "",
};

function nativeCall(
  routes: Record<string, unknown>,
): (method: string) => Promise<Result<unknown>> {
  return async (method: string) => {
    if (!(method in routes))
      return {
        ok: false,
        error: { code: "method_not_found", message: "no", retryable: false },
      };
    return { ok: true, result: routes[method] };
  };
}

describe("tasks project passthrough", () => {
  it("merges uncovered workspaces as synthetic folder projects", async () => {
    const call = nativeCall({
      "project.list": { projects: [nativeProject] },
      "workspace.list": {
        workspaces: [
          { id: "ws1", path: "/repo", name: "repo", kind: "git", hostId: "h" },
          { id: "ws2", path: "/docs", name: "docs", kind: "folder", hostId: "h" },
          // A worktree checkout of the real project: covered, never doubled.
          { id: "ws3", path: "/repo-wt", name: "wt", kind: "git", hostId: "h" },
        ],
      },
      "worktree.list": { worktrees: [nativeWorktree] },
    });
    const result = await dispatchTasksProjectRequest("tasksProjects", {}, call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projects = (result.result as { projects: { id: string }[] })
      .projects;
    expect(projects.map((item) => item.id).sort()).toEqual([
      "folder:ws2",
      "p1",
    ]);
  });

  it("fans worktrees out per project plus uncovered implicit ones", async () => {
    const call = nativeCall({
      "project.list": { projects: [nativeProject] },
      "workspace.list": {
        workspaces: [
          { id: "ws2", path: "/docs", name: "docs", kind: "folder", hostId: "h" },
        ],
      },
      "worktree.list": { worktrees: [nativeWorktree] },
    });
    const result = await dispatchTasksProjectRequest(
      "tasksWorktrees",
      {},
      call,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const worktrees = (result.result as { worktrees: { id: string }[] })
      .worktrees;
    expect(worktrees.map((item) => item.id).sort()).toEqual([
      "implicit:ws2",
      "w1",
    ]);
  });

  it("scopes worktrees to one project when asked", async () => {
    let seen: object | null = null;
    const call = async (method: string, params: object) => {
      seen = params;
      return nativeCall({ "worktree.list": { worktrees: [nativeWorktree] } })(
        method,
      );
    };
    const result = await dispatchTasksProjectRequest(
      "tasksWorktrees",
      { projectId: "p1" },
      call,
    );
    expect(result.ok).toBe(true);
    expect(seen).toMatchObject({ projectId: "p1" });
  });

  it("fails closed when the service errors", async () => {
    const call = nativeCall({});
    for (const [method, input] of [
      ["tasksProjects", {}],
      ["tasksWorktrees", {}],
    ] as const) {
      const result = await dispatchTasksProjectRequest(method, input, call);
      expect(result.ok).toBe(false);
    }
  });
});
