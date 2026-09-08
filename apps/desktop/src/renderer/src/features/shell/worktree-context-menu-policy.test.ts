import { describe, expect, test } from "vitest";
import {
  getFileManagerLabel,
  getWorktreeDeleteLabel,
  getWorktreeDeleteShortcutLabel,
  isWorktreeRenamable,
  shouldSuppressContextMenuFollowUpClick,
  worktreeDeleteRowKind,
} from "./worktree-context-menu-policy";

describe("worktree context menu policy", () => {
  test("git worktrees delete; folder implicit worktrees remove the workspace", () => {
    expect(
      worktreeDeleteRowKind({
        projectKind: "git",
        implicitFolderWorktree: false,
      }),
    ).toBe("delete");
    expect(
      worktreeDeleteRowKind({
        projectKind: "folder",
        implicitFolderWorktree: true,
      }),
    ).toBe("remove-workspace");
    expect(
      worktreeDeleteRowKind({ projectKind: "git", implicitFolderWorktree: true }),
    ).toBe("remove-workspace");
  });

  test("implicit folder worktrees offer no rename", () => {
    expect(isWorktreeRenamable({ implicitFolderWorktree: false })).toBe(true);
    expect(isWorktreeRenamable({ implicitFolderWorktree: true })).toBe(false);
  });

  test("delete row keeps the source labels and shortcut chip", () => {
    expect(getWorktreeDeleteLabel("delete")).toBe("Delete");
    expect(getWorktreeDeleteLabel("remove-workspace")).toBe("Remove Workspace");
    expect(getWorktreeDeleteShortcutLabel("MacIntel")).toBe("⌘⇧⌫");
    expect(getWorktreeDeleteShortcutLabel("Win32")).toBe(
      "Ctrl+Shift+Backspace",
    );
  });

  test("file-manager label follows the platform (source app-name copy)", () => {
    expect(getFileManagerLabel("MacIntel")).toBe("Finder");
    expect(getFileManagerLabel("Windows")).toBe("File Explorer");
    expect(getFileManagerLabel("Linux")).toBe("File Manager");
  });

  test("follow-up clicks are suppressed briefly after opening", () => {
    expect(shouldSuppressContextMenuFollowUpClick(1000, 1200)).toBe(true);
    expect(shouldSuppressContextMenuFollowUpClick(1000, 1600)).toBe(false);
    expect(shouldSuppressContextMenuFollowUpClick(1000, 999)).toBe(false);
  });
});
