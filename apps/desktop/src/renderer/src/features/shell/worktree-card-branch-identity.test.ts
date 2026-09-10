// MIT Copyright (c) 2026 Lovecast Inc.
// Fork parity (worktree-card-presentation.tsx `showBranch`): the meta row
// shows the real branch, never a line that only repeats the card title. The
// owner's screenshot showed `seconf-feature` above and `seconf-feature`
// below, because Drogon creates worktrees with `git worktree add -b <name>`.
import { describe, expect, test } from "vitest";
import { worktreeCardBranchLabel } from "./worktree-card-branch-identity";

describe("worktreeCardBranchLabel", () => {
  test("keeps a real, distinct branch", () => {
    expect(
      worktreeCardBranchLabel("clioo/drogon-qa-bot-monitors", "drogon-qa-bot-monitors"),
    ).toBe("clioo/drogon-qa-bot-monitors");
  });

  test("never repeats the card title", () => {
    expect(worktreeCardBranchLabel("seconf-feature", "seconf-feature")).toBe("");
    expect(worktreeCardBranchLabel("  seconf-feature  ", "seconf-feature")).toBe("");
  });

  test("treats an absent branch as nothing to show", () => {
    expect(worktreeCardBranchLabel("", "feature")).toBe("");
    expect(worktreeCardBranchLabel("   ", "feature")).toBe("");
    expect(worktreeCardBranchLabel(null, "feature")).toBe("");
    expect(worktreeCardBranchLabel(undefined, "feature")).toBe("");
  });
});
