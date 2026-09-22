// MIT Copyright (c) 2026 Lovecast Inc.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TaskPullRequest } from "./tasks-contract";
import {
  derivePrStatusBucket,
  findPullRequestForWorktree,
  getPrStatusBucketFromGroupKey,
  getPrStatusGroupKey,
  isLivePullRequest,
  selectBranchPullRequest,
  selectCanonicalPullRequest,
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

describe("canonical selection: branch first, live-first, newest number", () => {
  const branchPulls: TaskPullRequest[] = [
    pull({ number: 641, state: "merged", headRefName: "w" }),
    pull({ number: 642, state: "open", headRefName: "w" }),
    pull({ number: 640, state: "closed", headRefName: "w" }),
  ];

  it("prefers the live review over concluded history on the same branch", () => {
    expect(selectBranchPullRequest({ branch: "w" }, branchPulls)?.number).toBe(642);
    expect(selectCanonicalPullRequest({ branch: "w" }, branchPulls)?.number).toBe(642);
  });

  it("never depends on input array order", () => {
    const shuffled = [...branchPulls].reverse();
    expect(selectBranchPullRequest({ branch: "w" }, shuffled)?.number).toBe(642);
    expect(selectCanonicalPullRequest({ branch: "w" }, shuffled)?.number).toBe(642);
    // Newest live wins among several; newest concluded wins when no live review exists.
    const multiLive = [
      pull({ number: 3, state: "open", headRefName: "w" }),
      pull({ number: 5, state: "draft", headRefName: "w" }),
      pull({ number: 4, state: "open", headRefName: "w" }),
    ];
    expect(selectBranchPullRequest({ branch: "w" }, multiLive)?.number).toBe(5);
    const concludedOnly = [
      pull({ number: 9, state: "closed", headRefName: "w" }),
      pull({ number: 7, state: "merged", headRefName: "w" }),
    ];
    expect(selectBranchPullRequest({ branch: "w" }, concludedOnly)?.number).toBe(9);
    expect(selectBranchPullRequest({ branch: "w" }, [...concludedOnly].reverse())?.number).toBe(9);
  });

  it("a draft is live: it beats concluded history but loses to a newer live review", () => {
    expect(
      selectBranchPullRequest({ branch: "w" }, [
        pull({ number: 8, state: "merged", headRefName: "w" }),
        pull({ number: 7, state: "draft", headRefName: "w" }),
      ])?.number,
    ).toBe(7);
    expect(isLivePullRequest({ state: "draft" })).toBe(true);
    expect(isLivePullRequest({ state: "open" })).toBe(true);
    expect(isLivePullRequest({ state: "merged" })).toBe(false);
    expect(isLivePullRequest({ state: "closed" })).toBe(false);
  });

  it("falls back to the real stored linked number when the branch matched nothing", () => {
    const pulls = [pull({ number: 7, state: "merged", headRefName: "renamed" })];
    // Retargeted since: the branch names nothing, the stored link names #7.
    expect(
      selectCanonicalPullRequest({ branch: "feature", linkedPr: 7 }, pulls)?.number,
    ).toBe(7);
    expect(derivePrStatusBucket({ branch: "feature", linkedPr: 7 }, pulls)).toBe("merged");
  });

  it("the branch correlation wins over the stored link when both name reviews", () => {
    const pulls = [
      pull({ number: 7, state: "merged", headRefName: "renamed" }),
      pull({ number: 9, state: "open", headRefName: "feature" }),
    ];
    expect(
      selectCanonicalPullRequest({ branch: "feature", linkedPr: 7 }, pulls)?.number,
    ).toBe(9);
    expect(derivePrStatusBucket({ branch: "feature", linkedPr: 7 }, pulls)).toBe("open");
  });

  it("an unknown or implausible stored link resolves to no review, never an invented one", () => {
    const pulls = [pull({ number: 7, state: "open", headRefName: "elsewhere" })];
    for (const linkedPr of [undefined, null, 0, -3, 2.5, 99] as const) {
      expect(
        selectCanonicalPullRequest({ branch: "feature", linkedPr }, pulls),
      ).toBeNull();
      expect(
        derivePrStatusBucket({ branch: "feature", linkedPr }, pulls),
      ).toBe("none");
    }
  });

  it("duplicate numbers in different projects resolve independently per listing", () => {
    // Each project's listing is its own scope: PR #1 in repo A and PR #1
    // in repo B are different reviews, so the same worktree identity picks
    // each listing's own branch match rather than leaking across.
    const listingA = [pull({ number: 1, state: "open", headRefName: "alpha" })];
    const listingB = [pull({ number: 1, state: "merged", headRefName: "beta" })];
    expect(selectCanonicalPullRequest({ branch: "alpha" }, listingA)?.state).toBe("open");
    expect(selectCanonicalPullRequest({ branch: "alpha" }, listingB)).toBeNull();
    expect(derivePrStatusBucket({ branch: "alpha" }, listingA)).toBe("open");
    expect(derivePrStatusBucket({ branch: "alpha" }, listingB)).toBe("none");
    expect(derivePrStatusBucket({ branch: "beta" }, listingB)).toBe("merged");
  });

  it("stale knowledge resolves through the same policy: same review, same bucket", () => {
    // A failed refresh keeps the last-good listing (facts don't expire);
    // the bucket keeps naming that review while only the ready-claim lapses.
    const stale = [pull({ number: 7, state: "open", headRefName: "feature" })];
    expect(selectCanonicalPullRequest({ branch: "feature" }, stale)?.number).toBe(7);
    expect(derivePrStatusBucket({ branch: "feature" }, stale)).toBe("open");
    // A failed listing is unavailable, never none.
    expect(derivePrStatusBucket({ branch: "feature" }, null)).toBe("unavailable");
  });

  it("a branch-less worktree with a stored link still resolves the link", () => {
    const pulls = [pull({ number: 7, state: "open", headRefName: "elsewhere" })];
    expect(selectCanonicalPullRequest({ branch: "", linkedPr: 7 }, pulls)?.number).toBe(7);
    expect(derivePrStatusBucket({ branch: "", linkedPr: 7 }, pulls)).toBe("open");
    expect(selectCanonicalPullRequest({ branch: "" }, pulls)).toBeNull();
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
