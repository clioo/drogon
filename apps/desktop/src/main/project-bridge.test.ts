import { describe, expect, test } from "vitest";
import { dispatchProjectRequest } from "./project-bridge";

const okProjects = {
  ok: true as const,
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
};

describe("dispatchProjectRequest", () => {
  test("rejects a project.add without a path before reaching the service", async () => {
    let called = false;
    const result = await dispatchProjectRequest(
      "projectAdd",
      { name: "x" },
      async () => {
        called = true;
        return okProjects;
      },
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
  });

  test("forwards project.list with empty params and returns the result", async () => {
    const seen: Array<{ method: string; params: object }> = [];
    const result = await dispatchProjectRequest(
      "projectList",
      undefined,
      async (method, params) => {
        seen.push({ method, params });
        return okProjects;
      },
    );
    expect(seen).toEqual([{ method: "project.list", params: {} }]);
    expect(result).toEqual(okProjects);
  });

  test("forwards worktree.create with its params verbatim", async () => {
    const created = {
      ok: true as const,
      result: {
        id: "t1",
        projectId: "p1",
        workspaceId: "w9",
        path: "/data/repo/demo-a",
        branch: "demo-a",
        head: "abc",
        baseRef: "main",
        createdAt: "2026-09-07T00:00:00Z",
      },
    };
    const seen: Array<{ method: string; params: object }> = [];
    const result = await dispatchProjectRequest(
      "worktreeCreate",
      { projectId: "p1", name: "demo-a", baseRef: "main" },
      async (method, params) => {
        seen.push({ method, params });
        return created;
      },
    );
    expect(seen[0]?.method).toBe("worktree.create");
    expect(result).toEqual(created);
  });

  test("passes service errors through untouched", async () => {
    const failure = {
      ok: false as const,
      error: { code: "io_error", message: "git blew up", retryable: false },
    };
    const result = await dispatchProjectRequest(
      "worktreeRemove",
      { id: "t1", force: true },
      async () => failure,
    );
    expect(result).toEqual(failure);
  });

  test("refuses a contract-violating service payload instead of forwarding it", async () => {
    const result = await dispatchProjectRequest(
      "projectList",
      undefined,
      async () => ({ ok: true as const, result: { projects: [{ id: "p1" }] } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal_error");
  });

  test("rejects worktree.list without a projectId (the daemon requires it)", async () => {
    let called = false;
    const result = await dispatchProjectRequest(
      "worktreeList",
      {},
      async () => {
        called = true;
        return { ok: true as const, result: { worktrees: [] } };
      },
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
  });
});
