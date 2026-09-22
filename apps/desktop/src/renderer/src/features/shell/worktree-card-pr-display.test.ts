import { describe, expect, test } from "vitest";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import {
  getPrStateLabel,
  resolveCardPullRequest,
  resolveCardPrState,
  selectCardPull,
  type WorktreeCardPrDisplay,
} from "./worktree-card-pr-display";

const base: WorktreeCardPrDisplay = {
  provider: "github",
  number: 123,
  title: "Fix the sidebar",
};

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

describe("card PR state", () => {
  test("no linked review means no state and no icon", () => {
    expect(resolveCardPrState(null)).toBeNull();
  });

  test("merged wins over everything else gh reports", () => {
    expect(resolveCardPrState({ ...base, state: "merged", mergeable: "CONFLICTING" })).toBe(
      "merged",
    );
  });

  test("a conflicting branch is its own red state", () => {
    expect(resolveCardPrState({ ...base, state: "open", mergeable: "CONFLICTING" })).toBe(
      "conflicts",
    );
  });

  test("drafts are never ready, whether gh says it in state or isDraft", () => {
    expect(resolveCardPrState({ ...base, state: "draft" })).toBe("draft");
    expect(resolveCardPrState({ ...base, state: "open", isDraft: true })).toBe("draft");
  });

  test("ready is a confirmed claim: open, MERGEABLE, no failing checks, no requested changes", () => {
    expect(
      resolveCardPrState({ ...base, state: "open", mergeable: "MERGEABLE" }),
    ).toBe("ready");
    expect(
      resolveCardPrState({
        ...base,
        state: "open",
        mergeable: "MERGEABLE",
        checks: "success",
        reviewDecision: "APPROVED",
      }),
    ).toBe("ready");
  });

  test("unknown mergeability never reads as ready", () => {
    // gh reports UNKNOWN while still computing, and for concluded reviews;
    // a bare display with no mergeability verdict stays honestly open.
    expect(resolveCardPrState({ ...base, state: "open", mergeable: "UNKNOWN" })).toBe(
      "open",
    );
    expect(resolveCardPrState({ ...base, state: "open" })).toBe("open");
    expect(resolveCardPrState({ ...base })).toBe("open");
  });

  test("failing checks or requested changes never read as ready", () => {
    expect(
      resolveCardPrState({ ...base, state: "open", mergeable: "MERGEABLE", checks: "failure" }),
    ).toBe("open");
    expect(
      resolveCardPrState({
        ...base,
        state: "open",
        mergeable: "MERGEABLE",
        reviewDecision: "CHANGES_REQUESTED",
      }),
    ).toBe("open");
  });

  test("a closed review keeps its own state instead of reading as ready", () => {
    expect(resolveCardPrState({ ...base, state: "closed" })).toBe("closed");
  });

  test("every state has a label that claims exactly what it is", () => {
    expect([
      getPrStateLabel("merged"),
      getPrStateLabel("conflicts"),
      getPrStateLabel("draft"),
      getPrStateLabel("ready"),
      getPrStateLabel("open"),
      getPrStateLabel("closed"),
    ]).toEqual([
      "Merged",
      "Conflicts with the base branch",
      "Draft",
      "Ready to merge",
      "Open",
      "Closed",
    ]);
  });
});

describe("selectCardPull", () => {
  test("a worktree with no branch never matches", () => {
    expect(selectCardPull({ branch: "" }, [pull()])).toBeNull();
    expect(selectCardPull({ branch: "" }, [])).toBeNull();
  });

  test("no pull for the branch means no card review", () => {
    expect(
      selectCardPull({ branch: "feature" }, [pull({ headRefName: "other" })]),
    ).toBeNull();
  });

  test("a live review wins over concluded history on the same branch", () => {
    // collapsable-widgets carries MERGED #641 beneath OPEN #642; the card
    // must name the live review however the provider orders them.
    const merged = pull({ number: 641, state: "merged", headRefName: "collapsable-widgets" });
    const open = pull({ number: 642, state: "open", headRefName: "collapsable-widgets" });
    expect(selectCardPull({ branch: "collapsable-widgets" }, [merged, open])?.number).toBe(642);
    expect(selectCardPull({ branch: "collapsable-widgets" }, [open, merged])?.number).toBe(642);
  });

  test("the newest number wins within the same liveness group", () => {
    const older = pull({ number: 7, state: "open" });
    const newer = pull({ number: 9, state: "open" });
    expect(selectCardPull({ branch: "feature" }, [older, newer])?.number).toBe(9);
    expect(selectCardPull({ branch: "feature" }, [newer, older])?.number).toBe(9);
    const oldMerged = pull({ number: 3, state: "merged" });
    const newMerged = pull({ number: 5, state: "merged" });
    expect(selectCardPull({ branch: "feature" }, [oldMerged, newMerged])?.number).toBe(5);
  });
});

describe("resolveCardPullRequest", () => {
  function worktree(branch: string): import("../../../../shared/session-contract").Worktree {
    return {
      id: "wt-1",
      projectId: "proj-1",
      workspaceId: "ws-1",
      path: "/repo/wt-1",
      branch,
      head: "abc123",
      baseRef: "main",
      createdAt: "2026-09-09T00:00:00Z",
    };
  }

  test("names the live review on a branch with merged history", () => {
    const pulls = [
      pull({ number: 641, state: "merged", headRefName: "collapsable-widgets" }),
      pull({ number: 642, state: "open", headRefName: "collapsable-widgets", mergeable: "MERGEABLE" }),
    ];
    const display = resolveCardPullRequest(worktree("collapsable-widgets"), pulls);
    expect(display?.number).toBe(642);
    expect(display?.state).toBe("open");
  });

  test("carries the check rollup verdict that decides ready", () => {
    const failing = pull({
      checks: { state: "failure", total: 5, passed: 4, failed: 1, pending: 0, neutral: 0 },
    });
    const display = resolveCardPullRequest(worktree("feature"), [failing]);
    expect(display?.checks).toBe("failure");
    expect(resolveCardPrState(display)).toBe("open");
  });
});
