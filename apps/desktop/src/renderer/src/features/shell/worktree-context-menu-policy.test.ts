import { describe, expect, test } from "vitest";
import {
  getFileManagerLabel,
  getWorktreeDeleteLabel,
  getWorktreeDeleteShortcutLabel,
  isWorktreeCreatable,
  isWorktreeDeletable,
  isWorktreeRenamable,
  shouldSuppressContextMenuFollowUpClick,
} from "./worktree-context-menu-policy";

describe("worktree context menu policy", () => {
  test("git worktrees are deletable, renamable and creatable", () => {
    expect(
      isWorktreeDeletable({
        projectKind: "git",
        implicitFolderWorktree: false,
      }),
    ).toBe(true);
    expect(isWorktreeRenamable({ implicitFolderWorktree: false })).toBe(true);
    expect(isWorktreeCreatable({ projectKind: "git" })).toBe(true);
  });

  test("implicit folder worktrees offer no delete or rename", () => {
    expect(
      isWorktreeDeletable({
        projectKind: "folder",
        implicitFolderWorktree: true,
      }),
    ).toBe(false);
    expect(
      isWorktreeDeletable({ projectKind: "git", implicitFolderWorktree: true }),
    ).toBe(false);
    expect(isWorktreeRenamable({ implicitFolderWorktree: true })).toBe(false);
  });

  test("folder projects cannot source new worktrees", () => {
    expect(isWorktreeCreatable({ projectKind: "folder" })).toBe(false);
  });

  test("delete row keeps the source label and shortcut chip", () => {
    expect(getWorktreeDeleteLabel()).toBe("Delete Worktree");
    expect(getWorktreeDeleteShortcutLabel("MacIntel")).toBe("⌘⇧⌫");
    expect(getWorktreeDeleteShortcutLabel("Win32")).toBe(
      "Ctrl+Shift+Backspace",
    );
  });

  test("file-manager label follows the platform", () => {
    expect(getFileManagerLabel("MacIntel")).toBe("Reveal in Finder");
    expect(getFileManagerLabel("Win32")).toBe("Show in folder");
  });

  test("follow-up clicks are suppressed briefly after opening", () => {
    expect(shouldSuppressContextMenuFollowUpClick(1000, 1200)).toBe(true);
    expect(shouldSuppressContextMenuFollowUpClick(1000, 1600)).toBe(false);
    expect(shouldSuppressContextMenuFollowUpClick(1000, 999)).toBe(false);
  });
});
