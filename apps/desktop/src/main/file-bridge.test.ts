import { describe, expect, it } from "vitest";
import { dispatchFileRequest } from "./file-bridge";

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
    expect(calls).toEqual([["files.list", scope, undefined]]);
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
});
