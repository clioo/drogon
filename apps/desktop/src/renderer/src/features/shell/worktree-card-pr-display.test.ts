import { describe, expect, test } from "vitest";
import {
  getPrStateLabel,
  resolveCardPrState,
  type WorktreeCardPrDisplay,
} from "./worktree-card-pr-display";

const base: WorktreeCardPrDisplay = {
  provider: "github",
  number: 123,
  title: "Fix the sidebar",
};

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
    // UNKNOWN mergeability is not a conflict claim.
    expect(resolveCardPrState({ ...base, state: "open", mergeable: "UNKNOWN" })).toBe(
      "ready",
    );
  });

  test("drafts are never ready, whether gh says it in state or isDraft", () => {
    expect(resolveCardPrState({ ...base, state: "draft" })).toBe("draft");
    expect(resolveCardPrState({ ...base, state: "open", isDraft: true })).toBe("draft");
  });

  test("an open review with no conflicts is ready to merge", () => {
    expect(resolveCardPrState({ ...base, state: "open", mergeable: "MERGEABLE" })).toBe(
      "ready",
    );
    expect(resolveCardPrState({ ...base })).toBe("ready");
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
      getPrStateLabel("closed"),
    ]).toEqual([
      "Merged",
      "Conflicts with the base branch",
      "Draft",
      "Ready to merge",
      "Closed",
    ]);
  });
});
