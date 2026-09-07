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
});
