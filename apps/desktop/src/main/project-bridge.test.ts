import { describe, expect, test } from "vitest";
import {
  dispatchProjectRequest,
  startProjectRegistryWatcher,
} from "./project-bridge";
import { PROJECTS_CHANGED_CHANNEL } from "../shared/project-contract";

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

  test("forwards worktree.rename with worktreeId/name and returns the title", async () => {
    const renamed = {
      ok: true as const,
      result: {
        id: "t1",
        projectId: "p1",
        workspaceId: "w9",
        path: "/data/repo/demo-a",
        branch: "demo-a",
        head: "abc",
        baseRef: "main",
        title: "My feature",
        createdAt: "2026-09-07T00:00:00Z",
      },
    };
    const seen: Array<{ method: string; params: object }> = [];
    const result = await dispatchProjectRequest(
      "worktreeRename",
      { worktreeId: "t1", name: "My feature" },
      async (method, params) => {
        seen.push({ method, params });
        return renamed;
      },
    );
    expect(seen).toEqual([
      { method: "worktree.rename", params: { worktreeId: "t1", name: "My feature" } },
    ]);
    expect(result).toEqual(renamed);
  });

  test("rejects worktree.rename with a blank name before reaching the service", async () => {
    let called = false;
    const result = await dispatchProjectRequest(
      "worktreeRename",
      { worktreeId: "t1", name: "" },
      async () => {
        called = true;
        return { ok: true as const, result: {} };
      },
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
  });

  test("preserves a renamed worktree title through the list response", async () => {
    const listed = {
      ok: true as const,
      result: {
        worktrees: [
          {
            id: "t1",
            projectId: "p1",
            workspaceId: "w9",
            path: "/data/repo/demo-a",
            branch: "demo-a",
            head: "abc",
            baseRef: null,
            title: "ZQ",
            createdAt: "2026-09-07T00:00:00Z",
          },
        ],
      },
    };
    const result = await dispatchProjectRequest(
      "worktreeList",
      { projectId: "p1" },
      async () => listed,
    );
    expect(result).toEqual(listed);
  });

  test("registry watcher pushes exactly when the revision moves (issue #146)", async () => {
    const sent: Array<{ channel: string; revision: string }> = [];
    const window = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, revision: string) =>
          sent.push({ channel, revision }),
      },
    };
    // Baseline, rest, unreadable, move, rest: only the move pushes.
    const revisions: Array<string | null> = ["a", "a", null, "b", "b"];
    const watcher = startProjectRegistryWatcher({
      // The watcher only needs `isDestroyed`/`webContents.send`.
      getWindow: () => window as never,
      readRevision: async () => revisions.shift() ?? null,
      pollIntervalMs: 60_000,
    });
    try {
      await watcher.tick();
      expect(sent).toEqual([]);
      await watcher.tick();
      expect(sent).toEqual([]);
      await watcher.tick();
      expect(sent).toEqual([]);
      await watcher.tick();
      expect(sent).toEqual([
        { channel: PROJECTS_CHANGED_CHANNEL, revision: "b" },
      ]);
      await watcher.tick();
      expect(sent).toHaveLength(1);
    } finally {
      watcher.stop();
    }
  });

  test("registry watcher stays silent without a window and on a throwing reader", async () => {
    const sent: string[] = [];
    const destroyed = {
      isDestroyed: () => true,
      webContents: {
        send: (channel: string) => sent.push(channel),
      },
    };
    const watcher = startProjectRegistryWatcher({
      getWindow: () => destroyed as never,
      readRevision: async () => {
        throw new Error("daemon down");
      },
      pollIntervalMs: 60_000,
    });
    try {
      await watcher.tick();
      await watcher.tick();
      expect(sent).toEqual([]);
    } finally {
      watcher.stop();
    }
    // A null window is equally silent: the baseline still advances so a
    // later window is not spammed with a stale move.
    let reads = 0;
    const headless = startProjectRegistryWatcher({
      getWindow: () => null,
      readRevision: async () => (reads += 1) > 1 ? "moved" : "base",
      pollIntervalMs: 60_000,
    });
    try {
      await headless.tick();
      await headless.tick();
    } finally {
      headless.stop();
    }
    expect(reads).toBe(2);
  });

  test("accepts a worktree without a title (never renamed yet)", async () => {
    const listed = {
      ok: true as const,
      result: {
        worktrees: [
          {
            id: "t1",
            projectId: "p1",
            workspaceId: "w9",
            path: "/data/repo/demo-a",
            branch: "demo-a",
            head: "abc",
            baseRef: null,
            title: null,
            createdAt: "2026-09-07T00:00:00Z",
          },
        ],
      },
    };
    const result = await dispatchProjectRequest(
      "worktreeList",
      { projectId: "p1" },
      async () => listed,
    );
    expect(result).toEqual(listed);
  });
});
