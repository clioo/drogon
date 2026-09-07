import { describe, expect, it } from "vitest";
import { dispatchGitRequest, type GitMethod } from "./git-bridge";
import type { Result } from "../shared/session-contract";

const scope = { hostId: "host", workspaceId: "workspace" };
const status = {
  ...scope,
  branch: { head: "main" },
  entries: [
    { path: "a.txt", staged: "M", unstaged: ".", kind: "ordinary" },
    { path: "new.txt", staged: "?", unstaged: "?", kind: "untracked" },
  ],
  truncated: false,
};

describe("git bridge admission", () => {
  it("validates input before invoking the service", async () => {
    let called = false;
    const result = await dispatchGitRequest(
      "gitStatus",
      { workspaceId: "workspace" },
      async () => {
        called = true;
        return { ok: true, result: status };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it.each(["hostId", "workspaceId"])(
    "rejects a mismatching %s",
    async (key) => {
      const result = await dispatchGitRequest("gitStatus", scope, async () => ({
        ok: true,
        result: { ...status, [key]: "other" },
      }));
      expect(result).toMatchObject({
        ok: false,
        error: { code: "internal_error" },
      });
    },
  );

  it("rejects traversal paths and empty commit messages locally", async () => {
    let called = false;
    const spy = async (): Promise<Result<unknown>> => {
      called = true;
      return { ok: true, result: {} };
    };
    for (const [method, input] of [
      ["gitDiff", { ...scope, path: "../escape" }],
      ["gitStage", { ...scope, paths: [] }],
      ["gitCommit", { ...scope, message: "" }],
      ["gitPrCreate", { ...scope, title: "two\nlines" }],
    ] as const) {
      const result = await dispatchGitRequest(method, input, spy);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid_argument" },
      });
    }
    expect(called).toBe(false);
  });

  it("maps each bridge method to its native method", async () => {
    const calls: Array<[string, object]> = [];
    const natives: Record<string, unknown> = {
      "git.status": status,
      "git.diff": { ...scope, path: "a.txt", staged: false, diff: "", truncated: false },
      "git.stage": { ...scope, paths: ["a.txt"] },
      "git.unstage": { ...scope, paths: ["a.txt"] },
      "git.commit": { ...scope, commit: "abc123" },
      "git.push": { ...scope, pushed: true, detail: "Everything up-to-date" },
      "git.pr_create": { ...scope, url: "https://example.test/pr/1" },
    };
    const inputs: Record<string, object> = {
      gitStatus: scope,
      gitDiff: { ...scope, path: "a.txt" },
      gitStage: { ...scope, paths: ["a.txt"] },
      gitUnstage: { ...scope, paths: ["a.txt"] },
      gitCommit: { ...scope, message: "fix" },
      gitPush: scope,
      gitPrCreate: { ...scope, title: "title" },
    };
    for (const [method, input] of Object.entries(inputs)) {
      const result = await dispatchGitRequest(
        method as GitMethod,
        input,
        async (nativeMethod, params) => {
          calls.push([nativeMethod, params]);
          return { ok: true, result: natives[nativeMethod] };
        },
      );
      expect(result.ok).toBe(true);
    }
    expect(calls.map(([method]) => method).sort()).toEqual([
      "git.commit",
      "git.diff",
      "git.pr_create",
      "git.push",
      "git.stage",
      "git.status",
      "git.unstage",
    ]);
  });

  it("passes service errors through untouched", async () => {
    const result = await dispatchGitRequest("gitPush", scope, async () => ({
      ok: false,
      error: { code: "gh_unavailable", message: "no gh", retryable: false },
    }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "gh_unavailable" },
    });
  });
});
