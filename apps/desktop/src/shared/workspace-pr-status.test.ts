// MIT Copyright (c) 2026 Lovecast Inc.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TaskPullRequest } from "./tasks-contract";
import {
  derivePrStatusBucket,
  findPullRequestForWorktree,
  getPrStatusBucketFromGroupKey,
  getPrStatusGroupKey,
} from "./workspace-pr-status";

function pull(overrides: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    number: 1,
    title: "Add the thing",
    state: "open",
    labels: [],
    assignees: [],
    isDraft: false,
    headRefName: "feature",
    updatedAt: "2026-09-09T00:00:00Z",
    url: "https://github.com/example/repo/pull/1",
    ...overrides,
  };
}

describe("findPullRequestForWorktree / derivePrStatusBucket", () => {
  it("matches a pull request by exact branch name", () => {
    const pulls = [pull({ headRefName: "other" }), pull({ headRefName: "feature", number: 7 })];
    const found = findPullRequestForWorktree({ branch: "feature" }, pulls);
    expect(found?.number).toBe(7);
  });

  it("a worktree with no branch never matches (folder implicit worktree / detached HEAD)", () => {
    const pulls = [pull({ headRefName: "" })];
    expect(findPullRequestForWorktree({ branch: "" }, pulls)).toBeNull();
  });

  it("derives each real state bucket from the matched pull request", () => {
    for (const state of ["open", "draft", "merged", "closed"] as const) {
      expect(derivePrStatusBucket({ branch: "feature" }, [pull({ state })])).toBe(state);
    }
  });

  it("derives 'none' when the branch genuinely has no open pull request", () => {
    expect(derivePrStatusBucket({ branch: "feature" }, [pull({ headRefName: "other" })])).toBe(
      "none",
    );
    expect(derivePrStatusBucket({ branch: "feature" }, [])).toBe("none");
  });

  it("derives 'unavailable' -- distinct from 'none' -- when the provider call itself failed", () => {
    expect(derivePrStatusBucket({ branch: "feature" }, null)).toBe("unavailable");
  });
});

describe("getPrStatusGroupKey / getPrStatusBucketFromGroupKey", () => {
  it("round trips every real bucket", () => {
    for (const bucket of ["open", "draft", "merged", "closed", "none", "unavailable"] as const) {
      expect(getPrStatusBucketFromGroupKey(getPrStatusGroupKey(bucket))).toBe(bucket);
    }
  });

  it("rejects a key with a foreign prefix or an unknown bucket", () => {
    expect(getPrStatusBucketFromGroupKey("workspace-status:todo")).toBeNull();
    expect(getPrStatusBucketFromGroupKey("pr-status:not-a-real-bucket")).toBeNull();
  });
});
