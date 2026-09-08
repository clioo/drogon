import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FILES_CHANGED_CHANNEL,
  MAX_WATCHED_WORKSPACES,
  dispatchFileRequest,
  ensureWorkspaceWatch,
  setFilesWatcherDeps,
  stopFilesWatchers,
  watchedWorkspaceCount,
} from "./file-bridge";
import { resultSchemas } from "../shared/result-validation";

const scope = { hostId: "host", workspaceId: "workspace", path: "hello.txt" };
const file = { ...scope, content: "é", size: 2, mtime: "2026-09-07T00:00:00Z" };

describe("file bridge admission", () => {
  it("validates missing host before invoking the service", async () => {
    let called = false;
    const result = await dispatchFileRequest(
      "fileRead",
      { workspaceId: "workspace", path: "hello.txt" },
      async () => {
        called = true;
        return { ok: true, result: file };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it.each(["hostId", "workspaceId", "path"])(
    "rejects a mismatching %s",
    async (key) => {
      const result = await dispatchFileRequest("fileRead", scope, async () => ({
        ok: true,
        result: { ...file, [key]: "other" },
      }));
      expect(result).toMatchObject({
        ok: false,
        error: { code: "internal_error" },
      });
    },
  );

  it("checks UTF-8 byte counts rather than character counts", async () => {
    const accepted = await dispatchFileRequest("fileRead", scope, async () => ({
      ok: true,
      result: file,
    }));
    expect(accepted.ok).toBe(true);
    const rejected = await dispatchFileRequest("fileRead", scope, async () => ({
      ok: true,
      result: { ...file, size: 1 },
    }));
    expect(rejected.ok).toBe(false);
  });

  it("preserves caller request identity and sends encoded file bytes", async () => {
    const calls: unknown[] = [];
    const result = await dispatchFileRequest(
      "fileWrite",
      { ...scope, content: "é", requestId: "save-once" },
      async (...args) => {
        calls.push(args);
        return { ok: true, result: { ...scope, size: 2, mtime: file.mtime } };
      },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["files.write", { ...scope, contentBase64: "w6k=" }, "save-once"],
    ]);
  });

  it("refuses over-limit multibyte content before calling the service", async () => {
    let called = false;
    const result = await dispatchFileRequest(
      "fileWrite",
      { ...scope, content: "é".repeat(32_769), requestId: "large" },
      async () => {
        called = true;
        return { ok: true, result: file };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("preserves method-not-found from an older host without local fallback", async () => {
    const error = {
      code: "method_not_found",
      message: "Unsupported method.",
      retryable: false,
    };
    expect(
      await dispatchFileRequest("fileRead", scope, async () => ({
        ok: false,
        error,
      })),
    ).toEqual({ ok: false, error });
  });

  it("passes includeHidden through to files.list when given", async () => {
    const calls: unknown[] = [];
    const entries = [
      { name: "shown.txt", kind: "file", size: 1, mtime: file.mtime },
    ];
    const result = await dispatchFileRequest(
      "fileList",
      { ...scope, includeHidden: false },
      async (...args) => {
        calls.push(args);
        return { ok: true, result: { ...scope, entries, truncated: false } };
      },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["files.list", { ...scope, includeHidden: false }, undefined],
      // R16-L #157: a listed workspace arms the live watcher (root lookup);
      // the fake answers no workspaces, so nothing is watched.
      ["workspace.list", {}],
    ]);
  });

  it("omits includeHidden from the wire params when not requested", async () => {
    const calls: unknown[] = [];
    await dispatchFileRequest("fileList", scope, async (...args) => {
      calls.push(args);
      return {
        ok: true,
        result: { ...scope, entries: [], truncated: false },
      };
    });
    expect(calls).toEqual([
      ["files.list", scope, undefined],
      // R16-L #157: a listed workspace arms the live watcher (root lookup);
      // the fake answers no workspaces, so nothing is watched.
      ["workspace.list", {}],
    ]);
  });

  it("rejects results exceeding the specific requested bound", async () => {
    const read = await dispatchFileRequest(
      "fileRead",
      { ...scope, maxBytes: 1 },
      async () => ({ ok: true, result: file }),
    );
    expect(read.ok).toBe(false);
    const list = await dispatchFileRequest(
      "fileList",
      { ...scope, limitEntries: 1 },
      async () => ({
        ok: true,
        result: {
          ...scope,
          entries: ["a", "b"].map((name) => ({
            name,
            kind: "file",
            size: 0,
            mtime: file.mtime,
          })),
          truncated: false,
        },
      }),
    );
    expect(list.ok).toBe(false);
  });

  it("maps fileCreate onto files.create with identity checks", async () => {
    const calls: unknown[] = [];
    const created = { ...scope, kind: "directory" as const };
    const result = await dispatchFileRequest(
      "fileCreate",
      { ...scope, kind: "directory" },
      async (...args) => {
        calls.push(args);
        return { ok: true, result: created };
      },
    );
    expect(result).toEqual({ ok: true, result: created });
    expect(calls).toEqual([["files.create", { ...scope, kind: "directory" }]]);
    // A mismatched kind echo is a wire violation, not a result.
    const mismatched = await dispatchFileRequest(
      "fileCreate",
      { ...scope, kind: "file" },
      async () => ({ ok: true, result: created }),
    );
    expect(mismatched).toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
  });

  it("rejects fileCreate for unknown kinds before calling the service", async () => {
    let called = false;
    const result = await dispatchFileRequest(
      "fileCreate",
      { ...scope, kind: "symlink" },
      async () => {
        called = true;
        return { ok: true, result: scope };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("maps fileRename onto files.rename with from/to echo checks", async () => {
    const calls: unknown[] = [];
    const rename = {
      hostId: "host",
      workspaceId: "workspace",
      from: "a.txt",
      to: "b.txt",
    };
    const result = await dispatchFileRequest(
      "fileRename",
      rename,
      async (...args) => {
        calls.push(args);
        return { ok: true, result: rename };
      },
    );
    expect(result).toEqual({ ok: true, result: rename });
    expect(calls).toEqual([["files.rename", rename]]);
    const swapped = await dispatchFileRequest("fileRename", rename, async () => ({
      ok: true,
      result: { ...rename, to: "c.txt" },
    }));
    expect(swapped).toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
  });

  it("maps fileDelete onto files.delete and requires the full batch echo", async () => {
    const calls: unknown[] = [];
    const input = {
      hostId: "host",
      workspaceId: "workspace",
      paths: ["a.txt", "dir"],
    };
    const echoed = { ...input, deleted: ["a.txt", "dir"] };
    const result = await dispatchFileRequest(
      "fileDelete",
      input,
      async (...args) => {
        calls.push(args);
        return { ok: true, result: echoed };
      },
    );
    // The validated result carries the daemon's echo shape (no request keys).
    expect(result).toEqual({
      ok: true,
      result: { hostId: "host", workspaceId: "workspace", deleted: ["a.txt", "dir"] },
    });
    expect(calls).toEqual([["files.delete", input]]);
    // A partial echo is a wire violation.
    const partial = await dispatchFileRequest("fileDelete", input, async () => ({
      ok: true,
      result: { ...input, deleted: ["a.txt"] },
    }));
    expect(partial).toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
  });

  it("bounds fileDelete batches and preserves older-host errors", async () => {
    let called = false;
    const oversized = await dispatchFileRequest(
      "fileDelete",
      { hostId: "host", workspaceId: "workspace", paths: new Array(129).fill("a.txt") },
      async () => {
        called = true;
        return { ok: true, result: {} };
      },
    );
    expect(oversized.ok).toBe(false);
    expect(called).toBe(false);
    const missing = {
      code: "method_not_found",
      message: "Unsupported method.",
      retryable: false,
    };
    expect(
      await dispatchFileRequest(
        "fileDelete",
        { hostId: "host", workspaceId: "workspace", paths: ["a.txt"] },
        async () => ({ ok: false, error: missing }),
      ),
    ).toEqual({ ok: false, error: missing });
  });

  it("maps fileSearch onto files.search with identity and bound checks", async () => {
    const seen: unknown[] = [];
    const search = { hostId: "host", workspaceId: "workspace", query: "app" };
    const response = {
      hostId: "host",
      workspaceId: "workspace",
      query: "app",
      files: ["src/app.ts"],
      truncated: false,
    };
    const accepted = await dispatchFileRequest("fileSearch", search, async (method, params) => {
      seen.push([method, params]);
      return { ok: true, result: response };
    });
    expect(accepted.ok).toBe(true);
    expect(seen).toEqual([
      ["files.search", { hostId: "host", workspaceId: "workspace", query: "app" }],
    ]);
    // Daemon echoes the trimmed query; an untrimmed ask still validates.
    const padded = await dispatchFileRequest(
      "fileSearch",
      { ...search, query: "  app  " },
      async () => ({ ok: true, result: response }),
    );
    expect(padded.ok).toBe(true);
    const mismatched = await dispatchFileRequest("fileSearch", search, async () => ({
      ok: true,
      result: { ...response, workspaceId: "other" },
    }));
    expect(mismatched).toMatchObject({ ok: false, error: { code: "internal_error" } });
    const overLimit = await dispatchFileRequest(
      "fileSearch",
      { ...search, limit: 501 },
      async () => ({ ok: true, result: response }),
    );
    expect(overLimit).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
  });
});

describe("explorer mutation result contracts (R16-L #156/#157)", () => {
  it("covers every files.* method the bridge can call through callNative", () => {
    // Root cause of both issues: callNative parses EVERY daemon reply
    // through this table, so a missing entry turned a successful on-disk
    // rename/delete into a malformed-contract error and the tree never
    // refreshed. This guards the table, not just the bridge above it.
    for (const method of ["files.create", "files.rename", "files.delete"]) {
      expect(
        resultSchemas[method],
        `${method} must have a result schema`,
      ).toBeDefined();
    }
  });

  it("parses the daemon's mutation echoes", () => {
    expect(
      resultSchemas["files.create"].safeParse({
        hostId: "host",
        workspaceId: "workspace",
        path: "fresh.txt",
        kind: "file",
      }).success,
    ).toBe(true);
    expect(
      resultSchemas["files.rename"].safeParse({
        hostId: "host",
        workspaceId: "workspace",
        from: "scratch.txt",
        to: "notes.txt",
      }).success,
    ).toBe(true);
    expect(
      resultSchemas["files.delete"].safeParse({
        hostId: "host",
        workspaceId: "workspace",
        deleted: ["notes.txt"],
      }).success,
    ).toBe(true);
  });
});

describe("workspace watcher (R16-L #157)", () => {
  afterEach(() => {
    vi.useRealTimers();
    setFilesWatcherDeps(null);
    stopFilesWatchers();
  });

  const workspaceList = (
    workspaces: Array<{ id: string; path: string; hostId?: string }>,
    calls: unknown[] = [],
  ) =>
    async (method: string, params: unknown) => {
      calls.push([method, params]);
      if (method === "workspace.list")
        return { ok: true as const, result: { workspaces } };
      throw new Error(`unexpected call ${method}`);
    };

  function setup(ticks: unknown[], platform: NodeJS.Platform = "darwin") {
    const events = new Map<string, () => void>();
    const errors = new Map<string, () => void>();
    const watched: Array<{ root: string; recursive: boolean }> = [];
    const closed: string[] = [];
    setFilesWatcherDeps({
      platform,
      broadcast: (tick) => void ticks.push(tick),
      watchRoot: (root, recursive, onEvent, onError) => {
        watched.push({ root, recursive });
        events.set(root, onEvent);
        errors.set(root, onError);
        return {
          close: () => void closed.push(root),
        };
      },
    });
    return { events, errors, watched, closed };
  }

  it("publishes the channel name the preload subscribes to", () => {
    expect(FILES_CHANGED_CHANNEL).toBe("drogon:filesChanged");
  });

  it("watches the resolved root and coalesces a storm into one tick", async () => {
    vi.useFakeTimers();
    const ticks: unknown[] = [];
    const { events, watched } = setup(ticks);
    const call = workspaceList([{ id: "ws", path: "/root", hostId: "host" }]);
    await ensureWorkspaceWatch("host", "ws", call);
    expect(watched).toEqual([{ root: "/root", recursive: true }]);

    events.get("/root")?.();
    events.get("/root")?.();
    events.get("/root")?.();
    expect(ticks).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(ticks).toEqual([{ workspaceId: "ws" }]);
  });

  it("watches non-recursively where the platform has no recursive watch", async () => {
    vi.useFakeTimers();
    const { watched } = setup([], "linux");
    await ensureWorkspaceWatch(
      "host",
      "ws",
      workspaceList([{ id: "ws", path: "/root" }]),
    );
    expect(watched).toEqual([{ root: "/root", recursive: false }]);
  });

  it("reuses the live watch instead of resolving the root again", async () => {
    vi.useFakeTimers();
    const { watched } = setup([]);
    const calls: unknown[] = [];
    const call = workspaceList([{ id: "ws", path: "/root" }], calls);
    await ensureWorkspaceWatch("host", "ws", call);
    await ensureWorkspaceWatch("host", "ws", call);
    expect(watched).toHaveLength(1);
    expect(calls).toEqual([["workspace.list", {}]]);
  });

  it("stays fail-closed when the root cannot be resolved", async () => {
    vi.useFakeTimers();
    setup([]);
    await ensureWorkspaceWatch("host", "missing", workspaceList([]));
    expect(watchedWorkspaceCount()).toBe(0);
    await ensureWorkspaceWatch("host", "ws", async () => ({
      ok: false as const,
      error: { code: "unreachable", message: "down", retryable: true },
    }));
    expect(watchedWorkspaceCount()).toBe(0);
  });

  it("drops a dead root without touching the rest", async () => {
    vi.useFakeTimers();
    const { errors, closed } = setup([]);
    const call = (id: string) => workspaceList([{ id, path: `/${id}` }]);
    await ensureWorkspaceWatch("host", "ws-a", call("ws-a"));
    await ensureWorkspaceWatch("host", "ws-b", call("ws-b"));
    errors.get("/ws-a")?.();
    expect(watchedWorkspaceCount()).toBe(1);
    expect(closed).toEqual(["/ws-a"]);
  });

  it("evicts the oldest watch past the bound", async () => {
    vi.useFakeTimers();
    const { closed } = setup([]);
    const call = (id: string) => workspaceList([{ id, path: `/${id}` }]);
    for (let index = 0; index < MAX_WATCHED_WORKSPACES; index += 1) {
      await ensureWorkspaceWatch("host", `ws-${index}`, call(`ws-${index}`));
    }
    expect(watchedWorkspaceCount()).toBe(MAX_WATCHED_WORKSPACES);
    await ensureWorkspaceWatch("host", "ws-new", call("ws-new"));
    expect(watchedWorkspaceCount()).toBe(MAX_WATCHED_WORKSPACES);
    expect(closed).toContain("/ws-0");
  });
});
