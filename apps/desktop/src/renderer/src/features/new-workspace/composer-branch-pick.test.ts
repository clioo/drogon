import { describe, expect, test } from "vitest";
import {
  isBranchCheckedOutInWorktrees,
  resolveComposerBranchPick,
  resolveComposerBranchSelection,
} from "./composer-branch-pick";

describe("composer branch pick (the fork's smart-field branch semantics)", () => {
  test("an untouched name auto-derives from the local branch", () => {
    const pick = resolveComposerBranchPick({
      refName: "origin/feature-x",
      localBranchName: "feature-x",
      currentName: "",
      lastAutoName: "",
      worktreeBranches: [],
    });
    expect(pick.baseBranch).toBe("origin/feature-x");
    expect(pick.branchNameOverride).toBe("feature-x");
    expect(pick.name).toBe("feature-x");
    expect(pick.lastAutoName).toBe("feature-x");
  });

  test("a user-typed custom name is preserved and reuse stays off", () => {
    const pick = resolveComposerBranchPick({
      refName: "origin/main",
      localBranchName: "main",
      currentName: "my-own-name",
      lastAutoName: "",
      worktreeBranches: [],
    });
    expect(pick.name).toBeUndefined();
    expect(pick.branchNameOverride).toBeUndefined();
    // The ref is remote-only (`origin/`-prefixed): reuse is a local-branch
    // operation, so it is not eligible even with a custom name.
    expect(pick.reuseEligibleBranch).toBeNull();
    expect(pick.defaultReuse).toBe(false);
  });

  test("a remote-only ref is never reuse-eligible", () => {
    const pick = resolveComposerBranchPick({
      refName: "origin/feature-x",
      localBranchName: "feature-x",
      currentName: "",
      lastAutoName: "",
      worktreeBranches: [],
    });
    expect(pick.reuseEligibleBranch).toBeNull();
    expect(pick.defaultReuse).toBe(false);
  });

  test("a local branch checked out in another worktree cannot be reused", () => {
    expect(isBranchCheckedOutInWorktrees("main", ["refs/heads/main"])).toBe(
      true,
    );
    expect(isBranchCheckedOutInWorktrees("main", ["main"])).toBe(true);
    expect(isBranchCheckedOutInWorktrees("main", ["refs/heads/other"])).toBe(
      false,
    );
    const pick = resolveComposerBranchPick({
      refName: "main",
      localBranchName: "main",
      currentName: "",
      lastAutoName: "",
      worktreeBranches: ["main"],
    });
    // The override is dropped so the create derives a fresh branch from it.
    expect(pick.branchNameOverride).toBeUndefined();
    expect(pick.reuseEligibleBranch).toBeNull();
  });

  test("a local free branch defaults reuse on when the name was auto-derived", () => {
    const pick = resolveComposerBranchPick({
      refName: "main",
      localBranchName: "main",
      currentName: "",
      lastAutoName: "",
      worktreeBranches: [],
    });
    expect(pick.reuseEligibleBranch).toBe("main");
    expect(pick.defaultReuse).toBe(true);
  });

  test("the selection auto-name follows an edit back to the previous auto-name", () => {
    const selection = resolveComposerBranchSelection({
      refName: "origin/feature-y",
      localBranchName: "feature-y",
      currentName: "feature-x",
      lastAutoName: "feature-x",
    });
    expect(selection.name).toBe("feature-y");
  });
});
