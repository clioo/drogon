// MIT Copyright (c) 2026 Lovecast Inc.
// Test cases ported from Orca's
// src/renderer/src/components/sidebar/WorktreeTitleInlineRename.test.tsx
// (trim-and-save, blank/unchanged cancel, failure copy), adapted to the
// local getWorktreeTitleRenameCommit helper.
import { describe, expect, test } from "vitest";
import {
  getWorktreeTitleRenameCommit,
  worktreeRenameFailureCopy,
} from "./WorktreeTitleInlineRename";

describe("worktree title rename commit", () => {
  test("trims and saves a changed title", () => {
    expect(getWorktreeTitleRenameCommit("Old", "  New  ")).toEqual({
      kind: "save",
      displayName: "New",
    });
  });

  test("empty or unchanged input cancels (Enter is a no-op)", () => {
    expect(getWorktreeTitleRenameCommit("Old", "")).toEqual({
      kind: "cancel",
    });
    expect(getWorktreeTitleRenameCommit("Old", "   ")).toEqual({
      kind: "cancel",
    });
    expect(getWorktreeTitleRenameCommit("Old", "Old")).toEqual({
      kind: "cancel",
    });
    expect(getWorktreeTitleRenameCommit("Old", "  Old  ")).toEqual({
      kind: "cancel",
    });
  });

  test("failure copy matches the source dialog text", () => {
    expect(worktreeRenameFailureCopy()).toBe("Failed to rename workspace.");
  });
});
